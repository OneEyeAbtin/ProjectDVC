'use strict';
/**
 * [MODULE] bot.js
 * [SYSTEM] ProjectDVC — WebSocket nerve center. Bootstraps the Mineflayer instance,
 *          routes Python upstream commands to drone sub-modules, and bleeds
 *          telemetry, radar, and lifecycle events back to the desktop application.
 * [AUTHOR] Abtin
 * 
 * Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
 */
const mineflayer   = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const WebSocket    = require('ws');

// ── Version-agnostic plugin loader ────────────────────────────────────────────
// Different npm versions export plugins as: module itself, module.plugin, or
// module.default. This helper tries all three so a version bump never breaks
// bot startup with "plugin needs to be a function".
function resolvePlugin(pkg){
  const m = require(pkg);
  if (typeof m === 'function')        return m;
  if (typeof m.plugin === 'function') return m.plugin;
  if (typeof m.default === 'function')return m.default;
  // Last resort: find the first function-valued export key
  for(const k of Object.keys(m)){
    if(typeof m[k] === 'function') return m[k];
  }
  throw new Error(`${pkg}: no callable plugin export found (check npm version)`);
}

const collectBlock = resolvePlugin('mineflayer-collectblock');
const toolPlugin   = resolvePlugin('mineflayer-tool');
const autoEat      = resolvePlugin('mineflayer-auto-eat');
const armorManager = resolvePlugin('mineflayer-armor-manager');
const pvp          = resolvePlugin('mineflayer-pvp');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach((a,i,arr)=>{ if(a.startsWith('--')) args[a.slice(2)]=arr[i+1]??true; });
const HOST    = args.host     || 'localhost';
const PORT    = parseInt(args.port    || '25565');
const USERNAME= args.username || 'RavenBot';
const VERSION = args.version  || '1.21';
const WS_PORT = parseInt(args.ws_port || '8765');
const AUTH    = args.auth     || 'offline';

// ── Global error guards ───────────────────────────────────────────────────────
process.on('uncaughtException', err=>{
  console.error('[BOT] Uncaught:', err.message);
  send({ type:'error', level:'fatal', message:`Bot crashed: ${err.message}` });
});
process.on('unhandledRejection', reason=>{
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[BOT] Unhandled rejection:', msg);
  send({ type:'error', level:'warning', message:`Async error: ${msg}` });
});

function safeInt(val,def=1){ const n=parseInt(val); return Number.isFinite(n)&&n>0?n:def; }

// ── WebSocket bridge ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port:WS_PORT });
let ws = null;
wss.on('connection', sock=>{
  ws=sock; console.log('[BOT] Python connected ✓'); send({ type:'mode_info', mode:MODE });
  sock.on('message', raw=>{ try{ handlePython(JSON.parse(raw)); }catch(e){} });
  sock.on('close', ()=>{ if(ws===sock) ws=null; });
  sock.on('error', e=>console.log('[BOT] WS error:', e.message));
});
wss.on('error', err=>{
  console.error('[BOT] WS server error:', err.message);
  if(err.code==='EADDRINUSE') console.error(`[BOT] Port ${WS_PORT} in use`);
});
function send(obj){ if(ws&&ws.readyState===WebSocket.OPEN){ try{ ws.send(JSON.stringify(obj)); }catch(e){} } }

// ── Bot state ─────────────────────────────────────────────────────────────────
let bot=null, MODE='follower', follower=null, taskRunner=null, _spawned=false;

// ── Trusted players ───────────────────────────────────────────────────────────
const FRIENDS=new Set();
const _fs=require('fs'), _cfgPath=require('path').join(__dirname,'config.json');
function _saveFriends(){ try{ const c=JSON.parse(_fs.readFileSync(_cfgPath,'utf8')); c.friends=[...FRIENDS]; _fs.writeFileSync(_cfgPath,JSON.stringify(c,null,2)); }catch(e){ console.log('[BOT] save friends failed:',e.message); } }
function _loadFriends(){ try{ const c=JSON.parse(_fs.readFileSync(_cfgPath,'utf8')); (c.friends||[]).forEach(f=>FRIENDS.add(f)); if(FRIENDS.size)console.log('[BOT] Loaded friends:',[...FRIENDS].join(', ')); }catch(e){} }

