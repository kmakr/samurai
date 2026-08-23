import {
  PLAYER_SPEED,
  DASH_DISTANCE, DASH_TIME, DASH_COOLDOWN,
  COMBO_WINDOW,
  PARRY_STARTUP, PARRY_RECOVER, PARRY_COOLDOWN,
  attackSpecFor, dashFollowupFor, parryDurationFor, weaponComboFor,
} from './combat.js';

// Owns player action transitions, locomotion, root motion, and attack clocks.
// Rendering-specific feedback is supplied through narrow ports so the rules can
// be exercised without constructing the full scene.
export class PlayerController {
  constructor({
    state, player, input, audio, ink, trail,
    move, tmp, animateLocomotion,
    isoAzimuth,
    getEnemies, getActiveWeapon, getFlowTier,
    aimYaw,
    trySignature,
    rewardDashRead,
    spawnDashWake,
    spawnImpactBurst,
    dashCameraPunch,
    shake,
    showCombatCallout,
    playerDashHits,
    playerAttackHits,
    updateSignatureAction,
    pose,
  }) {
    this.state = state;
    this.player = player;
    this.input = input;
    this.audio = audio;
    this.ink = ink;
    this.trail = trail;
    this.move = move;
    this.tmp = tmp;
    this.animateLocomotion = animateLocomotion;
    this.isoAzimuth = isoAzimuth;
    this.getEnemies = getEnemies;
    this.getActiveWeapon = getActiveWeapon;
    this.getFlowTier = getFlowTier;
    this.aimYaw = aimYaw;
    this.trySignature = trySignature;
    this.rewardDashRead = rewardDashRead;
    this.spawnDashWake = spawnDashWake;
    this.spawnImpactBurst = spawnImpactBurst;
    this.dashCameraPunch = dashCameraPunch;
    this.shake = shake;
    this.showCombatCallout = showCombatCallout;
    this.playerDashHits = playerDashHits;
    this.playerAttackHits = playerAttackHits;
    this.updateSignatureAction = updateSignatureAction;
    this.pose = pose;
    this.reset();
  }

  reset() {
    this.idleFor = 0;
    this.sheathK = 0;
    this.sheathed = false;
  }

  get activeWeapon() {
    return this.getActiveWeapon();
  }

  parryDuration() {
    return parryDurationFor(this.state.upgrades.steelMind);
  }

  weaponCombo() {
    return weaponComboFor(this.activeWeapon.skill);
  }

  activeAttack() {
    return attackSpecFor(
      this.state.attackKind, this.state.comboIndex, this.activeWeapon.skill,
    );
  }

  beginDash(moving) {
    const state = this.state;
    state.action = 'dash';
    state.actionT = 0;
    state.dashCooldown = DASH_TIME + DASH_COOLDOWN;
    state.dashDir.copy(moving
      ? this.move
      : this.tmp.set(Math.sin(state.facing), 0, Math.cos(state.facing)));
    state.dashHit.clear();
    this.rewardDashRead();
    this.spawnDashWake(this.player.root.position, state.dashDir);
    this.spawnImpactBurst(this.player.root.position, 0.42);
    this.dashCameraPunch(state.dashDir);
    this.shake(0.14);
    this.audio.dash();
  }

  beginAttack(chain = false, kind = 'arc') {
    const state = this.state;
    state.attackKind = kind;
    if (kind !== 'arc' || !chain) state.comboIndex = 0;
    state.action = 'attack';
    state.actionT = 0;
    state.attackPhase = 'windup';
    state.hitThisSwing = new Set();
    state.comboTimer = COMBO_WINDOW;
    const heavyArc = kind === 'arc' && this.activeWeapon.skill === 'tsunami';
    if (heavyArc) this.audio.heavyWindup();
    else this.audio.swing(kind === 'thrust' ? 2 : state.comboIndex);
  }

