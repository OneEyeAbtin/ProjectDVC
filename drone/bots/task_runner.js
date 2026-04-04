'use strict';
/**
 * [MODULE] task_runner.js
 * [SYSTEM] ProjectDVC — Async task execution engine. Queues, gates, and surgically
 *          aborts drone operations via a generation-counter dead-man switch.
 *          Stale async corpses self-terminate. Follow+1 law is strictly enforced.
 * [AUTHOR] Abtin
 * 
 * Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
 */
function safeInt(val,def=1){ const n=parseInt(val); return Number.isFinite(n)&&n>0?n:def; }

const { goals, Movements } = require('mineflayer-pathfinder');
const vec3 = require('vec3');

// ── Module state ──────────────────────────────────────────────────────────────
let _bot=null, _send=null, _active=false, _queue=[], _running=false, _abort=false;
let _taskList=[];
let _friends=new Set();
// Generation counter — incremented by clearQueue/stop; tasks capture their gen
// at start and bail when _generation !== task._gen (stale task detection).
let _generation=0;

function setFriends(set){ _friends=set; }

// ── Abort helper — checked in every hot loop ──────────────────────────────────
// Returns true when the task should stop: either explicit abort OR the generation
// has moved on (clearQueue was called after this task started).
function _aborted(gen){ return _abort || _generation!==gen; }

// ── Concurrent task system ────────────────────────────────────────────────────
// Only FOLLOW and GUARD can run concurrently alongside the regular queue.
// Follow+1 rule: at most ONE regular task may be queued/running while a
// concurrent (follow/guard) task is active.
const CONCURRENT_CMDS = new Set(['follow','guard']);
// Tasks that are exempt from the Follow+1 limit (instant/informational).
const INSTANT_CMDS    = new Set(['status','inv','look','eat','collect']);

let _concurrentTask  = null;
let _concurrentAbort = false;

async function _runConcurrent(task){
  _concurrentAbort=false;
  _concurrentTask=task;
  try{
    if(task.cmd==='follow') await _followConcurrent(task);
    else if(task.cmd==='guard') await _guardConcurrent(task);
  }finally{
    _concurrentTask=null;
  }
}

function _stopConcurrent(){
  _concurrentAbort=true;
  _concurrentTask=null;
  try{ _bot?.pvp?.stop(); }catch(e){}
}

async function _followConcurrent({player}){
  const p=_bot.players[player];
  if(!p?.entity) return;
  try{
    const mc=new Movements(_bot); mc.allowSprinting=true;
    mc.allow1by1towers=false; mc.scaffoldingBlocks=[];
    _bot.pathfinder.setMovements(mc);
    _bot.pathfinder.setGoal(new goals.GoalFollow(p.entity,2),true);
  }catch(e){}
  while(!_concurrentAbort&&_active){
    await _sleep(4000);
    if(_concurrentAbort||!_active) break;
    try{
      const pp=_bot.players[player];
      if(pp?.entity){
        const mc2=new Movements(_bot); mc2.allowSprinting=true;
        mc2.allow1by1towers=false; mc2.scaffoldingBlocks=[];
        _bot.pathfinder.setMovements(mc2);
        _bot.pathfinder.setGoal(new goals.GoalFollow(pp.entity,2),true);
      }
    }catch(e){}
  }
}

