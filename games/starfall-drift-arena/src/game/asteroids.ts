/** Asteroid field, mining laser, ore pickups, station + docking.
 *
 * - ~64 asteroids in a shell around the play area; each has ore; mining (E
 *   within 30u, facing the rock) beams 1 ore per 0.5s into cargo; the rock
 *   shrinks as it depletes and respawns after 60s.
 * - Ore floats as Pickup entities (kind 'ore' kept in a parallel map — the
 *   engine PickupC interface is NOT changed); flying within 7u collects.
 * - Station entity at (0, 0, -600); mesh via `createStation()` (gfx stub —
 *   the meta builder swaps the import for the real src/gfx/station.ts).
 */

import * as THREE from 'three';
import {
  C, type LifetimeC, type PickupC, type TransformC, type VelocityC,
} from '../engine/ecs';
import { attachMesh, despawnEntity, type SimCtx } from './api';
import { createAsteroidMesh, createOrePickupMesh, createStation } from '../gfx/asteroids';
import { forwardFromEuler } from './flight';

export interface RockData {
  ore: number;
  maxOre: number;
  radius: number;
  respawn: number; // >0 while depleted
}

export const rockData = new Map<number, RockData>();

export interface OrePickupData {
  kind: 'ore';
  amount: number;
}

/** Parallel pickup map — engine PickupC is untouched. */
export const pickupData = new Map<number, OrePickupData>();

export const MINE_RANGE = 30;
export const MINE_PERIOD = 0.5; // 1 ore per 0.5s
export const RESPAWN_TIME = 60;
export const PICKUP_RADIUS = 7;
const DOCK_RANGE = 60;

interface MineState {
  acc: number;
  beam: THREE.Mesh;
  beamTarget: number; // rock id or -1
}

const _fwd = new THREE.Vector3();
const _toRock = new THREE.Vector3();
const _beamDir = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _beamQuat = new THREE.Quaternion();

export function createAsteroidField(ctx: SimCtx, count = 64): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 180 + Math.random() * 700;
    const radius = 4 + Math.random() * 10;
    const maxOre = Math.round(radius * 1.5);
    const id = ctx.world.spawn({
      [C.Transform]: {
        x: Math.cos(a) * r, y: (Math.random() - 0.5) * 260, z: Math.sin(a) * r,
        rx: Math.random() * 6.28, ry: Math.random() * 6.28, rz: 0,
        sx: 1, sy: 1, sz: 1,
      } as TransformC,
      [C.Renderable]: { mesh: 'prop', tint: 0xffffff, visible: true },
    });
    rockData.set(id, { ore: maxOre, maxOre, radius, respawn: 0 });
    attachMesh(ctx, id, createAsteroidMesh(radius, 1000 + i * 77));
  }
}

export function createStationEntity(ctx: SimCtx): number {
  const id = ctx.world.spawn({
    [C.Transform]: { x: 0, y: 0, z: -600, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } as TransformC,
    [C.Renderable]: { mesh: 'prop', tint: 0xffffff, visible: true },
  });
  attachMesh(ctx, id, createStation());
  ctx.state.stationId = id;
  return id;
}

export function spawnOrePickup(ctx: SimCtx, x: number, y: number, z: number, amount: number): number {
  const id = ctx.world.spawn({
    [C.Transform]: {
      x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    } as TransformC,
    [C.Velocity]: {
      x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4,
    } as VelocityC,
    // Engine PickupC kind stays 'health'; the real kind lives in pickupData.
    [C.Pickup]: { kind: 'health', amount: 0, taken: false } as PickupC,
    [C.Lifetime]: { t: 0, max: 90 } as LifetimeC,
    [C.Renderable]: { mesh: 'pickup', tint: 0xffffff, visible: true },
  });
  pickupData.set(id, { kind: 'ore', amount });
  attachMesh(ctx, id, createOrePickupMesh());
  return id;
}

function makeBeam(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.25, 0.25, 1, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: '#9fd8ff', transparent: true, opacity: 0.55, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  return m;
}

