// Monochrome film emulation.
//
// The scene renders to an offscreen target, then a single fullscreen pass turns
// it into a black-and-white print: orthochromatic response, a hard tone curve,
// halation around highlights, grain, gate weave, dust and scratches.

import * as THREE from 'three';

const FILM_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uGrain;
  uniform float uFlicker;
  uniform vec2  uWeave;
  uniform float uWhite;
  uniform float uContrast;
  uniform float uLift;
  uniform float uVignette;
  uniform float uDamage;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = clamp(vUv + uWeave, 0.001, 0.999);
    vec3 c = texture2D(tDiffuse, uv).rgb;

    // Halation. Silver-halide stock blooms around bright areas; a handful of
    // taps is enough to suggest it and costs almost nothing.
    vec2 px = 2.0 / uRes;
    vec3 bl = vec3(0.0);
    bl += texture2D(tDiffuse, uv + px * vec2( 1.0,  0.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2(-1.0,  0.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2( 0.0,  1.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2( 0.0, -1.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2( 2.0,  2.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2(-2.0,  2.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2( 2.0, -2.0)).rgb;
    bl += texture2D(tDiffuse, uv + px * vec2(-2.0, -2.0)).rgb;
    bl *= 0.125;
    float bLum = dot(bl, vec3(0.30, 0.59, 0.11));
    c += bl * smoothstep(0.62, 1.0, bLum) * 0.30;

    // Orthochromatic weighting: reds sink toward black, greens go bright. This
    // is why skin and blood look so dark in period black-and-white.
    float l = dot(c, vec3(0.20, 0.72, 0.08));

    // Tone curve: crushed toe, hot shoulder.
    l = clamp((l - 0.46) * uContrast + 0.46, 0.0, 1.0);
    l = smoothstep(0.0, 1.0, l);
    l = pow(l, 0.92);
    l = l * (1.0 - uLift) + uLift;
    l *= uFlicker;

    // Grain, strongest through the midtones. Two decorrelated samples
    // averaged: same photographic texture, half the per-pixel spike — single
    // -sample noise at this amplitude reads as discrete dots on flat paper.
    float g = (hash(vUv * uRes + fract(uTime) * 431.7)
             + hash(vUv * uRes * 1.13 + fract(uTime * 1.7) * 289.3)) * 0.5 - 0.5;
    l += g * uGrain * (0.30 + 1.0 * (1.0 - abs(l * 2.0 - 1.0)));

    // Print damage, resampled on a 16fps step so it stutters like a projector.
    // Both features are deliberately hairline — at cell sizes much above a few
    // pixels they stop reading as film and start reading as broken rendering.
    float frame = floor(uTime * 16.0);
    float lane = floor(vUv.x * 620.0);
    if (hash(vec2(lane, frame)) > 0.999) {
      // Vertical scratches run only part of the frame height, faintly.
      float span = hash(vec2(lane, frame + 3.0));
      float top = hash(vec2(lane, frame + 9.0));
      float inSpan = step(top, vUv.y) * step(vUv.y, top + span * 0.7);
      l += 0.10 * uDamage * inSpan;
    }
    // Dust: a rare, soft-edged fleck — an accent a few times a second, not a
    // field of black dots. The soft falloff is what stops it reading as a
    // literal square drawn on the frame.
    vec2 dgrid = vec2(520.0, 300.0);
    vec2 dcell = floor(vUv * dgrid);
    float dust = hash(dcell + frame * 7.13);
    if (dust > 0.99991) {
      float d = length(fract(vUv * dgrid) - 0.5);
      l -= 0.22 * uDamage * smoothstep(0.45, 0.1, d);
    }

    vec2 d = vUv - 0.5;
    l *= 1.0 - uVignette * dot(d, d) * 1.7;

    l = mix(clamp(l, 0.0, 1.0), 1.0, uWhite);
    gl_FragColor = vec4(vec3(l), 1.0);
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      // The film pass renders at the same pixel size as this target. Linear
      // sampling plus subpixel gate weave softened every voxel edge. Keep the
      // resolved MSAA image intact and move it only by complete pixels.
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      samples: 4,
    });

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uGrain: { value: 0.10 },
      uFlicker: { value: 1 },
      uWeave: { value: new THREE.Vector2() },
      uWhite: { value: 0 },
      uContrast: { value: 1.42 },
      uLift: { value: 0.015 },
      uVignette: { value: 0.35 },
      uDamage: { value: 1 },
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
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    const dpr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h);
    this.target.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.uniforms.uRes.value.set(w * dpr, h * dpr);
    return { w, h };
  }

  // Projector artefacts. Weave is a slow drift with an occasional jump; flicker
  // is exposure varying frame to frame.
  updateFilm(t) {
    this.uniforms.uTime.value = t;
    const wx = Math.sin(t * 2.3) * 0.0006 + Math.sin(t * 11.7) * 0.0003;
    const wy = Math.cos(t * 1.9) * 0.0008 + Math.sin(t * 9.1) * 0.0004;
    const res = this.uniforms.uRes.value;
    this.uniforms.uWeave.value.set(
      Math.round(wx * res.x) / res.x,
      Math.round(wy * res.y) / res.y,
    );
    this.uniforms.uFlicker.value = 0.965 + Math.abs(Math.sin(t * 31.0)) * 0.05 + Math.sin(t * 7.3) * 0.012;
  }

  render(scene, camera) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}

// Academy-era framing. Kurosawa shot 1.37:1 through Seven Samurai and moved to
// scope later; the letterbox is set from index.html and just needs sizing here.
export function applyLetterbox(ratio) {
  const bars = document.querySelectorAll('.bar');
  // Cap the bars: on a tall or narrow window a strict 2.39:1 crop would leave a
  // slot too thin to play in, and the HUD lives in the bars regardless.
  const maxH = innerHeight * 0.16;
  const maxW = innerWidth * 0.16;
  const h = Math.min(maxH, Math.max(0, (innerHeight - innerWidth / ratio) / 2));
  const w = Math.min(maxW, Math.max(0, (innerWidth - innerHeight * ratio) / 2));
  bars[0].style.height = `${h}px`;
  bars[1].style.height = `${h}px`;
  bars[2].style.width = `${w}px`;
  bars[3].style.width = `${w}px`;
}