async function _guardConcurrent({player,radius}){
  const r=safeInt(radius,10);
  const HOSTILE=new Set(['zombie','skeleton','creeper','spider','cave_spider','enderman','witch','phantom','slime','husk','stray','drowned','pillager','ravager','blaze','hoglin','zoglin','piglin_brute','vex','silverfish','magma_cube']);
  _send({ type:'observation', text:'*keeps watch while working~*', emotion:'thinking' });
  while(!_concurrentAbort&&_active){
    let found=null, closest=Infinity;
    for(const e of Object.values(_bot.entities)){
      if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
      let d; try{ d=_bot.entity.position.distanceTo(e.position); }catch(err){ continue; }
      if(d<r&&d<closest){ closest=d; found=e; }
    }
    if(found){
      try{ _bot.pvp.attack(found); }catch(e){}
      let waited=0;
      while(found.isValid&&!_concurrentAbort&&waited<8000){ await _sleep(100); waited+=100; }
      try{ _bot.pvp.stop(); }catch(e){}
    }
    await _sleep(300);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
function start(bot,sendFn){
  _bot=bot; _send=sendFn; _active=true; _queue=[]; _running=false; _abort=false;
  _generation=0;
  _taskList=[]; _concurrentTask=null; _concurrentAbort=false;
  _lastSuffocationHP=bot.health??20;
  _lavaEscaping=false;
  _send({ type:'mode_changed', mode:'task', message:'Task mode ready~ ⚒ %help' });
  _startStuckDetector();
  _startLavaWatch();
}

function stop(){
  _generation++;   // invalidate any in-flight task
  _active=false; _abort=true; _queue=[]; _taskList=[]; _running=false;
  _stopConcurrent();
  _stopStuckDetector();
  _stopLavaWatch();
  try{ _bot?.pvp?.stop(); }catch(e){}
  try{ _bot?.pathfinder?.stop(); }catch(e){}
}

// ── Queue management ──────────────────────────────────────────────────────────
function queueTask(task){
  // ── Concurrent commands (follow / guard) — run in background ──────────────
  if(CONCURRENT_CMDS.has(task.cmd)){
    if(_concurrentTask){
      _send({ type:'observation',
              text:`*was already ${_concurrentTask.cmd==='guard'?'guarding':'following'} — switching*`,
              emotion:'thinking' });
      _stopConcurrent();
    }
    // Remove any previous concurrent entry from taskList
    _taskList=_taskList.filter(t=>t.status!=='concurrent');
    _taskList.push({ label:task.label, status:'concurrent' });
    _send({ type:'task_queued', task:task.label, queue_length:_queue.length+1,
            task_list:_taskList.map(t=>t.label) });
    _runConcurrent(task);
    return;
  }

  // ── Follow+1 enforcement ───────────────────────────────────────────────────
  // When a concurrent task is active, only ONE regular task is allowed.
  // Instant/informational commands bypass this limit.
  if(_concurrentTask && !INSTANT_CMDS.has(task.cmd)){
    const busyCount = (_running?1:0) + _queue.length;
    if(busyCount>=1){
      const blocker = _running
        ? (_queue[0]?.label||'current task')
        : _queue[0]?.label||'a queued task';
      _send({ type:'task_result', task:task.label, status:'error',
              message:`Follow+1 rule: only one task allowed alongside ${_concurrentTask.cmd}. `+
                      `"${blocker}" is already ${_running&&!_queue.length?'running':'queued'}. `+
                      `%stop first, then re-queue.`,
              task_list:_taskList.map(t=>t.label) });
      return;
    }
  }

  // ── Regular queue ──────────────────────────────────────────────────────────
  _queue.push(task);
  _taskList.push({ label:task.label, status:'queued' });
  _send({ type:'task_queued', task:task.label, queue_length:_queue.length,
          task_list:_taskList.map(t=>t.label) });
  if(!_running) _next();
}

function clearQueue(){
  _generation++;   // invalidate in-flight task (belt)
  _abort=true;     // belt-and-suspenders: classic abort flag
  _queue=[];
  _taskList=[];
  _running=false;
  _stopConcurrent();
  try{ _bot?.pvp?.stop(); }catch(e){}
  try{ _bot?.pathfinder?.stop(); }catch(e){}
  _send({ type:'task_result', task:'all', status:'cleared', message:'Queue cleared ✓', task_list:[] });
}

// ── Task dispatcher ───────────────────────────────────────────────────────────
async function _next(){
  if(!_active||!_queue.length){ _running=false; return; }
  _running=true;

  const task=_queue.shift();
  // Stamp the task with the current generation BEFORE resetting _abort,
  // so the task has a clean snapshot to compare against.
  task._gen=_generation;
  _abort=false;   // reset after stamping — new task starts fresh

  const tl=_taskList.find(t=>t.label===task.label&&t.status==='queued');
  if(tl) tl.status='active';
  _send({ type:'task_start', task:task.label,
          task_list:_taskList.map(t=>`${t.status==='active'?'▶':'⏳'} ${t.label}`) });

  try{
    switch(task.cmd){
      case 'mine':       await _mine(task);        break;
      case 'goto':       await _goto(task);        break;
      case 'come':       await _come(task);        break;
      case 'follow':     await _followTask(task);  break;
      case 'kill':       await _kill(task);        break;
      case 'killall':    await _killall(task);     break;
      case 'eat':        bot_eat(task);            break;
      case 'equip':      await _equip(task);       break;
      case 'store':      await _store(task);       break;
      case 'loot':       await _loot(task);        break;
      case 'drop':       await _drop(task);        break;
      case 'dropall':    await _dropAll(task);     break;
      case 'cave':       await _cave(task);        break;
      case 'strip':      await _strip(task);       break;
      case 'tunnel':     await _tunnel(task);      break;
      case 'lumber':     await _lumber(task);      break;
      case 'explore':    await _explore(task);     break;
      case 'surface':    await _surface(task);     break;
      case 'farm':       await _farm(task);        break;
      case 'guard':      await _guard(task);       break;
      case 'collect':    await _collectItems(task);break;
      case 'craft':      await _craft(task);       break;
      case 'smelt':      await _smelt(task);       break;
      case 'pillar':     await _pillar(task);      break;
      case 'torch':      await _torch(task);       break;
      case 'fish':       await _fish(task);        break;
      case 'sleep':      await _sleep2(task);      break;
      case 'bring':      await _bring(task);       break;
      case 'chest_link': await _chestLink(task);   break;
      case 'status':     _status();               break;
      case 'inv':        _inv();                  break;
      case 'look':       await _look(task);        break;
      default: _send({ type:'task_result', task:task.label, status:'error',
                       message:`Unknown cmd: ${task.cmd}` });
    }
  }catch(e){
    _send({ type:'task_result', task:task.label, status:'error', message:e.message });
  }

  const idx=_taskList.findIndex(t=>t.label===task.label&&t.status==='active');
  if(idx>=0) _taskList.splice(idx,1);
  _next();
}

const _sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── Movement config ───────────────────────────────────────────────────────────
function _mc(canDig=true){
  const mc=new Movements(_bot);
  mc.allowSprinting=true;
  mc.canDig=canDig;
  mc.allow1by1towers=true;
  mc.maxDropDown=4;
  return mc;
}

// ── Block/item resolution ─────────────────────────────────────────────────────
function _resolveBlock(raw){
  const clean=raw.replace('minecraft:','').toLowerCase().replace(/s$/,'');
  const r=_bot.registry;
  return r.blocksByName[clean]||r.blocksByName[clean+'_ore']
      ||r.blocksByName['deepslate_'+clean+'_ore']||r.blocksByName['nether_'+clean+'_ore']
      ||r.blocksByName[clean+'_log']||r.blocksByName[clean+'_wood']
      ||r.blocksByName[raw.replace('minecraft:','')]||null;
}
function _resolveItem(raw){
  const c=raw.replace('minecraft:','').toLowerCase();
  return _bot.registry.itemsByName[c]||null;
}

// ── Tool tier system ──────────────────────────────────────────────────────────
const MIN_TIER={
  diamond_ore:4,deepslate_diamond_ore:4,emerald_ore:4,deepslate_emerald_ore:4,
  gold_ore:3,deepslate_gold_ore:3,redstone_ore:3,deepslate_redstone_ore:3,
  iron_ore:2,deepslate_iron_ore:2,lapis_ore:2,deepslate_lapis_ore:2,
  coal_ore:1,deepslate_coal_ore:1,copper_ore:1,deepslate_copper_ore:1,
  nether_quartz_ore:1,nether_gold_ore:1,obsidian:5,ancient_debris:5,
};
const PICKS=[
  {n:'netherite_pickaxe',t:5},{n:'diamond_pickaxe',t:4},{n:'iron_pickaxe',t:3},
  {n:'stone_pickaxe',t:2},{n:'golden_pickaxe',t:1},{n:'wooden_pickaxe',t:1},
];
function _getPickTier(){ const inv=_bot.inventory.items(); for(const{n,t}of PICKS){ if(inv.find(x=>x.name===n)) return{name:n,tier:t}; } return{name:'hand',tier:0}; }
function _getBestPick(){ const inv=_bot.inventory.items(); for(const{n}of PICKS){ const i=inv.find(x=>x.name===n); if(i) return i; } return null; }

// ── Falling / lava block sets ─────────────────────────────────────────────────
const FALLING_BLOCKS=new Set(['gravel','sand','red_sand','concrete_powder',
  'white_concrete_powder','orange_concrete_powder','magenta_concrete_powder',
  'light_blue_concrete_powder','yellow_concrete_powder','lime_concrete_powder',
  'pink_concrete_powder','gray_concrete_powder','light_gray_concrete_powder',
  'cyan_concrete_powder','purple_concrete_powder','blue_concrete_powder',
  'brown_concrete_powder','green_concrete_powder','red_concrete_powder',
  'black_concrete_powder']);
const LAVA_BLOCKS=new Set(['lava','flowing_lava']);

// ── Safe dig ──────────────────────────────────────────────────────────────────
async function _safeDig(block){
  if(!block||!block.position) return false;
  const fresh=_bot.blockAt(block.position);
  if(!fresh||fresh.name==='air') return true;
  if(FALLING_BLOCKS.has(fresh.name)){
    await _bot.waitForTicks(6);
    const settled=_bot.blockAt(block.position);
    if(!settled||settled.name==='air') return true;
    block=settled;
  }
  try{
    try{ await _bot.tool.equipForBlock(block); }catch(e){}
    await _bot.dig(block,true);
    await _bot.waitForTicks(2);
    return true;
  }catch(e){
    await _bot.waitForTicks(4);
    return false;
  }
}

// ── Vein mining (gen-aware) ───────────────────────────────────────────────────
async function _mineVein(blockName,maxVeinSize=64,gen=_generation){
  const def=_resolveBlock(blockName); if(!def) return 0;
  const visited=new Set(); let mined=0;
  async function _digAdjacent(pos){
    const key=`${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
    if(visited.has(key)||mined>=maxVeinSize||_aborted(gen)) return;
    visited.add(key);
    const b=_bot.blockAt(pos); if(!b||b.type!==def.id) return;
    try{
      _bot.pathfinder.setMovements(_mc());
      await _bot.pathfinder.goto(new goals.GoalNear(pos.x,pos.y,pos.z,3));
    }catch(e){ return; }
    await _bot.lookAt(pos.offset(0.5,0.5,0.5),true).catch(()=>{});
    const ok=await _safeDig(b);
    if(ok){
      mined++;
      const OFFSETS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      for(const[dx,dy,dz] of OFFSETS) await _digAdjacent(pos.offset(dx,dy,dz));
    }
  }
  const startBlock=_bot.findBlock({matching:def.id,maxDistance:32});
  if(!startBlock) return 0;
  await _digAdjacent(startBlock.position);
  return mined;
}

// ── Ore depth targets ─────────────────────────────────────────────────────────
const ORE_Y={ diamond:-58,deepslate_diamond:-58,ancient_debris:15,redstone:-58,gold:-16,nether_gold:15,iron:16,lapis:0,coal:96,copper:48,emerald:236 };
function _bestY(blockName){ const clean=blockName.replace('minecraft:','').replace(/_ore$/,'').replace(/^deepslate_/,'').replace(/^nether_/,''); return ORE_Y[clean]??-16; }

async function _goToY(targetY,gen=_generation){
  try{
    const mc=_mc(true);
    _bot.pathfinder.setMovements(mc);
    await _bot.pathfinder.goto(new goals.GoalY(targetY));
  }catch(e){ await _digDown(targetY,gen); }
}

async function _digDown(targetY,gen=_generation){
  const pick=_getBestPick(); if(pick) await _bot.equip(pick,'hand').catch(()=>{});
  let attempts=0, gravCount=0;
  while(Math.round(_bot.entity.position.y)>targetY+2&&!_aborted(gen)&&attempts<300){
    const below2=_bot.blockAt(_bot.entity.position.offset(0,-2,0));
    if(below2&&LAVA_BLOCKS.has(below2.name)){
      _send({ type:'observation', text:'*stops* Lava below!! Not digging into that~', emotion:'shocked' });
      break;
    }
    const below=_bot.blockAt(_bot.entity.position.offset(0,-1,0));
    if(!below||below.name==='air'){ await _sleep(200); }
    else if(FALLING_BLOCKS.has(below.name)){
      gravCount++;
      try{ await _bot.dig(below); await _sleep(100); }catch(e){ await _sleep(300); }
      if(gravCount>3){ await _escapeGravel(); gravCount=0; }
    }else{
      gravCount=0;
      try{ await _bot.dig(below); await _sleep(150); }catch(e){ await _sleep(400); }
    }
    attempts++;
  }
}

async function _escapeGravel(){
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  for(const[dx,dz] of DIRS){
    try{
      const bl=_bot.blockAt(_bot.entity.position.offset(dx,0,dz));
      if(bl&&bl.name==='air'){
        _bot.setControlState('jump',true); await _sleep(100); _bot.setControlState('jump',false);
        await _bot.pathfinder.goto(new goals.GoalNear(_bot.entity.position.x+dx*2,_bot.entity.position.y,_bot.entity.position.z+dz*2,1)).catch(()=>{});
        return true;
      }
      if(bl&&bl.name!=='air'&&!LAVA_BLOCKS.has(bl.name)){ await _bot.dig(bl).catch(()=>{}); await _sleep(300); return true; }
    }catch(e){}
  }
  return false;
}

// ── Stuck detector ────────────────────────────────────────────────────────────
let _stuckCheck=null, _lastPos=null, _stuckCount=0;
function _startStuckDetector(){
  _lastPos=_bot.entity.position.clone(); _stuckCount=0;
  _stuckCheck=setInterval(async()=>{
    if(!_bot||!_active) return;
    try{
      const cur=_bot.entity.position; const moved=cur.distanceTo(_lastPos);
      if(moved<0.5&&_bot.pathfinder.isMoving()){
        _stuckCount++;
        if(_stuckCount>=2){
          _stuckCount=0;
          _send({ type:'observation', text:"*sighs* I'm stuck... trying to get unstuck!", emotion:'annoyed' });
          _bot.setControlState('jump',true); await _sleep(300); _bot.setControlState('jump',false);
          const yaw=_bot.entity.yaw; const dx=-Math.sin(yaw),dz=-Math.cos(yaw);
          const pos=_bot.entity.position;
          for(const dy of [0,1]){
            try{ const bl=_bot.blockAt(pos.offset(dx,dy,dz)); if(bl&&bl.name!=='air'&&!LAVA_BLOCKS.has(bl.name)) await _bot.dig(bl).catch(()=>{}); }catch(e){}
          }
        }
      }else{ _stuckCount=0; }
      _lastPos=cur.clone();
    }catch(e){}
  },5000);
}
function _stopStuckDetector(){ if(_stuckCheck){ clearInterval(_stuckCheck); _stuckCheck=null; } }

// ── Lava + gravel evasion ─────────────────────────────────────────────────────
let _lavaTimer=null, _lavaEscaping=false, _lastSuffocationHP=20;
function _startLavaWatch(){
  _lavaTimer=setInterval(async()=>{
    if(!_bot||!_active||_lavaEscaping) return;
    try{
      const pos=_bot.entity.position;
      const atFeet=_bot.blockAt(pos.offset(0,0,0));
      const atBody=_bot.blockAt(pos.offset(0,0.5,0));
      const inLava=(atFeet&&LAVA_BLOCKS.has(atFeet.name))||(atBody&&LAVA_BLOCKS.has(atBody.name));
      const atHead=_bot.blockAt(pos.offset(0,1.5,0));
      const inGravel=atHead&&FALLING_BLOCKS.has(atHead.name);
      if(inLava){
        _lavaEscaping=true;
        _send({ type:'observation', text:'*SCREAMS* LAVA!! RUN RUN RUN!!', emotion:'shocked' });
        const bucket=_bot.inventory.items().find(i=>i.name==='water_bucket');
        if(bucket){
          await _bot.equip(bucket,'hand').catch(()=>{});
          for(const[dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
            try{ const side=_bot.blockAt(pos.offset(dx,0,dz)); if(side&&side.name==='air'){ await _bot.placeBlock(side,vec3(-dx,0,-dz)).catch(()=>{}); break; } }catch(e){}
          }
        }
        try{
          _bot.pathfinder.setMovements(_mc(false));
          _bot.setControlState('jump',true); await _bot.waitForTicks(2); _bot.setControlState('jump',false);
          _bot.setControlState('sprint',true);
          const escX=pos.x+(Math.random()-.5)*10,escZ=pos.z+(Math.random()-.5)*10;
          await _bot.pathfinder.goto(new goals.GoalNear(escX,pos.y,escZ,2)).catch(()=>{});
          _bot.setControlState('sprint',false);
        }catch(e){}
        _lavaEscaping=false;
      }else if(inGravel){
        _lavaEscaping=true;
        _send({ type:'observation', text:'*muffled* GRAVEL!! DIGGING OUT!!', emotion:'shocked' });
        try{
          await _bot.dig(atHead,true).catch(()=>{});
          await _bot.waitForTicks(3);
          const nowHead=_bot.blockAt(pos.offset(0,1.5,0));
          if(nowHead&&FALLING_BLOCKS.has(nowHead.name)) await _bot.dig(nowHead,true).catch(()=>{});
        }catch(e){}
        _lavaEscaping=false;
      }
    }catch(e){ _lavaEscaping=false; }
  },400);
}
function _stopLavaWatch(){ if(_lavaTimer){ clearInterval(_lavaTimer); _lavaTimer=null; } }

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS  (all use _aborted(task._gen) so clearQueue invalidates them instantly)
// ═══════════════════════════════════════════════════════════════════════════════

async function _mine(task){
  const{block,count,label,_gen}=task;
  const n=safeInt(count);
  const def=_resolveBlock(block);
  if(!def){ _send({ type:'task_result',task:label,status:'error',message:`Unknown block "${block}"` }); return; }
  const minTier=MIN_TIER[def.name]||0;
  const{name:pickName,tier:pickTier}=_getPickTier();
  if(pickTier<minTier){
    const needed=['hand','wooden','stone','iron','diamond','netherite'][minTier]||'iron';
    _send({ type:'task_result',task:label,status:'error',message:`Need at least ${needed} pickaxe for ${def.name}! (have: ${pickName})` }); return;
  }
  const curY=Math.round(_bot.entity.position.y),targetY=_bestY(block);
  const isOre=def.name.includes('ore')||def.name.includes('debris');
  if(isOre&&curY>targetY+25){
    _send({ type:'task_progress',task:label,done:0,total:n,message:`Going to Y=${targetY} for ${def.name}...` });
    await _goToY(targetY,_gen);
  }
  let mined=0,notFound=0;
  _send({ type:'task_progress',task:label,done:0,total:n,message:`Mining ${n}x ${def.name}...` });
  while(mined<n&&_active&&!_aborted(_gen)){
    const target=_bot.findBlock({matching:def.id,maxDistance:64});
    if(!target){
      notFound++;
      if(notFound>3){ _send({ type:'task_result',task:label,status:'error',message:`Can't find ${def.name}. Mined ${mined}/${n}.` }); return; }
      const p=_bot.entity.position;
      try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(p.x+(Math.random()-.5)*30,p.y,p.z+(Math.random()-.5)*30,3)); }catch(e){}
      await _sleep(500); continue;
    }
    notFound=0;
    try{
      _bot.pathfinder.setMovements(_mc());
      await _bot.pathfinder.goto(new goals.GoalLookAtBlock(target.position,_bot.world,{reach:4}))
        .catch(()=>_bot.pathfinder.goto(new goals.GoalNear(target.position.x,target.position.y,target.position.z,3)).catch(()=>{}));
      await _bot.lookAt(target.position.offset(0.5,0.5,0.5),true).catch(()=>{});
      const isOreBlock=def.name.includes('ore')||def.name.includes('debris');
      let gained=0;
      if(isOreBlock){
        gained=await _mineVein(block,Math.min(n-mined,64),_gen);
        if(gained===0) gained=await _safeDig(target)?1:0;
      }else{
        gained=await _safeDig(target)?1:0;
      }
      if(gained>0){
        mined+=gained;
        if(mined%Math.max(1,Math.floor(n/8))===0||mined>=n)
          _send({ type:'task_progress',task:label,done:mined,total:n,message:`Mined ${mined}/${n} ${def.name}` });
      }else{ await _sleep(400); }
    }catch(e){ await _sleep(600); }
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Mined ${mined}x ${def.name} ✓` });
}

async function _cave(task){
  const{label,_gen}=task;
  const ORE_IDS=['diamond_ore','deepslate_diamond_ore','iron_ore','deepslate_iron_ore','gold_ore','deepslate_gold_ore','coal_ore','deepslate_coal_ore','emerald_ore','deepslate_emerald_ore','ancient_debris','copper_ore','deepslate_copper_ore','lapis_ore','deepslate_lapis_ore','redstone_ore','deepslate_redstone_ore']
    .map(n=>_bot.registry.blocksByName[n]?.id).filter(Boolean);
  _send({ type:'task_progress',task:label,done:0,total:1,message:'Going deep for cave mining...' });
  await _goToY(-53,_gen);
  let mined=0;
  while(_active&&!_aborted(_gen)){
    const target=_bot.findBlock({matching:ORE_IDS,maxDistance:32});
    if(!target){
      const p=_bot.entity.position;
      try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(p.x+(Math.random()-.5)*20,p.y,p.z+(Math.random()-.5)*20,3)); }catch(e){}
      await _sleep(800); continue;
    }
    try{
      _bot.pathfinder.setMovements(_mc());
      await _bot.pathfinder.goto(new goals.GoalNear(target.position.x,target.position.y,target.position.z,3)).catch(()=>{});
      const gained=await _mineVein(target.name,64,_gen);
      const ok=gained>0||await _safeDig(target);
      if(ok){ mined+=Math.max(1,gained); if(mined%5===0) _send({ type:'task_progress',task:label,done:mined,total:mined+10,message:`Caved ${mined} ores` }); }
      else{ await _sleep(500); }
    }catch(e){ await _sleep(600); }
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Cave mined ${mined} ores ✓` });
}

