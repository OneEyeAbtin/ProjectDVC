'use strict';
/**
 * [MODULE] follower.js
 * [SYSTEM] ProjectDVC — Reactive companion cortex.
 * [AUTHOR] Abtin
 *
 * Uses GoalFollow (pathfinder) with canDig=false + allow1by1towers=false.
 * No scaffolding, no digTime crashes (bot.js blockAt shim handles that).
 * Knockback pause: stops pathfinder for 700ms on damage so physics can apply.
 * Stuck recovery: re-issues GoalFollow every 3s if position hasn't changed.
 */
const { goals, Movements } = require('mineflayer-pathfinder');

const FOLLOW_DIST  = 2;
const SCAN_MS      = 4000;
const LOOK_MS      = 300;
const STUCK_MS     = 3000;   // re-issue goal if no movement in this window
const KNOCKBACK_MS = 700;    // pause pathfinder after being hit (let physics apply)

let _bot=null, _send=null, _target=null;
let _timer=null, _lookTimer=null, _stuckTimer=null;
let _prevHealth=20, _friends=new Set(), _fighting=false;
let _lastPos=null, _knockbackPaused=false, _knockbackTimeout=null;

function setFriends(s){ _friends=s; }

// ── Cooldown map ──────────────────────────────────────────────────────────────
const _cd=new Map();
function cd(key,ms=18000){
  if(_cd.has(key)) return false;
  _cd.set(key,setTimeout(()=>_cd.delete(key),ms));
  return true;
}

// ── Response pools ────────────────────────────────────────────────────────────
const R={
  hostile_creeper: ['*SCREAMS* CREEPER!! RUN!!','CREEPER!! NOT TODAY!!','CREEPER GO GO GO!!'],
  hostile_warden:  ["*freezes* ...Warden. Don't. Move.","*whisper* Warden. Quiet. Please."],
  hostile_phantom: ["*looks up* Phantom! Cover!!","Great, flying nightmares."],
  hostile_enderman:["*avoids eyes* Don't look at it. DON'T."],
  hostile_many:    ['*grabs sleeve* {n} mobs!! RUN!!','WE ARE SURROUNDED!! GO!!'],
  hostile_generic: ['*tenses* {name} spotted~','Watch out for that {name}!'],
  rare_diamond:    ['*SCREAMS* DIAMONDS!! YES!!','DIAMONDS!!! WE\'RE RICH!!'],
  rare_netherite:  ['*gasps* NETHERITE!!','Oh my GOD NETHERITE?!'],
  rare_totem:      ['*holds up* Totem of Undying~'],
  rare_emerald:    ['Ooh, emerald~'],
  rare_spawner:    ['*backs away* A spawner... dangerous.'],
  rare_chest:      ['*peeks* A chest!! What\'s inside~?'],
  rare_portal:     ['*stares* A nether portal... are we going?'],
  night:           ['Getting dark... stay close~','*shivers* Night again...'],
  dawn:            ['*stretches* Morning!! We survived!!','Finally light~'],
  hurt_big:        ['*SCREAMS* {dmg} HEARTS!!','OW!! {dmg} hearts!! HURT!!'],
  hurt_med:        ['*hisses* OW!! {dmg} hearts!','*winces* That hurt!'],
  hurt_small:      ['*flinches* Ow!','Ow ow ow...'],
  crit_hp:         ['*PANIC* ONLY {hp} HEARTS!! HEAL!!'],
  kill:            ['*fist pump* Got it!','Take that!!','One less problem~'],
  pickup_diamond:  ['*bounces* DIAMONDS!! YES!!'],
  pickup_netherite:['*gasps* NETHERITE!! Unstoppable now!!'],
  pickup_totem:    ['*reverently* Totem of Undying~'],
  pickup_sword_net:['*stares* NETHERITE SWORD?! Unstoppable~'],
  pickup_sword_dia:['Ooh, diamond sword! Strong~'],
  pickup_sword_iron:['Iron sword! Now I can fight~'],
  pickup_sword_else:['A sword~ *poses*'],
  pickup_pick_net: ['NETHERITE PICKAXE?! Mine ANYTHING!!'],
  pickup_pick_dia: ['Diamond pickaxe!! Speed run time~'],
  pickup_pick_iron:['Iron pickaxe! Actually useful~'],
  pickup_armor_net:['NETHERITE ARMOR?! INVINCIBLE!!'],
  pickup_armor_dia:['Diamond armor!! *poses*'],
  rain:            ['Ugh, it\'s raining...'],
  other_player:    ['*glances* Who\'s {name}? Trust them?'],
  biome_nether:    ['*sniffs* Brimstone and regret.','I hate it here.'],
  biome_deep_dark: ['*freezes* DEEP DARK. DO NOT. MAKE. A SOUND.'],
  biome_mushroom:  ['GIANT MUSHROOMS?! No hostile mobs!! PEACE~'],
  biome_frozen:    ['*shivers* SO COLD I can\'t feel my feet...'],
  biome_warped:    ['The warped forest is beautiful in a cursed way~'],
  hunger:          ['*stomach growls* STARVING... food??'],
  advancement:     ['*claps* ACHIEVEMENT!! LET\'S GO!!'],
};
function pick(key,vars={}){
  const pool=R[key]||['...'];
  let s=pool[Math.floor(Math.random()*pool.length)];
  for(const[k,v] of Object.entries(vars)) s=s.replace(new RegExp(`\\{${k}\\}`,'g'),v);
  return s;
}