  updateAttack(dt) {
    const state = this.state;
    const kind = state.attackKind;
    const cfg = this.activeAttack();
    state.actionT += dt;
    const windupEnd = cfg.windup;
    const activeEnd = windupEnd + cfg.active;
    const recoverEnd = activeEnd + cfg.recover;

    if (state.actionT < windupEnd) {
      state.attackPhase = 'windup';
    } else if (state.actionT < activeEnd) {
      if (state.attackPhase !== 'active') {
        state.attackPhase = 'active';
        this.tmp.copy(this.player.root.position);
        this.tmp.y = 0.1;
        const tier = this.getFlowTier();
        const heavyArc = kind === 'arc' && this.activeWeapon.skill === 'tsunami';
        if (heavyArc) this.audio.swing(3);
        const baseScale = kind === 'thrust' ? 1.12
          : heavyArc ? 1.6
          : state.comboIndex === 2 ? 1.28 : 1;
        this.trail.fire(this.tmp, state.facing, {
          mirror: kind === 'dashcut' || (kind === 'arc' && state.comboIndex === 1),
          duration: cfg.active + cfg.recover * (heavyArc ? 1.0 : 0.8) + tier * 0.018,
          scale: baseScale * (1 + tier * 0.06),
          style: kind === 'thrust' ? 2
            : kind === 'dashcut' ? 0
            : heavyArc ? 3 : state.comboIndex,
          energy: tier,
        });
      }
      this.playerAttackHits();
    } else if (state.actionT < recoverEnd) {
      state.attackPhase = 'recover';
    } else {
      state.action = 'idle';
      state.attackPhase = '';
      state.actionT = 0;
      state.comboTimer = COMBO_WINDOW;
    }
  }