// ── Bot creation ──────────────────────────────────────────────────────────────
function createBot(){
  try{
    bot=mineflayer.createBot({ host:HOST, port:PORT, username:USERNAME, version:VERSION, auth:AUTH });
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(toolPlugin);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(pvp);
    attachEvents();
    console.log(`[BOT] Connecting → ${HOST}:${PORT} | user: ${USERNAME} | v${VERSION}`);
  }catch(e){
    console.error('[BOT] createBot failed:', e.message);
    send({ type:'error', level:'fatal', message:`Failed to create bot: ${e.message}` });
  }
}

function loadBots(){
  try{
    follower   = require('./bots/follower');
    taskRunner = require('./bots/task_runner');
    _loadFriends();
    follower?.setFriends?.(FRIENDS);
    taskRunner?.setFriends?.(FRIENDS);
  }catch(e){
    console.error('[BOT] Could not load bot modules:', e.message);
    send({ type:'error', level:'fatal', message:`Missing bots/ folder: ${e.message}` });
  }
}

function setMode(mode, extra={}){
  if(!_spawned) return;
  try{ follower?.stop?.(); }catch(e){}
  try{ taskRunner?.stop?.(); }catch(e){}
  MODE=mode;
  try{
    if(mode==='follower') follower.start(bot, send, extra.player||USERNAME);
    else if(mode==='task') taskRunner.start(bot, send);
    send({ type:'mode_changed', mode, message:extra.message||`Mode: ${mode}` });
  }catch(e){
    console.error('[BOT] setMode error:', e.message);
    send({ type:'error', level:'warning', message:`Mode switch failed: ${e.message}` });
  }
}