async function _goto(task){
  const{x,y,z,label,_gen}=task;
  _bot.pathfinder.setMovements(_mc());
  await _bot.pathfinder.goto(new goals.GoalBlock(Math.round(x),Math.round(y),Math.round(z)));
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:'Arrived ✓' });
}

async function _come(task){
  const{player,label,_gen}=task;
  const p=_bot.players[player];
  if(!p?.entity){ _send({ type:'task_result',task:label,status:'error',message:`Can't see ${player}` }); return; }
  _bot.pathfinder.setMovements(_mc());
  await _bot.pathfinder.goto(new goals.GoalNear(p.entity.position.x,p.entity.position.y,p.entity.position.z,2));
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`With ${player} ✓` });
}

async function _followTask(task){
  const{player,label,_gen}=task;
  const p=_bot.players[player];
  if(!p?.entity){ _send({ type:'task_result',task:label,status:'error',message:`Can't see ${player}` }); return; }
  _bot.pathfinder.setMovements(_mc());
  _bot.pathfinder.setGoal(new goals.GoalFollow(p.entity,2),true);
  _send({ type:'task_result',task:label,status:'done',message:`Following ${player}~ (%stop to cancel)` });
}

// ── Guard (sequential version) ────────────────────────────────────────────────
async function _guard(task){
  const{player,radius,label,_gen}=task;
  const r=safeInt(radius,10);
  const HOSTILE=new Set(['zombie','skeleton','creeper','spider','cave_spider','enderman','witch','phantom','slime','husk','stray','drowned','pillager','blaze','wither_skeleton','hoglin','zoglin','piglin_brute','vex','silverfish','magma_cube','ravager']);
  _send({ type:'observation', text:`*watches ${player||'the area'} carefully*`, emotion:'thinking' });
  _send({ type:'task_progress',task:label,done:0,total:1,message:`Guarding ${player||'area'}... (%stop to cancel)` });

  function _resumeFollow(){
    if(!player) return;
    const pp=_bot.players[player];
    if(pp?.entity){ try{ _bot.pathfinder.setMovements(_mc()); _bot.pathfinder.setGoal(new goals.GoalFollow(pp.entity,3),true); }catch(e){} }
  }
  _resumeFollow();

  let _prevHP=_bot.health;
  function _gHealth(){ const hp=_bot.health,dmg=_prevHP-hp; _prevHP=hp; if(dmg>0){ _send({ type:'observation', text:'*flinches* Got hit while guarding!', emotion:'shocked' }); } }
  _bot.on('health',_gHealth);

  while(_active&&!_aborted(_gen)){
    let found=null,closest=Infinity;
    for(const e of Object.values(_bot.entities)){
      if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
      let d; try{ d=_bot.entity.position.distanceTo(e.position); }catch(err){ continue; }
      if(d<r&&d<closest){ closest=d; found=e; }
    }
    if(found){
      _send({ type:'observation', text:`*lunges at ${found.name}!*`, emotion:'angry' });
      try{ _bot.pvp.attack(found); }catch(e){}
      let waited=0;
      while(found.isValid&&!_aborted(_gen)&&waited<15000){ await _sleep(100); waited+=100; }
      try{ _bot.pvp.stop(); }catch(e){}
      _resumeFollow();
    }
    await _sleep(300);
  }
  try{ _bot.off('health',_gHealth); }catch(e){}
  try{ _bot.pvp?.stop(); }catch(e){}
  try{ _bot.pathfinder.stop(); }catch(e){}
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:'Guard done ✓' });
}