const HOSTILE=new Set(['creeper','zombie','skeleton','spider','cave_spider','enderman',
  'witch','phantom','drowned','husk','stray','pillager','ravager','evoker','vindicator',
  'warden','blaze','ghast','magma_cube','slime','guardian','elder_guardian',
  'silverfish','endermite','hoglin','zoglin','piglin_brute','vex']);

// ── Movement config ───────────────────────────────────────────────────────────
function _mc(){
  const mc=new Movements(_bot);
  mc.allowSprinting=true;
  mc.canDig=false;              // never break blocks while following
  mc.allow1by1towers=false;    // no scaffolding
  mc.scaffoldingBlocks=[];
  return mc;
}

// ── Follow goal ───────────────────────────────────────────────────────────────
function _follow(){
  if(!_bot||!_target||_knockbackPaused) return;
  try{
    const p=_bot.players[_target]; if(!p?.entity) return;
    _bot.pathfinder.setMovements(_mc());
    _bot.pathfinder.setGoal(new goals.GoalFollow(p.entity, FOLLOW_DIST), true);
  }catch(e){}
}

// ── Start / Stop ──────────────────────────────────────────────────────────────
function start(bot, sendFn, playerName){
  _bot=bot; _send=sendFn; _target=playerName;
  _prevHealth=bot.health??20;
  _fighting=false; _knockbackPaused=false; _lastPos=null;
  _cd.clear();
  _follow();
  _lookTimer=setInterval(_lookAtTarget, LOOK_MS);
  _timer=setInterval(_scan, SCAN_MS);
  _startStuckDetector();
  bot.on('health',       _onHealth);
  bot.on('entityHurt',   _onEntityHurt);
  bot.on('entityDead',   _onEntityDead);
  bot.on('rain',         _onRain);
  bot.on('playerCollect',_onPickup);
  _send({ type:'mode_changed', mode:'follower', message:`Following ${playerName} 👁` });
}

function stop(){
  _clearKnockbackPause();
  _stopStuckDetector();
  if(_timer){ clearInterval(_timer); _timer=null; }
  if(_lookTimer){ clearInterval(_lookTimer); _lookTimer=null; }
  if(_bot){
    _bot.off('health',       _onHealth);
    _bot.off('entityHurt',   _onEntityHurt);
    _bot.off('entityDead',   _onEntityDead);
    _bot.off('rain',         _onRain);
    _bot.off('playerCollect',_onPickup);
    try{ _bot.pvp?.stop(); }catch(e){}
    try{ _bot.pathfinder?.stop(); }catch(e){}
  }
  _fighting=false; _knockbackPaused=false;
  _cd.forEach(t=>clearTimeout(t)); _cd.clear();
}

function setTarget(name){ _target=name; _follow(); }

// ── Head tracking ─────────────────────────────────────────────────────────────
function _lookAtTarget(){
  if(!_bot||!_target) return;
  try{
    const p=_bot.players[_target];
    if(p?.entity) _bot.lookAt(p.entity.position.offset(0,1.62,0), true);
  }catch(e){}
}

// ── Knockback pause ───────────────────────────────────────────────────────────
// Stop pathfinder briefly after taking damage so Minecraft physics can apply
// the knockback velocity. Without this, GoalFollow immediately overrides it.
function _pauseForKnockback(){
  _knockbackPaused=true;
  try{ _bot.pathfinder?.stop(); }catch(e){}
  _clearKnockbackPause();
  _knockbackTimeout=setTimeout(()=>{
    _knockbackPaused=false;
    _knockbackTimeout=null;
    _follow(); // resume following after knockback settles
  }, KNOCKBACK_MS);
}
function _clearKnockbackPause(){
  if(_knockbackTimeout){ clearTimeout(_knockbackTimeout); _knockbackTimeout=null; }
  _knockbackPaused=false;
}

