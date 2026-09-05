import { FLOW_WINDOW, FOCUS_MAX } from './combat.js';

// Owns enemy state-machine progression, attack-slot pressure, formation
// separation, ranged releases, and rival follow-up scheduling. Geometry posing
// and audiovisual feedback remain ports supplied by the scene layer.
export class EnemyDirector {
  constructor({
    state, player, getEnemies, tmp, clamp,
    ink, enemyTrail, audio, onStrike,
    enemyWindup, commitStrike, restoreStrikeTiming,
    updateBladeTelegraph, poseEnemy, resolveEnemyStrike,
    spawnImpactBurst, flash,
    parryActive, flowMultiplier, spawnParryRing, parryFlash,
    hitstop, shake, showCombatCallout, updateHUD, damagePlayer,
  }) {
    Object.assign(this, {
      state, player, getEnemies, tmp, clamp,
      ink, enemyTrail, audio, onStrike,
      enemyWindup, commitStrike, restoreStrikeTiming,
      updateBladeTelegraph, poseEnemy, resolveEnemyStrike,
      spawnImpactBurst, flash,
      parryActive, flowMultiplier, spawnParryRing, parryFlash,
      hitstop, shake, showCombatCallout, updateHUD, damagePlayer,
    });
  }

  requestSlot(enemy) {
    if (enemy.hasSlot) return true;
    const used = this.getEnemies().reduce((count, entry) => count + (entry.hasSlot ? 1 : 0), 0);
    if (used >= this.state.slots) return false;
    enemy.hasSlot = true;
    return true;
  }

  releaseSlot(enemy) {
    enemy.hasSlot = false;
  }

