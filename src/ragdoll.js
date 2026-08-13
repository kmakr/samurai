// Ragdolls and dismemberment.
//
// A slain enemy stops being an animated actor and becomes nine Verlet particles
// joined by distance constraints. The existing limb meshes are then re-parented
// to the scene and posed from those particles each frame — no physics engine,
// and the body keeps whatever pose it died in.
//
// Severed parts leave the constraint network entirely and tumble as independent
// rigid bodies. Both kinds of debris bleed onto the paper as they go.

import * as THREE from 'three';

const GRAVITY = -26;
const SUBSTEP = 1 / 120;
const ITERATIONS = 7;
const GROUND = 0.0;
const MAX_DEBRIS = 60;
const MAX_SPEED = 12;   // units/second, per particle

const _v = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _pelvis = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

function particle(pos, radius = 0.14) {
  return {
    pos: pos.clone(),
    prev: pos.clone(),
    radius,
    pinned: false,
  };
}

// Point a mesh whose local -Y runs down the limb along `from -> to`.
function aimDown(obj, from, to) {
  obj.position.copy(from);
  _v.subVectors(to, from);
  if (_v.lengthSq() < 1e-8) return;
  _v.normalize();
  obj.quaternion.setFromUnitVectors(DOWN, _v);
}

export class RagdollSystem {
  constructor(scene, ink, arenaHalf) {
    this.scene = scene;
    this.ink = ink;
    this.arenaHalf = arenaHalf;
    this.bodies = [];
    this.debris = [];
    this.accum = 0;
  }

  get count() { return this.bodies.length + this.debris.length; }

  // ------------------------------------------------------------------ spawn

