import * as THREE from 'three';
import { TechniqueState } from './technique-rules.js';

export class Techniques extends TechniqueState {
  constructor({scene,player,getEnemies,damage,fx,audio,callout,worldStrike}) {
    super();Object.assign(this,{scene,player,getEnemies,damage,fx,audio,callout,worldStrike});
    this.echoes=[];this.echoCursor=0;
    this.markGeo=new THREE.RingGeometry(.53,.59,28);this.markGeo.rotateX(-Math.PI/2);
    this.markMaterial=new THREE.MeshBasicMaterial({color:0xe9cb83,transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide});
    this.markMeshes=Array.from({length:3},()=>{const m=new THREE.Mesh(this.markGeo,this.markMaterial);m.visible=false;scene.add(m);return m;});
  }
  reset(){super.reset();for(const e of this.echoes||[]){e.life=0;e.root.visible=false;}for(const m of this.markMeshes||[])m.visible=false;}
  select(id){
    if(!super.select(id))return false;
    if(id==='echo'&&!this.echoes.length)this.makeEchoes();
    return true;
  }
  makeEchoes(){
    for(let i=0;i<3;i++) {
      const root=this.player.root.clone(true);
      const material=new THREE.MeshBasicMaterial({color:0x9be3e1,transparent:true,opacity:.3,depthWrite:false});
      const sources=[],targets=[];
      this.player.root.traverse(o=>sources.push(o));root.traverse(o=>targets.push(o));
      root.traverse(o=>{if(o.isMesh){o.material=material;o.castShadow=false;o.receiveShadow=false;if(o.userData.isFlowOutline||o.userData.isBladeGlow)o.visible=false;}});
      root.visible=false;root.name='Hollow Step / echo';this.scene.add(root);
      this.echoes.push({root,material,sources,targets,life:0,fired:false,facing:0});
    }
  }
  parry(){super.parry();if(this.id==='reprisal'){this.fx.ring(this.player.root.position,1.1,.35);this.callout('STORM HELD','YOUR NEXT CUT RETURNS THE LIGHTNING');}}
  hit(enemy){
    if(this.id==='thread'){this.mark(enemy);return;}
    if(this.id!=='reprisal'||!this.charge)return;
    const charges=this.discharge();let origin=this.player.root.position;
    const remaining=this.getEnemies().filter(e=>!e.dead&&e.actor.root.visible);
    let hits=0;
    while(remaining.length&&hits<1+this.rank){
      remaining.sort((a,b)=>a.actor.root.position.distanceToSquared(origin)-b.actor.root.position.distanceToSquared(origin));
      const target=remaining.shift(),p=target.actor.root.position;
      if(p.distanceToSquared(origin)>81)break;
      this.fx.line(origin.x,1.15,origin.z,p.x,1.3,p.z,.42,.085,.5);
      const dx=p.x-origin.x,dz=p.z-origin.z,d=Math.hypot(dx,dz)||1;
      origin=p.clone();this.damage(target,50+this.rank*20+charges*15,dx/d,dz/d,'limb');hits++;
    }
    this.audio.perfectParry(1);this.callout('REPRISAL',`${hits} LIGHTNING ${hits===1?'STRIKE':'STRIKES'}`);
  }
  dash(position,facing){
    if(this.id!=='echo')return;
    const echo=this.echoes[this.echoCursor++%this.echoes.length];
    echo.sources.forEach((s,i)=>{const t=echo.targets[i];t.position.copy(s.position);t.quaternion.copy(s.quaternion);t.scale.copy(s.scale);t.visible=s.visible&&!s.userData.isFlowOutline&&!s.userData.isBladeGlow;});
    echo.root.position.copy(position);echo.root.rotation.y=facing;echo.root.visible=true;
    echo.life=.95;echo.fired=false;echo.facing=facing;
    this.fx.ring(position,1.0,.55);
  }
  signature(exclude=new Set()) {
    if(this.id!=='thread')return;
    const targets=this.takeMarks(exclude);let origin=this.player.root.position;
    for(const target of targets){
      const p=target.actor.root.position,dx=p.x-origin.x,dz=p.z-origin.z,d=Math.hypot(dx,dz)||1;
      this.fx.line(origin.x,1.0,origin.z,p.x,1.2,p.z,.65,.095,.2);
      this.fx.ring(p,1.7,.5);origin=p.clone();
      this.damage(target,150+this.rank*45,dx/d,dz/d,'bisect');
    }
    if(targets.length)this.callout('THREAD SEVERED',`${targets.length} MARKED ${targets.length===1?'FOE':'FOES'}`);
  }
  update(dt){
    super.tick(dt);
    this.markMeshes.forEach((m,i)=>{const mark=this.marks[i];m.visible=!!mark;if(mark){m.position.copy(mark.enemy.actor.root.position);m.position.y=.09;m.rotation.y+=dt;}});
    for(const e of this.echoes){
      if(e.life<=0)continue;e.life-=dt;e.material.opacity=Math.min(.42,Math.max(0,e.life)*.7);
      if(!e.fired&&e.life<=.4){
        e.fired=true;const p=e.root.position,reach=3.4+this.rank*.5,fx=Math.sin(e.facing),fz=Math.cos(e.facing);
        this.fx.arc(p,e.facing,{combo:2,heavy:true});this.audio.swing(1);this.worldStrike(p,e.facing,reach,true);
        for(const enemy of [...this.getEnemies()]){
          if(enemy.dead||!enemy.actor.root.visible)continue;
          const ep=enemy.actor.root.position,dx=ep.x-p.x,dz=ep.z-p.z,d=Math.hypot(dx,dz)||1;
          if(d<reach&&(dx*fx+dz*fz)/d>-.6)this.damage(enemy,48+this.rank*22,dx/d,dz/d,'limb');
        }
      }
      if(e.life<=0)e.root.visible=false;
    }
  }
  get status(){return this.id==='reprisal'?(this.charge?`LIGHTNING HELD ×${this.charge} · CUT TO RELEASE`:'PARRY TO STORE LIGHTNING'):this.id==='echo'?'DASH → ECHO CUT':this.id==='thread'?`${this.marks.length}/3 MARKED · SIGNATURE TO EXECUTE`:'';}
}
