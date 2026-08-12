// The sword trail, drawn as a sumi-e brush stroke rather than a glow.
//
// A ribbon arc whose UV runs along the swing, revealed head-first and then
// allowed to dry out. The arc is calligraphic, not circular: it swells
// mid-stroke, rises as it travels, and whips thin at the end with a slight
// inward curl — the shape a loaded brush leaves, not the shape a compass
// draws. A paler echo stroke trails the main one, the doubled line of a
// brush moving faster than its own ink.

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

    // Calligraphic radius: the stroke bows outward mid-sweep and pulls in
    // through the final fifth — the wrist turning over at the end of a cut.
    const bow = 1 + 0.16 * Math.sin(t * Math.PI);
    const curl = 1 - 0.22 * Math.pow(Math.max(0, (t - 0.78) / 0.22), 1.6);
    const r = radius * bow * curl;

    // The cut rises as it travels — kesagiri runs high-to-low on the victim,
    // which from the attacker's arc is a climbing diagonal.
    const y = 0.5 + Math.sin(t * Math.PI) * 0.6 + t * 0.62;

    // Width: lands thin, swells just before the middle, then a long whip to
    // nothing. The long thin end is what makes it flowy instead of stubby.
    const swell = Math.pow(Math.sin(Math.min(1, t * 1.1) * Math.PI), 0.8);
    const whip = 1 - 0.6 * Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.3);
    const w = width * (0.1 + 0.9 * swell * whip);

    const dirX = Math.sin(a), dirZ = Math.cos(a);
    const r0 = r - w * 0.5, r1 = r + w * 0.5;
    const o = i * 6;
    pos[o] = dirX * r0; pos[o + 1] = y; pos[o + 2] = dirZ * r0;
    pos[o + 3] = dirX * r1; pos[o + 4] = y + 0.42 * swell; pos[o + 5] = dirZ * r1;
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
    const makeMat = (col) => new THREE.ShaderMaterial({
      uniforms: {
        tBrush: { value: this.tex },
        uHead: { value: 0 },
        uTail: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(col) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const geo = arcGeometry(48, radius, width, sweep);
    this.mat = makeMat(color);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    // The echo: same arc, slightly tighter and higher, paler, lagging the
    // main stroke by a tenth of the sweep.
    this.echoMat = makeMat(0x191920);
    this.echo = new THREE.Mesh(geo, this.echoMat);
    this.echo.frustumCulled = false;
    this.echo.visible = false;
    this.echo.renderOrder = 5;
    scene.add(this.echo);

    this.t = 0;
    this.duration = 0.34;
    this.active = false;
  }

  // `mirror` flips the sweep so a combo alternates shoulders.
  fire(position, yaw, { mirror = false, duration = 0.34, scale = 1 } = {}) {
    for (const m of [this.mesh, this.echo]) {
      m.position.copy(position);
      m.rotation.set(0, yaw, 0);
      m.visible = true;
    }
    this.mesh.scale.set(mirror ? -scale : scale, mirror ? scale * 0.9 : scale, scale);
    this.echo.scale.copy(this.mesh.scale).multiplyScalar(0.94);
    this.echo.scale.y *= 1.06;
    this.baseY = position.y;
    this.duration = duration;
    this.t = 0;
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const k = this.t / this.duration;
    if (k >= 1) {
      this.active = false;
      this.mesh.visible = this.echo.visible = false;
      return;
    }
    // Head races out; tail chases and catches up as the stroke dries. The
    // tail starts later and moves softer than before — the stroke lingers,
    // which is most of what "flowy" means at this timescale.
    const head = Math.min(1, Math.pow(k, 0.5) * 1.3);
    const tail = Math.max(0, Math.pow(Math.max(0, k - 0.45) / 0.55, 1.25));
    const op = 1 - Math.pow(k, 2.4);
    this.mat.uniforms.uHead.value = head;
    this.mat.uniforms.uTail.value = tail;
    this.mat.uniforms.uOpacity.value = op;
    // Echo lags a tenth behind and stays fainter.
    this.echoMat.uniforms.uHead.value = Math.max(0, head - 0.1);
    this.echoMat.uniforms.uTail.value = tail * 0.9;
    this.echoMat.uniforms.uOpacity.value = op * 0.38;
    // The drying stroke lifts off the page a little, like ink losing its grip.
    const lift = Math.pow(k, 2) * 0.3;
    this.mesh.position.y = this.baseY + lift;
    this.echo.position.y = this.baseY + lift * 1.4;
  }
}