// ── Stuck detector ────────────────────────────────────────────────────────────
// Re-issues GoalFollow every STUCK_MS if position hasn't changed while we
// should be moving. Handles pathfinder getting stuck on its own state machine.
function _startStuckDetector(){
  _stopStuckDetector();
  _lastPos=null;
  _stuckTimer=setInterval(()=>{
    if(!_bot||!_target||_knockbackPaused||_fighting) return;
    const p=_bot.players[_target];
    if(!p?.entity) return;
    const dist=_bot.entity.position.distanceTo(p.entity.position);
    if(dist<=FOLLOW_DIST) return; // close enough, not supposed to be moving
    const cur=_bot.entity.position;
    if(_lastPos && cur.distanceTo(_lastPos)<0.3){
      // Hasn't moved — re-issue goal to unstick pathfinder
      _follow();
    }
    _lastPos=cur.clone();
  }, STUCK_MS);
}
function _stopStuckDetector(){
  if(_stuckTimer){ clearInterval(_stuckTimer); _stuckTimer=null; }
  _lastPos=null;
}

// ── Environment scan ─────────────────────────────────────────────────────────
const RARE_BLOCKS=[
  ['diamond_ore','rare_diamond','excited'],
  ['deepslate_diamond_ore','rare_diamond','excited'],
  ['ancient_debris','rare_netherite','excited'],
  ['emerald_ore','rare_emerald','happy'],
  ['spawner','rare_spawner','shocked'],
  ['chest','rare_chest','thinking'],
  ['nether_portal','rare_portal','shocked'],
];
const BIOME_KEYS={
  'minecraft:nether_wastes':'biome_nether',
  'minecraft:soul_sand_valley':'biome_nether',
  'minecraft:basalt_deltas':'biome_nether',
  'minecraft:deep_dark':'biome_deep_dark',
  'minecraft:mushroom_fields':'biome_mushroom',
  'minecraft:frozen_ocean':'biome_frozen',
  'minecraft:warped_forest':'biome_warped',
  'minecraft:crimson_forest':'biome_nether',
};

function _scan(){
  if(!_bot) return;
  try{
    const hostiles=Object.values(_bot.entities)
      .filter(e=>e.position&&e.type==='mob'&&HOSTILE.has(e.name)
               &&_bot.entity.position.distanceTo(e.position)<20)
      .sort((a,b)=>_bot.entity.position.distanceTo(a.position)
                  -_bot.entity.position.distanceTo(b.position));
    if(hostiles.length>0){
      const h=hostiles[0];
      if(cd(`hostile:${h.name}`,12000)){
        let txt,emo;
        if(h.name==='creeper')    {txt=pick('hostile_creeper');emo='shocked';}
        else if(h.name==='warden'){txt=pick('hostile_warden'); emo='shocked';}
        else if(h.name==='phantom'){txt=pick('hostile_phantom');emo='annoyed';}
        else if(h.name==='enderman'){txt=pick('hostile_enderman');emo='confused';}
        else if(hostiles.length>=3){txt=pick('hostile_many',{n:hostiles.length});emo='shocked';}
        else{txt=pick('hostile_generic',{name:h.name});emo='confused';}
        return _send({type:'observation',text:txt,emotion:emo});
      }
    }
    for(const[id,rKey,emo] of RARE_BLOCKS){
      const def=_bot.registry.blocksByName[id]; if(!def) continue;
      try{
        if(_bot.findBlock({matching:def.id,maxDistance:10})&&cd(`rare:${id}`,25000))
          return _send({type:'observation',text:pick(rKey),emotion:emo});
      }catch(e){}
    }
    const tod=_bot.time?.timeOfDay??0;
    if(tod>12800&&tod<23000&&cd('night',80000))  return _send({type:'observation',text:pick('night'),emotion:'sad'});
    if(tod>23200&&tod<24000&&cd('dawn',120000))  return _send({type:'observation',text:pick('dawn'),emotion:'happy'});
    try{
      const b=_bot.world.getBiome(_bot.entity.position);
      const bk=b&&BIOME_KEYS[b.name];
      if(bk&&cd(`biome:${b.name}`,120000))
        return _send({type:'observation',text:pick(bk),emotion:'thinking'});
    }catch(e){}
    if(_bot.food<=6&&cd('hunger',30000))
      return _send({type:'observation',text:pick('hunger'),emotion:'sad'});
    for(const p of Object.values(_bot.players)){
      if(!p.entity||p.username===_bot.username||p.username===_target) continue;
      const d=_bot.entity.position.distanceTo(p.entity.position);
      if(d<16&&cd(`player:${p.username}`,60000))
        return _send({type:'observation',text:pick('other_player',{name:p.username}),emotion:'thinking'});
    }
  }catch(e){ console.log('[Follower] scan error:',e.message); }
}