  // `cut` is the world-space direction of the killing blow; `severity` decides
  // how much comes apart.
  spawn(actor, spec, cut, severity = 'limb') {
    const scene = this.scene;
    const s = spec.height;
    // The pose is sampled from world matrices, which may be a frame stale.
    actor.root.updateMatrixWorld(true);

    // Sample the pose as it stands, so the ragdoll inherits the death frame.
    const world = (obj, lx, ly, lz) => obj.localToWorld(_v.set(lx, ly, lz)).clone();

    const head = world(actor.head, 0, 0.05, 0);
    const chestL = world(actor.hips, -0.42, 0.52, 0);
    const chestR = world(actor.hips, 0.42, 0.52, 0);
    const pelvisL = world(actor.hips, -0.20, -0.62, 0);
    const pelvisR = world(actor.hips, 0.20, -0.62, 0);
    const handL = world(actor.armL, 0, -0.60, 0);
    const handR = world(actor.armR, 0, -0.60, 0);
    const footL = world(actor.legL, 0, -0.70, 0);
    const footR = world(actor.legR, 0, -0.70, 0);

    const P = {
      head: particle(head, 0.20 * s),
      chestL: particle(chestL, 0.16 * s),
      chestR: particle(chestR, 0.16 * s),
      pelvisL: particle(pelvisL, 0.16 * s),
      pelvisR: particle(pelvisR, 0.16 * s),
      handL: particle(handL, 0.11 * s),
      handR: particle(handR, 0.11 * s),
      footL: particle(footL, 0.12 * s),
      footR: particle(footR, 0.12 * s),
    };

    const link = (a, b, stiff = 1) => ({
      a: P[a], b: P[b], len: P[a].pos.distanceTo(P[b].pos), stiff,
    });

    const constraints = [
      link('chestL', 'chestR'),
      link('pelvisL', 'pelvisR'),
      link('chestL', 'pelvisL'),
      link('chestR', 'pelvisR'),
      // Cross-braces give the torso volume instead of letting it fold flat.
      link('chestL', 'pelvisR', 0.7),
      link('chestR', 'pelvisL', 0.7),
      link('head', 'chestL', 0.9),
      link('head', 'chestR', 0.9),
      link('head', 'pelvisL', 0.35),
      link('head', 'pelvisR', 0.35),
      link('chestL', 'handL', 0.55),
      link('chestR', 'handR', 0.55),
      link('pelvisL', 'footL', 0.75),
      link('pelvisR', 'footR', 0.75),
    ];

    // The blow throws the body. Kept modest on purpose: a sword cut should
    // drop a man and shove him, not launch him.
    const push = severity === 'bisect' ? 3.8 : 2.6;
    const lift = severity === 'bisect' ? 1.8 : 1.2;
    for (const k in P) {
      const p = P[k];
      const height = (p.pos.y / (2 * s));
      _v.set(cut.x, 0, cut.z).multiplyScalar(push * (0.5 + height));
      _v.y = lift * (0.35 + height * 0.9);
      // Verlet stores velocity implicitly as the gap between pos and prev.
      p.prev.copy(p.pos).addScaledVector(_v, -SUBSTEP);
    }

    const body = {
      P, constraints,
      bones: [],
      wounds: [],
      age: 0,
      settleAt: 0,
      spec,
    };

    // Re-parent the limb meshes; `attach` keeps their current world transform.
    const take = (obj) => { if (obj && obj.parent) scene.attach(obj); return obj; };

    const bone = (obj, kind, ...keys) => {
      if (!obj) return;
      take(obj);
      body.bones.push({ obj, kind, keys });
    };

    const severed = this.chooseSevered(severity, spec);

    if (!severed.has('head')) bone(actor.head, 'head', 'head', 'chestL', 'chestR');
    bone(actor.torso, 'torso', 'chestL', 'chestR', 'pelvisL', 'pelvisR');
    bone(actor.shoulders, 'chest', 'chestL', 'chestR', 'pelvisL', 'pelvisR');
    if (!severed.has('legs')) bone(actor.skirt, 'pelvis', 'chestL', 'chestR', 'pelvisL', 'pelvisR');
    if (!severed.has('armL')) bone(actor.armL, 'limb', 'chestL', 'handL');
    if (!severed.has('armR')) bone(actor.armR, 'limb', 'chestR', 'handR');
    if (!severed.has('legs')) {
      bone(actor.legL, 'limb', 'pelvisL', 'footL');
      bone(actor.legR, 'limb', 'pelvisR', 'footR');
    }

    // Everything severed becomes its own tumbling body.
    for (const name of severed) {
      if (name === 'legs') {
        this.addDebris(actor.skirt, cut, 1.0);
        this.addDebris(actor.legL, cut, 1.1);
        this.addDebris(actor.legR, cut, 1.1);
        body.wounds.push('pelvisL', 'pelvisR');
      } else if (name === 'head') {
        this.addDebris(actor.head, cut, 1.5);
        body.wounds.push('chestL');
      } else if (name === 'armL') {
        this.addDebris(actor.armL, cut, 1.3);
        body.wounds.push('chestL');
      } else if (name === 'armR') {
        this.addDebris(actor.armR, cut, 1.3);
        body.wounds.push('chestR');
      }
    }

    // The sword always leaves the hand.
    if (actor.katana) this.addDebris(actor.katana, cut, 0.9, true);

    // Even a clean kill opens the torso along the cut — every death bleeds
    // from the body itself.
    if (!body.wounds.length) {
      body.wounds.push(cut.x > 0 ? 'chestR' : 'chestL');
    }

    // Wounds gush. The jet samples the particle every emission, so the spray
    // follows the body as it falls instead of hanging where the hit landed.
    for (const key of body.wounds) {
      const particle = P[key];
      this.ink.addJet(() => particle.pos, cut.x, cut.z, {
        duration: 0.8 + Math.random() * 0.5,
        rate: 26,
        force: 1.3,
      });
    }
    // The instant of the cut still gets its burst.
    if (severed.size) {
      const at = severed.has('legs') ? P.pelvisL.pos : P.chestL.pos;
      this.ink.spray(at.x, at.y, at.z, 10 + severed.size * 6, {
        dirX: cut.x, dirZ: cut.z, force: 1.6,
      });
    }
    // Decapitation gets its own fountain: straight up from the neck, the
    // single most legible kill signal the game has.
    if (severed.has('head')) {
      const n = P.head.pos;
      this.ink.spray(n.x, n.y - 0.1, n.z, 14, { force: 0.55, up: 2.2 });
    }

    // Anything still parented to the actor (the empty root, stray bits) goes.
    if (actor.root.parent) actor.root.parent.remove(actor.root);

    this.bodies.push(body);
    return body;
  }

  chooseSevered(severity, spec) {
    const out = new Set();
    if (severity === 'none') return out;

    // A killing cut takes the head — that is the read of the kill. Big
    // enemies resist: they lose an arm more often than the head, and only
    // come fully apart under the heavy blow.
    const tough = spec.height >= 1.3;
    if (severity === 'bisect') {
      out.add('legs');
      if (Math.random() < 0.6) out.add('head');
      else if (Math.random() < 0.5) out.add(Math.random() < 0.5 ? 'armL' : 'armR');
      return out;
    }
    const roll = Math.random();
    if (tough) {
      if (roll < 0.4) out.add('head');
      else if (roll < 0.75) out.add(Math.random() < 0.5 ? 'armL' : 'armR');
    } else if (roll < 0.78) {
      out.add('head');
    } else {
      out.add(roll < 0.89 ? 'armR' : 'armL');
    }
    return out;
  }

