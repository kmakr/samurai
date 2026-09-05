// Explicit localhost-only QA controls. Runs use the existing QA record isolation.
import { IAI_TIMING } from './signature-timing.js';
import { SAMURAI_SKINS, applySamuraiSkin } from './actors.js';
import { COURT, courtSpawn } from './court-layout.js';

export function installCombatLab(api, ports) {
  const panel = document.createElement('aside'); panel.id = 'combatLab';
  panel.style.cssText = 'position:fixed;left:18px;top:105px;z-index:100;background:#10110fe8;color:#eee8d6;padding:12px;max-width:310px;font:11px monospace;border:1px solid #737166';
  const heading = document.createElement('div'); heading.textContent = 'LOCAL COMBAT LAB'; heading.style.marginBottom='9px'; panel.append(heading);
  const output = document.createElement('output'); output.id = 'combatLabResult'; output.style.cssText='display:block;white-space:pre-wrap;max-height:220px;overflow:auto;margin-top:8px';
  let stressUntil = 0, stressStart = 0, lastBeat = 0, lastSignature = 0;
  let stressSamples = [], lastFrame = 0;
  const button = (label, run) => { const b=document.createElement('button'); b.textContent=label; b.style.cssText='font:11px monospace;background:#e4dece;color:#161811;border:0;padding:7px;margin:2px;cursor:pointer'; b.onclick=async()=>{try{await run()}catch(error){output.textContent='FAIL: '+error.stack;output.dataset.status='fail';throw error}};panel.append(b); };
  const report = value => {ports.updateHUD();output.textContent=JSON.stringify(value,null,2);output.dataset.status=value.ok===false?'fail':'pass';};
  const hold = value => {
    api.setPaused(value);
    document.getElementById('pauseScreen').style.display=value?'none':'';
    document.body.classList.remove('paused');
  };
  const step = count => {for(let i=0;i<count;i++)api.step(1/60)};
  function setup(weapon='katana') {
    stressUntil=0;hold(false);ports.restart();api.state.waveBreak=10000;api.state.wave=10;api.state.invuln=10000;
    api.state.focus=100;api.state.facing=0;api.state.vel.set(0,0,0);api.player.root.position.set(0,0,0);
    api.selectWeapon(weapon,{force:true,persist:false}); api.input.touchActive=true;hold(true);
    api.state.timeScale=1;api.state.hitstop=0;api.state.slowmo=0;
  }
  function spawn(type, x, z, hp) {
    api.spawnEnemy(type,{radius:2,angle:0,delay:0});
    const e=api.enemies.at(-1);e.actor.root.position.set(x,0,z);e.actor.root.visible=true;
    e.entered=true;e.state='circle';e.cooldown=1000;e.circleFor=1000;e.speed=0;e.phase=0;e.t=0;
    if(hp)e.hp=e.maxHp=hp;
    return e;
  }
  function signatureScene(frame=25) {
    setup();const roster=['ronin','hunter','yari','yumi','brute','oni'];
    roster.forEach((type,i)=>spawn(type,(i%2-.5)*1.4,2.2+i*1.5));
    spawn('hunter',9,4);api.state.facing=0;api.trySignature();step(frame);
    report({frame,time:api.state.actionT,kills:api.state.kills,strokes:api.combatFX.activeStrokes,held:true});
  }
  button('Play arena',()=>{setup();['ronin','hunter','yari','yumi','brute','oni'].forEach((t,i)=>{const e=spawn(t,Math.sin(i)*8,Math.cos(i)*8);e.cooldown=1;e.speed=e.spec.speed;e.circleFor=.7});hold(false);report({arena:'Six enemy types',controls:'WASD / click / Shift / Space / F'})});
  button('Court study',()=>{setup();api.state.focus=55;[['ronin',-7,-3],['yari',8,-5],['brute',-8,7],['yumi',11,3],['hunter',4,9],['oni',-5,-11]].forEach(([t,x,z])=>spawn(t,x,z));step(90);report({artDirection:api.world.artDirection,held:true})});
  button('Edge study',()=>{setup();api.state.focus=55;api.player.root.position.set(16,0,14);spawn('oni',12,10);spawn('yari',14,6);step(90);report({position:api.player.root.position.toArray(),held:true})});
  button('Hide lab',()=>{panel.hidden=true});
  addEventListener('keydown',e=>{if(e.code==='Backquote')panel.hidden=!panel.hidden});
  button('Iai · draw',()=>signatureScene(11));
  button('Iai · impact',()=>signatureScene(25));
  button('Iai · release',()=>signatureScene(34));
  button('Tsunami',()=>{setup('nodachi');for(let i=0;i<6;i++)spawn('brute',(i-2.5)*1.3,3,90);api.trySignature();step(27);report({kills:api.state.kills,strokes:api.combatFX.activeStrokes})});
  button('Resume',()=>{hold(false);report({playing:true})});
  button('Audit combat',async()=>{
    report({status:'running audit'});
    const checks=[];const assert=(name,ok,detail)=>{checks.push({name,ok,...(detail?{detail}: {})});if(!ok)throw new Error(name+' '+JSON.stringify(detail))};
    assert('Blender actor graph is active',api.player.root.name==='storm-court:player');
    for(const weapon of ['katana','nodachi']) {
      for(const kind of weapon==='katana'?['arc','thrust','dashcut']:['arc']) {
        const combos=kind==='arc'?(weapon==='katana'?3:2):1;
        for(let combo=0;combo<combos;combo++) {
          await new Promise(requestAnimationFrame);
          setup(weapon);const e=spawn('brute',0,2,10000);ports.attack(false,kind);api.state.comboIndex=combo;
          const damage=api.activeAttack().damage;step(85);
          assert(`${weapon} ${kind} ${combo+1} hits once`,e.hp===10000-damage,{damage:10000-e.hp});
        }
      }
    }
    setup();let e=spawn('ronin',0,2);api.state.action='parry';api.state.actionT=.06;ports.strike(e,2,0,-1,2.5);
    assert('Perfect parry grants focus and staggers',api.state.perfectParries===1&&e.stagger===1);
    setup();['ronin','hunter','yari','yumi','brute','oni'].forEach((t,i)=>spawn(t,(i%2-.5)*1.4,2+i*1.5));
    const outside=spawn('hunter',9,4);const before=api.enemies.map(e=>({e,x:e.actor.root.position.x,z:e.actor.root.position.z,t:e.t}));
    api.state.facing=0;api.trySignature();step(12);
    assert('Iai freezes all enemy clocks and positions',before.every(({e,x,z,t})=>e.t===t&&e.actor.root.position.x===x&&e.actor.root.position.z===z));
    assert('No premature signature damage',api.state.kills===0);
    assert('Draw holds player before travel',api.player.root.position.length()<.001);
    step(13);assert('Iai cuts six types, leaves off-axis enemy',api.state.kills===6&&!outside.dead,{kills:api.state.kills});
    step(140);assert('Signature ends and bodies release',api.state.action!=='iai'&&ports.pendingBodies()===0);
    setup('nodachi');for(let i=0;i<5;i++)spawn('ronin',(i-2)*1.1,3);api.trySignature();step(120);
    assert('Tsunami clears its forward fan',api.state.kills===5,{kills:api.state.kills});
    // Exceed every FX slot deliberately: the render buffer and pool must remain bounded.
    for(let i=0;i<220;i++){api.combatFX.arc(api.player.root.position,i,{combo:2,heavy:true});api.combatFX.impact(api.player.root.position,1,0,2,true)}
    api.combatFX.update(1/60);
    assert('FX pools saturate safely',api.combatFX.activeStrokes<=48&&api.combatFX.activeSparks<=192&&api.combatFX.vertices<=api.combatFX.positions.length/3);
    api.combatFX.update(2);assert('FX retire fully',api.combatFX.vertices===0);
    const geometries=api.film.renderer.info.memory.geometries;
    for(let pass=0;pass<3;pass++){setup();for(let i=0;i<10;i++)spawn('ronin',(i-5)*1.5,3);for(const enemy of [...api.enemies])api.killEnemy(enemy,1,0,'bisect');step(10);setup();step(2)}
    assert('Retry retains pooled geometry',api.film.renderer.info.memory.geometries<=geometries+2,{before:geometries,after:api.film.renderer.info.memory.geometries});
    for(const skin of SAMURAI_SKINS){applySamuraiSkin(api.player,skin.id);step(1);let meshes=0;api.player.root.traverseVisible(o=>{if(o.isMesh&&!o.userData.isFlowOutline)meshes++});assert('Legend '+skin.id+' renders',meshes>10)}
    applySamuraiSkin(api.player,api.selectedSkin);
    setup();for(const [i,type] of ['ronin','hunter','yari','yumi','brute','oni'].entries())spawn(type,i*2-5,3);
    for(const enemy of [...api.enemies])api.killEnemy(enemy,1,0,'bisect');step(4);
    let sources=0;const seen=new Set();
    for(const root of [...api.ragdolls.bodies.flatMap(b=>b.bones.map(x=>x.obj)),...api.ragdolls.debris.map(d=>d.obj)])root.traverse(o=>{if(o.isMesh&&!o.userData.isBladeGlow&&!o.userData.isFlowOutline){seen.add(o);sources++}});
    const instances=[...api.ragdolls.renderBatches.values()].reduce((n,b)=>n+b.count,0);
    assert('Each corpse part renders exactly once',instances===sources&&sources===seen.size,{instances,sources});
    assert('Corpse instances retain steel, cloth and lacquer response',[...seen].every(o=>{
      const material=api.ragdolls.renderBatches.get(o.geometry).material;
      return material.roughness===o.material.roughness&&material.metalness===o.material.metalness&&material.clearcoat===o.material.clearcoat;
    }));
    for(let tick=0;tick<600;tick++)api.ragdolls.update(1/60);
    assert('Bodies and detached weapons retire',api.ragdolls.count===0,{remaining:api.ragdolls.count});
    assert('Retired corpse batches are empty',[...api.ragdolls.renderBatches.values()].every(b=>b.count===0&&!b.visible));
    setup();step(2);
    const beforeCull=api.world.scatters.reduce((n,s)=>n+s.meshes[0].count,0);
    const capacity=api.world.scatters.reduce((n,s)=>n+s.count,0);
    assert('Authored district stays in its static instance budget',beforeCull>0&&beforeCull<=capacity&&capacity<12000,{visible:beforeCull,capacity});
    api.player.root.position.x=200;api.player.root.position.z=-200;step(2);
    assert('Player remains inside the courtyard walls',Math.abs(api.player.root.position.x)<COURT.halfX&&Math.abs(api.player.root.position.z)<COURT.halfZ);
    const entry=courtSpawn(api.player.root.position,18,0);
    assert('Edge spawns retain combat space',Math.hypot(entry.x-api.player.root.position.x,entry.z-api.player.root.position.z)>9);
    setup();step(60);
    report({ok:true,checks,profile:ports.stats()});
  });
  button('Stress · 20 seconds',()=>{
    setup();api.state.wave=20;hold(false);stressStart=performance.now();stressUntil=stressStart+20000;lastBeat=0;lastSignature=0;stressSamples=[];lastFrame=stressStart;report({status:'running',seconds:20});
  });
  panel.append(output);document.body.append(panel);
  function loop(now) {
    requestAnimationFrame(loop);
    if(!stressUntil)return;
    if(now>=stressUntil){stressUntil=0;const sorted=stressSamples.sort((a,b)=>a-b);hold(true);report({ok:true,scenario:'20s mixed combat, up to 24 enemies',samples:sorted.length,frameMean:sorted.reduce((a,b)=>a+b,0)/sorted.length,frameP95:sorted[Math.floor(sorted.length*.95)],frameP99:sorted[Math.floor(sorted.length*.99)],over25ms:sorted.filter(x=>x>25).length,profile:ports.stats()});return}
    if(now-stressStart>1500)stressSamples.push(now-lastFrame);lastFrame=now;
    api.state.invuln=10000;api.state.waveBreak=10000;api.state.pendingUpgrade=false;
    if(now-lastBeat>330){lastBeat=now;while(api.enemies.length<24){const i=api.enemies.length;const e=spawn(['ronin','hunter','yari','yumi','brute','oni'][i%6],Math.sin(i*2.4)*5,Math.cos(i*2.4)*5);e.speed=e.spec.speed;e.cooldown=.5;e.circleFor=.7}if(api.state.action!=='iai')ports.attack(false,'arc')}
    if(now-lastSignature>3600&&api.state.action!=='iai'){lastSignature=now;api.state.focus=100;api.state.action='idle';api.trySignature()}
  }
  requestAnimationFrame(loop);
}