// ── Kill / killall ────────────────────────────────────────────────────────────
async function _kill(task){
  const{mob,count,label,_gen}=task;
  const total=safeInt(count); let killed=0;
  const name=mob.replace('minecraft:','');
  _send({ type:'task_progress',task:label,done:0,total,message:`Hunting ${total}x ${name}...` });
  _send({ type:'observation', text:`*equips weapon* Time to hunt ${name}~`, emotion:'angry' });
  while(killed<total&&_active&&!_aborted(_gen)){
    let target=null,closest=Infinity;
    for(const e of Object.values(_bot.entities)){
      if(!e.isValid||e.name!==name) continue;
      let d; try{ d=_bot.entity.position.distanceTo(e.position); }catch(err){ continue; }
      if(d<80&&d<closest){ closest=d; target=e; }
    }
    if(!target){ await _sleep(1500); continue; }
    try{
      _bot.pathfinder.setMovements(_mc());
      _bot.pathfinder.setGoal(new goals.GoalFollow(target,1.5),true);
      _bot.pvp.attack(target);
    }catch(e){}
    let waited=0;
    while(target.isValid&&!_aborted(_gen)&&waited<30000){ await _sleep(100); waited+=100; }
    if(!target.isValid){
      killed++;
      try{ _bot.pvp.stop(); }catch(e){}
      _send({ type:'task_progress',task:label,done:killed,total,message:`Killed ${killed}/${total} ${name}` });
    }
  }
  try{ _bot.pvp?.stop(); }catch(e){}
  try{ _bot.pathfinder.stop(); }catch(e){}
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Killed ${killed}x ${name} ✓` });
}

async function _killall(task){
  const{radius,label,_gen}=task;
  const r=safeInt(radius,20);
  const HOSTILE=new Set(['zombie','skeleton','creeper','spider','cave_spider','enderman','witch','phantom','slime','husk','stray','drowned','pillager','ravager','blaze','ghast','hoglin','zoglin','piglin_brute','vex','silverfish','magma_cube']);
  let killed=0;
  while(_active&&!_aborted(_gen)){
    let target=null,closest=Infinity;
    for(const e of Object.values(_bot.entities)){
      if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
      let d; try{ d=_bot.entity.position.distanceTo(e.position); }catch(err){ continue; }
      if(d<r&&d<closest){ closest=d; target=e; }
    }
    if(!target) break;
    try{
      _bot.pathfinder.setMovements(_mc());
      _bot.pathfinder.setGoal(new goals.GoalFollow(target,1.5),true);
      _bot.pvp.attack(target);
    }catch(e){}
    let waited=0;
    while(target.isValid&&!_aborted(_gen)&&waited<20000){ await _sleep(100); waited+=100; }
    if(!target.isValid){ killed++; try{ _bot.pvp.stop(); }catch(e){} }
  }
  try{ _bot.pvp?.stop(); }catch(e){}
  try{ _bot.pathfinder.stop(); }catch(e){}
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Cleared ${killed} mobs ✓` });
}

