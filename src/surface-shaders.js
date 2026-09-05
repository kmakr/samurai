// World-space microstructure for the instanced architecture. No extra maps,
// draw calls or per-frame CPU work; derivatives perturb the lighting normal.
const SURFACE_GLSL = /* glsl */`
  varying vec3 vSurfaceP, vSurfaceN, vSurfaceLocal;
  float surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float surfaceNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),
      mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+1.),f.x),f.y);
  }
  vec2 surfaceUV(){
    vec3 n=abs(vSurfaceN);
    return n.y>max(n.x,n.z)?vSurfaceP.xz:(n.x>n.z?vSurfaceP.zy:vSurfaceP.xy);
  }
  vec3 surfaceNormal(vec3 eyePosition,vec3 n,float height){
    vec3 dx=dFdx(eyePosition),dy=dFdy(eyePosition);
    vec3 r1=cross(dy,n),r2=cross(n,dx);
    float det=dot(dx,r1);
    vec3 gradient=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);
    return normalize(abs(det)*n-gradient);
  }
`;

export function shadeSurface(material, kind) {
  material.onBeforeCompile = shader => {
    shader.vertexShader='varying vec3 vSurfaceP, vSurfaceN, vSurfaceLocal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vSurfaceLocal=position;
      vSurfaceP=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;
      // Correct the normal for nonuniform instance scaling before rotating it.
      mat3 basis=mat3(modelMatrix*instanceMatrix);
      vec3 invScale=vec3(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]));
      vSurfaceN=normalize(basis*(normal/invScale));`);
    shader.fragmentShader=SURFACE_GLSL+shader.fragmentShader;
    const stone = kind==='paving'||kind==='stone';
    let map, roughness, relief;
    if(stone){
      const scale=kind==='paving'?'.065':'.11';
      map=`vec2 surfaceCoord=surfaceUV();
        vec3 stoneTex=texture2D(map,surfaceCoord*${scale}).rgb;
        float stoneLuma=dot(stoneTex,vec3(.2126,.7152,.0722));
        float damp=surfaceNoise(surfaceCoord*.23);
        diffuseColor.rgb*=stoneTex*mix(.82,1.03,smoothstep(.2,.8,damp));`;
      roughness=kind==='paving'
        ? 'roughnessFactor=mix(.23,.67,smoothstep(.24,.76,damp));'
        : 'roughnessFactor=mix(.65,.92,damp);';
      relief='(stoneLuma*.08+surfaceNoise(surfaceCoord*22.)*.007)';
    }else if(kind==='wood'){
      map=`vec2 surfaceCoord=surfaceUV();
        float grain=sin(surfaceCoord.x*72.+surfaceNoise(surfaceCoord*vec2(3.,.42))*15.);
        float pores=surfaceNoise(surfaceCoord*vec2(23.,1.4));
        diffuseColor.rgb*=.78+pores*.3+grain*.065;`;
      roughness='roughnessFactor=.65+pores*.25;';
      relief='(grain*.004+pores*.018)';
    }else if(kind==='roof'){
      map=`vec2 surfaceCoord=surfaceUV();
        float glaze=surfaceNoise(surfaceCoord*3.5);
        float edge=1.-smoothstep(.32,.5,abs(vSurfaceLocal.x));
        diffuseColor.rgb*=mix(.72,1.04,glaze)*mix(.78,1.,edge);`;
      roughness='roughnessFactor=.24+glaze*.2;';
      relief='(surfaceNoise(surfaceCoord*28.)*.004)';
    }else{
      map=`vec2 surfaceCoord=surfaceUV();
        float plaster=surfaceNoise(surfaceCoord*2.)*.6+surfaceNoise(surfaceCoord*17.)*.4;
        float weather=(1.-smoothstep(.6,2.,vSurfaceP.y))*.26;
        diffuseColor.rgb*=.90+plaster*.14-weather;`;
      roughness='roughnessFactor=.9;';
      relief='(plaster*.018)';
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',map);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\n${roughness}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      normal=surfaceNormal(-vViewPosition,normal,${relief});`);
  };
  material.customProgramCacheKey=()=>`court-surface-${kind}-v2`;
}
