// Linear HDR rendering, depth-based contact shading and a filmic output curve.
//
// The offscreen scene receives restrained bloom, atmospheric color, grain and
// readable combat flashes in one fullscreen pass.

import * as THREE from 'three';

// Restrained full-color grade. Scene lighting carries the material detail.
const FILM_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform vec4 uCamera;
  uniform float uAO;
  uniform float uTime, uGrain, uWhite, uInvert, uContrast, uVignette, uTimeStop;
  varying vec2 vUv;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  vec3 viewPosition(vec2 uv){
    float depth=texture2D(tDepth,uv).x;
    return vec3((uv*2.-1.)*uCamera.xy,-mix(uCamera.z,uCamera.w,depth));
  }
  float contactOcclusion(){
    vec3 p=viewPosition(vUv);
    vec3 n=normalize(cross(dFdx(p),dFdy(p)));
    float occlusion=0.;
    // A stable spiral, in world units, avoids camera-distance-dependent halos.
    float angle=hash(floor(vUv*uRes*.5))*6.283185;
    for(int i=0;i<10;i++){
      float fi=float(i),r=.14+fi*.095;
      vec2 offset=vec2(cos(angle+fi*2.399963),sin(angle+fi*2.399963))*r/(uCamera.xy*2.);
      vec3 delta=viewPosition(clamp(vUv+offset,vec2(.001),vec2(.999)))-p;
      float distance=length(delta);
      float horizon=max(0.,dot(n,delta)/max(distance,.001)-.12);
      occlusion+=horizon*(1.-smoothstep(.10,1.4,distance));
    }
    return clamp(1.-occlusion*.24*uAO,.55,1.);
  }
  void main(){
    vec3 c=texture2D(tDiffuse,vUv).rgb;
    c*=contactOcclusion();
    vec2 px=2.0/uRes;vec3 bloom=vec3(0.);
    bloom+=texture2D(tDiffuse,vUv+px*vec2(2.,0.)).rgb;
    bloom+=texture2D(tDiffuse,vUv+px*vec2(-2.,0.)).rgb;
    bloom+=texture2D(tDiffuse,vUv+px*vec2(0.,2.)).rgb;
    bloom+=texture2D(tDiffuse,vUv+px*vec2(0.,-2.)).rgb;
    bloom*=.25;
    c+=max(bloom-vec3(1.),vec3(0.))*.095;
    c=max((c-.18)*uContrast+.18,vec3(0.));
    float l=clamp(dot(c,vec3(.2126,.7152,.0722)),0.,1.);
    // Cool shadow air, a restrained warm shoulder, and continuous color.
    c+=vec3(-.006,.008,.013)*(1.-l);
    c*=vec3(1.03,1.015,.97);
    c+=(hash(vUv*uRes+floor(uTime*30.))-.5)*uGrain*.25;
    vec2 d=(vUv-.5)*vec2(1.,.82);
    c*=1.-uVignette*dot(d,d)*1.4;
    float silver=dot(c,vec3(.299,.587,.114));
    vec3 stopped=vec3(.12,.26,.32)*silver+pow(vec3(silver),vec3(5.))*.28;
    c=mix(c,stopped,uTimeStop*.88);
    c=mix(c,vec3(.74,.91,1.),uInvert*.50);
    c=mix(c,vec3(1.,.98,.89),uWhite*.42);
    gl_FragColor=vec4(max(c,vec3(0.)),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FILM_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class FilmRenderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // Four-sample MSAA preserves edges while leaving headroom for PBR shading.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Three only tone-maps the final screen pass. Scene/reflection buffers stay
    // linear HDR, so bright lamps and metallic reflections retain their range.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: this.renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
      // Preserve the resolved MSAA image when grading at the same pixel size.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      samples: 4,
    });
    this.target.depthTexture = new THREE.DepthTexture(1,1,THREE.UnsignedIntType);

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      uCamera: { value: new THREE.Vector4(1,1,1,400) },
      uAO: { value: .9 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uGrain: { value: 0.10 },
      uWhite: { value: 0 },
      uInvert: { value: 0 },
      uContrast: { value: 1.42 },
      uVignette: { value: 0.35 },
      uTimeStop: { value: 0 },
    };

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: FILM_VERT,
        fragmentShader: FILM_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.frustumCulled = false;
    this.postScene.add(quad);

    this.resize();
  }

  get domElement() { return this.renderer.domElement; }

  resize() {
    // A backgrounded or collapsed tab reports zero, which would leave the
    // render target at 0x0 and break the next frame.
    const { w, h } = viewportSize();
    const dpr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h);
    this.target.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.uniforms.uRes.value.set(w * dpr, h * dpr);
    return { w, h };
  }

  // Grain follows the simulation clock, so time-stop holds it with the scene.
  updateFilm(t) {
    this.uniforms.uTime.value=t;
  }

  render(scene, camera) {
    this.uniforms.uCamera.value.set((camera.right-camera.left)/camera.zoom/2,(camera.top-camera.bottom)/camera.zoom/2,camera.near,camera.far);
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
    this.frameCalls = this.renderer.info.render.calls;
    this.frameTriangles = this.renderer.info.render.triangles;
  }
}

// The size everything renders and frames against. `clientWidth/Height` is the
// layout viewport that `position: fixed; inset: 0` elements actually span —
// unlike innerWidth/Height, which on mobile browsers can include space behind
// the URL bar after a rotation, leaving the canvas taller than what is visible
// and the bottom HUD under the chrome.
export function viewportSize() {
  const el = document.documentElement;
  return {
    w: Math.max(1, el.clientWidth || innerWidth),
    h: Math.max(1, el.clientHeight || innerHeight),
  };
}

// Academy-era framing. Kurosawa shot 1.37:1 through Seven Samurai and moved to
// scope later; the letterbox is set from index.html and just needs sizing here.
export function applyLetterbox(ratio) {
  if(!ratio){
    document.querySelectorAll('.bar').forEach(bar=>{bar.style.width='0';bar.style.height='0'});
    document.documentElement.style.setProperty('--film-bar-h','0px');
    document.documentElement.style.setProperty('--film-bar-w','0px');
    document.documentElement.classList.toggle('hud-compact',viewportSize().w<850);
    return;
  }
  const bars = document.querySelectorAll('.bar');
  const { w: vw, h: vh } = viewportSize();
  // Keep enough black frame for the HUD even when the screen is wider than the
  // film ratio. This makes the frame and HUD use the same responsive geometry.
  const maxH = vh * 0.16;
  const maxW = vw * 0.16;
  const minHudH = Math.min(72, Math.max(52, vh * 0.095));
  const naturalH = Math.max(0, (vh - vw / ratio) / 2);
  const h = Math.min(maxH, Math.max(minHudH, naturalH));
  const framedHeight = vh - h * 2;
  const w = Math.min(maxW, Math.max(0, (vw - framedHeight * ratio) / 2));
  bars[0].style.height = `${h}px`;
  bars[1].style.height = `${h}px`;
  bars[2].style.width = `${w}px`;
  bars[3].style.width = `${w}px`;
  document.documentElement.style.setProperty('--film-bar-h', `${h}px`);
  document.documentElement.style.setProperty('--film-bar-w', `${w}px`);
  document.documentElement.classList.toggle('hud-compact', vw < 620 || h < 58);
}