// ── % Command parser ──────────────────────────────────────────────────────────
function handlePercent(raw, fromPlayer){
  try{
    const parts=raw.trim().replace(/^%/,'').split(/\s+/);
    const cmd=parts[0].toLowerCase();
    function task(t){ if(MODE!=='task') setMode('task'); taskRunner.queueTask(t); }

    switch(cmd){
      case 'follow': case 'follower':{ const p=parts[1]||fromPlayer||USERNAME; setMode('follower',{player:p}); bot.chat(`👁 Following ${p}!`); break; }
      case 'task': case 'tasks': setMode('task'); bot.chat('⚒ Task mode~ %help for commands'); break;
      case 'mine': case 'dig': task({ cmd:'mine', block:(parts[1]||'stone').replace('minecraft:',''), count:safeInt(parts[2]), label:`Mine ${safeInt(parts[2])}x ${parts[1]||'stone'}` }); break;
      case 'gather': case 'collect': task({ cmd:'mine', block:(parts[1]||'stone').replace('minecraft:',''), count:safeInt(parts[2],64), label:`Gather ${safeInt(parts[2],64)}x ${parts[1]||'stone'}` }); break;
      case 'chop': case 'wood': case 'lumber': task({ cmd:'lumber', label:'Chop all nearby trees' }); break;
      case 'cave': task({ cmd:'cave', label:'Cave mining' }); break;
      case 'strip': task({ cmd:'strip', length:safeInt(parts[1],50), label:`Strip mine ${safeInt(parts[1],50)} blocks` }); break;
      case 'tunnel': task({ cmd:'tunnel', length:safeInt(parts[1],20), label:`Tunnel ${safeInt(parts[1],20)} blocks` }); break;
      case 'explore': task({ cmd:'explore', distance:safeInt(parts[1],200), label:`Explore ${safeInt(parts[1],200)} blocks` }); break;
      case 'surface': case 'up': task({ cmd:'surface', label:'Go to surface' }); break;
      case 'farm': task({ cmd:'farm', label:'Harvest crops' }); break;
      case 'goto': case 'go':{ const [x,y,z]=[parts[1],parts[2],parts[3]].map(Number); if([x,y,z].some(isNaN)){ bot.chat('Usage: %goto <x> <y> <z>'); break; } task({ cmd:'goto', x, y, z, label:`Go to ${Math.round(x)} ${Math.round(y)} ${Math.round(z)}` }); break; }
      case 'come': case 'here': task({ cmd:'come', player:fromPlayer||parts[1]||USERNAME, label:`Come to ${fromPlayer||parts[1]||USERNAME}` }); break;
      case 'kill': case 'hunt': case 'attack': task({ cmd:'kill', mob:(parts[1]||'zombie').replace('minecraft:',''), count:safeInt(parts[2]), label:`Kill ${safeInt(parts[2])}x ${parts[1]||'zombie'}` }); break;
      case 'killall': case 'cleararea': task({ cmd:'killall', radius:safeInt(parts[1],20), label:`Kill all within ${safeInt(parts[1],20)} blocks` }); break;
      case 'guard': case 'defend':{ const gp=parts[1]&&isNaN(parseInt(parts[1]))?parts[1]:(fromPlayer||USERNAME); const gr=safeInt(parts[1]&&!isNaN(parseInt(parts[1]))?parts[1]:parts[2],10); task({ cmd:'guard', player:gp, radius:gr, label:`Guard ${gp}` }); break; }
      case 'eat': case 'feed': bot.autoEat?.eat?.().catch(()=>{}); bot.chat('Eating~'); break;
      case 'wear': bot.armorManager?.equipAll?.().catch(()=>{}); bot.chat('Equipping best armor~'); break;
      case 'sleep': case 'bed': task({ cmd:'sleep', label:'Sleep through night' }); break;
      case 'fish': task({ cmd:'fish', duration:safeInt(parts[1],60), label:`Fish ${safeInt(parts[1],60)}s` }); break;
      case 'equip': case 'hold': task({ cmd:'equip', item:(parts[1]||'sword').replace('minecraft:',''), slot:parts[2]||'hand', label:`Equip ${parts[1]||'sword'}` }); break;
      case 'store': case 'deposit': task({ cmd:'store', item:parts[1]?.replace('minecraft:',''), label:`Store ${parts[1]||'all'}` }); break;
      case 'loot': case 'take': case 'grab': task({ cmd:'loot', label:'Loot chest' }); break;
      case 'drop': case 'throw':{ const di=parts[1]?parts[1].replace('minecraft:',''):null; if(!di){ bot.chat('Usage: %drop <item> [count]'); break; } task({ cmd:'drop', item:di, count:safeInt(parts[2],64), label:`Drop ${di}` }); break; }
      case 'dropall': case 'dumpall': case 'emptyinv': task({ cmd:'dropall', label:'Drop all inventory items' }); break;
      case 'collect': case 'pickup': case 'getitems': task({ cmd:'collect', label:'Collect dropped items' }); break;
      case 'inv': case 'inventory': case 'items': if(MODE==='task') task({ cmd:'inv', label:'Inventory' }); else{ setMode('task'); taskRunner.queueTask({ cmd:'inv', label:'Inventory' }); } break;
      case 'bring': case 'fetch':{ const bi=parts[1]; if(!bi){ bot.chat('Usage: %bring <item> [count]'); break; } task({ cmd:'bring', item:bi.replace('minecraft:',''), count:safeInt(parts[2],1), label:`Bring ${safeInt(parts[2],1)}x ${bi}` }); break; }
      case 'chest': if(parts[1]==='link'||parts[1]==='l'){ task({ cmd:'chest_link', label:'Link nearest chest' }); break; } bot.chat('Usage: %chest link'); break;
      case 'craft': task({ cmd:'craft', item:(parts[1]||'').replace('minecraft:',''), count:safeInt(parts[2]), label:`Craft ${safeInt(parts[2])}x ${parts[1]||'?'}` }); break;
      case 'smelt': task({ cmd:'smelt', item:(parts[1]||'').replace('minecraft:',''), count:safeInt(parts[2]), label:`Smelt ${safeInt(parts[2])}x ${parts[1]||'?'}` }); break;
      case 'pillar': task({ cmd:'pillar', count:safeInt(parts[1],10), label:`Pillar ${safeInt(parts[1],10)} blocks` }); break;
      case 'torch': case 'light': task({ cmd:'torch', count:safeInt(parts[1],5), label:`Place ${safeInt(parts[1],5)} torches` }); break;
      case 'status': case 'stats': case 'hp':
        if(MODE==='task'){ task({ cmd:'status', label:'Status' }); }
        else{
          // In follower mode: emit status_update directly (bypasses chat/TTS on Python side)
          const sp=bot.entity.position;
          send({ type:'status_update',
                 hp:Math.round(bot.health), food:Math.round(bot.food),
                 x:Math.round(sp.x), y:Math.round(sp.y), z:Math.round(sp.z),
                 held:bot.heldItem?.name||'empty' });
        }
        break;
      case 'pos': case 'where':{ const p=bot.entity.position; bot.chat(`I'm at ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`); break; }
      case 'mode': bot.chat(`Mode: ${MODE} | %follow or %task`); send({type:'mode_info',mode:MODE}); break;
      case 'friend':{ const fn=parts[1]; if(!fn){ bot.chat('Usage: %friend <n>'); break; } FRIENDS.add(fn); follower?.setFriends?.(FRIENDS); taskRunner?.setFriends?.(FRIENDS); _saveFriends(); bot.chat(`${fn} is a friend now~ ♥`); send({ type:'event', event:'friend_added', username:fn }); break; }
      case 'unfriend':{ const fn=parts[1]; if(!fn){ bot.chat('Usage: %unfriend <n>'); break; } FRIENDS.delete(fn); _saveFriends(); follower?.setFriends?.(FRIENDS); bot.chat(`Removed ${fn} from friends.`); break; }
      case 'friends': bot.chat(FRIENDS.size?`Friends: ${[...FRIENDS].join(', ')}`:'No friends yet. %friend <n>'); break;
      case 'emote': case 'e':{ const en=parts.slice(1).join(' ').toLowerCase(); const E={'shrug':'\\_(ツ)_/','happy':'(^_^)','sad':'(T_T)','angry':'(>_<)','love':'(*^3^)','blush':'(*^_^*)','wink':'(^_~)','confused':'(o_O)?','surprised':'(O_O)!!','sleep':'(-_-)zzz','think':'(-_-)...','evil':'(>:)','smug':'(~_^)','cry':'(;_;)','pout':'(-_-;)','bow':'m(_ _)m','peek':'(._. )','wave':'(^_^)/','no':'(x_x)','ok':'(^_^)b','nervous':'(^_^;)','sweat':'(>_<;)','stare':'(-_-)','hearts':'(^3^)','yay':'\\(^o^)/'}; if(!en){ bot.chat('Emotes: '+Object.keys(E).join(', ')); break; } const txt=E[en]; if(!txt){ bot.chat('Emotes: '+Object.keys(E).join(', ')); break; } bot.chat(txt); const M={'happy':'happy','sad':'sad','angry':'angry','love':'love','blush':'blush','wink':'happy','confused':'confused','surprised':'shocked','sleep':'sleepy','think':'thinking','evil':'evil','smug':'smirk','cry':'sad','pout':'annoyed','wave':'happy','no':'annoyed','nervous':'confused','sweat':'confused','stare':'bored','hearts':'love','yay':'excited','ok':'happy','shrug':'thinking','peek':'thinking','bow':'happy'}; send({ type:'observation', text:txt, emotion:M[en]||'neutral' }); break; }
      case 'stop': case 'cancel': case 'halt': case 'wait': taskRunner?.clearQueue?.(); try{bot.pvp?.stop();}catch(e){} try{bot.pathfinder.stop();}catch(e){} bot.chat('Stopping~'); send({type:'event',event:'stopped',message:'Tasks cleared'}); break;
      case 'clear': taskRunner?.clearQueue?.(); bot.chat('Queue cleared!'); break;
      case 'help':
        bot.chat('⛏ Mine: %mine %cave %strip %tunnel %explore %surface %lumber %farm');
        bot.chat('⚔ Fight: %guard %kill %killall  🧭 Nav: %goto %come %follow %pos');
        bot.chat('🍎 Surv: %eat %wear %sleep %fish  🎒 Inv: %equip %store %loot %drop %dropall %inv');
        bot.chat('🏗 Build: %pillar %torch  📦 Chest: %chest link %bring  🔨 Make: %craft %smelt');
        bot.chat('⚙ Ctrl: %stop %friend %mode  😄 Emotes: %emote shrug|happy|sad|...');
        break;
      default: bot.chat(`Unknown: %${cmd}. Try %help`);
    }
  }catch(e){
    console.error('[BOT] % error:', e.message);
    send({ type:'error', level:'warning', message:`Command error: ${e.message}` });
    try{ bot.chat(`Error: ${e.message}`); }catch(_){}
  }
}