  update(dt) {
    const state = this.state;
    const playerPosition = this.player.root.position;
    const enemies = this.getEnemies();

    for (const enemy of enemies) {
      const position = enemy.actor.root.position;

      if (enemy.state === 'enter') {
        enemy.t += dt;
        if (enemy.t < 0) {
          enemy.actor.root.visible = false;
          continue;
        }
        if (!enemy.entered) {
          enemy.entered = true;
          enemy.actor.root.visible = true;
          this.ink.addStain(
            position.x, position.z,
            enemy.rival ? 2.2 : 1.15 * enemy.spec.height,
            { alpha: enemy.rival ? 0.94 : 0.72, bleed: enemy.rival ? 1.05 : 0.7 },
          );
          if (enemy.rival) {
            this.ink.addStain(position.x, position.z, 3.1, {
              alpha: 0.34, bleed: 1.45, aspect: 1.5,
            });
            this.spawnImpactBurst(position, 0.65);
          }
        }
        const progress = this.clamp(enemy.t / (enemy.rival ? 0.62 : 0.42), 0, 1);
        const rise = 1 - (1 - progress) ** 3;
        position.y = -0.62 * enemy.spec.height * (1 - rise);
        enemy.actor.root.rotation.y += dt * (enemy.rival ? 1.4 : 0.8) * (1 - progress);
        this.poseEnemy(enemy, dt);
        if (progress >= 1) {
          position.y = 0;
          enemy.state = 'approach';
          enemy.t = 0;
        }
        continue;
      }

      const lagX = playerPosition.x - position.x;
      const lagZ = playerPosition.z - position.z;
      if (lagX * lagX + lagZ * lagZ > 45 * 45) {
        const angle = Math.atan2(lagX, lagZ) + (Math.random() - 0.5) * 1.2;
        position.x = playerPosition.x + Math.sin(angle) * 26;
        position.z = playerPosition.z + Math.cos(angle) * 26;
        enemy.state = 'approach';
        enemy.t = 0;
      }

      const dx = playerPosition.x - position.x;
      const dz = playerPosition.z - position.z;
      const distance = Math.hypot(dx, dz) || 1;
      const nx = dx / distance;
      const nz = dz / distance;
      const reach = enemy.spec.reach * enemy.spec.height;

      enemy.t += dt;
      if (enemy.cooldown > 0) enemy.cooldown -= dt;
      let move = 0;
      let turn = true;
      const orbitRange = enemy.spec.bow ? enemy.spec.range : reach;
      const strikeRange = reach * 1.25;
      if (enemy.aimLine && enemy.state !== 'aim' && enemy.state !== 'loose') {
        enemy.aimLine.material.opacity = 0;
      }

      switch (enemy.state) {
        case 'approach': {
          move = enemy.speed;
          if (enemy.spec.bow) {
            if (distance < enemy.spec.range * 1.25) { enemy.state = 'circle'; enemy.t = 0; }
            break;
          }
          if (distance < strikeRange && enemy.cooldown <= 0 && this.requestSlot(enemy)) {
            enemy.state = 'windup'; enemy.t = 0; this.commitStrike(enemy);
          } else if (distance < reach * 1.6) {
            enemy.state = 'circle'; enemy.t = 0;
          }
          break;
        }
        case 'circle': {
          const radial = (distance - orbitRange) * 1.4;
          this.tmp.set(nx * radial, 0, nz * radial);
          this.tmp.x += -nz * enemy.circleDir * enemy.speed * 0.75;
          this.tmp.z += nx * enemy.circleDir * enemy.speed * 0.75;
          const length = this.tmp.length() || 1;
          this.tmp.multiplyScalar(Math.min(enemy.speed, length) / length);
          position.x += this.tmp.x * dt;
          position.z += this.tmp.z * dt;
          enemy.phase += dt * 7;
          if (enemy.t > enemy.circleFor) {
            enemy.t = 0;
            enemy.circleFor = 0.5 + Math.random() * 0.7;
            if (enemy.spec.bow) {
              const anyAiming = enemies.some((entry) => !entry.dead && entry.spec.bow
                && (entry.state === 'aim' || entry.state === 'loose'));
              if (!anyAiming && enemy.cooldown <= 0
                && distance > 4.5 && distance < enemy.spec.range * 1.5) {
                enemy.state = 'aim';
                enemy.aimDir.set(nx, 0, nz);
              } else if (Math.random() < 0.3) {
                enemy.circleDir *= -1;
              }
            } else if (distance < strikeRange && enemy.cooldown <= 0 && this.requestSlot(enemy)) {
              enemy.state = 'windup';
              this.commitStrike(enemy);
            } else if (distance > reach * 2.2) {
              enemy.state = 'approach';
            } else if (Math.random() < 0.3) {
              enemy.circleDir *= -1;
            }
          }
          break;
        }
        case 'aim': {
          turn = false;
          const windup = this.enemyWindup(enemy);
          const progress = Math.min(1, enemy.t / windup);
          const locked = progress >= 0.55;
          if (!locked) { enemy.aimDir.set(nx, 0, nz); turn = true; }
          const lineLength = 17;
          const line = enemy.aimLine;
          line.position.set(
            position.x + enemy.aimDir.x * lineLength / 2,
            0.06,
            position.z + enemy.aimDir.z * lineLength / 2,
          );
          line.rotation.set(-Math.PI / 2, 0, Math.atan2(-enemy.aimDir.z, enemy.aimDir.x));
          line.scale.set(lineLength, locked ? 0.16 : 0.34, 1);
          line.material.opacity = locked
            ? 0.42 + Math.sin(state.time * 26) * 0.16
            : 0.05 + progress * 0.1;
          if (enemy.t >= windup) {
            enemy.state = 'loose';
            enemy.t = 0;
            this.onStrike?.(enemy, Math.atan2(enemy.aimDir.x, enemy.aimDir.z));
            this.audio.swing(1);
            const playerX = playerPosition.x - position.x;
            const playerZ = playerPosition.z - position.z;
            const along = playerX * enemy.aimDir.x + playerZ * enemy.aimDir.z;
            const across = Math.abs(playerX * enemy.aimDir.z - playerZ * enemy.aimDir.x);
            if (along > 0 && along < lineLength && across < 0.6) {
              if (this.parryActive()) {
                state.chainTimer = Math.max(state.chainTimer, FLOW_WINDOW);
                state.focus = Math.min(FOCUS_MAX, state.focus + 12 * this.flowMultiplier());
                this.tmp.set(playerPosition.x, 1.2, playerPosition.z);
                this.spawnParryRing(this.tmp);
                this.parryFlash();
                this.flash(0.7);
                this.hitstop(0.1, 0.1);
                this.shake(0.5);
                this.showCombatCallout('TURN', 'ARROW TURNED');
                this.audio.parry();
                this.updateHUD();
              } else if (state.invuln <= 0) {
                this.damagePlayer(enemy.damage, enemy);
              }
            }
          }
          break;
        }
        case 'loose': {
          turn = false;
          const fade = Math.max(0, 1 - enemy.t / 0.14);
          enemy.aimLine.material.opacity = fade * 0.85;
          enemy.aimLine.scale.set(17, 0.1 + (1 - fade) * 0.22, 1);
          if (enemy.t >= 0.3) {
            enemy.state = 'circle';
            enemy.t = 0;
            enemy.cooldown = 2.6 + Math.random() * 1.6;
          }
          break;
        }
        case 'windup': {
          move = enemy.speed * 0.25;
          if (enemy.t >= this.enemyWindup(enemy)) {
            this.restoreStrikeTiming(enemy);
            enemy.state = 'strike';
            enemy.t = 0;
            enemy.lunge.set(nx, 0, nz);
            this.tmp.copy(position);
            this.tmp.y = 0.1;
            this.spawnImpactBurst(position, enemy.rival ? 1.25 : 0.62);
            this.flash(enemy.rival ? 0.18 : 0.06);
            this.onStrike?.(enemy, Math.atan2(nx, nz));
            this.enemyTrail.fire(this.tmp, Math.atan2(nx, nz), {
              duration: 0.3, scale: enemy.spec.height,
            });
            this.audio.swing();
          }
          break;
        }
        case 'strike': {
          const progress = Math.min(1, enemy.t / 0.16);
          const speed = 9 * enemy.spec.height * (1 - progress) ** 1.5;
          position.x += enemy.lunge.x * speed * dt;
          position.z += enemy.lunge.z * speed * dt;
          turn = false;
          if (!enemy.resolved && enemy.t >= 0.10) {
            enemy.resolved = true;
            this.resolveEnemyStrike(enemy, distance, nx, nz, reach);
          }
          if (enemy.t >= 0.34) {
            enemy.resolved = false;
            enemy.state = 'recover';
            enemy.t = 0;
          }
          break;
        }
        case 'recover': {
          turn = false;
          if (enemy.t >= 0.42) {
            const chainLimit = enemy.rival ? (enemy.awakened ? 2 : 1) : 0;
            if (enemy.rival && enemy.rivalChain < chainLimit && distance < reach * 1.8) {
              enemy.rivalChain++;
              enemy.rivalFollowup = true;
              enemy.state = 'windup';
              this.commitStrike(enemy);
              enemy.t = Math.max(0, this.enemyWindup(enemy) - (enemy.grudge ? 0.32 : 0.24));
              enemy.circleDir *= -1;
            } else {
              enemy.rivalFollowup = false;
              enemy.rivalChain = 0;
              this.releaseSlot(enemy);
              enemy.cooldown = enemy.rival
                ? (enemy.grudge ? 0.4 : 0.55)
                : 0.8 + Math.random() * 1.6;
              enemy.state = distance > reach * 1.6 ? 'approach' : 'circle';
              enemy.t = 0;
            }
          }
          break;
        }
        case 'awaken': {
          turn = false;
          if (enemy.t >= 0.72) {
            enemy.state = 'circle';
            enemy.t = 0;
            enemy.cooldown = 0.18;
            enemy.circleFor = 0.18;
          }
          break;
        }
        case 'stagger': {
          if (enemy.t >= 0.3) {
            enemy.state = 'circle';
            enemy.t = 0;
            enemy.cooldown = Math.max(enemy.cooldown, 0.4);
          }
          break;
        }
      }

      this.updateBladeTelegraph(enemy);
      if (move > 0) {
        position.x += nx * move * dt;
        position.z += nz * move * dt;
        enemy.phase += dt * 9 * (move / enemy.spec.speed);
      }
      if (turn) {
        const target = Math.atan2(nx, nz);
        let difference = target - enemy.actor.root.rotation.y;
        while (difference > Math.PI) difference -= Math.PI * 2;
        while (difference < -Math.PI) difference += Math.PI * 2;
        enemy.actor.root.rotation.y += difference * Math.min(1, dt * 7);
      }
      this.poseEnemy(enemy, dt);
    }

    this.separate();
  }

