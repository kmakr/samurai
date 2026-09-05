// One preallocated triangle batch for lightning, steel sparks and shock rings.
// No object creation, material compilation or GPU resource allocation on contact.
import * as THREE from 'three';

export const COMBAT_FX_LIMITS = Object.freeze({ strokes: 48, sparks: 192, points: 32 });
const MAX_VERTICES = COMBAT_FX_LIMITS.strokes * 31 * 12 + COMBAT_FX_LIMITS.sparks * 3;
const TAU = Math.PI * 2;

export class CombatFX {
  constructor(scene) {
    this.strokes = Array.from({ length: COMBAT_FX_LIMITS.strokes }, () => ({
      points: new Float32Array(96), count: 0, age: 1, life: 0, width: .03, ink: false,
    }));
    this.sparks = Array.from({ length: COMBAT_FX_LIMITS.sparks }, () => ({ age: 1, life: 0 }));
    this.strokeCursor = 0; this.sparkCursor = 0;
    this.positions = new Float32Array(MAX_VERTICES * 3);
    this.colors = new Float32Array(MAX_VERTICES * 4);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 tint; varying vec4 vTint;
        void main(){ vTint=tint; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec4 vTint; void main(){ gl_FragColor=vTint;
        #include <colorspace_fragment>
      }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'pooled-combat-fx'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.vertices = 0; this.activeStrokes = 0; this.activeSparks = 0;
  }

  stroke(count, life, width, ink = false) {
    const s = this.strokes[this.strokeCursor++ % this.strokes.length];
    s.count = Math.min(count, COMBAT_FX_LIMITS.points); s.life = life; s.age = 0;
    s.width = width; s.ink = ink;
    return s;
  }

  arc(position, facing, { heavy = false, combo = 0, kind = 'arc' } = {}) {
    if (kind === 'thrust' || kind === 'dashcut') {
      this.line(position.x, .9, position.z,
        position.x + Math.sin(facing) * (heavy ? 5 : 4.1), 1.15,
        position.z + Math.cos(facing) * (heavy ? 5 : 4.1), .26, .04, .14);
      return;
    }
    const radius = heavy ? 4.1 : combo === 2 ? 3.15 : 2.65;
    const sweep = heavy ? 3.65 : 2.8;
    const mirror = combo % 2 ? -1 : 1;
    for (let lane = 0; lane < (combo === 2 || heavy ? 3 : 2); lane++) {
      const s = this.stroke(28, .22 + lane * .07 + (heavy ? .1 : 0), lane ? .023 : .065, lane === 0);
      for (let i = 0; i < s.count; i++) {
        const t = i / (s.count - 1), angle = facing + (t - .5) * sweep * mirror;
        const r = radius * (.86 + Math.sin(t * Math.PI) * .14) + lane * .12;
        const jitter = lane === 2 ? Math.sin(i * 8.3) * .14 : 0;
        s.points[i * 3] = position.x + Math.sin(angle) * (r + jitter);
        s.points[i * 3 + 1] = .75 + Math.sin(t * Math.PI) * .35 + lane * .03;
        s.points[i * 3 + 2] = position.z + Math.cos(angle) * (r + jitter);
      }
    }
    if (combo === 2) {
      const x = position.x + Math.sin(facing) * radius;
      const z = position.z + Math.cos(facing) * radius;
      this.line(x - .5, 3.5, z - .2, x, .12, z, .28, .042, .22);
    }
  }

  line(ax, ay, az, bx, by, bz, life = .3, width = .045, jag = .2, ink = false) {
    const s = this.stroke(22, life, width, ink);
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < s.count; i++) {
      const t = i / (s.count - 1);
      const jitter = Math.sin(i * 12.9898 + this.strokeCursor) * jag * Math.sin(t * Math.PI);
      s.points[i * 3] = ax + (bx - ax) * t + dz / length * jitter;
      s.points[i * 3 + 1] = ay + (by - ay) * t + jitter * .35;
      s.points[i * 3 + 2] = az + (bz - az) * t - dx / length * jitter;
    }
  }

  ring(position, radius = 2.5, life = .42, ink = false) {
    const s = this.stroke(32, life, .045, ink);
    for (let i = 0; i < s.count; i++) {
      const angle = i / (s.count - 1) * TAU;
      s.points[i * 3] = position.x + Math.sin(angle) * radius;
      s.points[i * 3 + 1] = .10;
      s.points[i * 3 + 2] = position.z + Math.cos(angle) * radius;
    }
  }

  impact(position, dx = 0, dz = 1, strength = 1, kill = false) {
    const count = Math.min(30, Math.round((kill ? 20 : 9) * strength));
    for (let i = 0; i < count; i++) {
      const p = this.sparks[this.sparkCursor++ % this.sparks.length];
      const a = i * 2.39996 + this.sparkCursor * .1;
      const speed = (2 + (i % 5) * 1.1) * strength;
      p.x = position.x; p.y = .85; p.z = position.z;
      p.vx = Math.sin(a) * speed + dx * 2; p.vz = Math.cos(a) * speed + dz * 2;
      p.vy = 1.5 + (i % 4) * .9; p.age = 0; p.life = .20 + (i % 5) * .075;
      p.size = .035 + (i % 3) * .018; p.ink = i % 3 === 0;
    }
    if (kill) {
      // A brief luminous cut remains suspended while the body breaks apart.
      const x = position.x, z = position.z;
      this.line(x - dz * .85, .7, z + dx * .85, x + dz * .85, 1.45, z - dx * .85, .38, .045, .035);
      this.ring(position, strength * 1.1, .28, true);
    }
  }

