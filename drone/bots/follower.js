'use strict';
/**
 * [MODULE] follower.js
 * [SYSTEM] ProjectDVC — Reactive companion cortex. Tracks the target player,
 *          fires environmental observations and emotion hints on world events,
 *          and retaliates with pvp plugin when the drone or player is threatened.
 * [AUTHOR] Abtin
 * 
 * Copyright (c) 2026 Abtin (github.com/OneEyeAbtin). All rights reserved.
This code may not be copied, modified, or distributed without permission.
 */
const { goals, Movements } = require('mineflayer-pathfinder');

const SCAN_MS    = 4000;
const FOLLOW_DIST = 2;
let _bot=null, _send=null, _target=null, _timer=null, _lookTimer=null;
let _prevHealth=20;
let _friends=new Set();
let _fighting=false;  // pvp plugin is active

function setFriends(set){ _friends=set; }

const _cd=new Map();
function cd(key,ms=18000){
  if(_cd.has(key)) return false;
  _cd.set(key, setTimeout(()=>_cd.delete(key), ms));
  return true;
}

// ── Response pools ────────────────────────────────────────────────────────────
const R={
  hostile_creeper: ['*SCREAMS* CREEPER!! RUN!!','CREEPER!! NOT TODAY!!','CREEPER GO GO GO!!'],
  hostile_warden:  ["*freezes* ...Warden. Don't. Move.","*whisper* Warden. Quiet. Please.","*shaking* So dead if it notices us..."],
  hostile_phantom: ["*looks up* Phantom... someone hasn't slept~","*ducks* Phantom!! Cover!!","Great, flying nightmares."],
  hostile_enderman:["*avoids eyes* Don't look at it. DON'T.","*stares at ceiling* La la la, not looking~"],
  hostile_many:    ['*grabs sleeve* {n} mobs!! RUN!!','WE ARE SURROUNDED!! GO!!'],
  hostile_generic: ['*tenses* {name} spotted~','Watch out for that {name}!'],
  rare_diamond:    ['*SCREAMS* DIAMONDS!! YES!!','DIAMONDS!!! WE\'RE RICH!!','*vibrating* IS THAT DIAMONDS?!'],
  rare_netherite:  ['*gasps* NETHERITE!!','Oh my GOD NETHERITE?!','*shaking* ...actual netherite...'],
  rare_totem:      ['*holds up* Totem of Undying~ precious~','Totem!! Don\'t waste it!!'],
  rare_emerald:    ['Ooh, emerald~','*pockets it* Nice~'],
  rare_spawner:    ['*backs away* A spawner... dangerous.','Oh no, spawner. Stay ready!'],
  rare_chest:      ['*peeks* A chest!! What\'s inside~?','Ooh treasure??'],
  rare_portal:     ['*stares* A nether portal... are we going?','*gulp* Nether portal... must we?'],
  night:           ['Getting dark... stay close~','*shivers* Night again...','Monsters waking up... careful~'],
  dawn:            ['*stretches* Morning!! We survived!!','Finally light~ I missed the sun.'],
  hurt_big:        ['*SCREAMS* {dmg} HEARTS!!','OW!! {dmg} hearts!! HURT!!','*shocked* How {dmg} hearts?!'],
  hurt_med:        ['*hisses* OW!! {dmg} hearts!','*winces* That hurt — {dmg} hearts!','OW! {dmg} hearts!'],
  hurt_small:      ['*flinches* Ow!','Ow ow ow...','*rubs it* That stung~'],
  crit_hp:         ['*PANIC* ONLY {hp} HEARTS!! HEAL!!','I\'M ALMOST DEAD!! {hp} HEARTS!!'],
  kill:            ['*fist pump* Got it!','Take that!!','DOWN! ✓','One less problem~','Boom!'],
  pickup_diamond:  ['*bounces* DIAMONDS!! YES!!','*sparkles* Diamonds~!! YES!!'],
  pickup_netherite:['*gasps* NETHERITE!! Unstoppable now!!','Netherite!! I can\'t believe it!!'],
  pickup_totem:    ['*reverently* Totem of Undying~','Don\'t you DARE waste this!'],
  pickup_sword_net:['*stares* NETHERITE SWORD?! Unstoppable~','Netherite sword... *swoons*'],
  pickup_sword_dia:['Ooh, diamond sword! Strong~','*swings* Diamond~! Now we\'re talking!'],
  pickup_sword_iron:['Iron sword! Now I can fight~','*nods* Iron sword. Good.'],
  pickup_sword_else:['A sword~ *poses*','Armed!'],
  pickup_pick_net: ['NETHERITE PICKAXE?! Mine ANYTHING!!'],
  pickup_pick_dia: ['Diamond pickaxe!! Speed run time~'],
  pickup_pick_iron:['Iron pickaxe! Actually useful~'],
  pickup_armor_net:['NETHERITE ARMOR?! INVINCIBLE!!','*flexes* Netherite protection~'],
  pickup_armor_dia:['Diamond armor!! *poses*','*flexes* Diamond protection~!'],
  death_pickup:    ['*respawning* Going to grab my stuff!','I died — going back for my items~'],
  rain:            ['Ugh, it\'s raining...','*shakes hair* Of course it rains NOW.'],
  other_player:    ['*glances* Who\'s {name}? Trust them?','A stranger... {name}. Keep an eye~'],
  biome_nether:    ['*sniffs* Brimstone and regret.','I hate it here. I hate it here.'],
  biome_deep_dark: ['*freezes* DEEP DARK. DO NOT. MAKE. A SOUND.','*whispering* Warden territory...'],
  biome_mushroom:  ['GIANT MUSHROOMS?! What IS this?!','No hostile mobs!! Finally PEACE~'],
  biome_frozen:    ['*shivers* SO COLD I can\'t feel my feet...'],
  biome_warped:    ['The warped forest is beautiful in a cursed way~'],
  hunger:          ['*stomach growls* STARVING... food??','Foooood... dying~'],
  advancement:     ['*claps* ACHIEVEMENT!! LET\'S GO!!','ADVANCEMENT!! Look at us~','*victory dance* We got one!!'],
};