// ── Eat (manual force) ────────────────────────────────────────────────────────
function bot_eat({label}){
  _bot.autoEat?.eat?.()
    .then(()=>_send({ type:'task_result',task:label,status:'done',message:`Ate — food: ${Math.round(_bot.food)}/20 ✓` }))
    .catch(()=>_send({ type:'task_result',task:label,status:'error',message:'No food in inventory!' }));
}

async function _equip({item,slot,label}){
  const name=item.replace('minecraft:','');
  const found=_bot.inventory.items().find(i=>i.name===name||i.name.includes(name));
  if(!found){ _send({ type:'task_result',task:label,status:'error',message:`No ${name} in inventory` }); return; }
  try{ await _bot.equip(found,slot||'hand'); _send({ type:'task_result',task:label,status:'done',message:`Equipped ${found.name} ✓` }); }
  catch(e){ _send({ type:'task_result',task:label,status:'error',message:e.message }); }
}

async function _collectItems(task){
  const{label,_gen}=task;
  _send({ type:'task_progress',task:label,done:0,total:1,message:'Looking for dropped items...' });
  await _sleep(800);
  const itemEnts=Object.values(_bot.entities).filter(e=>e.name==='item').filter(e=>{ try{ return _bot.entity.position.distanceTo(e.position)<64; }catch(err){ return false; } });
  if(!itemEnts.length){ _send({ type:'task_result',task:label,status:'done',message:'No items nearby to collect ✓' }); return; }
  let collected=0;
  for(const ent of itemEnts){
    if(!_active||_aborted(_gen)) break;
    if(!ent.isValid) continue;
    try{
      _bot.pathfinder.setMovements(_mc(false));
      await _bot.pathfinder.goto(new goals.GoalNear(ent.position.x,ent.position.y,ent.position.z,1));
      collected++; await _sleep(200);
    }catch(e){ await _sleep(300); }
  }
  _send({ type:'task_result',task:label,status:'done',message:`Collected ${collected} item stacks ✓` });
}