  enemy(position, facing, type, reach) {
    if (type === 'yari' || type === 'yumi') {
      const length = type === 'yumi' ? 17 : reach;
      this.line(position.x, 1.0, position.z,
        position.x + Math.sin(facing) * length, .85,
        position.z + Math.cos(facing) * length, .18, .055, .015, true);
      return;
    }
    const s = this.stroke(24, .28, type === 'brute' ? .12 : .065, true);
    for (let i = 0; i < s.count; i++) {
      const t = i / (s.count - 1), a = facing + (t - .5) * 2.6;
      s.points[i*3] = position.x + Math.sin(a) * reach * .8;
      s.points[i*3+1] = .6 + Math.sin(t * Math.PI) * .45;
      s.points[i*3+2] = position.z + Math.cos(a) * reach * .8;
    }
    if (type === 'brute' || type === 'oni') this.ring(position, reach * .65, .3, true);
  }

  charge(position, facing) {
    this.ring(position, 2.5, .48);
    this.ring(position, 2.63, .48, true);
    for (let i = -1; i <= 1; i++) {
      const a = facing + i * .15;
      this.line(position.x, .11, position.z, position.x + Math.sin(a) * 10,
        .13, position.z + Math.cos(a) * 10, .39, .018, i === 0 ? .025 : .10);
    }
  }

  iai(origin, end, facing) {
    const dx = Math.sin(facing), dz = Math.cos(facing);
    // The visible fault line matches the damage corridor's long reach.
    this.line(origin.x - dx, 1, origin.z - dz, origin.x + dx * 30, 1.05,
      origin.z + dz * 30, .62, .07, .2);
    for (let i = 0; i < 5; i++) {
      const t = i / 4, x = origin.x + (end.x - origin.x) * t, z = origin.z + (end.z - origin.z) * t;
      this.line(x - dz * 1.2, .5, z + dx * 1.2, x + dz * 1.2, 1.9, z - dx * 1.2, .45 + i * .045, .035, .06);
    }
    this.ring(end, 3.0, .45);
  }

  vertex(x, y, z, shade, alpha) {
    const v = this.vertices++, p = v * 3, c = v * 4;
    this.positions[p] = x; this.positions[p + 1] = y; this.positions[p + 2] = z;
    this.colors[c] = this.colors[c + 1] = this.colors[c + 2] = shade;
    this.colors[c + 3] = alpha;
  }

  segment(ax, ay, az, bx, by, bz, width, shade, alpha) {
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz);
    const sx = length > .001 ? dz / length * width : width;
    const sz = length > .001 ? -dx / length * width : 0;
    this.vertex(ax-sx,ay,az-sz,shade,alpha); this.vertex(ax+sx,ay,az+sz,shade,alpha); this.vertex(bx+sx,by,bz+sz,shade,alpha);
    this.vertex(ax-sx,ay,az-sz,shade,alpha); this.vertex(bx+sx,by,bz+sz,shade,alpha); this.vertex(bx-sx,by,bz-sz,shade,alpha);
  }

  update(dt) {
    this.vertices = 0; this.activeStrokes = 0; this.activeSparks = 0;
    for (const s of this.strokes) {
      s.age += dt; if (s.age >= s.life) continue;
      this.activeStrokes++;
      const k = s.age / s.life, alpha = Math.min(1, (1 - k) * 2.6);
      const count = Math.min(s.count - 1, Math.ceil(k * 7 * (s.count - 1)));
      for (let i = 0; i < count; i++) {
        const j = i * 3, p = s.points;
        const width = s.width * (.25 + .75 * Math.sin((i + .5) / (s.count - 1) * Math.PI));
        if (!s.ink) this.segment(p[j],p[j+1]-.015,p[j+2],p[j+3],p[j+4]-.015,p[j+5],width*2.6,.015,alpha*.7);
        this.segment(p[j],p[j+1],p[j+2],p[j+3],p[j+4],p[j+5],width,s.ink ? .015 : 1,alpha);
      }
    }
    for (const p of this.sparks) {
      p.age += dt; if (p.age >= p.life) continue;
      this.activeSparks++;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= dt * 9;
      if (p.y < .08) { p.y = .08; p.vy = Math.abs(p.vy) * .25; }
      const alpha = (1-p.age/p.life) ** .7, shade = p.ink ? .012 : 1;
      this.vertex(p.x-p.size,p.y,p.z,shade,alpha);
      this.vertex(p.x+p.size,p.y,p.z,shade,alpha);
      this.vertex(p.x-p.vx*.025,p.y-p.vy*.03+p.size*2,p.z-p.vz*.025,shade,alpha);
    }
    this.geometry.setDrawRange(0, this.vertices);
    this.mesh.visible = this.vertices > 0;
    if (this.vertices) {
      for (const [name, size] of [['position', 3], ['tint', 4]]) {
        const attribute = this.geometry.getAttribute(name);
        attribute.clearUpdateRanges(); attribute.addUpdateRange(0, this.vertices * size); attribute.needsUpdate = true;
      }
    }
  }

  clear() {
    for (const s of this.strokes) s.life = 0;
    for (const s of this.sparks) s.life = 0;
    this.update(0);
  }
}