// ── Python → bot ──────────────────────────────────────────────────────────────
function handlePython(msg){
  try{
    if(msg.text?.startsWith('%')){ handlePercent(msg.text, USERNAME); return; }
    const cmd=msg.cmd;
    switch(cmd){
      case 'chat':     bot.chat(msg.message||''); break;
      case 'set_mode': setMode(msg.mode||'follower', msg); break;
      case 'follow':   setMode('follower',{player:msg.username||USERNAME}); break;
      case 'task':     setMode('task'); break;
      case 'mine':     if(MODE!=='task')setMode('task'); taskRunner.queueTask({cmd:'mine',block:(msg.block||'stone').replace('minecraft:',''),count:safeInt(msg.count),label:`Mine ${safeInt(msg.count)}x ${msg.block||'stone'}`}); break;
      case 'goto':     if(MODE!=='task')setMode('task'); taskRunner.queueTask({cmd:'goto',x:msg.x,y:msg.y,z:msg.z,label:`Go to ${msg.x} ${msg.y} ${msg.z}`}); break;
      case 'kill':     if(MODE!=='task')setMode('task'); taskRunner.queueTask({cmd:'kill',mob:(msg.mob||'zombie').replace('minecraft:',''),count:safeInt(msg.count),label:`Kill ${safeInt(msg.count)}x ${msg.mob}`}); break;
      case 'stop':     taskRunner?.clearQueue?.(); try{bot.pvp?.stop();}catch(e){} try{bot.pathfinder.stop();}catch(e){} break;
      case 'clear':    taskRunner?.clearQueue?.(); break;
      case 'status':   taskRunner?.queueTask?.({cmd:'status',label:'Status'}); break;
      default: if(cmd) console.log('[BOT] unhandled cmd:', cmd);
    }
  }catch(e){
    console.error('[BOT] handlePython error:', e.message);
    send({ type:'error', level:'warning', message:`Handler error: ${e.message}` });
  }
}