async function _store({item,label}){
  const chest=_bot.findBlock({matching:_bot.registry.blocksByName.chest?.id,maxDistance:20});
  if(!chest){ _send({ type:'task_result',task:label,status:'error',message:'No chest nearby!' }); return; }
  try{
    _bot.pathfinder.setMovements(_mc());
    await _bot.pathfinder.goto(new goals.GoalNear(chest.position.x,chest.position.y,chest.position.z,2));
    const cw=await _bot.openContainer(chest);
    const name=item?.replace('minecraft:','');
    const toStore=name?_bot.inventory.items().filter(i=>i.name.includes(name)):_bot.inventory.items();
    for(const it of toStore){ try{ await cw.deposit(it.type,null,it.count); }catch(e){} }
    cw.close(); _send({ type:'task_result',task:label,status:'done',message:'Stored ✓' });
  }catch(e){ _send({ type:'task_result',task:label,status:'error',message:e.message }); }
}

async function _loot({label}){
  const chest=_bot.findBlock({matching:_bot.registry.blocksByName.chest?.id,maxDistance:20});
  if(!chest){ _send({ type:'task_result',task:label,status:'error',message:'No chest nearby!' }); return; }
  try{
    _bot.pathfinder.setMovements(_mc());
    await _bot.pathfinder.goto(new goals.GoalNear(chest.position.x,chest.position.y,chest.position.z,2));
    const cw=await _bot.openContainer(chest);
    const items=cw.containerItems();
    for(const it of items){ try{ await cw.withdraw(it.type,null,it.count); }catch(e){} }
    cw.close(); _send({ type:'task_result',task:label,status:'done',message:`Looted ${items.length} stacks ✓` });
  }catch(e){ _send({ type:'task_result',task:label,status:'error',message:e.message }); }
}

async function _drop({item,count,label}){
  if(!item){ _send({ type:'task_result',task:label,status:'error',message:'Specify an item!' }); return; }
  const name=item.replace('minecraft:','').toLowerCase();
  const found=_bot.inventory.items().filter(i=>i.name===name||i.name.includes(name));
  if(!found.length){ _send({ type:'task_result',task:label,status:'error',message:`No "${name}" in inventory` }); return; }
  let dropped=0;
  for(const it of found){ const n=safeInt(count,it.count); try{ await _bot.toss(it.type,null,Math.min(n,it.count)); dropped+=Math.min(n,it.count); }catch(e){} }
  _send({ type:'task_result',task:label,status:'done',message:`Dropped ${dropped}x ${name} ✓` });
}

async function _dropAll({label}){
  const items=_bot.inventory.items();
  if(!items.length){ _send({ type:'task_result',task:label,status:'done',message:'Inventory is already empty!' }); return; }
  let dropped=0,types=0;
  for(const it of items){ try{ await _bot.toss(it.type,null,it.count); dropped+=it.count; types++; }catch(e){} await _sleep(50); }
  _send({ type:'task_result',task:label,status:'done',message:`Dropped everything — ${dropped} items (${types} types) ✓` });
}

async function _lumber(task){
  const{label,_gen}=task;
  const LOGS=['oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log'].map(n=>_bot.registry.blocksByName[n]?.id).filter(Boolean);
  let chopped=0;
  _send({ type:'task_progress',task:label,done:0,total:1,message:'Chopping trees...' });
  while(_active&&!_aborted(_gen)){
    const t=_bot.findBlock({matching:LOGS,maxDistance:32}); if(!t) break;
    try{
      _bot.pathfinder.setMovements(_mc());
      await _bot.collectBlock.collect(t); chopped++;
      if(chopped%10===0) _send({ type:'task_progress',task:label,done:chopped,total:chopped+10,message:`Chopped ${chopped} logs` });
    }catch(e){ await _sleep(600); }
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Chopped ${chopped} logs ✓` });
}

async function _explore(task){
  const{distance,label,_gen}=task;
  const dist=safeInt(distance,200); let walked=0,steps=Math.ceil(dist/20);
  _send({ type:'task_progress',task:label,done:0,total:steps,message:`Exploring ${dist} blocks...` });
  for(let i=0;i<steps&&_active&&!_aborted(_gen);i++){
    const p=_bot.entity.position; const tx=p.x+(Math.random()-.5)*40,tz=p.z+(Math.random()-.5)*40;
    try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(tx,p.y,tz,3)); walked++; if(walked%5===0) _send({ type:'task_progress',task:label,done:walked,total:steps,message:`Explored ${walked}/${steps}` }); }catch(e){ await _sleep(800); }
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Explored ~${dist} blocks ✓` });
}

async function _surface(task){
  const{label,_gen}=task;
  _send({ type:'task_progress',task:label,done:0,total:1,message:'Going to surface...' });
  try{
    _bot.pathfinder.setMovements(_mc(true)); await _bot.pathfinder.goto(new goals.GoalY(65));
    _send({ type:'task_result',task:label,status:'done',message:`Surface Y=${Math.round(_bot.entity.position.y)} ✓` });
  }catch(e){
    let att=0;
    while(_bot.entity.position.y<60&&att<300&&!_aborted(_gen)){
      const above=_bot.blockAt(_bot.entity.position.offset(0,1,0));
      if(above&&above.name!=='air'){ try{await _bot.dig(above);}catch(ee){} }
      else{ await _bot.jump(); }
      await _sleep(200); att++;
    }
    _send({ type:'task_result',task:label,status:'done',message:'Surfaced ✓' });
  }
}

async function _farm(task){
  const{label,_gen}=task;
  const CROPS=[['wheat',7,'wheat_seeds'],['carrots',7,'carrot'],['potatoes',7,'potato'],['beetroots',3,'beetroot_seeds']];
  let harvested=0;
  _send({ type:'task_progress',task:label,done:0,total:1,message:'Farming...' });
  for(const[crop,stage,seed] of CROPS){
    while(_active&&!_aborted(_gen)){
      const t=_bot.findBlock({matching:b=>b.name===crop&&b.metadata>=stage,maxDistance:32}); if(!t) break;
      try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(t.position.x,t.position.y,t.position.z,2)); await _bot.dig(t); harvested++; const si=_bot.inventory.items().find(i=>i.name===seed); if(si){ const fl=_bot.blockAt(t.position.offset(0,-1,0)); if(fl) await _bot.placeBlock(fl,vec3(0,1,0)).catch(()=>{}); } }catch(e){ await _sleep(600); }
    }
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Farmed ${harvested} crops ✓` });
}

async function _strip(task){
  const{length,label,_gen}=task;
  const len=safeInt(length,50);
  _send({ type:'task_progress',task:label,done:0,total:len,message:`Strip mining ${len} blocks...` });
  try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalY(11)); }catch(e){}
  let dug=0;
  for(let i=0;i<len&&_active&&!_aborted(_gen);i++){
    const pos=_bot.entity.position;
    const ahead=_bot.entity.position.offset(0,0,1);
    const bl=_bot.blockAt(ahead); if(bl&&bl.name!=='air'){ try{ await _safeDig(bl); dug++; }catch(e){} }
    for(const dx of [-1,1]){ const s=_bot.entity.position.offset(dx,0,0); const b=_bot.blockAt(s); if(b&&b.name.includes('ore')){ await _safeDig(b).catch(()=>{}); } }
    try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(pos.x,pos.y,pos.z+i+1,1)); }catch(e){}
    if(i%10===0) _send({ type:'task_progress',task:label,done:i,total:len,message:`Strip ${i}/${len}` });
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Strip mined ${dug} blocks ✓` });
}