function pick(key, vars={}){
  const pool=R[key]||['...'];
  let s=pool[Math.floor(Math.random()*pool.length)];
  for(const [k,v] of Object.entries(vars)) s=s.replace(new RegExp(`\\{${k}\\}`,'g'),v);
  return s;
}

const HOSTILE=new Set(['creeper','zombie','skeleton','spider','cave_spider','enderman','witch',
  'phantom','drowned','husk','stray','pillager','ravager','evoker','vindicator',
  'warden','blaze','ghast','magma_cube','slime','guardian','elder_guardian',
  'silverfish','endermite','hoglin','zoglin','piglin_brute','vex']);

// ── Start / Stop ──────────────────────────────────────────────────────────────
function start(bot, sendFn, playerName){
  _bot=bot; _send=sendFn; _target=playerName;
  _prevHealth=bot.health??20;
  _fighting=false;
  _cd.clear();
  _follow();
  _timer=setInterval(_scan, SCAN_MS);
  _lookTimer=setInterval(_lookAtTarget, 400);
  bot.on('health',     _onHealth);
  bot.on('entityHurt', _onEntityHurt);
  bot.on('entityDead', _onEntityDead);
  bot.on('rain',       _onRain);
  bot.on('playerCollect', _onPickup);   // still needed for weapon/armor reactions
  _send({ type:'mode_changed', mode:'follower', message:`Following ${playerName} 👁` });
}

function stop(){
  if(_timer){ clearInterval(_timer); _timer=null; }
  if(_lookTimer){ clearInterval(_lookTimer); _lookTimer=null; }
  if(_bot){
    _bot.off('health',     _onHealth);
    _bot.off('entityHurt', _onEntityHurt);
    _bot.off('entityDead', _onEntityDead);
    _bot.off('rain',       _onRain);
    _bot.off('playerCollect', _onPickup);
    try{ _bot.pvp?.stop(); }catch(e){}
    try{ _bot.pathfinder.stop(); }catch(e){}
  }
  _fighting=false;
  _cd.forEach(t=>clearTimeout(t)); _cd.clear();
}

function setTarget(name){ _target=name; _follow(); }

// ── Head tracking + follow ────────────────────────────────────────────────────
function _lookAtTarget(){
  if(!_bot||!_target) return;
  try{
    const p=_bot.players[_target];
    if(p?.entity) _bot.lookAt(p.entity.position.offset(0,1.62,0), true);
  }catch(e){}
}

function _follow(){
  if(!_bot||!_target) return;
  try{
    const p=_bot.players[_target]; if(!p?.entity) return;
    const mc=new Movements(_bot);
    mc.allowSprinting=true;
    // Disable pathfinder's built-in scaffolding — its internal tick-loop races
    // the physics engine causing the bot to jump without placing, or place on the
    // wrong face. Manual pillar (%pillar) handles elevation reliably instead.
    mc.allow1by1towers=false;
    mc.scaffoldingBlocks=[];
    _bot.pathfinder.setMovements(mc);
    _bot.pathfinder.setGoal(new goals.GoalFollow(p.entity, FOLLOW_DIST), true);
  }catch(e){}
}