// ── Health / combat ───────────────────────────────────────────────────────────
function _onHealth(){
  const hp=_bot.health, prev=_prevHealth; _prevHealth=hp;
  const dmg=prev-hp;
  if(dmg>0){
    let key,emo;
    if(dmg>=8)      {key='hurt_big';  emo='shocked';}
    else if(dmg>=4) {key='hurt_med';  emo='angry';}
    else            {key='hurt_small';emo='sad';}
    _send({type:'observation',text:pick(key,{dmg:Math.round(dmg)}),emotion:emo});
    // Pause pathfinder so knockback physics can apply
    _pauseForKnockback();
    if(!_fighting){
      let closest=null, minD=Infinity;
      for(const e of Object.values(_bot.entities)){
        if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
        const d=_bot.entity.position.distanceTo(e.position);
        if(d<10&&d<minD){ minD=d; closest=e; }
      }
      if(closest){
        _fighting=true;
        _send({type:'observation',text:'*draws weapon* Not today!!',emotion:'angry'});
        try{ _bot.pvp.attack(closest); }catch(e){ _fighting=false; }
      }
    }
  }
  if(hp<=4&&cd('crit_hp',10000))
    _send({type:'observation',text:pick('crit_hp',{hp:Math.round(hp)}),emotion:'shocked'});
}

function _onEntityHurt(entity){
  if(!entity) return;
  const tp=_bot.players[_target]?.entity;
  if(tp&&entity===tp&&cd('player_hurt',5000)){
    _send({type:'observation',text:'*reaches out* Hey!! Are you okay??',emotion:'sad'});
    let closest=null, minD=Infinity;
    for(const e of Object.values(_bot.entities)){
      if(!e.isValid||!e.name||!HOSTILE.has(e.name)) continue;
      const d=_bot.entity.position.distanceTo(e.position);
      if(d<12&&d<minD){ minD=d; closest=e; }
    }
    if(closest&&!_fighting){ _fighting=true; try{_bot.pvp.attack(closest);}catch(e){_fighting=false;} }
  }
}

function _onEntityDead(entity){
  if(!entity?.name||!HOSTILE.has(entity.name)) return;
  _fighting=false;
  try{ _bot.pvp?.stop(); }catch(e){}
  setTimeout(()=>_follow(), 400); // resume following after kill
  if(cd(`kill:${entity.name}`,6000))
    _send({type:'observation',text:pick('kill'),emotion:'excited'});
}

function _onPickup(collector,item){
  if(!item) return;
  const isMine=collector===_bot.entity;
  const isPlayer=_bot.players[_target]?.entity===collector;
  if(!isMine&&!isPlayer) return;
  const name=item.name||'';
  if(name.includes('netherite_sword') &&cd('p:nsword',15000)) return _send({type:'observation',text:pick('pickup_sword_net'),emotion:'excited'});
  if(name.includes('diamond_sword')   &&cd('p:dsword',15000)) return _send({type:'observation',text:pick('pickup_sword_dia'),emotion:'happy'});
  if(name.includes('iron_sword')      &&cd('p:isword',15000)) return _send({type:'observation',text:pick('pickup_sword_iron'),emotion:'happy'});
  if(name.includes('_sword')          &&cd('p:sword', 15000)) return _send({type:'observation',text:pick('pickup_sword_else'),emotion:'happy'});
  if(name.includes('netherite_pickaxe')&&cd('p:npick',15000)) return _send({type:'observation',text:pick('pickup_pick_net'),emotion:'excited'});
  if(name.includes('diamond_pickaxe') &&cd('p:dpick',15000)) return _send({type:'observation',text:pick('pickup_pick_dia'),emotion:'happy'});
  if(name.includes('iron_pickaxe')    &&cd('p:ipick',15000)) return _send({type:'observation',text:pick('pickup_pick_iron'),emotion:'happy'});
  const isArmor=n=>n.includes('helmet')||n.includes('chest')||n.includes('legg')||n.includes('boot');
  if(name.includes('netherite')&&isArmor(name)&&cd('p:narmor',15000)) return _send({type:'observation',text:pick('pickup_armor_net'),emotion:'excited'});
  if(name.includes('diamond')  &&isArmor(name)&&cd('p:darmor',15000)) return _send({type:'observation',text:pick('pickup_armor_dia'),emotion:'happy'});
  if(name.includes('diamond')  &&cd('p:diamond', 12000)) return _send({type:'observation',text:pick('pickup_diamond'),  emotion:'excited'});
  if(name.includes('netherite')&&cd('p:netherite',15000)) return _send({type:'observation',text:pick('pickup_netherite'),emotion:'excited'});
  if(name.includes('totem')    &&cd('p:totem',   20000)) return _send({type:'observation',text:pick('pickup_totem'),    emotion:'excited'});
}

function _onRain(){
  if(cd('rain',100000)) _send({type:'observation',text:pick('rain'),emotion:'annoyed'});
}

module.exports={ start, stop, setTarget, setFriends };
