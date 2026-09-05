import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterDirector, CHAPTER_ENCOUNTERS, chapterRecord } from '../src/chapter.js';
import { TechniqueState } from '../src/technique-rules.js';
import { courtWaypoint, GARDEN_PLANTERS, segmentBlocked } from '../src/chapter-navigation.js';
import { Input } from '../src/input.js';

const center={x:0,z:0},gate={x:0,z:-14};
function clear(d){assert.equal(d.tick(.01,0,center),null);return d.tick(3,0,center);}

test('The whole chapter requires nine encounters, two crossings, and a final offering',()=>{
  const state={over:false,choosingUpgrade:false},d=new ChapterDirector(state);
  assert.equal(d.tick(4,0,center),'start');
  for(let i=0;i<9;i++){
    const plan=d.startEncounter();assert.equal(plan.wave,i+1);assert.ok(plan.enemies.length>0);
    assert.equal(d.startEncounter(),null,'a second start cannot skip an encounter');
    assert.equal(d.tick(30,1,gate),null,'living or pending enemies block progression');
    const event=clear(d);
    if(i===8){
      assert.equal(event,'offering');assert.equal(d.victory,false);
      assert.equal(d.tick(100,0,center),null,'waiting alone cannot win');
      assert.equal(d.tick(.1,0,{x:9,z:-14}),null,'the wall is not the gate');
      assert.equal(d.tick(.1,0,gate),'victory');assert.equal(state.chapterWon,true);
      assert.equal(d.tick(100,0,gate),null,'victory fires once');
    }else if((i+1)%3===0){
      assert.equal(event,'gate');assert.equal(d.tick(100,0,center),null);
      assert.equal(d.tick(.1,0,gate),'fade');assert.equal(d.tick(.7,0,gate),'enter');
      assert.equal(d.stage,(i+1)/3);assert.equal(d.tick(4,0,center),'start');
    }else{
      assert.equal(event,i===0?'technique':'upgrade');
      assert.equal(d.tick(100,0,center),null,'a reward waits for a choice');
      assert.equal(d.finishChoice(),true);assert.equal(d.finishChoice(),false);
      assert.equal(d.tick(2,0,center),'start');
    }
  }
  assert.equal(d.cleared,9);assert.equal(d.stage,2);assert.equal(d.index,8);
});

test('Retry and endless isolation clear chapter victory, gates and clocks',()=>{
  const state={},d=new ChapterDirector(state);d.stage=2;d.index=8;d.victory=true;state.chapterWon=true;
  d.reset();assert.equal(d.stage,0);assert.equal(d.index,-1);assert.equal(d.elapsed,0);assert.equal(state.chapterWon,false);
  d.disable();assert.equal(d.tick(60,0,gate),null);assert.equal(d.elapsed,0);
});

test('Encounters budget enemies, stagger reinforcements, and reserve Kurogane for the finale',()=>{
  const d=new ChapterDirector({});
  for(let i=0;i<9;i++){
    d.phase='ready';const plan=d.startEncounter({grudgeName:'KUROGANE'});
    assert.ok(plan.enemies.length<=8);assert.ok(plan.enemies.every(e=>Math.abs(e.entry.x)<18&&Math.abs(e.entry.z)<16));
    assert.equal(Boolean(plan.rivalName),i===8);
    if(i<8)assert.ok(plan.enemies.some(e=>e.delay>=9));
    else assert.equal(plan.enemies[0].grudge,true);
  }
  assert.equal(CHAPTER_ENCOUNTERS.length,9);
});

test('Reprisal stores only perfect reads, caps charge, and consumes it once',()=>{
  const t=new TechniqueState();t.parry();assert.equal(t.charge,0);
  t.select('reprisal');for(let i=0;i<8;i++)t.parry();assert.equal(t.charge,3);
  assert.equal(t.discharge(),3);assert.equal(t.discharge(),0);
  for(let i=0;i<5;i++)t.empower();assert.equal(t.rank,3);
  t.select('echo');assert.equal(t.charge,0);assert.equal(t.rank,1);
});

test('Thread marks are unique, bounded, expiring, and never double-hit a signature target',()=>{
  const t=new TechniqueState(),foes=Array.from({length:5},()=>({dead:false}));t.select('thread');
  foes.forEach(e=>t.mark(e));assert.equal(t.marks.length,3);assert.equal(t.marks[0].enemy,foes[2]);
  t.tick(4);t.mark(foes[3]);assert.equal(t.marks.length,3);assert.equal(t.marks[1].time,12);
  foes[2].dead=true;t.tick(.1);assert.equal(t.marks.length,2);
  assert.deepEqual(t.takeMarks(new Set([foes[3]])),[foes[4]]);assert.equal(t.marks.length,0);
  t.mark(foes[0]);t.tick(13);assert.equal(t.marks.length,0);
  t.reset();assert.equal(t.id,'');assert.equal(t.rank,1);
});

test('Chapter records preserve a best time and count completed journeys',()=>{
  const one=chapterRecord(null,{seconds:420,technique:'echo',kills:55,parries:8});
  const two=chapterRecord(one,{seconds:500,technique:'thread',kills:55,parries:10});
  assert.equal(two.clears,2);assert.equal(two.bestSeconds,420);assert.equal(two.last.technique,'thread');
  assert.equal(chapterRecord(two,{seconds:390}).bestSeconds,390);
});

test('Enemies can reach the player around both planted islands from every entrance',()=>{
  for(const x of [-16.8,16.8])for(const z of [-8,0,8])for(const target of [{x:0,z:0},{x:-16,z:2},{x:16,z:-2},{x:0,z:-13}]){
    const p={x,z};let steps=0;
    while(Math.hypot(p.x-target.x,p.z-target.z)>.2&&steps++<1600){
      const w=courtWaypoint(p,target,GARDEN_PLANTERS,.85),dx=w.x-p.x,dz=w.z-p.z,d=Math.hypot(dx,dz)||1;
      const next={x:p.x+dx/d*Math.min(.1,d),z:p.z+dz/d*Math.min(.1,d)};
      assert.equal(segmentBlocked(p,next,GARDEN_PLANTERS,.85),false);
      Object.assign(p,next);
    }
    assert.ok(steps<1600,`route from ${x},${z} to ${JSON.stringify(target)} stalls`);
  }
});

test('A target at a planter edge remains reachable by an opponent with larger clearance',()=>{
  const p={x:16,z:0},target={x:7.85,z:0};let steps=0;
  while(Math.hypot(p.x-target.x,p.z-target.z)>.4&&steps++<800){
    const w=courtWaypoint(p,target,GARDEN_PLANTERS,.85),dx=w.x-p.x,dz=w.z-p.z,d=Math.hypot(dx,dz)||1;
    p.x+=dx/d*Math.min(.1,d);p.z+=dz/d*Math.min(.1,d);
  }
  assert.ok(steps<800);
});

test('Pausing or losing focus clears held touch movement and queued attacks',()=>{
  const input={keys:new Set(['KeyW']),buffers:{attack:.1,parry:.1,dash:.1,focus:.1},stick:{active:true,id:4,x:1,z:-1}};
  Input.prototype.clear.call(input);
  assert.equal(input.keys.size,0);assert.ok(Object.values(input.buffers).every(v=>v===0));
  assert.deepEqual(input.stick,{active:false,id:-1,x:0,z:0});
});