  addDebris(obj, cut, force = 1, isProp = false) {
    if (!obj) return;
    // Retire the oldest rather than letting a long fight accumulate limbs.
    while (this.debris.length >= MAX_DEBRIS) {
      this.dispose(this.debris.shift().obj);
    }
    if (obj.parent) this.scene.attach(obj);
    obj.getWorldPosition(_v);
    this.debris.push({
      obj,
      vel: new THREE.Vector3(
        cut.x * 2.6 * force + (Math.random() - 0.5) * 1.8,
        2.0 * force + Math.random() * 1.4,
        cut.z * 2.6 * force + (Math.random() - 0.5) * 1.8,
      ),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 11,
        (Math.random() - 0.5) * 11,
        (Math.random() - 0.5) * 11,
      ),
      rest: 0,
      age: 0,
      // A limb bleeds; a dropped sword does not.
      bleed: isProp ? 0 : 0.045,
      bleedT: 0,
      y0: Math.max(0.06, _v.y * 0.02 + 0.09),
    });
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    // Fixed substeps: Verlet integration is only stable at a constant timestep,
    // and frame times here swing with hitstop.
    this.accum = Math.min(this.accum + dt, 0.1);
    while (this.accum >= SUBSTEP) {
      this.simulate(SUBSTEP);
      this.accum -= SUBSTEP;
    }
    this.pose();
    this.updateDebris(dt);
    this.retire(dt);
  }

  simulate(h) {
    const lim = this.arenaHalf + 3;
    const g = GRAVITY * h * h;

    for (const body of this.bodies) {
      const P = body.P;

      for (const k in P) {
        const p = P[k];
        if (p.pinned) continue;
        const vx = (p.pos.x - p.prev.x) * 0.995;
        const vy = (p.pos.y - p.prev.y) * 0.995;
        const vz = (p.pos.z - p.prev.z) * 0.995;
        p.prev.copy(p.pos);
        p.pos.x += vx;
        p.pos.y += vy + g;
        p.pos.z += vz;
      }

      // Safety net. Positional constraint corrections are read back as velocity
      // at 1/h, so any single large correction can launch the body. Cap it.
      for (const k in P) {
        const p = P[k];
        const gap = _v.subVectors(p.pos, p.prev);
        const speed = gap.length() / h;
        if (speed > MAX_SPEED) {
          gap.multiplyScalar(MAX_SPEED / speed);
          p.prev.subVectors(p.pos, gap);
        }
      }

      for (let it = 0; it < ITERATIONS; it++) {
        for (const c of body.constraints) {
          const d = _v.subVectors(c.b.pos, c.a.pos);
          const len = d.length();
          if (len < 1e-6) continue;
          const diff = ((len - c.len) / len) * 0.5 * c.stiff;
          d.multiplyScalar(diff);
          c.a.pos.add(d);
          c.b.pos.sub(d);
        }

        // Ground and walls, resolved inside the constraint loop so the body
        // does not tunnel through the paper while it is folding up.
        for (const k in P) {
          const p = P[k];
          if (p.pos.y < GROUND + p.radius) {
            p.pos.y = GROUND + p.radius;
            // Collapse the vertical gap as well as the position. In Verlet the
            // gap *is* the velocity, so lifting pos out of the floor without
            // this turns penetration depth into upward speed and the body
            // bounces higher on every landing.
            p.prev.y = p.pos.y;
            // Friction: drag the previous position toward the current one.
            p.prev.x += (p.pos.x - p.prev.x) * 0.35;
            p.prev.z += (p.pos.z - p.prev.z) * 0.35;
          }
          p.pos.x = THREE.MathUtils.clamp(p.pos.x, -lim, lim);
          p.pos.z = THREE.MathUtils.clamp(p.pos.z, -lim, lim);
        }
      }
    }
  }

  pose() {
    for (const body of this.bodies) {
      const P = body.P;
      const chest = _chest.addVectors(P.chestL.pos, P.chestR.pos).multiplyScalar(0.5);
      const pelvis = _pelvis.addVectors(P.pelvisL.pos, P.pelvisR.pos).multiplyScalar(0.5);

      // Body frame: up along the spine, right across the shoulders.
      _up.subVectors(chest, pelvis);
      if (_up.lengthSq() < 1e-8) _up.set(0, 1, 0); else _up.normalize();
      _right.subVectors(P.chestR.pos, P.chestL.pos);
      if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0); else _right.normalize();
      _fwd.crossVectors(_right, _up);
      if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1); else _fwd.normalize();
      _right.crossVectors(_up, _fwd).normalize();
      _m.makeBasis(_right, _up, _fwd);
      _q.setFromRotationMatrix(_m);

      for (const b of body.bones) {
        switch (b.kind) {
          case 'head':
            b.obj.position.copy(P.head.pos);
            b.obj.quaternion.copy(_q);
            break;
          case 'torso':
            b.obj.position.copy(chest).lerp(pelvis, 0.42);
            b.obj.quaternion.copy(_q);
            break;
          case 'chest':
            b.obj.position.copy(chest);
            b.obj.quaternion.copy(_q);
            break;
          case 'pelvis':
            b.obj.position.copy(pelvis);
            b.obj.quaternion.copy(_q);
            break;
          case 'limb':
            aimDown(b.obj, P[b.keys[0]].pos, P[b.keys[1]].pos);
            break;
        }
      }
    }
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;

      // Once retirement starts, leave the piece below the floor. Running the
      // ground-contact branch again would clamp it back to y0 every frame and
      // undo the sink applied in retire(), so debris would never be removed.
      if (d.rest > 3.0) continue;

      d.vel.y += GRAVITY * dt;
      d.obj.position.addScaledVector(d.vel, dt);

      if (d.obj.position.y <= d.y0) {
        d.obj.position.y = d.y0;
        if (Math.abs(d.vel.y) > 1.2) {
          // Bounce, shedding most of the energy.
          d.vel.y *= -0.26;
          d.vel.x *= 0.55;
          d.vel.z *= 0.55;
          d.spin.multiplyScalar(0.5);
          if (d.bleed > 0) this.ink.addStain(d.obj.position.x, d.obj.position.z, 0.35 + Math.random() * 0.4);
        } else {
          d.vel.set(0, 0, 0);
          d.spin.multiplyScalar(Math.exp(-9 * dt));
          d.rest += dt;
        }
      }

      const lim = this.arenaHalf + 3;
      d.obj.position.x = THREE.MathUtils.clamp(d.obj.position.x, -lim, lim);
      d.obj.position.z = THREE.MathUtils.clamp(d.obj.position.z, -lim, lim);

      if (d.spin.lengthSq() > 1e-6) {
        d.obj.rotateX(d.spin.x * dt);
        d.obj.rotateY(d.spin.y * dt);
        d.obj.rotateZ(d.spin.z * dt);
      }

      // A severed limb trails ink until the wound runs dry.
      if (d.bleed > 0 && d.age < 2.2) {
        d.bleedT -= dt;
        if (d.bleedT <= 0) {
          d.bleedT = d.bleed;
          const p = d.obj.position;
          this.ink.spray(p.x, Math.max(p.y, 0.15), p.z, 1, { force: 0.35, up: 0.35 });
        }
      }
    }
  }

  retire(dt) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const body = this.bodies[i];
      body.age += dt;

      // After the jets die down, open joints keep seeping.
      if (body.wounds.length && body.age > 1.2 && body.age < 3.4) {
        body.bleedT = (body.bleedT ?? 0) - dt;
        if (body.bleedT <= 0) {
          body.bleedT = 0.16;
          const key = body.wounds[(Math.random() * body.wounds.length) | 0];
          const p = body.P[key].pos;
          this.ink.spray(p.x, Math.max(p.y, 0.12), p.z, 1, { force: 0.3, up: 0.4 });
        }
      }

      // A settled body soaks into the page and is removed.
      if (body.age > 4.0) {
        const sink = Math.min(1, (body.age - 4.0) / 1.6);
        for (const b of body.bones) b.obj.position.y -= sink * 2.2 * dt * 3;
        if (sink >= 1) {
          for (const b of body.bones) this.dispose(b.obj);
          this.bodies.splice(i, 1);
        }
      }
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.rest > 3.0) {
        d.obj.position.y -= dt * 1.6;
        if (d.obj.position.y < -1.5) {
          this.dispose(d.obj);
          this.debris.splice(i, 1);
        }
      }
    }
  }

  dispose(obj) {
    if (obj.parent) obj.parent.remove(obj);
    // Geometry and the outline shader are shared. Toon materials, blade glows,
    // and mask eyes are created per actor and must leave with the corpse.
    obj.traverse((o) => {
      if (o.isMesh && o.material
          && (o.material.isMeshToonMaterial || o.material.isMeshBasicMaterial)) {
        o.material.dispose();
      }
    });
  }

  clear() {
    for (const body of this.bodies) for (const b of body.bones) this.dispose(b.obj);
    for (const d of this.debris) this.dispose(d.obj);
    this.bodies.length = 0;
    this.debris.length = 0;
  }
}
