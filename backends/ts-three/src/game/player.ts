/** Third-person player controller on the engine APIs.
 *  Camera-relative movement via input axes, mouse look (pointer lock on
 *  canvas click, drag fallback), Space jump (coyote 0.1s + buffer), Shift
 *  sprint. The Rapier dynamic capsule carries position/collisions; this
 *  system owns feel and writes velocity each tick. Camera follow with
 *  smoothing, collision-avoidance raycast, sprint FOV kick, landing dip. */

import * as THREE from 'three';
import { C, World } from '../engine/ecs';
import type { InputSys } from '../engine/input';
import type { PhysicsSys } from '../engine/physics';
import type { AudioSys } from '../engine/audio';
import { buildPlayerMesh } from '../gfx/character';
import type { Mats } from '../gfx/materials';
import type { ArenaData } from './arena';
import { makeTransform, writePos, makeHealth, getHp, setHp, TransformFull, HealthFull } from './sim';

const WALK = 5.2;
const SPRINT = 7.8;
const JUMP_VEL = 4.9;      // Rapier gravity -9.81 -> ~1.2m apex
const COYOTE = 0.1;
const BUFFER = 0.12;
const REST_Y = 0.85;       // capsule center at rest (hy 0.5 + hx 0.35)
const CAM_DIST = 4.6;
const CAM_HEIGHT = 1.7;
const LOOK_SENS = 0.0026;
const FOV_BASE = 60;
const FOV_SPRINT = 69;

const _fwd = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };

