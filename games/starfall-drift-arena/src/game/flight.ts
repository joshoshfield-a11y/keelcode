/** Flight system: arcade 6DOF-ish ship handling.
 *
 * Bindings (defined by main on the real InputSys; read here via InputLike):
 * - mouse (pointer lock) steers pitch/yaw — per-event look deltas are CLAMPED
 *   to ±0.25 rad (pointer-lock swing quirk: never feed a raw post-lock
 *   mousemove spike into the camera)
 * - W/S thrust axis, A/D strafe axis, Shift boost, click fire, E mine, F dock
 *
 * Manual kinematic integration (no Rapier bodies for ships).
 */

import * as THREE from 'three';
import { C, type TransformC, type VelocityC } from '../engine/ecs';
import { attachMesh, laserDamageOf, thrustOf, type SimCtx } from './api';
import { createPlayerShip } from '../gfx/spaceship';
import { fireLaser } from './projectiles';

const PITCH_LIMIT = 1.2;
export const LOOK_CLAMP = 0.25;
const DAMPING = 0.55; // /s, light space drag so the ship stays controllable
const FIRE_COOLDOWN = 0.16;
const LASER_SPEED = 170;

/** Clamp one pointer-lock look delta (radians) — the anti-swing guard. */
export function clampLookDelta(d: number): number {
  return Math.max(-LOOK_CLAMP, Math.min(LOOK_CLAMP, d));
}

/** Forward vector for euler (pitch=rx, yaw=ry), order YXZ, forward = -Z. */
export function forwardFromEuler(pitch: number, yaw: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  out.set(-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw));
  return out;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _acc = new THREE.Vector3();

export interface FlightState {
  fireCd: number;
}

/** Spawn the player ship entity; returns its id. */
export function spawnPlayerShip(ctx: SimCtx): number {
  const id = ctx.world.spawn({
    [C.Player]: {},
    [C.Input]: { controlled: true },
    [C.Transform]: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } as TransformC,
    [C.Velocity]: { x: 0, y: 0, z: 0 } as VelocityC,
    [C.Health]: { hp: 100, maxHp: 100 },
    [C.Collider]: { kind: 'sphere', hx: 3.2, hy: 3.2, hz: 3.2, static: false },
    [C.Renderable]: { mesh: 'player', tint: 0xffffff, visible: true },
  });
  attachMesh(ctx, id, createPlayerShip());
  return id;
}

export function createFlightSystem(ctx: SimCtx): FlightState {
  const st: FlightState = { fireCd: 0 };

  ctx.loop.on('update', (c) => {
    const dt = c.dt;
    const pid = ctx.state.playerShipId;
    const t = ctx.world.get<TransformC>(pid, C.Transform);
    const v = ctx.world.get<VelocityC>(pid, C.Velocity);
    if (!t || !v) return;

    // consume accumulated look deltas (already clamped per-event in main)
    t.ry += ctx.look.yaw;
    t.rx = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, t.rx + ctx.look.pitch));
    ctx.look.yaw = 0;
    ctx.look.pitch = 0;

    const docked = ctx.state.docked;
    const thrustAxis = docked ? 0 : ctx.input.axis('thrust');
    const strafeAxis = docked ? 0 : ctx.input.axis('strafe');

    // thrust input undocks
    if (docked && (thrustAxis !== 0 || strafeAxis !== 0)) {
      ctx.state.docked = false;
    }

    if (!ctx.state.docked) {
      forwardFromEuler(t.rx, t.ry, _fwd);
      _right.set(-_fwd.z, 0, _fwd.x).normalize(); // horizontal right of forward
      // if looking straight up/down, fall back to world X
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);

      const boost = ctx.input.isDown('boost') ? 2.2 : 1.0;
      const thrust = thrustOf(ctx.state) * boost;
      _acc.set(0, 0, 0)
        .addScaledVector(_fwd, thrustAxis * thrust)
        .addScaledVector(_right, strafeAxis * thrust * 0.8);

      v.x += _acc.x * dt;
      v.y += _acc.y * dt;
      v.z += _acc.z * dt;

      const damp = Math.exp(-DAMPING * dt);
      v.x *= damp; v.y *= damp; v.z *= damp;

      const maxSpeed = 42 * boost;
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > maxSpeed) {
        const k = maxSpeed / sp;
        v.x *= k; v.y *= k; v.z *= k;
      }

      // gentle banking into strafes
      const targetRoll = -strafeAxis * 0.28;
      t.rz += (targetRoll - t.rz) * Math.min(1, 8 * dt);
    } else {
      v.x = 0; v.y = 0; v.z = 0;
    }

    t.x += v.x * dt;
    t.y += v.y * dt;
    t.z += v.z * dt;

    // fire lasers
    st.fireCd -= dt;
    if (!ctx.state.docked && ctx.input.pressed('fire') && st.fireCd <= 0) {
      st.fireCd = FIRE_COOLDOWN;
      forwardFromEuler(t.rx, t.ry, _fwd);
      fireLaser(
        ctx,
        t.x + _fwd.x * 4, t.y + _fwd.y * 4, t.z + _fwd.z * 4,
        _fwd.x, _fwd.y, _fwd.z, LASER_SPEED,
        { damage: laserDamageOf(ctx.state), fromPlayer: true },
      );
    }

    // dock request key
    if (ctx.input.pressed('dock')) {
      ctx.state.hooks.requestDock?.();
    }
  });

  return st;
}