export function createAsteroidSystem(ctx: SimCtx): MineState {
  const st: MineState = { acc: 0, beam: makeBeam(), beamTarget: -1 };
  ctx.scene.add(st.beam);

  // kill hook: pirates drop ore pickups
  ctx.state.hooks.onEnemyKilled = (x, y, z) => {
    if (Math.random() < 0.6) spawnOrePickup(ctx, x, y, z, 1 + Math.floor(Math.random() * 3));
  };

  // dock hook: F within range docks
  ctx.state.hooks.requestDock = () => {
    const pid = ctx.state.playerShipId;
    const sid = ctx.state.stationId;
    const pt = ctx.world.get<TransformC>(pid, C.Transform);
    const st2 = ctx.world.get<TransformC>(sid, C.Transform);
    if (!pt || !st2) return;
    const d = Math.hypot(pt.x - st2.x, pt.y - st2.y, pt.z - st2.z);
    if (d < DOCK_RANGE) ctx.state.docked = true;
  };

  ctx.loop.on('update', (c) => {
    const dt = c.dt;
    const pid = ctx.state.playerShipId;
    const pt = ctx.world.get<TransformC>(pid, C.Transform);
    if (!pt) return;

    // ---- respawn depleted rocks ----
    for (const [id, rock] of rockData) {
      if (rock.respawn > 0) {
        rock.respawn -= dt;
        if (rock.respawn <= 0) {
          rock.ore = rock.maxOre;
          const m = ctx.meshes.get(id);
          if (m) {
            m.visible = true;
            m.scale.setScalar(1);
          }
        }
      }
    }

    // ---- mining ----
    let target = -1;
    if (ctx.input.isDown('mine') && !ctx.state.docked) {
      forwardFromEuler(pt.rx, pt.ry, _fwd);
      let best = MINE_RANGE;
      for (const [id, rock] of rockData) {
        if (rock.ore <= 0) continue;
        const rt = ctx.world.get<TransformC>(id, C.Transform);
        if (!rt) continue;
        _toRock.set(rt.x - pt.x, rt.y - pt.y, rt.z - pt.z);
        const d = _toRock.length();
        if (d < best && d > 1e-3) {
          _toRock.divideScalar(d);
          if (_fwd.dot(_toRock) > 0.5) {
            best = d;
            target = id;
          }
        }
      }
      if (target >= 0) {
        const rock = rockData.get(target)!;
        st.acc += dt;
        while (st.acc >= MINE_PERIOD - 1e-9) { // epsilon: 1/60 steps land on FP boundaries
          st.acc -= MINE_PERIOD;
          if (rock.ore > 0) {
            rock.ore -= 1;
            ctx.api.addOre(1);
            ctx.api.addQuestProgress('mine', 1);
            const m = ctx.meshes.get(target);
            if (m) {
              const k = rock.ore / rock.maxOre;
              m.scale.setScalar(0.35 + 0.65 * k);
              if (rock.ore === 0) {
                m.visible = false;
                rock.respawn = RESPAWN_TIME;
              }
            }
          }
        }
      } else {
        st.acc = 0;
      }
    } else {
      st.acc = 0;
    }
    st.beamTarget = target;

    // ---- ore pickup collection ----
    for (const id of ctx.world.query(C.Pickup, C.Transform)) {
      const pk = ctx.world.get<TransformC>(id, C.Transform);
      const life = ctx.world.get<LifetimeC>(id, C.Lifetime);
      const data = pickupData.get(id);
      if (!pk || !data) continue;
      if (life) {
        life.t += dt;
        if (life.t >= life.max) {
          pickupData.delete(id);
          despawnEntity(ctx, id);
          continue;
        }
      }
      const d2 =
        (pk.x - pt.x) * (pk.x - pt.x) +
        (pk.y - pt.y) * (pk.y - pt.y) +
        (pk.z - pt.z) * (pk.z - pt.z);
      if (d2 < PICKUP_RADIUS * PICKUP_RADIUS) {
        ctx.api.addOre(data.amount);
        pickupData.delete(id);
        despawnEntity(ctx, id);
      } else {
        // drift
        const vv = ctx.world.get<VelocityC>(id, C.Velocity);
        if (vv) {
          pk.x += vv.x * dt; pk.y += vv.y * dt; pk.z += vv.z * dt;
        }
      }
    }

    // spin pickups (visual only)
    for (const id of pickupData.keys()) {
      const m = ctx.meshes.get(id);
      if (m) m.rotation.y += dt * 2.2;
    }
  });

  return st;
}

/** Beam visual sync — call from postupdate. */
export function syncMiningBeam(ctx: SimCtx, st: MineState): void {
  const beam = st.beam;
  const pid = ctx.state.playerShipId;
  const pt = ctx.world.get<TransformC>(pid, C.Transform);
  const rt = st.beamTarget >= 0 ? ctx.world.get<TransformC>(st.beamTarget, C.Transform) : undefined;
  if (!pt || !rt) {
    beam.visible = false;
    return;
  }
  beam.visible = true;
  forwardFromEuler(pt.rx, pt.ry, _fwd);
  const sx = pt.x + _fwd.x * 4, sy = pt.y + _fwd.y * 4, sz = pt.z + _fwd.z * 4;
  _beamDir.set(rt.x - sx, rt.y - sy, rt.z - sz);
  const len = _beamDir.length();
  beam.position.set((sx + rt.x) / 2, (sy + rt.y) / 2, (sz + rt.z) / 2);
  _beamQuat.setFromUnitVectors(Y_AXIS, _beamDir.normalize());
  beam.quaternion.copy(_beamQuat);
  beam.scale.set(1, len, 1);
}