async function _tunnel(task){
  const{length,label,_gen}=task;
  const len=safeInt(length,20);
  _send({ type:'task_progress',task:label,done:0,total:len,message:`Tunneling ${len}...` });
  for(let i=1;i<=len&&_active&&!_aborted(_gen);i++){
    const yaw=_bot.entity.yaw; const dx=-Math.sin(yaw),dz=-Math.cos(yaw); const pos=_bot.entity.position;
    for(const dy of [0,1]){ try{ const bl=_bot.blockAt(pos.offset(dx,dy,dz)); if(bl&&bl.name!=='air') await _safeDig(bl); }catch(e){} }
    try{ await _bot.pathfinder.goto(new goals.GoalNear(pos.x+dx,pos.y,pos.z+dz,1)); }catch(e){}
    if(i%5===0) _send({ type:'task_progress',task:label,done:i,total:len,message:`Tunnel ${i}/${len}` });
  }
  if(!_aborted(_gen)) _send({ type:'task_result',task:label,status:'done',message:`Tunneled ${len} ✓` });
}

// ── Pillar — physics fix ──────────────────────────────────────────────────────
async function _pillar(task){
  const{count,label,_gen}=task;
  const n=safeInt(count,10);
  const BLOCKS=['cobblestone','dirt','stone','oak_planks','sand'];
  let block=null;
  for(const b of BLOCKS){ if(_bot.inventory.items().find(i=>i.name===b)){ block=b; break; } }
  if(!block){ _send({ type:'task_result',task:label,status:'error',message:'No blocks!' }); return; }
  let placed=0;
  for(let i=0;i<n&&!_aborted(_gen);i++){
    try{
      const item=_bot.inventory.items().find(x=>x.name===block);
      if(!item){ _send({ type:'task_result',task:label,status:'error',message:`Ran out of ${block}` }); return; }
      await _bot.equip(item,'hand').catch(()=>{});

      // Record floor Y so we know when we've actually left the ground
      const yFloor=_bot.entity.position.y;

      // Jump — hold for 1 tick then release
      _bot.setControlState('jump',true);
      await _bot.waitForTicks(1);
      _bot.setControlState('jump',false);

      // Wait until genuinely airborne (risen ≥ 0.45 blocks above floor).
      // 2-tick wait was not enough — bot was still at ground level, placing
      // on the wrong face or failing silently. Cap at 600 ms safety.
      let risen=0;
      while(_bot.entity.position.y < yFloor+0.45 && risen < 600){
        await _sleep(30); risen+=30;
      }

      // Reference block is directly under feet (offset 0,-1,0).
      // The old code used offset(0,-2,0) which is the block the player STANDS
      // on at normal height, but mid-jump the feet have risen so -1 is correct.
      try{
        const underFeet=_bot.blockAt(_bot.entity.position.offset(0,-1,0));
        if(underFeet && underFeet.name!=='air' && !LAVA_BLOCKS.has(underFeet.name) && !FALLING_BLOCKS.has(underFeet.name)){
          await _bot.placeBlock(underFeet, vec3(0,1,0));
          placed++;
        } else {
          // Fallback: try -2 in case the player is very close to the next block boundary
          const two=_bot.blockAt(_bot.entity.position.offset(0,-2,0));
          if(two && two.name!=='air' && !LAVA_BLOCKS.has(two.name)){
            await _bot.placeBlock(two, vec3(0,1,0));
            placed++;
          }
        }
      }catch(placeErr){}

      // Wait for landing before starting the next jump — prevents iterations
      // overlapping mid-air and double-jumping without placing.
      let landWait=0;
      while(!_bot.entity.onGround && landWait<1000){ await _sleep(40); landWait+=40; }
      await _sleep(80); // brief ground-settle before next iteration
    }catch(e){ await _sleep(300); }
  }
  _send({ type:'task_result',task:label,status:'done',message:`Pillared ${placed} ✓` });
}

async function _torch({count,label}){
  const n=safeInt(count,5); const t=_bot.inventory.items().find(i=>i.name==='torch');
  if(!t){ _send({ type:'task_result',task:label,status:'error',message:'No torches!' }); return; }
  await _bot.equip(t,'hand'); let placed=0;
  for(let i=0;i<n;i++){
    try{ const fl=_bot.blockAt(_bot.entity.position.offset(0,-1,0)); if(fl){ await _bot.placeBlock(fl,vec3(0,1,0)); placed++; } const p=_bot.entity.position; _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(p.x,p.y,p.z+6,1)); await _sleep(300); }catch(e){ await _sleep(400); }
  }
  _send({ type:'task_result',task:label,status:'done',message:`Placed ${placed} torches ✓` });
}

async function _fish({duration,label}){
  const secs=safeInt(duration,60); const rod=_bot.inventory.items().find(i=>i.name==='fishing_rod');
  if(!rod){ _send({ type:'task_result',task:label,status:'error',message:'No fishing rod!' }); return; }
  await _bot.equip(rod,'hand'); _send({ type:'task_progress',task:label,done:0,total:1,message:`Fishing ${secs}s...` });
  try{ await _bot.fish(); }catch(e){}
  _send({ type:'task_result',task:label,status:'done',message:`Fished ${secs}s ✓` });
}

async function _sleep2({label}){
  const BEDS=['red_bed','blue_bed','white_bed','black_bed','orange_bed','purple_bed','yellow_bed','green_bed','cyan_bed'];
  let bed=null;
  for(const b of BEDS){ const d=_bot.registry.blocksByName[b]; if(d){ bed=_bot.findBlock({matching:d.id,maxDistance:32}); if(bed) break; } }
  if(!bed){ _send({ type:'task_result',task:label,status:'error',message:'No bed nearby!' }); return; }
  try{ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(bed.position.x,bed.position.y,bed.position.z,2)); await _bot.sleep(bed); await _sleep(2000); await _bot.wake(); _send({ type:'task_result',task:label,status:'done',message:'Slept through night ✓' }); }
  catch(e){ _send({ type:'task_result',task:label,status:'error',message:`Can't sleep: ${e.message}` }); }
}

async function _craft({item,count,label}){
  const n=safeInt(count); const def=_resolveItem(item);
  if(!def){ _send({ type:'task_result',task:label,status:'error',message:`Unknown item "${item}"` }); return; }
  try{
    const ct=_bot.findBlock({matching:_bot.registry.blocksByName.crafting_table?.id,maxDistance:16});
    const recs=_bot.recipesFor(def.id,null,1,ct);
    if(!recs.length){ _send({ type:'task_result',task:label,status:'error',message:`No recipe for ${item}` }); return; }
    if(ct){ _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(ct.position.x,ct.position.y,ct.position.z,2)); }
    await _bot.craft(recs[0],n,ct); _send({ type:'task_result',task:label,status:'done',message:`Crafted ${n}x ${item} ✓` });
  }catch(e){ _send({ type:'task_result',task:label,status:'error',message:`Craft: ${e.message}` }); }
}