// ── Scan ──────────────────────────────────────────────────────────────────────
const RARE_BLOCKS=[
  ['diamond_ore','rare_diamond','excited'],['deepslate_diamond_ore','rare_diamond','excited'],
  ['ancient_debris','rare_netherite','excited'],['emerald_ore','rare_emerald','happy'],
  ['spawner','rare_spawner','shocked'],['chest','rare_chest','thinking'],['nether_portal','rare_portal','shocked'],
];
const BIOME_KEYS={
  'minecraft:nether_wastes':'biome_nether','minecraft:soul_sand_valley':'biome_nether',
  'minecraft:basalt_deltas':'biome_nether','minecraft:deep_dark':'biome_deep_dark',
  'minecraft:mushroom_fields':'biome_mushroom','minecraft:frozen_ocean':'biome_frozen',
  'minecraft:warped_forest':'biome_warped','minecraft:crimson_forest':'biome_nether',
};

function _scan(){
  if(!_bot) return;
  try{
    _follow();
    // Hostiles
    const hostiles=Object.values(_bot.entities)
      .filter(e=>e.position&&e.type==='mob'&&HOSTILE.has(e.name)&&_bot.entity.position.distanceTo(e.position)<20)
      .map(e=>({name:e.name, dist:_bot.entity.position.distanceTo(e.position)}))
      .sort((a,b)=>a.dist-b.dist);
    if(hostiles.length>0){
      const h=hostiles[0];
      if(cd(`hostile:${h.name}`,12000)){
        let txt,emo;
        if(h.name==='creeper')   { txt=pick('hostile_creeper'); emo='shocked'; }
        else if(h.name==='warden')  { txt=pick('hostile_warden');  emo='shocked'; }
        else if(h.name==='phantom') { txt=pick('hostile_phantom'); emo='annoyed'; }
        else if(h.name==='enderman'){ txt=pick('hostile_enderman');emo='confused'; }
        else if(hostiles.length>=3) { txt=pick('hostile_many',{n:hostiles.length}); emo='shocked'; }
        else { txt=pick('hostile_generic',{name:h.name}); emo='confused'; }
        return _send({ type:'observation', text:txt, emotion:emo });
      }
    }
    // Rare blocks
    for(const [id,rKey,emo] of RARE_BLOCKS){
      const def=_bot.registry.blocksByName[id]; if(!def) continue;
      try{ if(_bot.findBlock({matching:def.id, maxDistance:10})&&cd(`rare:${id}`,25000))
        return _send({ type:'observation', text:pick(rKey), emotion:emo }); }catch(e){}
    }
    // Time
    const tod=_bot.time?.timeOfDay??0;
    if(tod>12800&&tod<23000&&cd('night',80000))  return _send({ type:'observation', text:pick('night'), emotion:'sad' });
    if(tod>23200&&tod<24000&&cd('dawn',120000))  return _send({ type:'observation', text:pick('dawn'),  emotion:'happy' });
    // Biome
    try{
      const b=_bot.world.getBiome(_bot.entity.position);
      const bk=b&&BIOME_KEYS[b.name];
      if(bk&&cd(`biome:${b.name}`,120000)) return _send({ type:'observation', text:pick(bk), emotion:'thinking' });
    }catch(e){}
    // Hunger
    if(_bot.food<=6&&cd('hunger',30000)) return _send({ type:'observation', text:pick('hunger'), emotion:'sad' });
    // Other players
    for(const p of Object.values(_bot.players)){
      if(!p.entity||p.username===_bot.username||p.username===_target) continue;
      const d=_bot.entity.position.distanceTo(p.entity.position);
      if(d<16&&cd(`player:${p.username}`,60000))
        return _send({ type:'observation', text:pick('other_player',{name:p.username}), emotion:'thinking' });
    }
  }catch(e){ console.log('[Follower] scan error:', e.message); }
}

// ── Health events ─────────────────────────────────────────────────────────────
function _onHealth(){
  const hp=_bot.health, prev=_prevHealth; _prevHealth=hp;
  const dmg=prev-hp;
  if(dmg>0){
    let key,emo;
    if(dmg>=8)      { key='hurt_big';   emo='shocked'; }
    else if(dmg>=4) { key='hurt_med';   emo='angry'; }
    else            { key='hurt_small'; emo='sad'; }
    _send({ type:'observation', text:pick(key,{dmg:Math.round(dmg)}), emotion:emo });
    // Use mineflayer-tool to equip best weapon automatically
    try{ _bot.tool.equipForBlock?.({name:'air'}); }catch(e){}  // fallback: just trigger tool select
    // Use pvp plugin to fight back when hit
    if(!_fighting){
      let target=null, closest=Infinity;
      for(const e of Object.values(_bot.entities)){
        if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
        const d=_bot.entity.position.distanceTo(e.position);
        if(d<10&&d<closest){ closest=d; target=e; }
      }
      if(target){
        _fighting=true;
        _send({ type:'observation', text:'*draws weapon* Not today!!', emotion:'angry' });
        try{
          const mc=new Movements(_bot); mc.allowSprinting=true;
          _bot.pathfinder.setMovements(mc);
          _bot.pvp.attack(target);
        }catch(e){ _fighting=false; }
      }
    }
  }
  if(hp<=4&&cd('crit_hp',10000))
    _send({ type:'observation', text:pick('crit_hp',{hp:Math.round(hp)}), emotion:'shocked' });
}