  update(dt) {
    const state = this.state;
    const player = this.player;
    const activeWeapon = this.activeWeapon;

    if (state.action !== 'iai') state.facing = this.aimYaw();

    if (state.dashCooldown > 0) state.dashCooldown -= dt;
    if (state.parryCooldown > 0) state.parryCooldown -= dt;
    if (state.invuln > 0) state.invuln -= dt;
    if (state.comboTimer > 0) state.comboTimer -= dt;
    else state.comboIndex = 0;

    const moving = this.input.moveVector(this.move);

    if (state.action === 'idle' && !moving) this.idleFor += dt;
    else this.idleFor = 0;
    let calm = this.idleFor > 3;
    if (calm) {
      for (const enemy of this.getEnemies()) {
        if (enemy.dead) continue;
        const ex = enemy.actor.root.position.x - player.root.position.x;
        const ez = enemy.actor.root.position.z - player.root.position.z;
        if (ex * ex + ez * ez < 81) { calm = false; break; }
      }
    }
    if (this.sheathed && !calm && this.sheathK > 0.5) this.audio.swing(1);
    this.sheathed = calm;
    this.sheathK += ((calm ? 1 : 0) - this.sheathK)
      * Math.min(1, dt * (calm ? 3 : 18));

    if (moving) {
      const mx = this.move.x;
      const mz = this.move.z;
      const sin = Math.sin(this.isoAzimuth);
      const cos = Math.cos(this.isoAzimuth);
      this.move.x = mx * cos + mz * sin;
      this.move.z = mz * cos - mx * sin;
    }

    const dashCancellable = state.action === 'idle'
      || state.action === 'attack'
      || state.action === 'parry';
    const hitConfirmed = state.action === 'attack'
      && state.hitThisSwing && state.hitThisSwing.size > 0;
    const canChain = state.action === 'attack'
      && (state.attackPhase === 'recover'
        || (state.attackPhase === 'active' && hitConfirmed));

    if (dashCancellable && state.dashCooldown <= 0 && this.input.take('dash')) {
      this.beginDash(moving);
    } else if (state.action === 'idle') {
      if (this.input.take('focus')) this.trySignature();
      else if (this.input.take('parry') && state.parryCooldown <= 0) {
        state.action = 'parry';
        state.actionT = 0;
        state.parryCooldown = PARRY_COOLDOWN + PARRY_STARTUP
          + this.parryDuration() + PARRY_RECOVER;
        this.audio.guard();
      } else if (this.input.take('attack')) {
        this.beginAttack();
      }
    } else if (canChain) {
      if (this.input.take('attack') && state.comboIndex < this.weaponCombo().length - 1) {
        state.comboIndex++;
        this.beginAttack(true);
      }
    } else if (state.action === 'dash' && state.actionT > 0.02 && this.input.take('attack')) {
      const kind = dashFollowupFor(state.dashDir.x, state.dashDir.z, state.facing);
      this.beginAttack(false, kind);
      if (!state.seenDashCut) {
        state.seenDashCut = true;
        this.showCombatCallout('DRAW', kind === 'thrust' ? 'DASH THRUST' : 'DASH CUT');
      }
    }

    let speed = 0;
    if (state.action === 'dash') {
      const dashDt = Math.min(dt, Math.max(0, DASH_TIME - state.actionT));
      state.actionT += dt;
      state.invuln = Math.max(state.invuln, 0.02);
      const travel = DASH_DISTANCE * (dashDt / DASH_TIME);
      player.root.position.x += state.dashDir.x * travel;
      player.root.position.z += state.dashDir.z * travel;
      this.playerDashHits();
      if (Math.random() < 0.6) {
        this.ink.addStain(
          player.root.position.x + (Math.random() - 0.5) * 0.8,
          player.root.position.z + (Math.random() - 0.5) * 0.8,
          0.18 + Math.random() * 0.25,
          { alpha: 0.28 },
        );
      }
      if (state.actionT >= DASH_TIME) {
        state.action = 'idle';
        state.actionT = 0;
      }
    } else if (state.action === 'attack') {
      this.updateAttack(dt);
      const heavyArc = state.attackKind === 'arc' && activeWeapon.skill === 'tsunami';
      speed = PLAYER_SPEED * (heavyArc ? 0.2
        : state.attackKind === 'arc' && state.comboIndex === 2 ? 0.25 : 0.45);
      if (state.action === 'attack') {
        const cfg = this.activeAttack();
        const t = state.actionT;
        let drive = 0;
        if (t < cfg.windup) {
          drive = (heavyArc ? -2.4 : -1.3) * (t / cfg.windup);
        } else if (t < cfg.windup + cfg.active) {
          const activeT = (t - cfg.windup) / cfg.active;
          const peak = state.attackKind === 'thrust' ? 27
            : state.attackKind === 'dashcut' ? 15
            : heavyArc ? (state.comboIndex >= 1 ? 16 : 11)
            : state.comboIndex === 2 ? 15 : 10.5;
          drive = peak * Math.pow(1 - activeT, 1.4);
        }
        player.root.position.x += Math.sin(state.facing) * drive * dt;
        player.root.position.z += Math.cos(state.facing) * drive * dt;
      }
    } else if (state.action === 'parry') {
      state.actionT += dt;
      speed = PLAYER_SPEED * 0.25;
      if (state.actionT >= PARRY_STARTUP + this.parryDuration() + PARRY_RECOVER) {
        state.action = 'idle';
        state.actionT = 0;
      }
    } else if (state.action === 'iai') {
      this.updateSignatureAction(dt);
    } else if (state.action === 'hurt') {
      state.actionT -= dt;
      speed = PLAYER_SPEED * 0.3;
      if (state.actionT <= 0) state.action = 'idle';
    } else {
      speed = PLAYER_SPEED;
    }

    if (moving && speed > 0) {
      player.root.position.x += this.move.x * speed * dt;
      player.root.position.z += this.move.z * speed * dt;
    }

    player.root.rotation.y = state.facing;
    const blend = moving && speed > PLAYER_SPEED * 0.5 ? 1 : 0;
    const previousPhase = state.phase;
    state.phase += dt * (blend ? 11 : 2.2);
    if (blend && Math.floor(state.phase / Math.PI) !== Math.floor(previousPhase / Math.PI)) {
      this.audio.step();
    }
    this.animateLocomotion(player, state.phase, blend, state.time);
    this.pose(dt);
  }
}
