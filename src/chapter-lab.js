// Local-only QA surface. Exercises real gameplay ports, renders held studies,
// and reports evidence through the DOM. Never installed on a deployed host.
export function installChapterLab(api,ports){
  const panel=document.createElement('aside');panel.id='chapterLab';
  panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:150;background:#10272eee;border:1px solid #afcbb755;padding:10px;max-width:440px;color:#d4dfd3;font:10px/1.5 monospace';
  const output=document.createElement('pre');output.id='chapterLabResult';output.style.cssText='max-height:160px;overflow:auto;white-space:pre-wrap';
  let auto=false,stress=false,autoStarted=0,frameTime=0,samples=[],lastAction=0,defenseUntil=0,trace=[];
  const report=value=>{output.textContent=JSON.stringify(value,null,2);output.dataset.status=value.ok===false?'fail':'pass';};
  const hold=value=>{api.setPaused(value);document.getElementById('pauseScreen').style.display=value?'none':'';document.body.classList.remove('paused');};
  const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText='background:#d7c9a4;color:#173036;border:0;padding:7px;margin:2px;font:10px monospace';b.onclick=async()=>{try{await fn()}catch(e){report({ok:false,error:e.stack});throw e}};panel.append(b);};
  function setup(){auto=false;stress=false;hold(false);ports.restart();api.state.invuln=10000;api.input.touchActive=true;api.input.keys.clear();hold(true);}
  function spawn(type,x,z,hp=1000){
    api.spawnEnemy(type,{entry:{x,z},delay:0});const e=api.enemies.at(-1);e.actor.root.position.set(x,0,z);
    e.actor.root.visible=true;e.entered=true;e.state='circle';e.cooldown=1000;e.circleFor=1000;e.speed=0;e.t=0;e.hp=e.maxHp=hp;return e;
  }
  const clear=()=>{for(const e of [...api.enemies])api.killEnemy(e,0,-1,'bisect');};
  const study=stage=>{
    setup();api.chapter.stage=stage;api.chapter.index=stage*3;api.chapter.phase='combat';api.state.wave=stage*3+1;
    api.chapterWorld.reset(stage,true);api.chapterUI.arrive(api.chapter.stageInfo);api.player.root.position.set(0,0,2);
    [['ronin',-6,-2],['yari',6,-4],['hunter',3,7],['brute',-5,6]].forEach(([t,x,z])=>spawn(t,x,z));
    ports.advance(90);ports.settleView();report({study:api.chapter.stageInfo.name,held:true,profile:ports.stats()});
  };
  button('Play chapter',()=>{setup();api.state.invuln=0;hold(false);report({playing:true});});
  button('Outer court',()=>study(0));button('Garden',()=>study(1));button('Inner shrine',()=>study(2));
  button('Technique choice',()=>{setup();api.chapter.phase='choice';ports.choose(true);report({choice:true});});
  button('Reprisal study',()=>{study(0);api.techniques.select('reprisal');api.techniques.parry();api.techniques.hit(api.enemies[0]);ports.advance(4);report({technique:api.techniques.id,held:true});});
  button('Echo study',()=>{study(1);api.techniques.select('echo');api.techniques.dash(api.player.root.position,0);api.player.root.position.x=3;ports.advance(24);report({technique:api.techniques.id,held:true});});
  button('Thread study',()=>{study(2);api.techniques.select('thread');api.enemies.slice(0,3).forEach(e=>api.techniques.mark(e));ports.advance(3);report({technique:api.techniques.id,held:true});});
  button('Boss study',()=>{setup();api.chapter.stage=2;api.chapter.index=7;api.chapter.phase='ready';api.chapterWorld.reset(2,true);api.chapterUI.arrive(api.chapter.stageInfo);api.player.root.position.set(0,0,0);api.startWave();ports.advance(120);api.enemies[0].actor.root.position.set(0,0,-5);ports.advance(2);ports.settleView();report({boss:true,held:true});});
  function offeringStudy(){
    setup();api.chapter.stage=2;api.chapter.index=7;api.chapter.phase='ready';api.chapterWorld.reset(2,true);api.chapterUI.arrive(api.chapter.stageInfo);
    api.startWave();ports.advance(120);clear();ports.advance(200);api.player.root.position.set(0,0,-11);ports.advance(2);ports.settleView();
  }
  button('Final offering',()=>{offeringStudy();report({study:'Final offering gate',held:true});});
  button('Ending study',()=>{offeringStudy();hold(false);api.player.root.position.set(0,0,-14);ports.advance(2);ports.settleView();report({study:'Fixture victory',saved:false});});
  button('Audit chapter',async()=>{
    const checks=[],assert=(name,ok,detail)=>{checks.push({name,ok,detail});if(!ok)throw new Error(name+' '+JSON.stringify(detail));};
    setup();const storageBefore=ports.storageSnapshot();
    for(let i=0;i<9;i++){
      if(i===0)ports.advance(185);
      assert(`Encounter ${i+1} starts through the director`,api.state.wave===i+1&&api.chapter.phase==='combat');
      assert(`Encounter ${i+1} has enemies`,api.enemies.length>0);
      if(i===0){
        assert('Gate blocks the player before the watch falls',api.chapterWorld.constrain({x:0,z:-16}).z>-13.2);
        const pending=api.enemies.find(e=>!e.actor.root.visible),hp=pending.hp;
        ports.damage(pending,1000,0,1);assert('Hidden reinforcements cannot take premature damage',pending.hp===hp&&!pending.dead);
      }
      if(i===8){
        const boss=api.enemies[0];assert('Final encounter is a lone named rival',boss.rival&&boss.rivalName==='KUROGANE'&&api.enemies.length===1);
        boss.actor.root.visible=true;boss.entered=true;boss.state='windup';boss.t=.2;
        ports.damage(boss,1,0,-1);assert('Kurogane holds a committed swing through ordinary damage',boss.state==='windup'&&boss.t===.2);
        boss.fierce=false;api.state.action='parry';api.state.actionT=.06;
        ports.strike(boss,2,0,-1,3);assert('A perfect parry opens Kurogane to a full stagger',boss.state==='stagger'&&boss.stagger===1);
        api.state.action='idle';api.state.hitstop=0;api.state.slowmo=0;api.state.timeScale=1;
        api.player.root.position.set(0,0,-5);api.state.facing=Math.PI;api.state.focus=100;
        boss.actor.root.position.set(0,0,-9);boss.actor.root.visible=true;boss.entered=true;boss.state='circle';boss.speed=0;boss.cooldown=100;
        api.input.touchActive=true;api.trySignature();ports.advance(80);
        assert('Kurogane survives one signature',!boss.dead&&boss.hp<boss.maxHp,{hp:boss.hp});
        ports.damage(boss,220,0,-1);assert('Kurogane enters his second form',boss.awakened);
      }
      clear();ports.advance(200);
      if(i===8){
        assert('Boss defeat opens the offering, not an automatic win',api.chapter.phase==='offering'&&!api.state.chapterWon);
        api.player.root.position.set(0,0,-14);ports.advance(2);
        assert('Crossing the shrine finishes the chapter',api.state.chapterWon&&api.state.over&&!api.state.running);
        assert('The blade is left on the offering stone',!!api.chapterWorld.offering&&!api.player.katana.visible);
      }else if((i+1)%3===0){
        assert('Court clear opens the physical gate',api.chapter.phase==='crossing'&&api.chapterWorld.open);
        api.player.root.position.set(0,0,-14);ports.advance(1);assert('Crossing begins a transition',api.chapter.phase==='transition');
        ports.advance(45);assert('Next court restores life and changes scenery',api.chapter.stage===(i+1)/3&&api.chapterWorld.stage===api.chapter.stage&&api.state.hp===100);
        ports.advance(200);
      }else{
        assert('Reward waits for a real choice',api.state.choosingUpgrade);
        const choices=document.querySelectorAll('#upgradeChoices button');assert('Three usable choices',choices.length===3);
        choices[0].click();assert('Choice resumes the journey',!api.state.choosingUpgrade&&api.chapter.phase==='ready');
        ports.advance(100);
      }
      await new Promise(requestAnimationFrame);
    }
    assert('QA completion never writes saved progress',ports.storageSnapshot()===storageBefore);
    setup();assert('Retry returns to an intact first court',api.chapter.stage===0&&!api.chapterWorld.open&&api.chapterWorld.stats.brokenLanterns===0&&!api.state.chapterWon&&!api.techniques.id&&api.player.katana.visible&&!api.chapterWorld.offering);
    api.chapter.phase='combat';api.player.root.position.set(0,0,0);
    const a=spawn('brute',0,2),b=spawn('ronin',2,3),c=spawn('ronin',-2,3);
    api.techniques.select('reprisal');api.state.action='parry';api.state.actionT=.06;
    ports.strike(a,2,0,-1,2.5);assert('A real perfect parry stores reprisal',api.techniques.charge===1);
    api.techniques.hit(a);assert('Reprisal damages chained targets and consumes charge',api.techniques.charge===0&&a.hp<1000&&b.hp<1000,{hp:[a.hp,b.hp,c.hp]});
    api.techniques.select('echo');a.hp=1000;a.actor.root.position.set(0,0,2);api.state.action='idle';api.state.hitstop=0;api.state.slowmo=0;api.state.timeScale=1;api.player.root.position.set(0,0,0);api.techniques.dash(api.player.root.position,0);
    ports.advance(15);assert('The echo waits before cutting',a.hp===1000);
    ports.advance(35);assert('The delayed echo cuts once',a.hp===930,{hp:a.hp});ports.advance(60);assert('Echo damage never repeats',a.hp===930);
    for(let i=0;i<10;i++)api.techniques.dash(api.player.root.position,0);assert('Echo pool stays bounded',api.techniques.echoes.length===3);ports.advance(90);
    api.techniques.select('thread');api.techniques.mark(b);api.techniques.mark(c);b.hp=c.hp=1000;
    api.techniques.signature(new Set([b]));assert('Thread reaches marked enemies but skips the primary signature hit',b.hp===1000&&c.hp===805&&api.techniques.marks.length===0);
    const l=api.chapterWorld.lanterns[0];api.chapterWorld.strike({x:l.x,z:l.z+1},Math.PI,3);
    assert('Sword cuts shatter a lantern and keep debris',l.broken&&!l.lamp.visible&&api.chapterWorld.shards.length===8);
    for(const lamp of api.chapterWorld.lanterns)api.chapterWorld.strike({x:lamp.x,z:lamp.z},0,4,true);
    assert('Scenery debris remains bounded',api.chapterWorld.shards.length<=48);
    api.chapterWorld.reset(1,true);const bamboo=api.chapterWorld.bamboo[0];api.chapterWorld.strike(bamboo.g.position,0,3,true);api.chapterWorld.update(.02,api.player.root.position);
    assert('Bamboo reacts to cuts',bamboo.force>0&&Math.abs(bamboo.g.rotation.z)>0);
    setup();ports.advance(2);assert('Second retry clears every technique and prop effect',api.techniques.marks.length===0&&api.techniques.echoes.every(e=>!e.root.visible)&&api.chapterWorld.shards.length===0);
    report({ok:true,checks,profile:ports.stats()});
  });
  button('Autoplay chapter',()=>{setup();api.state.invuln=0;auto=true;autoStarted=performance.now();frameTime=autoStarted;samples=[];trace=[];hold(false);report({status:'autoplay',note:'Uses normal movement, attack, parry and signature inputs; no immunity.'});});
  button('Stop playtest',()=>{auto=false;stress=false;api.input.clear();hold(true);report(result(performance.now(),'interrupted normal-input chapter'));});
  button('Stress · 20 seconds',()=>{study(1);api.techniques.select('echo');stress=true;autoStarted=performance.now();frameTime=autoStarted;samples=[];hold(false);report({status:'stress',seconds:20});});
  button('Touch controls',()=>{ports.touch();report({touch:true});});
  button('Hide lab',()=>panel.hidden=true);button('Hold / resume',()=>hold(!api.paused));
  addEventListener('keydown',e=>{if(e.code==='Backquote')panel.hidden=!panel.hidden;});
  panel.append(output);document.body.append(panel);
  function result(now,kind){
    const sorted=samples.toSorted((a,b)=>a-b);return {ok:true,scenario:kind,seconds:(now-autoStarted)/1000,won:api.state.chapterWon,wave:api.state.wave,hp:api.state.hp,kills:api.state.kills,position:api.player.root.position.toArray(),enemies:api.enemies.map(e=>({type:e.type,state:e.state,position:e.actor.root.position.toArray()})),trace,
      frames:sorted.length,mean:sorted.reduce((a,b)=>a+b,0)/Math.max(1,sorted.length),p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],over25:sorted.filter(n=>n>25).length,profile:ports.stats()};
  }
  function loop(now){
    requestAnimationFrame(loop);if(!auto&&!stress)return;
    if(now-autoStarted>1500)samples.push(now-frameTime);frameTime=now;
    if(stress){
      if(now-autoStarted>20000){stress=false;hold(true);report(result(now,'20 second garden combat / echoes / breakable scenery'));return;}
      api.state.invuln=10000;
      if(now-lastAction>420){
        lastAction=now;while(api.enemies.length<16){const i=api.enemies.length,e=spawn(['ronin','yari','hunter','yumi','brute'][i%5],Math.sin(i*2.4)*5,Math.cos(i*2.4)*5,90);e.speed=e.spec.speed;e.cooldown=.3;e.circleFor=.5;}
        api.state.facing=now/1000;api.techniques.dash(api.player.root.position,api.state.facing);api.techniques.signature();
        ports.attack(false,'arc');api.chapterWorld.strike(api.chapterWorld.lanterns[(Math.floor(now/420)%6)].g.position,0,3,true);
      }return;
    }
    if(api.state.over||now-autoStarted>600000){auto=false;api.input.keys.clear();report(result(now,'normal-input automated chapter'));return;}
    if(api.paused)return;
    const marker=`${api.chapter.stage}:${api.chapter.index}:${api.chapter.phase}`;
    if(trace.at(-1)?.phase!==marker)trace.push({phase:marker,seconds:Math.round((now-autoStarted)/1000),hp:Math.round(api.state.hp)});
    if(api.state.choosingUpgrade){document.querySelector('#upgradeChoices button')?.click();return;}
    api.input.keys.clear();api.input.stick.active=true;api.input.stick.x=0;api.input.stick.z=0;
    const p=api.player.root.position;
    let target;
    if(['crossing','offering'].includes(api.chapter.phase))target={x:0,z:-14.4};
    else {const enemy=api.enemies.filter(e=>!e.dead&&e.actor.root.visible).sort((a,b)=>a.actor.root.position.distanceToSquared(p)-b.actor.root.position.distanceToSquared(p))[0];target=enemy?.actor.root.position;}
    if(!target)return;
    const w=api.chapterWorld.waypoint(p,target,.65),dx=w.x-p.x,dz=w.z-p.z,d=Math.hypot(dx,dz);
    const crossing=['crossing','offering'].includes(api.chapter.phase);
    const routed=Math.hypot(w.x-target.x,w.z-target.z)>.01;
    if(d>.015&&(routed||Math.hypot(target.x-p.x,target.z-p.z)>(crossing?.15:2.1))){
      const sx=(dx-dz)*Math.SQRT1_2,sz=(dx+dz)*Math.SQRT1_2;
      const speed=routed?Math.min(1,d*5):1;
      api.input.stick.x=sx/d*speed;api.input.stick.z=sz/d*speed;
    }
    const nearby=api.enemies.filter(e=>!e.dead&&e.actor.root.position.distanceToSquared(p)<45);
    const preparing=nearby.find(e=>e.state==='windup');
    const threat=nearby.find(e=>{
      const eta=e.state==='windup'?e.spec.windup*e.attackScale-e.t+.1:e.state==='strike'&&!e.resolved?.1-e.t:10;
      return eta>0&&eta<(e.fierce?.15:.23);
    });
    const arrow=api.enemies.find(e=>e.state==='aim'&&e.t/e.spec.windup>.70&&Math.abs((p.x-e.actor.root.position.x)*e.aimDir.z-(p.z-e.actor.root.position.z)*e.aimDir.x)<.7);
    if((arrow||threat?.fierce)&&api.state.dashCooldown<=0){
      api.input.buffers.attack=0;api.input.buffers.focus=0;api.input.buffers.dash=.16;defenseUntil=now+380;
      // A full lateral dash, with no premature attack cancel.
      const enemy=arrow||threat,ex=p.x-enemy.actor.root.position.x,ez=p.z-enemy.actor.root.position.z,ed=Math.hypot(ex,ez)||1;
      api.input.stick.x=(-ez-ex)*Math.SQRT1_2/ed;api.input.stick.z=(ex-ez)*Math.SQRT1_2/ed;
    }else if(threat&&!threat.fierce){api.input.buffers.attack=0;api.input.buffers.parry=.16;}
    else if(!crossing&&!preparing&&now>defenseUntil&&d<4.0){
      if(api.state.focus>=100)api.input.buffers.focus=.16;
      else if(now-lastAction>120){api.input.buffers.attack=.16;lastAction=now;}
    }

  }
  requestAnimationFrame(loop);
}
