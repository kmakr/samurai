import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_MESHES } from '../assets/models/storm-court.js';
import { IAI_TIMING, iaiProgress, isTimeStopped } from '../src/signature-timing.js';

test('Blender export covers every actor with finite, nondegenerate geometry under budget',()=>{
  assert.deepEqual(Object.keys(ACTOR_MESHES).sort(),['brute','hunter','oni','player','ronin','yari','yumi']);
  for(const [name,parts] of Object.entries(ACTOR_MESHES)){
    let triangles=0;
    for(const part of parts){
      assert.equal(part.p.length,part.c.length*9);triangles+=part.c.length;
      assert.ok(part.p.every(Number.isFinite));assert.ok(part.c.every(v=>v>=0&&v<=255));
      for(let i=0;i<part.p.length;i+=9){
        const p=part.p,ax=p[i+3]-p[i],ay=p[i+4]-p[i+1],az=p[i+5]-p[i+2];
        const bx=p[i+6]-p[i],by=p[i+7]-p[i+1],bz=p[i+8]-p[i+2];
        assert.ok(Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)>0,`${name}:${part.joint} triangle ${i/9}`);
      }
    }
    assert.ok(triangles<(name==='player'?3500:2400),name+' triangle budget');
    for(const joint of ['torso','skirt','head','armL','armR','legL','legR','katana']) assert.ok(parts.some(p=>p.joint===joint),name+':'+joint);
  }
});
test('Every cosmetic feature and both player weapons survive export',()=>{
  const parts=ACTOR_MESHES.player;
  for(const feature of ['wildHair','dualSword','warSash','ponytail','lightSleeves','kabuto','armoredShoulders','dragonCrescent','mibuHaori','mibuHeadband']) assert.ok(parts.some(p=>p.feature===feature),feature);
  assert.ok(parts.some(p=>p.joint==='nodachi'&&p.slot==='steel'));
  for(const type of ['ronin','hunter','yari','brute','oni'])assert.ok(ACTOR_MESHES[type].some(p=>p.slot==='steel'),type+' parry steel');
});
test('Iai draws, moves, cuts, releases time, then recovers on an independent clock',()=>{
  assert.equal(iaiProgress(-1),0);assert.equal(iaiProgress(IAI_TIMING.draw),0);
  assert.equal(iaiProgress(IAI_TIMING.strike),1);assert.equal(iaiProgress(3),1);
  assert.ok(IAI_TIMING.strike<IAI_TIMING.release&&IAI_TIMING.release<IAI_TIMING.finish);
  assert.equal(isTimeStopped('iai','iai',IAI_TIMING.release-.001),true);
  assert.equal(isTimeStopped('iai','iai',IAI_TIMING.release),false);
  assert.equal(isTimeStopped('iai','tsunami',.1),false);
  assert.equal(isTimeStopped('idle','iai',.1),false);
  let last=0;for(let t=0;t<1;t+=1/240){const p=iaiProgress(t);assert.ok(p>=last&&p<=1);last=p}
});