// ── Lifecycle events ──────────────────────────────────────────────────────────
function attachEvents(){
  bot.once('spawn', ()=>{
    _spawned=true;
    console.log(`[BOT] Spawned as ${USERNAME} ✓`);
    send({ type:'event', event:'spawned', username:USERNAME });

    // ── block.digTime compatibility shim ─────────────────────────────────
    // mineflayer-pathfinder calls block.digTime(...) as a function to calculate
    // movement costs. In some prismarine-block versions, digTime is cached as a
    // NUMBER on the block INSTANCE (overriding the prototype method), so calling
    // it as a function throws "is not a function" and crashes pathfinder mid-path.
    // Fix: intercept bot.blockAt so every block returned has digTime guaranteed
    // to be callable. This catches instance-level overrides that prototype
    // patching misses.
    const _origBlockAt = bot.blockAt.bind(bot);
    bot.blockAt = function(...args){
      const blk = _origBlockAt(...args);
      if(blk && typeof blk.digTime !== 'function'){
        const val = blk.digTime;
        blk.digTime = typeof val === 'number'
          ? ()=>val          // return the cached ms value, ignoring tool args
          : ()=>0;           // unknown — use 0 so pathfinder doesn't stall
      }
      return blk;
    };
    console.log('[BOT] block.digTime shim active');

    // Configure auto-eat
    bot.autoEat.options = {
      priority:'foodPoints', startAt:14,
      bannedFood:['rotten_flesh','spider_eye','poisonous_potato','pufferfish','chicken'],
    };
    bot.autoEat.enable();

    loadBots();
    setMode('follower', { player:USERNAME });

    // Radar emitter
    const HOSTILE_TYPES=new Set(['zombie','skeleton','creeper','spider','cave_spider','enderman','witch','phantom','drowned','husk','stray','pillager','ravager','blaze','ghast','magma_cube','slime','warden','hoglin','zoglin','piglin_brute','vex','silverfish','guardian','elder_guardian','evoker','vindicator']);
    setInterval(()=>{
      if(!bot||!_spawned) return;
      try{
        const entities=[]; const bp=bot.entity.position;
        for(const e of Object.values(bot.entities)){
          if(!e||!e.position||!e.name||e===bot.entity) continue;
          const dx=e.position.x-bp.x, dz=e.position.z-bp.z;
          if(Math.sqrt(dx*dx+dz*dz)>32) continue;
          let kind=null;
          if(HOSTILE_TYPES.has(e.name)) kind='hostile';
          else if(e.type==='player'&&e.username!==bot.username) kind='player';
          if(kind) entities.push({ kind, name:e.name||e.username||'?', x:Math.round(dx*10)/10, z:Math.round(dz*10)/10 });
        }
        send({ type:'radar', entities });
      }catch(e){}
    }, 2000);
  });

  bot.on('chat', (username, message)=>{
    if(username===bot.username) return;
    if(message.startsWith('%')){ handlePercent(message, username); return; }
    if(message.startsWith('#')) send({ type:'chat', username, message });
  });
  bot.on('whisper', (username, message)=>{
    if(message.startsWith('%')){ handlePercent(message, username); return; }
    send({ type:'whisper', username, message });
  });
  bot.on('title', (action, value)=>{
    if(!value) return;
    const text=typeof value==='object'?JSON.stringify(value):String(value);
    if(text.includes('advancement')||text.includes('Achievement'))
      send({ type:'advancement', username:USERNAME, title:text, description:'' });
  });
  bot.on('message', (msg)=>{
    const text=msg.toString();
    if((text.includes('has made the advancement')||text.includes('has completed')||text.includes('has reached'))&&text.includes(USERNAME)){
      const m=text.match(/\[(.+?)\]/);
      send({ type:'advancement', username:USERNAME, title:m?m[1]:text, description:'' });
    }
  });
  bot.on('health', ()=>{
    send({ type:'stats', health:bot.health, food:bot.food });
    if(bot.health<=4) send({ type:'emotion_hint', emotion:'shocked', reason:'low health' });
  });
  bot.on('autoeat_started',  ()=>console.log('[BOT] auto-eat: eating'));
  bot.on('autoeat_stopped',  ()=>console.log('[BOT] auto-eat: done'));
  bot.on('autoeat_error',    e=>console.log('[BOT] auto-eat error:', e?.message));
  bot.on('death', ()=>{
    send({ type:'event', event:'died', username:USERNAME });
    send({ type:'emotion_hint', emotion:'sad', reason:'died' });
    const deathPos=bot.entity.position.clone();
    setTimeout(()=>{
      try{
        bot.respawn();
        setTimeout(()=>{
          if(MODE==='follower'&&follower){
            try{ follower.stop(); }catch(e){}
            taskRunner.start(bot, send);
            taskRunner.queueTask({ cmd:'goto', x:deathPos.x, y:deathPos.y, z:deathPos.z, label:`Return to death (${Math.round(deathPos.x)} ${Math.round(deathPos.y)} ${Math.round(deathPos.z)})` });
            taskRunner.queueTask({ cmd:'collect', label:'Collect dropped items' });
          }
        }, 2500);
      }catch(e){ console.log('[BOT] Respawn failed:', e.message); }
    }, 1500);
  });
  bot.on('playerJoined', p=>{ send({ type:'event', event:'player_joined', username:p.username }); send({ type:'emotion_hint', emotion:'happy', reason:`${p.username} joined` }); });
  bot.on('playerLeft',   p=>send({ type:'event', event:'player_left', username:p.username }));
  bot.on('kicked', reason=>{ const msg=typeof reason==='object'?JSON.stringify(reason):String(reason); send({ type:'error', level:'fatal', message:`Kicked: ${msg}` }); setTimeout(()=>process.exit(0),400); });
  bot.on('end',   reason=>{ send({ type:'event', event:'disconnected', reason:String(reason||'') }); send({ type:'error', level:'info', message:`Disconnected: ${reason||'server closed connection'}` }); setTimeout(()=>process.exit(0),400); });
  bot.on('error', err=>{ const msg=err.message||''; let hint=msg; if(msg.includes('ECONNREFUSED'))hint=`Can't connect to ${HOST}:${PORT}`; else if(msg.includes('getaddrinfo'))hint=`Can't resolve "${HOST}"`; else if(msg.includes('version'))hint='Version mismatch — check settings'; else if(msg.includes('ECONNRESET'))hint='Connection reset by server'; send({ type:'error', level:'fatal', message:hint }); });
  bot.on('path_update', r=>{ if(r.status==='noPath') send({ type:'error', level:'info', message:'No path found — destination unreachable.' }); });
}

createBot();
