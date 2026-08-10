// The sword trail, drawn as a sumi-e brush stroke rather than a glow.
//
// A ribbon arc whose UV runs along the swing, revealed head-first and then
// allowed to dry out. The dry-brush texture does the character work.

import * as THREE from 'three';
import { makeBrushTexture } from './paper.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D tBrush;
  uniform float uHead;
  uniform float uTail;
  uniform float uOpacity;
  uniform vec3  uColor;
  varying vec2 vUv;
  void main() {
    // Only the swept portion of the arc exists yet.
    if (vUv.x > uHead || vUv.x < uTail) discard;
    float a = texture2D(tBrush, vec2(vUv.x, vUv.y)).a;
    // Thin toward the tail so the stroke lifts off the page.
    float along = (vUv.x - uTail) / max(uHead - uTail, 0.001);
    a *= smoothstep(0.0, 0.25, along);
    a *= uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

function arcGeometry(segments, radius, width, sweep) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((segments + 1) * 2 * 3);
  const uv = new Float32Array((segments + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = (-0.5 + t) * sweep;
    // The cut rises as it travels, so the stroke reads as a diagonal kesagiri.
    const y = 0.55 + Math.sin(t * Math.PI) * 0.55 + t * 0.5;
    const dirX = Math.sin(a), dirZ = Math.cos(a);
    // Taper: the stroke swells just after the brush lands and thins to nothing
    // at the tip. A constant-width ribbon reads as a painted band, not a cut.
    const taper = Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI), 0.55);
    const w = width * (0.12 + 0.88 * taper);
    const r0 = radius - w * 0.5, r1 = radius + w * 0.5;
    const o = i * 6;
    pos[o] = dirX * r0; pos[o + 1] = y; pos[o + 2] = dirZ * r0;
    pos[o + 3] = dirX * r1; pos[o + 4] = y + 0.35 * taper; pos[o + 5] = dirZ * r1;
    const u = i * 4;
    uv[u] = t; uv[u + 1] = 0;
    uv[u + 2] = t; uv[u + 3] = 1;
    if (i < segments) {
      const v = i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class SlashTrail {
  constructor(scene, { radius = 2.6, width = 1.5, sweep = 2.9, color = 0x000000 } = {}) {
    this.tex = makeBrushTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tBrush: { value: this.tex },
        uHead: { value: 0 },
        uTail: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(arcGeometry(40, radius, width, sweep), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    this.t = 0;
    this.duration = 0.34;
    this.active = false;
  }

  // `mirror` flips the sweep so a combo alternates shoulders.
  fire(position, yaw, { mirror = false, duration = 0.34, scale = 1 } = {}) {
    this.mesh.position.copy(position);
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.scale.set(mirror ? -scale : scale, mirror ? scale * 0.9 : scale, scale);
    this.duration = duration;
    this.t = 0;
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const k = this.t / this.duration;
    if (k >= 1) { this.active = false; this.mesh.visible = false; return; }
    // Head races out; tail chases it and catches up as the stroke dries.
    this.mat.uniforms.uHead.value = Math.min(1, Math.pow(k, 0.55) * 1.35);
    this.mat.uniforms.uTail.value = Math.max(0, Math.pow(Math.max(0, k - 0.35) / 0.65, 1.4));
    this.mat.uniforms.uOpacity.value = 1 - Math.pow(k, 3);
  }
}