  separate() {
    const enemies = this.getEnemies();
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].dead || enemies[i].state === 'enter') continue;
      const first = enemies[i].actor.root.position;
      const firstRadius = 0.55 * enemies[i].spec.height;
      for (let j = i + 1; j < enemies.length; j++) {
        if (enemies[j].dead || enemies[j].state === 'enter') continue;
        const second = enemies[j].actor.root.position;
        const secondRadius = 0.55 * enemies[j].spec.height;
        const dx = second.x - first.x;
        const dz = second.z - first.z;
        const squared = dx * dx + dz * dz;
        const minimum = firstRadius + secondRadius;
        if (squared > minimum * minimum) continue;
        let distance = Math.sqrt(squared);
        let unitX;
        let unitZ;
        if (distance < 1e-4) {
          const angle = (i * 17 + j * 31 + 1) * 1.618034;
          unitX = Math.cos(angle);
          unitZ = Math.sin(angle);
          distance = 0;
        } else {
          unitX = dx / distance;
          unitZ = dz / distance;
        }
        const push = (minimum - distance) * 0.5;
        first.x -= unitX * push;
        first.z -= unitZ * push;
        second.x += unitX * push;
        second.z += unitZ * push;
      }
    }

    const playerPosition = this.player.root.position;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy.dead || enemy.state === 'enter') continue;
      const position = enemy.actor.root.position;
      const minimum = 0.46 + 0.48 * enemy.spec.height;
      const dx = position.x - playerPosition.x;
      const dz = position.z - playerPosition.z;
      const squared = dx * dx + dz * dz;
      if (squared >= minimum * minimum) continue;
      let distance = Math.sqrt(squared);
      let unitX;
      let unitZ;
      if (distance < 1e-4) {
        const angle = (i + 1) * 2.399963;
        unitX = Math.cos(angle);
        unitZ = Math.sin(angle);
        distance = 0;
      } else {
        unitX = dx / distance;
        unitZ = dz / distance;
      }
      const push = minimum - distance;
      position.x += unitX * push;
      position.z += unitZ * push;
    }
  }
}
