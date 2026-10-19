/** ONE enemy type: FSM brain (idle|patrol|chase|windup|strike|recover)
 *  with hysteresis (aggro 12 / deaggro 15.6), waypoint patrol, chase,
 *  telegraphed melee attack + cooldown, HP, death → pickup drop chance.
 *  Tuning lives in ENEMY_TUNING (data, not code). AI component follows the
 *  engine shape {brain:'chaser', state, t, target}; per-enemy render data
 *  (waypoint, flash, respawn) lives in a side table. Torso materials are
 *  cloned per enemy so damage flash never touches the shared library.
 *
 *  Babylon port of the ts-three reference (game/enemy.ts): identical FSM,
 *  tuning, and sim math. Render mapping only: positions (x,y,z)->(x,y,-z),
 *  yaw ry->(PI+ry) (see game/player.ts). Damage flash drives
 *  StandardMaterial.emissiveColor (no emissiveIntensity in Babylon). */

import * as BABYLON from '@babylonjs/core';
import { C, World } from '../engine/ecs';
import type { PhysicsSys } from '../engine/physics';
import type { AudioSys } from '../engine/audio';
import { buildEnemyMesh, addShadowCasters } from '../gfx/character';
import type { Mats } from '../gfx/materials';
import { createStreams } from '../engine/rng';
import { MASTER_SEED, resolveStaticContact, CONTACT_SINK_PER_TICK, type AABB } from './arena';
import { makeTransform, writePos, makeHealth, getHp, setHp, TransformFull, HealthFull } from './sim';

export const ENEMY_TUNING = {
  hp: 30,
  walkSpeed: 3.4,
  patrolSpeed: 1.7,
  damage: 12,
  attackRange: 2.4,
  attackCooldown: 1.4,
  aggroRange: 12,
  deaggroRange: 15.6,   // 1.3x hysteresis
  reactionDelay: 0.35,
  windupTime: 0.45,     // telegraph
  strikeTime: 0.12,
  recoverTime: 0.6,
  separationRadius: 2.0,
  count: 6,
  respawnDelay: 6,
  dropChance: 0.35,
  waypoints: 5,
} as const;

export type EnemyState = 'idle' | 'patrol' | 'chase' | 'windup' | 'strike' | 'recover';

export interface EnemyHooks {
  onPlayerDamage: (dmg: number, x: number, z: number) => void;
  onKill: (x: number, y: number, z: number) => void;
  onDrop: (x: number, z: number) => void;
}

export interface EnemyOpts {
  shadow?: BABYLON.ShadowGenerator;
  /** Static AABBs for controller-owned wall contact (see player.ts). */
  statics?: AABB[];
}

interface AIComp { brain: 'chaser'; state: EnemyState; t: number; target: number }

interface EnemyRec {
  id: number;
  bodyId: number;
  torsoMat: BABYLON.StandardMaterial;
  node: BABYLON.TransformNode;
  wp: number;
  flash: number;
  atkCd: number;
  respawnT: number;
  vx: number;
  vz: number;
}

const REST_Y = 0.85;
const _pos = { x: 0, y: 0, z: 0 };

export class Enemies {
  private list: EnemyRec[] = [];
  private waypoints: Array<{ x: number; z: number }> = [];
  private rng: () => number;

  constructor(
    private world: World,
    private physics: PhysicsSys,
    private scene: BABYLON.Scene,
    private mats: Mats,
    private audio: AudioSys,
    private hooks: EnemyHooks,
    private opts?: EnemyOpts,
  ) {
    this.rng = createStreams(MASTER_SEED, ['enemies'])['enemies'];
    for (let i = 0; i < ENEMY_TUNING.waypoints; i++) {
      const a = (i / ENEMY_TUNING.waypoints) * Math.PI * 2;
      this.waypoints.push({ x: Math.cos(a) * 13, z: Math.sin(a) * 13 });
    }
  }

  private get statics(): AABB[] {
    return this.opts?.statics ?? [];
  }

  spawn(x: number, z: number): number {
    const id = this.world.spawn({
      [C.Transform]: makeTransform(x, REST_Y, z),
      [C.Velocity]: { x: 0, y: 0, z: 0 },
      [C.Health]: makeHealth(ENEMY_TUNING.hp, ENEMY_TUNING.hp),
      [C.Collider]: { kind: 'capsule', hx: 0.4, hy: 0.45, hz: 0, static: false },
      [C.Enemy]: {},
      [C.AI]: { brain: 'chaser', state: 'patrol', t: 0, target: 0 } as AIComp,
      [C.Renderable]: { mesh: 'enemy', tint: 0xffffff, visible: true },
    });
    const bodyId = this.physics.addBody({ kind: 'capsule', hx: 0.4, hy: 0.45, hz: 0, x, y: REST_Y, z, static: false });

    const { node, torsoMesh } = buildEnemyMesh(this.mats, this.scene);
    const torsoMat = torsoMesh.material!.clone('etorso' + id) as BABYLON.StandardMaterial;
    torsoMesh.material = torsoMat;
    node.position.set(x, 0, -z);
    if (this.opts?.shadow) addShadowCasters(this.opts.shadow, node);
    const rec: EnemyRec = {
      id, bodyId, torsoMat, node,
      wp: Math.floor(this.rng() * this.waypoints.length),
      flash: 0, atkCd: 0, respawnT: 0, vx: 0, vz: 0,
    };
    this.list.push(rec);
    return id;
  }