async function _smelt({item,count,label}){
  const n=safeInt(count); const fDef=_bot.registry.blocksByName.furnace;
  const furnace=fDef&&_bot.findBlock({matching:fDef.id,maxDistance:16});
  if(!furnace){ _send({ type:'task_result',task:label,status:'error',message:'No furnace nearby!' }); return; }
  try{
    _bot.pathfinder.setMovements(_mc()); await _bot.pathfinder.goto(new goals.GoalNear(furnace.position.x,furnace.position.y,furnace.position.z,2));
    const fw=await _bot.openFurnace(furnace);
    const inp=_bot.inventory.items().find(i=>i.name.includes(item.replace('minecraft:','')));
    const fuel=_bot.inventory.items().find(i=>['coal','charcoal','oak_planks','oak_log'].includes(i.name));
    if(!inp){ fw.close(); _send({ type:'task_result',task:label,status:'error',message:`No ${item} in inventory` }); return; }
    if(!fuel){ fw.close(); _send({ type:'task_result',task:label,status:'error',message:'No fuel!' }); return; }
    await fw.putFuel(fuel.type,null,Math.min(fuel.count,n)); await fw.putInput(inp.type,null,Math.min(inp.count,n));
    _send({ type:'task_progress',task:label,done:0,total:1,message:`Smelting ${n}x ${item}... (~${n*10}s)` });
    await _sleep(n*10000); await fw.takeOutput(); fw.close();
    _send({ type:'task_result',task:label,status:'done',message:`Smelted ${n}x ${item} ✓` });
  }catch(e){ _send({ type:'task_result',task:label,status:'error',message:`Smelt: ${e.message}` }); }
}

// ── Linked chest + bring ──────────────────────────────────────────────────────
let _linkedChest=null;
async function _chestLink({label}){
  const def=_bot.registry.blocksByName.chest;
  if(!def){ _send({ type:'task_result',task:label,status:'error',message:'No chest block in registry!' }); return; }
  const chest=_bot.findBlock({matching:def.id,maxDistance:6});
  if(!chest){ _send({ type:'task_result',task:label,status:'error',message:'No chest within 6 blocks!' }); return; }
  _linkedChest={x:chest.position.x,y:chest.position.y,z:chest.position.z};
  _send({ type:'task_result',task:label,status:'done',message:`Linked chest at ${Math.round(_linkedChest.x)} ${Math.round(_linkedChest.y)} ${Math.round(_linkedChest.z)} ✓` });
}

async function _bring({item,count,label}){
  if(!_linkedChest){ _send({ type:'task_result',task:label,status:'error',message:'No chest linked! Use %chest link while standing next to one.' }); return; }
  const n=safeInt(count,1); const itemName=item.replace('minecraft:','').toLowerCase();
  const playerEnt=Object.values(_bot.players).find(p=>p.entity&&p.username!==_bot.username);
  const playerPos=playerEnt?.entity?.position?.clone()??_bot.entity.position.clone();
  _send({ type:'task_progress',task:label,done:0,total:3,message:'Going to chest...' });
  try{ _bot.pathfinder.setMovements(_mc(false)); await _bot.pathfinder.goto(new goals.GoalNear(_linkedChest.x,_linkedChest.y,_linkedChest.z,2)); }
  catch(e){ _send({ type:'task_result',task:label,status:'error',message:`Can't reach chest: ${e.message}` }); return; }
  _send({ type:'task_progress',task:label,done:1,total:3,message:`Searching for ${itemName}...` });
  let withdrew=0;
  try{
    const chestBlock=_bot.blockAt(new (require('vec3'))(_linkedChest.x,_linkedChest.y,_linkedChest.z));
    if(!chestBlock){ _send({ type:'task_result',task:label,status:'error',message:'Chest block gone!' }); return; }
    const cw=await _bot.openContainer(chestBlock);
    const match=cw.containerItems().find(s=>s.name===itemName||s.name.includes(itemName));
    if(!match){ cw.close(); _send({ type:'task_result',task:label,status:'error',message:`No ${itemName} in the linked chest!` }); return; }
    const actual=Math.min(n,match.count); await cw.withdraw(match.type,null,actual); withdrew=actual; cw.close();
    await _bot.waitForTicks(2);
  }catch(e){ _send({ type:'task_result',task:label,status:'error',message:`Chest error: ${e.message}` }); return; }
  _send({ type:'task_progress',task:label,done:2,total:3,message:'Coming back to you...' });
  try{ _bot.pathfinder.setMovements(_mc(false)); await _bot.pathfinder.goto(new goals.GoalNear(playerPos.x,playerPos.y,playerPos.z,2)); }catch(e){}
  try{ const toToss=_bot.inventory.items().find(s=>s.name===itemName||s.name.includes(itemName)); if(toToss) await _bot.toss(toToss.type,null,withdrew); }catch(e){}
  const quips=["Try not to break this one.","*drops it at your feet* There. Happy?","Here. Don't lose it this time~","*slides it over* You owe me.","Fetched it. You're welcome~"];
  _send({ type:'task_result',task:label,status:'done',message:`${quips[Math.floor(Math.random()*quips.length)]} (${withdrew}x ${itemName})` });
}

// ── Status + Inventory — SILENT (bypass chat/TTS via dedicated message types) ─
// Python receives `inventory_update` / `status_update` and routes them ONLY to
// the UI inventory tab / stats label — never to the chat bubble or TTS engine.
function _status(){
  const pos=_bot.entity.position;
  const hp  = Math.round(_bot.health);
  const food= Math.round(_bot.food);
  const x=Math.round(pos.x), y=Math.round(pos.y), z=Math.round(pos.z);
  const held= _bot.heldItem?.name||'empty';
  // Dedicated message type — Python routes this directly to the stats label.
  // XP is intentionally omitted (noisy / not requested by user).
  _send({ type:'status_update', hp, food, x, y, z, held });
  // Empty task_result still needed so the task bar clears correctly.
  _send({ type:'task_result', task:'status', status:'done', message:'',
          task_list:_taskList.map(t=>t.label) });
}

function _inv(){
  const rawItems=_bot.inventory.items();
  // Group by name for a tidy summary.
  const groups={};
  for(const i of rawItems){ groups[i.name]=(groups[i.name]||0)+i.count; }
  const items=Object.entries(groups).map(([name,count])=>({ name, count }));
  // Dedicated message type — Python routes this directly to the inventory list.
  _send({ type:'inventory_update', items, totalStacks:rawItems.length });
  // Empty task_result so the task bar clears correctly.
  _send({ type:'task_result', task:'inv', status:'done', message:'',
          task_list:_taskList.map(t=>t.label) });
}

async function _look({player,label}){
  const p=_bot.players[player??'']?.entity;
  if(p) await _bot.lookAt(p.position.offset(0,1.6,0));
  _send({ type:'task_result',task:label,status:'done',message:'Looking ✓' });
}

module.exports={ start, stop, queueTask, clearQueue, setFriends, getLinkedChest:()=>_linkedChest };
