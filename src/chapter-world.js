import * as THREE from 'three';
import { constrainToCourt } from './court-layout.js';
import { courtWaypoint, GARDEN_PLANTERS } from './chapter-navigation.js';
import { shadeSurface } from './surface-shaders.js';

// Reusable authored set dressing, a physical gate and bounded reactive props.
// All courts share the district kit; only the current court's additions draw.
export class ChapterWorld {
  constructor(scene, fx, audio, kit) {
    this.fx = fx; this.audio = audio; this.stage = 0; this.enabled = false;
    this.group = new THREE.Group(); this.group.name = 'Chapter / living courtyard'; scene.add(this.group);
    this.box = kit.geometries.timber;
    this.cylinder = new THREE.CylinderGeometry(.5,.5,1,6);
    this.leaf = kit.geometries.leaf;
    const rock = kit.geometries.stone;
    this.materials = {
      wood: new THREE.MeshStandardMaterial({color:0x473c2b,roughness:.75}),
      red: new THREE.MeshStandardMaterial({color:0x733e2b,roughness:.58}),
      stone: new THREE.MeshStandardMaterial({color:0x515a4d,roughness:.8}),
      moss: new THREE.MeshStandardMaterial({color:0x344739,roughness:1}),
      leaf: new THREE.MeshStandardMaterial({color:0x4f7356,roughness:.8}),
      bamboo: new THREE.MeshStandardMaterial({color:0x77856a,roughness:.72}),
      bronze: new THREE.MeshStandardMaterial({color:0xa08550,metalness:.65,roughness:.4}),
      paper: new THREE.MeshStandardMaterial({color:0xffe2ad,emissive:0xffb452,emissiveIntensity:1.8}),
      cloth: new THREE.MeshStandardMaterial({color:0xe1d4af,roughness:1,side:THREE.DoubleSide}),
    };
    for(const name of ['wood','red','bamboo'])shadeSurface(this.materials[name],'wood');
    shadeSurface(this.materials.stone,'stone');
    const mesh=(parent,mat,x,y,z,sx,sy,sz,geo=this.box)=>{
      const m=new THREE.Mesh(geo,this.materials[mat]);m.position.set(x,y,z);m.scale.set(sx,sy,sz);
      m.castShadow=mat!=='paper';m.receiveShadow=true;parent.add(m);return m;
    };
    this.mesh=mesh;
    this.sets=[new THREE.Group(),new THREE.Group(),new THREE.Group()];
    this.sets.forEach((g,i)=>{g.name=['Outer watch','Lantern garden','Inner shrine'][i];this.group.add(g)});
    this.obstacles=[[],GARDEN_PLANTERS,[]];
    const gatePosts=[{x:-3.6,z:-14.3,hx:.48,hz:.48},{x:3.6,z:-14.3,hx:.48,hz:.48}];
    this.colliders=this.obstacles.map(list=>[...list,...gatePosts]);
    // The garden has two planted islands and a central approach. Low edges
    // preserve silhouettes; bamboo flexes, but its planter is solid.
    for(const x of [-10,10]) {
      mesh(this.sets[1],'stone',x,.12,0,3,.24,13);
      mesh(this.sets[1],'moss',x,.26,0,2.6,.1,12.6);
      for(let i=0;i<13;i++) {
        const z=-5.6+i*.9,xx=x+Math.sin(i*7.1)*.8;
        const stone=mesh(this.sets[1],'stone',xx,.32,z,.45+(i%3)*.16,.28+(i%2)*.13,.5,rock);stone.rotation.y=i;
      }
      for(let i=0;i<120;i++) {
        const xx=x+Math.sin(i*12.3)*1.1,z=Math.cos(i*5.7)*6;
        const grass=mesh(this.sets[1],'moss',xx,.36,z,.32,.38,.32,this.leaf);grass.rotation.y=i*1.7;
      }
    }
    // Timber boards, red columns, a great crossbeam and hanging prayer papers
    // turn the last arena into a shrine precinct without hiding combat.
    for(let x=-8.8;x<9;x+=.62)mesh(this.sets[2],'wood',x,.005,0,.59,.035,19);
    for(const x of [-13,13]) {
      mesh(this.sets[2],'stone',x,.15,-11.5,1.7,.3,1.7);
      mesh(this.sets[2],'red',x,2.9,-11.5,.55,5.8,.55,this.cylinder);
      for(const z of [-8,0,8]) {
        mesh(this.sets[2],'red',x,1.6,z,.25,3.2,.25);
        mesh(this.sets[2],'cloth',x,2.2,z,1.1,1.65,.06);
        mesh(this.sets[2],'red',x,2.2,z+.04,.13,.8,.035);
      }
    }
    mesh(this.sets[2],'red',0,5.4,-11.5,27,.52,.72);
    mesh(this.sets[2],'wood',0,5.8,-11.5,28,.26,.92);
    const bellProfile=[[.12,1.15],[.38,1.08],[.55,.83],[.59,.25],[.72,.08],[.72,0],[.60,.04]].map(([x,y])=>new THREE.Vector2(x,y));
    mesh(this.sets[2],'bronze',0,3.75,-11.5,1,1,1,new THREE.LatheGeometry(bellProfile,16));
    mesh(this.sets[2],'wood',0,5.1,-11.5,.09,.7,.09);
    for(let x=-9;x<=9;x+=2.25) {
      mesh(this.sets[2],'bronze',x,4.8,-11.5,.8,.08,.12);
      const paper=mesh(this.sets[2],'cloth',x,4.45,-11.5,.20,.7,.04);paper.rotation.z=.25;
    }
    mesh(this.sets[2],'stone',0,.25,-15.1,3.8,.50,1.1,rock);
    // Meshes that never move share batches. Individual materials remain shared.
    const batchGroup=set=>{
      const buckets=new Map();
      for(const m of [...set.children]) {
        if(!m.isMesh)continue;
        m.updateMatrix();const id=m.geometry.uuid+m.material.uuid;
        if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(m);set.remove(m);
      }
      for(const objects of buckets.values()) {
        const batch=new THREE.InstancedMesh(objects[0].geometry,objects[0].material,objects.length);
        objects.forEach((m,i)=>batch.setMatrixAt(i,m.matrix));batch.castShadow=true;batch.receiveShadow=true;
        batch.computeBoundingSphere();set.add(batch);
      }
    };
    this.sets.forEach(batchGroup);
    this.gate=new THREE.Group();this.gate.position.set(0,0,-14.3);this.group.add(this.gate);
    for(const x of [-3.6,3.6]){
      mesh(this.gate,'stone',x,.18,0,.95,.36,.95);mesh(this.gate,'red',x,2.1,0,.42,4.2,.46);
    }
    mesh(this.gate,'wood',0,4.2,0,8.4,.45,.78);
    mesh(this.gate,'bronze',0,4.48,0,8.8,.14,.9);
    for(let i=0;i<18;i++){
      const tile=mesh(this.gate,'stone',-4.25+i*.5,4.55,0,.49,.8,.78,kit.geometries.tile);tile.rotation.y=Math.PI/2;
    }
    this.doors=[];
    for(const side of [-1,1]) {
      const pivot=new THREE.Group();pivot.position.x=side*3.45;this.gate.add(pivot);this.doors.push(pivot);
      for(const y of [.35,2.0,3.7])mesh(pivot,'wood',-side*1.7,y,0,3.35,.18,.20);
      for(let i=0;i<10;i++)mesh(pivot,'wood',-side*(.14+i*.34),2.0,0,.095,3.6,.14);
      mesh(pivot,'bronze',-side*3.0,1.8,.18,.14,.4,.08);
      batchGroup(pivot);
    }
    batchGroup(this.gate);
    this.marker=new THREE.Group();this.group.add(this.marker);
    for(const z of [-10.6,-11.6,-12.6]) {
      for(const side of [-1,1]){const m=mesh(this.marker,'paper',side*.24,.09,z,.12,.035,.7);m.rotation.y=side*-.7;}
    }
    this.lanterns=[];
    for(const [x,z] of [[-7,-7],[7,-7],[-13,7],[13,7],[-7,8],[7,8]]) {
      const g=new THREE.Group();g.position.set(x,0,z);this.group.add(g);
      mesh(g,'stone',0,.16,0,.7,.32,.7);mesh(g,'wood',0,.9,0,.14,1.5,.14);
      const lamp=new THREE.Group();lamp.position.y=1.8;g.add(lamp);
      mesh(lamp,'paper',0,0,0,.6,.85,.6,kit.geometries.lantern);
      mesh(lamp,'bronze',0,.5,0,.78,.38,.78,kit.geometries.finial);mesh(lamp,'bronze',0,-.46,0,.69,.08,.69);
      batchGroup(lamp);batchGroup(g);
      this.lanterns.push({g,lamp,x,z,broken:false});
    }
    this.bamboo=[];
    for(const side of [-1,1])for(const z of [-5,0,5]) {
      const g=new THREE.Group();g.position.set(side*10, .3,z);this.group.add(g);
      for(let i=0;i<3;i++) {
        const x=(i-1)*.4,h=3.6+i*.35;
        mesh(g,'bamboo',x,h/2,0,.085,h,.085,this.cylinder);
        for(let j=0;j<9;j++) {
          const a=j*2.4+i,l=mesh(g,'leaf',x+Math.sin(a)*.62,2+j*.21,Math.cos(a)*.62,.95,.85,.55,this.leaf);l.rotation.set(.3,a,j%2?-.3:.3);
        }
      }
      batchGroup(g);
      this.bamboo.push({g,force:0,dir:1});
    }
    this.shards=[];
    const shardGeo=new THREE.BoxGeometry(.16,.24,.055);
    this.debris=new THREE.InstancedMesh(shardGeo,this.materials.bronze,48);this.debris.frustumCulled=false;this.group.add(this.debris);
    this.matrix=new THREE.Matrix4();this.rotation=new THREE.Quaternion();this.euler=new THREE.Euler();
    this.scale=new THREE.Vector3(1,1,1);this.pos=new THREE.Vector3();
    this.reset(0,false);
  }
  reset(stage=0,enabled=true) {
    this.stage=stage;this.enabled=enabled;this.group.visible=enabled;
    this.open=false;this.openAmount=0;this.clock=0;this.shards.length=0;this.debris.count=0;
    this.sets.forEach((g,i)=>g.visible=i===stage);
    for(const l of this.lanterns){l.broken=false;l.lamp.visible=true;}
    for(const b of this.bamboo){b.g.visible=stage===1;b.g.rotation.set(0,0,0);b.force=0;}
    this.marker.visible=false;this.doors.forEach(d=>d.rotation.y=0);
    if(this.offering){this.group.remove(this.offering);this.offering=null;}
  }
  openGate(){this.open=true;this.marker.visible=true;this.audio.taiko(55,.4);}
  offerBlade(weapon){
    this.offering=weapon.clone(true);this.offering.visible=true;
    this.offering.position.set(-1.1,.59,-15.1);this.offering.rotation.set(0,0,-Math.PI/2);
    this.offering.traverse(o=>{if(o.userData.isFlowOutline)o.visible=false;});
    this.group.add(this.offering);this.offering.updateMatrixWorld(true);
    const bounds=new THREE.Box3(),part=new THREE.Box3(),center=new THREE.Vector3();
    this.offering.traverseVisible(o=>{if(o.isMesh){o.geometry.computeBoundingBox();part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);bounds.union(part);}});
    bounds.getCenter(center);this.offering.position.x-=center.x;this.offering.position.z+=-15.1-center.z;this.offering.position.y+=.58-bounds.min.y;
    this.marker.visible=false;
  }
  waypoint(position,target,radius=.8){return courtWaypoint(position,target,this.enabled?this.obstacles[this.stage]:[],radius);}
  constrain(p,r=.65) {
    constrainToCourt(p,r);
    if(!this.enabled)return p;
    if((!this.open||this.openAmount<.65)&&Math.abs(p.x)<3.9+r&&p.z<-13.65+r)p.z=-13.65+r;
    for(const o of this.colliders[this.stage]){
      const dx=p.x-o.x,dz=p.z-o.z,hx=o.hx+r,hz=o.hz+r;
      if(Math.abs(dx)<hx&&Math.abs(dz)<hz){if(hx-Math.abs(dx)<hz-Math.abs(dz))p.x=o.x+Math.sign(dx||1)*hx;else p.z=o.z+Math.sign(dz||1)*hz;}
    }
    return p;
  }
  strike(position,facing,reach=3.5,wide=false) {
    if(!this.enabled)return;
    const fx=Math.sin(facing),fz=Math.cos(facing);
    const hits=(x,z)=>{const dx=x-position.x,dz=z-position.z,d=Math.hypot(dx,dz);return d<reach&&(wide||(dx*fx+dz*fz)/(d||1)>-.15)};
    for(const l of this.lanterns)if(!l.broken&&hits(l.x,l.z)){
      l.broken=true;l.lamp.visible=false;this.fx.impact(l.g.position,fx,fz,.8);this.audio.hit();
      for(let i=0;i<8;i++){
        if(this.shards.length>=48)this.shards.shift();
        this.shards.push({x:l.x,y:1.8,z:l.z,vx:fx*3+Math.sin(i*2.4)*2,vy:2+(i%3),vz:fz*3+Math.cos(i*2.4)*2,age:0});
      }
    }
    if(this.stage===1)for(const b of this.bamboo)if(hits(b.g.position.x,b.g.position.z)){b.force=.55;b.dir=fx||1;this.audio.step();}
  }
  update(dt,center) {
    if(!this.enabled)return;
    this.clock+=dt;this.openAmount+=(Number(this.open)-this.openAmount)*Math.min(1,dt*2.8);
    this.doors.forEach((d,i)=>d.rotation.y=(i?1:-1)*this.openAmount*1.32);
    this.marker.position.y=.025+Math.sin(this.clock*2)*.025;
    for(const b of this.bamboo){
      const near=Math.hypot(center.x-b.g.position.x,center.z-b.g.position.z)<2.6;
      b.force=Math.max(0,b.force-dt*.45);
      b.g.rotation.z=Math.sin(this.clock*1.4+b.g.position.z)*.025+b.force*Math.cos(this.clock*12)*b.dir+(near?.10:0);
    }
    this.debris.count=this.shards.length;
    this.shards.forEach((p,i)=>{
      if(p.y>.07){p.age+=dt;p.vy-=dt*12;p.x+=p.vx*dt;p.y=Math.max(.07,p.y+p.vy*dt);p.z+=p.vz*dt;}
      this.pos.set(p.x,p.y,p.z);this.euler.set(p.age*3,p.age*2,p.age);this.rotation.setFromEuler(this.euler);
      this.matrix.compose(this.pos,this.rotation,this.scale);this.debris.setMatrixAt(i,this.matrix);
    });
    if(this.shards.length)this.debris.instanceMatrix.needsUpdate=true;
  }
  get stats(){return {stage:this.stage,brokenLanterns:this.lanterns.filter(l=>l.broken).length,sceneryDebris:this.shards.length,gateOpen:this.open};}
}
