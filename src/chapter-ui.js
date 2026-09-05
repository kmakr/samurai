import { TECHNIQUES } from './chapter.js';
import * as THREE from 'three';

export class ChapterUI {
  constructor(){
    const hud=document.getElementById('hud');
    this.root=document.createElement('section');this.root.id='chapterHUD';this.root.hidden=true;
    this.root.setAttribute('aria-label','Chapter progress');
    this.root.innerHTML='<div class="chapterRoute"><span>COURT</span><i></i><span>GARDEN</span><i></i><span>SHRINE</span></div><p class="chapterObjective"></p><small class="chapterEncounter"></small>';
    hud.append(this.root);this.objective=this.root.querySelector('p');this.encounter=this.root.querySelector('small');
    this.technique=document.createElement('div');this.technique.id='techniqueHUD';this.technique.hidden=true;hud.append(this.technique);
    this.rival=document.createElement('div');this.rival.id='chapterRival';this.rival.hidden=true;
    this.rival.innerHTML='<span>KUROGANE <small>THE IRON DEMON</small></span><div role="progressbar" aria-label="Kurogane health" aria-valuemin="0" aria-valuemax="100"><i></i></div><em></em>';hud.append(this.rival);
    this.narrative=document.createElement('div');this.narrative.id='chapterNarrative';this.narrative.setAttribute('role','status');hud.append(this.narrative);
    this.waypoint=document.createElement('div');this.waypoint.id='chapterWaypoint';this.waypoint.hidden=true;this.waypoint.innerHTML='<span>◇</span><small>SHRINE GATE</small>';hud.append(this.waypoint);
    this.gatePoint=new THREE.Vector3();
    this.curtain=document.createElement('div');this.curtain.id='chapterCurtain';this.curtain.setAttribute('aria-hidden','true');document.body.append(this.curtain);
    this.endless=document.createElement('button');this.endless.id='endlessBtn';this.endless.textContent='ENDLESS VIGIL';this.endless.type='button';
    document.getElementById('overlay').append(this.endless);
    this.messageTime=0;this.lastStatus='';
  }
  time(seconds){const n=Math.max(0,Math.round(seconds));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  showModes(show){this.endless.hidden=!show;}
  reset(){this.root.hidden=true;this.rival.hidden=true;this.technique.hidden=true;this.waypoint.hidden=true;this.messageTime=0;this.narrative.classList.remove('show');this.fade(false);}
  fade(value){this.curtain.classList.toggle('show',value);}
  say(message,seconds=5){this.narrative.textContent=message;this.messageTime=seconds;this.narrative.classList.add('show');}
  arrive(stage){
    const label=document.getElementById('districtLabel');
    label.querySelector('span').textContent=stage.subtitle;
    label.querySelector('strong').textContent=stage.name;
    label.querySelector('small').textContent='CHAPTER ONE / THE IRON DEMON';
    this.say(stage.arrival,6);
  }
  update(dt,{chapter,techniques,state,enemies,active}){
    this.root.hidden=!active||!state.running;
    this.technique.hidden=!active||!state.running||!techniques.id;
    const boss=active&&state.running?enemies.find(e=>e.rival&&!e.dead):null;
    this.rival.hidden=!boss;
    this.waypoint.hidden=!(active&&state.running&&['crossing','offering'].includes(chapter.phase));
    if(boss){
      const value=Math.max(0,boss.hp/boss.maxHp*100);
      this.rival.querySelector('i').style.transform=`scaleX(${value/100})`;
      this.rival.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(Math.round(value)));
      this.rival.querySelector('em').textContent=boss.awakened?'SECOND FORM · READ THE FOLLOW-UP':'IRON STANCE · WHITE: PARRY / RED: DASH';
    }
    if(active){
      const crossing=chapter.phase==='crossing'||chapter.phase==='offering';
      if(crossing)this.waypoint.querySelector('small').textContent=chapter.phase==='offering'?'OFFER THE BLADE':chapter.stage===0?'GARDEN GATE':'SHRINE GATE';
      const text=crossing?chapter.stageInfo.gate:chapter.stageInfo.objective;
      if(this.objective.textContent!==text)this.objective.textContent=text;
      this.root.classList.toggle('gate-open',crossing);
      this.root.querySelectorAll('.chapterRoute span').forEach((el,i)=>{el.classList.toggle('current',i===chapter.stage);el.classList.toggle('complete',i<chapter.stage);});
      const alive=enemies.filter(e=>!e.dead&&e.actor.root.visible).length;
      const incoming=enemies.filter(e=>!e.dead&&!e.actor.root.visible).length;
      const encounter=crossing?'FOLLOW THE GOLDEN MARKS TO THE NORTH GATE':`ENCOUNTER ${Math.max(1,chapter.index+1)} / 9${alive?` · ${alive} REMAINING`:''}${incoming?' · REINFORCEMENTS APPROACHING':''}`;
      if(this.encounter.textContent!==encounter)this.encounter.textContent=encounter;
      const def=TECHNIQUES.find(t=>t.id===techniques.id);
      const status=def?`${def.mark}  ${def.name} ${['','I','II','III'][techniques.rank]} / ${techniques.status}`:'';
      if(status!==this.lastStatus){this.technique.textContent=status;this.lastStatus=status;}
    }
    if(this.messageTime>0){this.messageTime-=dt;if(this.messageTime<=0)this.narrative.classList.remove('show');}
  }
  projectGate(camera,width,height){
    if(this.waypoint.hidden)return;
    this.gatePoint.set(0,1,-14).project(camera);
    const x=Math.max(55,Math.min(width-55,(this.gatePoint.x*.5+.5)*width));
    const y=Math.max(75,Math.min(height-110,(-this.gatePoint.y*.5+.5)*height));
    this.waypoint.style.transform=`translate(${Math.round(x-50)}px,${Math.round(y-35)}px)`;
  }
}