  spawnInitial(): void {
    for (let i = 0; i < ENEMY_TUNING.count; i++) {
      const a = (i / ENEMY_TUNING.count) * Math.PI * 2 + this.rng() * 0.6;
      const r = 9 + this.rng() * 7;
      this.spawn(Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  clear(): void {
    for (const e of this.list) {
      e.node.dispose();
      e.torsoMat.dispose();
      if (e.bodyId >= 0) this.physics.remove(e.bodyId);
      this.world.despawn(e.id);
    }
    this.list.length = 0;
  }

  aliveCount(): number {
    let n = 0;
    for (const e of this.list) if (e.respawnT <= 0) n++;
    return n;
  }

  damage(id: number, dmg: number, kx: number, kz: number): void {
    const rec = this.list.find((e) => e.id === id);
    const h = this.world.get<HealthFull>(id, C.Health);
    if (!rec || !h || getHp(h) <= 0 || rec.respawnT > 0) return;
    const v = Math.max(0, getHp(h) - dmg);
    setHp(h, v);
    rec.flash = 0.09;
    // knockback nudge (no getVelocity in the engine API; teleport-nudge it)
    if (rec.bodyId >= 0) {
      this.physics.getPosition(rec.bodyId, _pos);
      this.physics.setKinematicPosition(rec.bodyId, _pos.x + kx * 0.35, _pos.y, _pos.z + kz * 0.35);
    }
    this.audio.play('hit');
    if (v <= 0) {
      const t = this.world.get<TransformFull>(id, C.Transform);
      this.kill(rec, t ? t.x : _pos.x, t ? t.z : _pos.z);
    }
  }

  private kill(rec: EnemyRec, x: number, z: number): void {
    rec.respawnT = ENEMY_TUNING.respawnDelay;
    rec.node.setEnabled(false);
    if (rec.bodyId >= 0) {
      this.physics.remove(rec.bodyId);
      rec.bodyId = -1;
    }
    this.hooks.onKill(x, 1, z);
    if (this.rng() < ENEMY_TUNING.dropChance) this.hooks.onDrop(x, z);
  }

  /** Update phase. px,pz = player pos; playerAlive gates aggro. */
  update(dt: number, px: number, pz: number, playerAlive: boolean): void {
    const T = ENEMY_TUNING;
    const ids = this.world.query(C.Enemy, C.Transform, C.AI, C.Health);

    for (const id of ids) {
      const rec = this.list.find((e) => e.id === id);
      if (!rec) continue;
      const t = this.world.get<TransformFull>(id, C.Transform)!;
      const brain = this.world.get<AIComp>(id, C.AI)!;
      const h = this.world.get<HealthFull>(id, C.Health)!;
      if (getHp(h) <= 0) continue;

      // respawn countdown (dead entities keep components; body removed)
      if (rec.respawnT > 0) {
        rec.respawnT -= dt;
        if (rec.respawnT <= 0) {
          const a = this.rng() * Math.PI * 2;
          const r = 10 + this.rng() * 6;
          const nx = Math.cos(a) * r, nz = Math.sin(a) * r;
          setHp(h, h.maxHp);
          brain.state = 'patrol'; brain.t = 0;
          rec.bodyId = this.physics.addBody({ kind: 'capsule', hx: 0.4, hy: 0.45, hz: 0, x: nx, y: REST_Y, z: nz, static: false });
          writePos(t, nx, REST_Y, nz);
          rec.node.setEnabled(true);
          rec.vx = 0; rec.vz = 0;
        }
        continue;
      }
      if (rec.bodyId < 0) continue;

      // sync transform from physics
      this.physics.getPosition(rec.bodyId, _pos);
      // Controller-owned vertical motion + ground/wall contact (see
      // player.ts): the Havok ANIMATED driver applies no gravity and
      // resolves no contacts. Enemy vy is forced 0 every tick in ts-three
      // with the same CONTACT_SINK_PER_TICK settle; walls/pillars push out.
      const ey0 = _pos.y;
      if (_pos.y > REST_Y) _pos.y = Math.max(REST_Y, _pos.y - CONTACT_SINK_PER_TICK);
      const pushed = resolveStaticContact(this.statics, _pos, 0.4);
      if (pushed || _pos.y !== ey0) {
        this.physics.setKinematicPosition(rec.bodyId, _pos.x, _pos.y, _pos.z);
      }
      writePos(t, _pos.x, _pos.y, _pos.z);

      const dx = px - t.x, dz = pz - t.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const canSee = playerAlive && dist < T.deaggroRange;

      // damage flash decay
      if (rec.flash > 0) {
        rec.flash -= dt;
        const k = Math.max(0, rec.flash / 0.09) * 0.9;
        rec.torsoMat.emissiveColor.set(k, k, k);
      } else {
        rec.torsoMat.emissiveColor.set(0, 0, 0);
      }

      let sx = 0, sz = 0; // steering target velocity

      switch (brain.state) {
        case 'idle':
          if (canSee && dist < T.aggroRange) { brain.state = 'chase'; brain.t = T.reactionDelay; }
          else { brain.t -= dt; if (brain.t <= 0) { brain.state = 'patrol'; } }
          break;

        case 'patrol': {
          if (canSee && dist < T.aggroRange) { brain.state = 'chase'; brain.t = T.reactionDelay; break; }
          const wp = this.waypoints[rec.wp];
          const wx = wp.x - t.x, wz = wp.z - t.z;
          const wd = Math.hypot(wx, wz);
          if (wd < 1.2) rec.wp = (rec.wp + 1) % this.waypoints.length;
          else { sx = (wx / wd) * T.patrolSpeed; sz = (wz / wd) * T.patrolSpeed; }
          break;
        }

        case 'chase':
          if (!canSee || dist > T.deaggroRange) { brain.state = 'patrol'; break; }
          if (brain.t > 0) { brain.t -= dt; break; } // reaction delay: face but hold
          rec.atkCd -= dt;
          if (dist < T.attackRange && rec.atkCd <= 0) {
            brain.state = 'windup'; brain.t = T.windupTime;
            break;
          }
          sx = (dx / dist) * T.walkSpeed;
          sz = (dz / dist) * T.walkSpeed;
          break;

        case 'windup': // telegraph: rear up, then strike
          brain.t -= dt;
          rec.node.scaling.setAll(1 + 0.12 * (1 - brain.t / T.windupTime));
          if (brain.t <= 0) {
            brain.state = 'strike'; brain.t = T.strikeTime;
            rec.node.scaling.setAll(1);
          }
          break;

        case 'strike':
          brain.t -= dt;
          if (brain.t <= 0) {
            if (dist < T.attackRange + 0.5) this.hooks.onPlayerDamage(T.damage, t.x, t.z);
            brain.state = 'recover'; brain.t = T.recoverTime;
            rec.atkCd = T.attackCooldown;
          }
          break;

        case 'recover':
          brain.t -= dt;
          if (brain.t <= 0) { brain.state = 'chase'; brain.t = 0; }
          break;
      }

      // separation from other live enemies
      for (const other of ids) {
        if (other === id) continue;
        const orec = this.list.find((e) => e.id === other);
        if (!orec || orec.respawnT > 0) continue;
        const ot = this.world.get<TransformFull>(other, C.Transform);
        if (!ot) continue;
        const ex = t.x - ot.x, ez = t.z - ot.z;
        const ed = Math.hypot(ex, ez);
        if (ed > 0.001 && ed < T.separationRadius) {
          sx += (ex / ed) * 2.2;
          sz += (ez / ed) * 2.2;
        }
      }

      // face travel/player
      if (brain.state === 'chase' || brain.state === 'windup' || brain.state === 'strike') {
        t.ry = Math.atan2(dx, dz);
      } else if (sx !== 0 || sz !== 0) {
        t.ry = Math.atan2(sx, sz);
      }

      // smooth velocity toward steering target
      const kk = Math.min(1, 8 * dt);
      rec.vx += (sx - rec.vx) * kk;
      rec.vz += (sz - rec.vz) * kk;
      this.physics.setVelocity(rec.bodyId, rec.vx, 0, rec.vz);

      // render mapping
      rec.node.position.set(t.x, t.y, -t.z);
      rec.node.rotation.y = Math.PI + t.ry;
    }
  }

  serialize(): Array<{ x: number; z: number; hp: number; state: EnemyState; wp: number }> {
    const out: Array<{ x: number; z: number; hp: number; state: EnemyState; wp: number }> = [];
    for (const e of this.list) {
      if (e.respawnT > 0) continue;
      const t = this.world.get<TransformFull>(e.id, C.Transform);
      const h = this.world.get<HealthFull>(e.id, C.Health);
      const b = this.world.get<AIComp>(e.id, C.AI);
      if (t && h && b) out.push({ x: t.x, z: t.z, hp: getHp(h), state: b.state, wp: e.wp });
    }
    return out;
  }

  restore(states: Array<{ x: number; z: number; hp: number; state: EnemyState; wp: number }>): void {
    this.clear();
    for (const s of states) {
      const id = this.spawn(s.x, s.z);
      const h = this.world.get<HealthFull>(id, C.Health);
      const b = this.world.get<AIComp>(id, C.AI);
      const rec = this.list.find((e) => e.id === id);
      if (h) setHp(h, s.hp);
      if (b) { b.state = s.state; b.t = 0; }
      if (rec) { rec.wp = s.wp; rec.atkCd = 0; }
    }
  }
}
