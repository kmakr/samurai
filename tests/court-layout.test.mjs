import test from 'node:test';
import assert from 'node:assert/strict';
import { COURT,COURT_OBSTACLES,constrainToCourt,courtSpawn } from '../src/court-layout.js';
import { RAIN_KIT } from '../assets/models/rain-court-kit.js';

test('Movement, dash and signature destinations remain inside the wall clearance',()=>{
  for(const radius of [.65,1.3])for(const x of [-200,-18,0,18,200])for(const z of [-200,-16,0,16,200]){
    const position={x,y:2,z};constrainToCourt(position,radius);
    assert.ok(Math.abs(position.x)<=COURT.halfX-radius);
    assert.ok(Math.abs(position.z)<=COURT.halfZ-radius);
    assert.equal(position.y,2);
  }
});
test('Every edge and corner retains a distant, valid enemy arrival for all directions',()=>{
  for(const x of [-17.35,0,17.35])for(const z of [-15.35,0,15.35])for(let a=0;a<Math.PI*2;a+=Math.PI/24){
    const p=courtSpawn({x,z},18,a);
    assert.ok(Math.abs(p.x)<=COURT.halfX-1.25&&Math.abs(p.z)<=COURT.halfZ-1.25);
    assert.ok(Math.hypot(p.x-x,p.z-z)>=10);
    assert.deepEqual(p,courtSpawn({x,z},18,a));
  }
});
test('Blender architecture is finite, nondegenerate, and inexpensive to instance',()=>{
  assert.equal(Object.keys(RAIN_KIT).length,9);
  for(const [name,{p}] of Object.entries(RAIN_KIT)){
    assert.equal(p.length%9,0);assert.ok(p.length/9<250,name);assert.ok(p.every(Number.isFinite));
    for(let i=0;i<p.length;i+=9){
      const a=[p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]],b=[p[i+6]-p[i],p[i+7]-p[i+1],p[i+8]-p[i+2]];
      assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>0,name);
    }
  }
});
test('Lantern plinths and supplies are solid from every approach, including near a wall',()=>{
  for(const radius of [.65,1.3])for(const o of COURT_OBSTACLES)for(let x=o.x-2;x<=o.x+2;x+=.25)for(let z=o.z-2;z<=o.z+2;z+=.25){
    const p=constrainToCourt({x,z},radius);
    assert.ok(Math.abs(p.x)<=COURT.halfX-radius&&Math.abs(p.z)<=COURT.halfZ-radius);
    for(const obstacle of COURT_OBSTACLES)assert.ok(Math.abs(p.x-obstacle.x)>=obstacle.hx+radius-1e-8||Math.abs(p.z-obstacle.z)>=obstacle.hz+radius-1e-8,JSON.stringify({p,obstacle,radius}));
  }
});
