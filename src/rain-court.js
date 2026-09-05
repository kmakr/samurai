// An authored, instanced shrine district. Architecture uses the Blender kit;
// lighting accents are baked into surfaces, so lantern count never changes the
// shader's light topology. Only rain, water and foliage move at runtime.
import * as THREE from 'three';
import { RAIN_KIT } from '../assets/models/rain-court-kit.js';
import { rng } from './paper.js';
import { COURT, COURT_LANTERNS, COURT_SUPPLIES } from './court-layout.js';
import { shadeSurface } from './surface-shaders.js';

const PALETTE = {
  stone:0x697477, cap:0x929589, timber:0x403e34, wood:0x756046,
  roof:0x305155, roofEdge:0x67817a, plaster:0xb1a790, bronze:0x857354,
  moss:0x4c6340, leaf:0x52694a, pine:0x234d45, red:0x874f37,
  dark:0x172c30, paper:0xffd898,
};

export function buildRainCourt(scene, time, renderer) {
  const rnd=rng(9021), group=new THREE.Group(); group.name='Rain Court / district';scene.add(group);
  const geometries={}, materials={}, buckets=new Map(), matrix=new THREE.Matrix4();
  const position=new THREE.Vector3(), rotation=new THREE.Quaternion(), scale=new THREE.Vector3(), euler=new THREE.Euler();
  const color=new THREE.Color();
  for(const [name,data] of Object.entries(RAIN_KIT)){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(data.p.map(n=>n/10000),3));geo.computeVertexNormals();
    // Keep reusable kit UVs; architectural surface grain uses world coordinates.
    const p=geo.attributes.position;const uv=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)+.5;uv[i*2+1]=p.getZ(i)+.5}
    geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.computeBoundingSphere();geometries[name]=geo;
  }
  for(const [name,hex] of Object.entries(PALETTE)){
    const glazed=name==='roof'||name==='roofEdge';
    const Material=glazed?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial;
    materials[name]=new Material({color:hex,roughness:glazed?.34:.79,metalness:name==='bronze'?.78:0,flatShading:true});
    if(glazed){materials[name].clearcoat=.85;materials[name].clearcoatRoughness=.20;shadeSurface(materials[name],'roof')}
    if(name==='wood'||name==='timber')shadeSurface(materials[name],'wood');
    if(name==='plaster')shadeSurface(materials[name],'plaster');
  }
  materials.paper=new THREE.MeshStandardMaterial({color:0xffdf9e,emissive:0xffac43,emissiveIntensity:2.4,roughness:1});
  materials.leaf.side=materials.pine.side=THREE.DoubleSide;
  for(const name of ['leaf','pine']){
    materials[name].onBeforeCompile=shader=>{
      shader.uniforms.uCourtTime=time;
      shader.vertexShader='uniform float uCourtTime;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        transformed.x += sin(uCourtTime * 1.25 + instanceMatrix[3].x * 2.0 + instanceMatrix[3].z) * .07;`);
    };
    materials[name].customProgramCacheKey=()=> 'court-leaf-v1';
  }
  function add(geo,mat,x,y,z,sx=1,sy=1,sz=1,ry=0,rx=0,rz=0,tint=1){
    const id=geo+':'+mat;let bucket=buckets.get(id);
    if(!bucket){bucket={geo,mat,instances:[]};buckets.set(id,bucket)}
    position.set(x,y,z);euler.set(rx,ry,rz);rotation.setFromEuler(euler);scale.set(sx,sy,sz);matrix.compose(position,rotation,scale);
    bucket.instances.push({m:matrix.clone(),color:tint*(.91+rnd()*.18)});
  }
  const box=(mat,x,y,z,sx,sy,sz,ry=0)=>add(mat==='timber'||mat==='wood'?'timber':'stone',mat,x,y,z,sx,sy,sz,ry);

  // Prefilter an HDR sky once. A broad cloud opening and bright sun supply
  // directional reflection detail without adding runtime lights or an image.
  const sky=new THREE.Scene();
  const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,toneMapped:false,
    vertexShader:'varying vec3 vSky;void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 vSky;void main(){
      vec3 d=normalize(vSky),sun=normalize(vec3(-24.,38.,14.));
      float elevation=max(d.y,0.);
      vec3 sky=mix(vec3(.58,.64,.65),vec3(.19,.34,.48),pow(elevation,.45));
      float clouds=sin(d.x*11.+sin(d.z*8.)*1.5)*sin(d.z*14.+d.y*4.);
      sky=mix(sky,vec3(.80,.86,.87),smoothstep(-.15,.65,clouds)*elevation*.7);
      sky+=vec3(1.8,1.40,.92)*pow(max(dot(d,sun),0.),32.);
      sky+=vec3(8.,6.7,4.4)*smoothstep(.9975,.9996,dot(d,sun));
      sky=mix(vec3(.07,.09,.08),sky,smoothstep(-.12,.08,d.y));
      gl_FragColor=vec4(sky,1.);}`
  });
  const skyBox=new THREE.Mesh(new THREE.BoxGeometry(100,100,100),skyMaterial);sky.add(skyBox);
  const pmrem=new THREE.PMREMGenerator(renderer);const environment=pmrem.fromScene(sky,.035,.1,200);
  scene.environment=environment.texture;scene.environmentIntensity=.55;pmrem.dispose();skyBox.geometry.dispose();skyMaterial.dispose();

  materials.paving=new THREE.MeshPhysicalMaterial({color:0x4b5147,roughness:.45,metalness:0,clearcoat:.48,clearcoatRoughness:.27});
  shadeSurface(materials.paving,'paving');
  for(const name of ['stone','cap']){
    materials[name].color.multiplyScalar(.38);
    shadeSurface(materials[name],'stone');
  }
  materials.base=materials.dark.clone();
  box('base',0,-.30,0,110,.45,110);
  // Individual slabs supply the only joints; the shader adds seam-free stone
  // grain and wetness, while the fine bevels catch the light.
  for(let z=-30;z<=30;z+=1.17)for(let x=-32;x<=32;x+=1.62){
    const px=x+((Math.round(z/1.17)%2)*.81);
    add('paver','paving',px,-.103,z,1.59,.18,1.135,0,0,0,.84+rnd()*.25);
  }
  for(const x of [-17.8,17.8]){
    box('dark',x,-.018,0,.44,.05,35);
    for(let z=-17;z<=17;z+=.38)box('bronze',x,.005,z,.48,.03,.06);
  }
  for(const z of [-15.8,15.8])for(let x=-18;x<=18;x+=1.8)box('cap',x,-.02,z,1.76,.13,.50);

  function wall(cx,cz,length,angle,height=3.2){
    const tx=(x,z)=>[cx+x*Math.cos(angle)+z*Math.sin(angle),cz-x*Math.sin(angle)+z*Math.cos(angle)];
    for(let row=0;row<Math.ceil(height/.52);row++)for(let x=-length/2+.8;x<length/2;x+=1.60){
      const [px,pz]=tx(x+(row%2)*.36,0);box('stone',px,.24+row*.52,pz,1.56,.48,1.05,angle);
    }
    for(let x=-length/2;x<=length/2;x+=3.1){
      const [px,pz]=tx(x,0);box('stone',px,height*.5,pz,1.22,height+.2,1.30,angle);box('cap',px,height+.15,pz,1.50,.25,1.54,angle);
      add('finial','bronze',px,height+.45,pz,.35,.65,.35,angle);
    }
    const [px,pz]=tx(0,0);box('cap',px,height+.04,pz,length+.6,.19,1.36,angle);
    for(let i=0;i<length*15;i++){
      const u=(rnd()-.5)*length;const [x,z]=tx(u,(rnd()>.5?1:-1)*.57);const y=height-rnd()*1.9;
      add('leaf','moss',x,y,z,.30+rnd()*.55,.45,.40,rnd()*6,.3,1.1);
    }
  }
  wall(-19.5,0,37,Math.PI/2,3.4);wall(19.5,0,37,Math.PI/2,2.8);
  wall(-13,-18,13,0,3.4);wall(13,-18,13,0,3.4);
  // Foreground wall stays low enough to preserve combat silhouettes.
  wall(-12,18.1,15,0,1.1);wall(12,18.1,15,0,1.1);

  const lamps=[];
  function lamp(x,y,z,s=1){
    add('lantern','paper',x,y,z,.50*s,.85*s,.50*s);
    for(const dy of [-.43,.43])box('bronze',x,y+dy*s,z,.39*s,.09*s,.39*s);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;add('timber','bronze',x+Math.cos(a)*.235*s,y,z+Math.sin(a)*.235*s,.024*s,.8*s,.024*s)}
    lamps.push(new THREE.Vector3(x,0,z));
  }
  function stoneLantern(x,z){
    box('stone',x,.12,z,1.45,.24,1.45);box('cap',x,.45,z,1.05,.4,1.05);
    box('stone',x,1.15,z,.50,1.1,.50);box('cap',x,1.7,z,1.18,.22,1.18);
    lamp(x,2,z,.85);
    for(const a of [-1,1])for(const b of [-1,1])box('stone',x+a*.39,2,z+b*.39,.17,.65,.17);
    add('finial','cap',x,2.65,z,1.7,1.0,1.7);
  }
  function building(cx,cz,w,d,h,turn=0,shrine=false){
    const tx=(x,z)=>[cx+x*Math.cos(turn)+z*Math.sin(turn),cz-x*Math.sin(turn)+z*Math.cos(turn)];
    const b=(mat,x,y,z,sx,sy,sz)=>{const [px,pz]=tx(x,z);box(mat,px,y,pz,sx,sy,sz,turn)};
    b('stone',0,.30,0,w+.6,.65,d+.6);b('plaster',0,h*.5+.5,0,w,h,d);
    for(let x=-w/2;x<=w/2+.01;x+=w/4){
      for(const z of [-d/2-.08,d/2+.08])b(shrine?'red':'timber',x,h*.5+.5,z,.30,h+.5,.34);
    }
    for(const y of [.75,1.3,h-.1,h+.35])for(const z of [-d/2-.15,d/2+.15])b('timber',0,y,z,w+.65,.20,.27);
    // Deep recessed lattice windows and closed doors.
    for(const x of [-w*.31,w*.31]){
      b('dark',x,2.3,d/2+.05,w*.22,1.80,.14);
      for(let dx=-w*.10;dx<=w*.10;dx+=.28)b('wood',x+dx,2.3,d/2+.15,.065,1.85,.065);
      for(const y of [1.52,1.85,2.25,2.65,3.05])b('wood',x,y,d/2+.16,w*.24,.065,.09);
    }
    b('timber',0,1.75,d/2+.13,2.0,2.5,.19);
    for(let x=-.83;x<.9;x+=.18)b('wood',x,1.75,d/2+.25,.06,2.4,.07);
    for(const x of [-1.16,1.16])b(shrine?'red':'timber',x,1.95,d/2+.25,.25,3,.28);
    for(const x of [-1.65,1.65]){const [px,pz]=tx(x,d/2+.57);lamp(px,2.80,pz)}
    // Each roof tile is a real small convex ceramic piece, instanced from Blender.
    const depth=d/2+1.1;
    for(const side of [-1,1])for(let row=0;row<Math.ceil(depth/.58);row++){
      const t=(row+.5)/Math.ceil(depth/.58), z=side*t*depth;
      const lift=.18*Math.pow(t,5),y=h+2.0-t*1.75+lift;
      for(let x=-w/2-1;x<w/2+1;x+=.52){
        const [px,pz]=tx(x,z);add('tile',row%6===0?'roofEdge':'roof',px,y,pz,.50,.85,.77,turn,side*.33);
      }
    }
    for(let x=-w/2-1.1;x<w/2+1.1;x+=.49){const [px,pz]=tx(x,0);add('tile','roofEdge',px,h+2.13,pz,.48,1.3,.74,turn+Math.PI/2)}
    for(const z of [-depth,depth])b('timber',0,h+.20,z,w+2.2,.26,.25);
    for(const side of [-1,1])b('roofEdge',side*(w/2+.7),h+1.3,0,.22,1.0,.35);
    if(shrine){
      for(let i=0;i<4;i++)b('cap',0,.08+i*.13,d/2+1.30-i*.42,3.8,.17,1.0);
      const [lx,lz]=tx(-3.8,d/2+2);stoneLantern(lx,lz);const [rx,rz]=tx(3.8,d/2+2);stoneLantern(rx,rz);
    }
  }
  building(0,-22.1,12.2,7.6,4.0,0,true);
  building(-25,-9,7.4,9.5,4.2,Math.PI/2);
  building(-25,10,6.5,8.5,3.3,Math.PI/2);
  building(25.2,-10,7.2,10,4.0,-Math.PI/2);
  building(25,9.5,6.3,7.5,3.5,-Math.PI/2);
  building(-15,26,7.5,5.5,3.2,Math.PI);
  // Suggest the rest of the district beyond the courtyard.
  building(-15,-33,11,8,5.5);building(17,-32,10,9,5.7);
  for(const [x,z] of COURT_LANTERNS)stoneLantern(x,z);

  function pine(x,z,height=7){
    box('timber',x,height*.44,z,.27,height*.88,.29);
    for(let tier=0;tier<5;tier++){
      const y=height*(.48+tier*.105),r=(1-tier*.13)*2.05;
      for(let i=0;i<23;i++){
        const a=rnd()*Math.PI*2,rad=Math.sqrt(rnd())*r;
        add('leaf','pine',x+Math.cos(a)*rad,y+(rnd()-.5)*.48,z+Math.sin(a)*rad,1.1+rnd()*.8,.8,1.0,rnd()*6,(rnd()-.5)*.4);
      }
      box('timber',x+.45,y-.14,z,1.8,.11,.12,.25);
    }
  }
  for(const [x,z,h] of [[-22,-18,8],[-22,2,7.6],[-22,16,8],[22,-18,8.4],[22,2,7],[22,15,7],[-9,-29,9],[10,-29,8],[-10,22,6.5]])pine(x,z,h);
  for(const side of [-1,1])for(let i=0;i<22;i++){
    const x=side*(20.3+rnd()*2),z=-16+rnd()*34,h=3+rnd()*4;
    box('moss',x,h*.5,z,.11,h,.11);
    for(let y=1;y<h;y+=.7)box('bronze',x,y,z,.135,.04,.135);
    for(let l=0;l<9;l++)add('leaf','leaf',x+(rnd()-.5)*1.1,h*.62+rnd()*h*.32,z+(rnd()-.5)*1.1,.6,.8,.3,rnd()*6,.45);
  }
  for(let i=0;i<320;i++){
    const side=rnd()>.5?1:-1,x=side*(18.4+rnd()*1.1),z=(rnd()-.5)*35;
    add('leaf','moss',x,.07,z,.3+rnd()*.7,.2,.25+rnd()*.55,rnd()*6);
  }
  for(const [x,z] of COURT_SUPPLIES){
    for(let i=0;i<3;i++){
      add('barrel','wood',x+(i-1)*.64,.46,z,.68,.9,.68);
      for(const y of [.14,.71])box('bronze',x+(i-1)*.64,y,z,.70,.065,.70);
    }
    box('wood',x, .45,z+1.15,.85,.9,.9,.15);box('timber',x,.45,z+1.63,.10,1.1,.08,.15);
  }
  // Instanced batches keep thousands of architectural pieces inexpensive.
  const scatters=[];
  for(const bucket of buckets.values()){
    const mesh=new THREE.InstancedMesh(geometries[bucket.geo],materials[bucket.mat],bucket.instances.length);
    mesh.name='Court / '+bucket.geo+' / '+bucket.mat;
    bucket.instances.forEach((entry,i)=>{mesh.setMatrixAt(i,entry.m);color.setScalar(entry.color);mesh.setColorAt(i,color)});
    mesh.castShadow=!['paper','paving','base','moss'].includes(bucket.mat);mesh.receiveShadow=true;
    if(['paving','base'].includes(bucket.mat))mesh.layers.set(1);
    mesh.computeBoundingSphere();group.add(mesh);
    scatters.push({count:mesh.count,meshes:[mesh]});
  }
  // A single small reflection target serves every puddle. It refreshes every
  // fourth frame; smooth ripple motion stays at the display rate. Ground geometry
  // occupies layer 1 and is excluded from the mirrored camera.
  const waterGroup=new THREE.Group();group.add(waterGroup);
  const reflectionTarget=new THREE.WebGLRenderTarget(640,360,{depthBuffer:true,type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType});
  const reflectedCamera=new THREE.OrthographicCamera();reflectedCamera.layers.set(0);
  const reflectionMatrix=new THREE.Matrix4(),reflectLook=new THREE.Vector3(),reflectDir=new THREE.Vector3();
  let reflectionTick=0;
  const reflectionStats={calls:0,triangles:0};
  const waterMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
    uniforms:{tReflection:{value:reflectionTarget.texture},uReflection:{value:reflectionMatrix},uTime:time,uEye:{value:new THREE.Vector3()}},
    vertexShader:`uniform mat4 uReflection;varying vec4 vReflection;varying vec2 vUv;varying vec3 vWorld;
      void main(){vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;vReflection=uReflection*p;vUv=uv;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`uniform sampler2D tReflection;uniform float uTime;uniform vec3 uEye;varying vec4 vReflection;varying vec2 vUv;varying vec3 vWorld;
      void main(){vec2 uv=vReflection.xy/vReflection.w*.5+.5;
        vec2 wave=vec2(sin(vWorld.x*7.+uTime*1.9),cos(vWorld.z*8.+uTime*2.1));
        uv+=wave*.00045;
        vec3 c=texture2D(tReflection,uv).rgb;
        float edge=1.-smoothstep(.27,.49,length(vUv-.5));
        vec3 n=normalize(vec3(wave.x*.035,1.,wave.y*.025));
        float fresnel=.02+.98*pow(1.-max(dot(n,normalize(uEye-vWorld)),0.),5.);
        float reflectedLight=max(c.r,max(c.g,c.b));
        float opacity=clamp(.12+fresnel*2.+reflectedLight*.045,.12,.42);
        gl_FragColor=vec4(c*vec3(.84,.94,.96),edge*opacity);}`
  });
  const shape=new THREE.Shape();
  for(let i=0;i<48;i++){const a=i/48*Math.PI*2,r=.86+Math.sin(a*5)*.075+Math.cos(a*9)*.06;const x=Math.cos(a)*r,z=Math.sin(a)*r;i?shape.lineTo(x,z):shape.moveTo(x,z)}shape.closePath();
  const puddleGeo=new THREE.ShapeGeometry(shape);const puddleUV=puddleGeo.attributes.uv;
  for(let i=0;i<puddleUV.count;i++)puddleUV.setXY(i,puddleUV.getX(i)*.5+.5,puddleUV.getY(i)*.5+.5);
  puddleGeo.rotateX(-Math.PI/2);
  for(const [x,z,sx,sz] of [[-8,-5,3.5,1.2],[7,4,3,1.6],[-3,11,4,1.1],[11,-9,2.5,1],[-13,5,1.8,3],[2,-10,2.7,.9],[0,-13,5,1.7]]){
    const mesh=new THREE.Mesh(puddleGeo,waterMaterial);mesh.position.set(x,.007,z);mesh.scale.set(sx,1,sz);mesh.rotation.y=rnd()*6;mesh.renderOrder=1;waterGroup.add(mesh);
  }
  const glowGeo=new THREE.PlaneGeometry(5,5);glowGeo.rotateX(-Math.PI/2);
  const glowMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec2 vUv;void main(){float r=length(vUv-.5)*2.;float a=pow(max(0.,1.-r),3.);gl_FragColor=vec4(vec3(.95,.46,.12),a*.35);}'
  });
  const glow=new THREE.InstancedMesh(glowGeo,glowMaterial,lamps.length);
  lamps.forEach((p,i)=>{matrix.makeTranslation(p.x,.018,p.z);glow.setMatrixAt(i,matrix)});glow.renderOrder=2;group.add(glow);
  // Two permanent, shadowless lights illuminate the shrine's warm entrance.
  // Their count remains fixed through every wave and signature.
  for(const x of [-4,4]){const light=new THREE.PointLight(0xffbd68,24,14,2);light.position.set(x,3,-15.5);scene.add(light)}
  const ambience={rustle:0};
  return {group,scatters,ambience,artDirection:'rain-court',bounds:COURT,reflectionStats,
    update(center){ambience.rustle=Math.max(0,Math.abs(center.x)-12)*.055;},
    reflect(renderer,camera){
      reflectionStats.calls=0;reflectionStats.triangles=0;
      waterMaterial.uniforms.uEye.value.copy(camera.position);
      if(reflectionTick++%4!==0)return;
      reflectedCamera.left=camera.left;reflectedCamera.right=camera.right;reflectedCamera.top=camera.top;reflectedCamera.bottom=camera.bottom;
      reflectedCamera.near=camera.near;reflectedCamera.far=camera.far;reflectedCamera.zoom=camera.zoom;reflectedCamera.updateProjectionMatrix();
      reflectedCamera.position.copy(camera.position);reflectedCamera.position.y*=-1;
      camera.getWorldDirection(reflectDir);reflectLook.copy(camera.position).add(reflectDir);reflectLook.y*=-1;
      reflectedCamera.up.set(0,-1,0);reflectedCamera.lookAt(reflectLook);reflectedCamera.updateMatrixWorld();
      reflectionMatrix.multiplyMatrices(reflectedCamera.projectionMatrix,reflectedCamera.matrixWorldInverse);
      const target=renderer.getRenderTarget(),auto=renderer.shadowMap.autoUpdate;
      waterGroup.visible=false;renderer.shadowMap.autoUpdate=false;renderer.info.reset();renderer.setRenderTarget(reflectionTarget);renderer.clear();renderer.render(scene,reflectedCamera);
      reflectionStats.calls=renderer.info.render.calls;reflectionStats.triangles=renderer.info.render.triangles;
      renderer.setRenderTarget(target);renderer.shadowMap.autoUpdate=auto;waterGroup.visible=true;
    },
  };
}