export function isTouchDevice(): boolean {
  return (typeof window !== 'undefined') &&
    (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
}

/** Pointer lock that never produces an unhandled rejection (e2e zero-error gate). */
export function requestPointerLock(canvas: HTMLCanvasElement): void {
  try {
    const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (r && typeof r.catch === 'function') r.catch(() => { /* lock unavailable */ });
  } catch {
    /* lock unavailable */
  }
}

export class Player {
  readonly id: number;
  /** Set by main when UI buttons are clicked; edges ignored until then. */
  suppressUntil = 0;
  onFire: (fx: number, fy: number, fz: number, dx: number, dy: number, dz: number) => void = () => {};
  onLand: () => void = () => {};
  onHurt: (hp: number) => void = () => {};
  onDie: () => void = () => {};

  private bodyId = -1;
  private yaw = Math.PI;
  private pitch = -0.18;
  private coyote = 0;
  private buffer = 0;
  private fireCd = 0;
  private fov = FOV_BASE;
  private dip = 0;
  private wasGrounded = true;
  private vx = 0;
  private vz = 0;
  private dragging = false;
  private lastPX = 0;
  private lastPY = 0;
  /** Set on pointer-lock acquisition; the next locked mousemove is the
   *  Chromium acquisition burst and is discarded (ADR-0016). */
  private swallowLockBurst = false;
  private node: THREE.Group;
  private isTouch = false;

  constructor(
    private world: World,
    private input: InputSys,
    private physics: PhysicsSys,
    private audio: AudioSys,
    scene: THREE.Scene,
    mats: Mats,
    private camera: THREE.PerspectiveCamera,
    private arena: ArenaData,
    private canvas: HTMLCanvasElement,
  ) {
    this.isTouch = isTouchDevice();
    this.id = world.spawn({
      [C.Transform]: makeTransform(0, 0, 8, Math.PI),
      [C.Velocity]: { x: 0, y: 0, z: 0 },
      [C.Health]: makeHealth(100, 100),
      [C.Collider]: { kind: 'capsule', hx: 0.35, hy: 0.5, hz: 0, static: false },
      [C.Player]: {},
      [C.Input]: { controlled: true },
      [C.Renderable]: { mesh: 'player', tint: 0xffffff, visible: true },
    });
    this.bodyId = physics.addBody({ kind: 'capsule', hx: 0.35, hy: 0.5, hz: 0, x: 0, y: REST_Y, z: 8, static: false });
    this.node = buildPlayerMesh(mats);
    scene.add(this.node);
    this.attachLook();
  }

  get hp(): number {
    const h = this.world.get<HealthFull>(this.id, C.Health);
    return h ? getHp(h) : 0;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  damage(amount: number): void {
    const h = this.world.get<HealthFull>(this.id, C.Health);
    if (!h || getHp(h) <= 0) return;
    const v = Math.max(0, getHp(h) - amount);
    setHp(h, v);
    this.audio.play('hurt');
    this.onHurt(v);
    if (v <= 0) this.onDie();
  }

  heal(amount: number): void {
    const h = this.world.get<HealthFull>(this.id, C.Health);
    if (!h) return;
    setHp(h, Math.min(h.maxHp, getHp(h) + amount));
  }

  reset(x: number, z: number): void {
    const t = this.world.get<TransformFull>(this.id, C.Transform);
    const h = this.world.get<HealthFull>(this.id, C.Health);
    if (t) writePos(t, x, REST_Y, z);
    if (h) setHp(h, h.maxHp);
    if (this.bodyId >= 0) {
      this.physics.setKinematicPosition(this.bodyId, x, REST_Y, z);
      this.physics.setVelocity(this.bodyId, 0, 0, 0);
    }
    this.vx = 0; this.vz = 0;
    this.yaw = Math.PI; this.pitch = -0.18;
  }

  /** External look input (touch drag). */
  addLook(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SENS;
    this.pitch -= dy * LOOK_SENS;
    this.pitch = Math.max(-1.1, Math.min(0.45, this.pitch));
  }

  private attachLook(): void {
    this.canvas.addEventListener('click', () => {
      if (!this.isTouch && document.pointerLockElement !== this.canvas) {
        requestPointerLock(this.canvas);
      }
    });
    // Pointer-lock acquisition burst (ADR-0016; supersedes the ADR-0009
    // carry-over): on lock, Chromium dispatches a mousemove whose
    // movementX/Y are the negated pre-lock cursor position. Fed into
    // addLook() it swings the camera ~90° before tick 0, so the first
    // mousemove after each lock acquisition is discarded. Only that one
    // event is dropped — legitimate look input, fast flicks included,
    // is never clamped or altered.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        this.swallowLockBurst = true;
      }
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement === this.canvas) {
        if (this.swallowLockBurst) {
          this.swallowLockBurst = false;
          return;
        }
        this.addLook(e.movementX, e.movementY);
      } else if (this.dragging) {
        this.addLook((e.clientX - this.lastPX) * 1.6, (e.clientY - this.lastPY) * 1.6);
        this.lastPX = e.clientX; this.lastPY = e.clientY;
      }
    });
    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0 && document.pointerLockElement !== this.canvas && !this.isTouch) {
        this.dragging = true;
        this.lastPX = e.clientX; this.lastPY = e.clientY;
      }
    });
    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.dragging = false;
    });
  }

  /** Update phase: movement intent + jump + fire. Physics steps after. */
  update(dt: number): void {
    if (!this.alive || this.bodyId < 0) return;
    const t = this.world.get<TransformFull>(this.id, C.Transform);
    if (!t) return;
    this.physics.getPosition(this.bodyId, _p);
    writePos(t, _p.x, _p.y, _p.z);
    const grounded = _p.y <= REST_Y + 0.07;
    const uiBlocked = performance.now() < this.suppressUntil;

    // wish direction, camera-relative
    const mx = this.input.axis('moveX');
    const mz = this.input.axis('moveY');
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    _wish.set(mx * cy - mz * sy, 0, -mx * sy - mz * cy);
    if (_wish.lengthSq() > 1) _wish.normalize();
    const sprinting = this.input.isDown('sprint') && mz > 0.1;
    const speed = sprinting ? SPRINT : WALK;
    _wish.multiplyScalar(speed);

    // smooth horizontal velocity toward wish (arcade accel)
    const k = Math.min(1, (grounded ? 14 : 5) * dt);
    this.vx += (_wish.x - this.vx) * k;
    this.vz += (_wish.z - this.vz) * k;

    // coyote + jump buffer
    if (grounded) this.coyote = COYOTE; else this.coyote -= dt;
    if (!uiBlocked && this.input.pressed('jump')) this.buffer = BUFFER; else this.buffer -= dt;
    let vy = 0;
    if (this.buffer > 0 && this.coyote > 0) {
      vy = JUMP_VEL;
      this.buffer = 0; this.coyote = 0;
      this.audio.play('jump');
    }
    this.physics.setVelocity(this.bodyId, this.vx, vy, this.vz);

    // landing
    if (!this.wasGrounded && grounded) {
      this.dip = 0.14;
      this.audio.play('ui', { volume: 0.4 });
      this.onLand();
    }
    this.wasGrounded = grounded;

    // face movement direction
    if (mx !== 0 || mz !== 0) {
      t.ry = Math.atan2(_wish.x, _wish.z);
    }

    // fire (only when pointer locked on desktop, or touch)
    const canFire = this.isTouch || document.pointerLockElement === this.canvas;
    this.fireCd -= dt;
    if (!uiBlocked && canFire && this.fireCd <= 0 &&
        (this.input.pressed('fire') || this.input.isDown('fire'))) {
      this.fireCd = 0.18;
      _fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.onFire(t.x, t.y + 1.5, t.z, _fwd.x, _fwd.y, _fwd.z);
      this.audio.play('shoot');
    }

    // sprint FOV kick
    const targetFov = sprinting && (mx !== 0 || mz !== 0) ? FOV_SPRINT : FOV_BASE;
    this.fov += (targetFov - this.fov) * Math.min(1, 6 * dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // render mapping
    this.node.position.set(t.x, t.y, t.z);
    this.node.rotation.y = t.ry;
  }

  /** Postupdate: smoothed follow camera with collision-avoidance raycast. */
  updateCamera(dt: number): void {
    const t = this.world.get<TransformFull>(this.id, C.Transform);
    if (!t) return;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);

    _target.set(t.x, t.y + CAM_HEIGHT, t.z);
    _dir.set(sy * cp, -sp, cy * cp); // from target toward camera
    let dist = CAM_DIST;
    const hit = this.arena.raycast(_target.x, _target.y, _target.z, _dir.x, _dir.y, _dir.z, CAM_DIST);
    if (hit < dist) dist = Math.max(0.6, hit - 0.25);

    _camPos.set(
      _target.x + _dir.x * dist,
      _target.y + _dir.y * dist,
      _target.z + _dir.z * dist,
    );
    this.dip = Math.max(0, this.dip - dt * 0.9);
    _camPos.y -= this.dip;

    const kk = 1 - Math.exp(-14 * dt);
    this.camera.position.lerp(_camPos, kk);
    this.camera.lookAt(_target);
  }

  /** Snap camera behind player (spawn / load). */
  snapCamera(): void {
    const t = this.world.get<TransformFull>(this.id, C.Transform);
    if (!t) return;
    _target.set(t.x, t.y + CAM_HEIGHT, t.z);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      _target.x + Math.sin(this.yaw) * cp * CAM_DIST,
      _target.y - Math.sin(this.pitch) * CAM_DIST,
      _target.z + Math.cos(this.yaw) * cp * CAM_DIST,
    );
    this.camera.lookAt(_target);
  }
}