function _onEntityHurt(entity){
  if(!entity) return;
  // Player got hurt — help fight
  const tp=_bot.players[_target]?.entity;
  if(tp&&entity===tp&&cd('player_hurt',5000)){
    _send({ type:'observation', text:'*reaches out* Hey!! Are you okay??', emotion:'sad' });
    let target2=null, closest2=Infinity;
    for(const e of Object.values(_bot.entities)){
      if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
      const d=_bot.entity.position.distanceTo(e.position);
      if(d<12&&d<closest2){ closest2=d; target2=e; }
    }
    if(target2&&!_fighting){
      _fighting=true;
      try{ _bot.pvp.attack(target2); }catch(e){ _fighting=false; }
    }
  }
}

function _onEntityDead(entity){
  if(!entity?.name||!HOSTILE.has(entity.name)) return;
  _fighting=false;
  try{ _bot.pvp?.stop(); }catch(e){}
  // Resume following after kill
  setTimeout(()=>_follow(), 500);
  if(cd(`kill:${entity.name}`,6000))
    _send({ type:'observation', text:pick('kill'), emotion:'excited' });
}

// ── Pickup reactions (weapons/armor/valuables only — NO gift detection) ───────
function _onPickup(collector, item){
  if(!item) return;
  const isMine   = collector===_bot.entity;
  const isPlayer = _bot.players[_target]?.entity===collector;
  if(!isMine&&!isPlayer) return;
  const name=item.name||'';
  // ── Weapon/armor reactions (always react, cooldown prevents spam) ──────────
  if(name.includes('netherite_sword') &&cd('p:nsword',15000)) return _send({type:'observation',text:pick('pickup_sword_net'),emotion:'excited'});
  if(name.includes('diamond_sword')   &&cd('p:dsword',15000)) return _send({type:'observation',text:pick('pickup_sword_dia'),emotion:'happy'});
  if(name.includes('iron_sword')      &&cd('p:isword',15000)) return _send({type:'observation',text:pick('pickup_sword_iron'),emotion:'happy'});
  if(name.includes('_sword')          &&cd('p:sword', 15000)) return _send({type:'observation',text:pick('pickup_sword_else'),emotion:'happy'});
  if(name.includes('netherite_pickaxe')&&cd('p:npick',15000)) return _send({type:'observation',text:pick('pickup_pick_net'),emotion:'excited'});
  if(name.includes('diamond_pickaxe') &&cd('p:dpick',15000)) return _send({type:'observation',text:pick('pickup_pick_dia'),emotion:'happy'});
  if(name.includes('iron_pickaxe')    &&cd('p:ipick',15000)) return _send({type:'observation',text:pick('pickup_pick_iron'),emotion:'happy'});
  if(name.includes('netherite')&&(name.includes('helmet')||name.includes('chest')||name.includes('legg')||name.includes('boot'))&&cd('p:narmor',15000))
    return _send({type:'observation',text:pick('pickup_armor_net'),emotion:'excited'});
  if(name.includes('diamond')&&(name.includes('helmet')||name.includes('chest')||name.includes('legg')||name.includes('boot'))&&cd('p:darmor',15000))
    return _send({type:'observation',text:pick('pickup_armor_dia'),emotion:'happy'});
  // Valuables
  if(name.includes('diamond')   &&cd('p:diamond',  12000)) return _send({type:'observation',text:pick('pickup_diamond'),  emotion:'excited'});
  if(name.includes('netherite') &&cd('p:netherite',15000)) return _send({type:'observation',text:pick('pickup_netherite'),emotion:'excited'});
  if(name.includes('totem')     &&cd('p:totem',    20000)) return _send({type:'observation',text:pick('pickup_totem'),    emotion:'excited'});
  // Everything else (ore drops, logs, etc.) — silently ignored
}

function _onRain(){
  if(cd('rain',100000)) _send({ type:'observation', text:pick('rain'), emotion:'annoyed' });
}

module.exports={ start, stop, setTarget, setFriends };
