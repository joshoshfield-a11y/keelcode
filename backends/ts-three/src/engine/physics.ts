/**
 * Physics integration layer over Rapier (`@dimforge/rapier3d-compat`).
 *
 * Owning knowledge: KB `core/05-physics.md` and the `local-physics-integration`
 * skill. Backend choice, one line: Rapier — determinism-friendly and actively
 * developed; the compat bundle imports cleanly into this toolchain, so the
 * cannon-es fallback the contract allows was not needed.
 *
 * Integration rules followed:
 * - The world steps at the sim's fixed dt (the loop calls `step(dt)` from a
 *   fixed-step phase), never at frame dt.
 * - Characters are NOT full dynamic bodies here: `setKinematicPosition`
 *   teleports the body, because the character solver above this layer owns
 *   feel (coyote time, buffering, air control) and the body only carries
 *   position + collision response.
 * - Shape mapping: box -> cuboid(hx,hy,hz); sphere -> ball(hx as radius);
 *   capsule -> capsule(hy as half-height, hx as radius).
 *
 * `ready` resolves once RAPIER.init() completes; calls before that are safe
 * no-ops (`addBody` returns -1 when the world isn't up yet).
 */

import RAPIER from '@dimforge/rapier3d-compat';

export interface BodyOpts {
  kind: 'box' | 'sphere' | 'capsule';
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  static: boolean;
}

export interface PhysicsSys {
  ready: Promise<void>;
  step(dt: number): void;
  addBody(o: BodyOpts): number;
  remove(id: number): void;
  getPosition(id: number, out: { x: number; y: number; z: number }): void;
  setVelocity(id: number, x: number, y: number, z: number): void;
  /** Teleport-style kinematic move; the controller above owns the feel. */
  setKinematicPosition(id: number, x: number, y: number, z: number): void;
}

const GRAVITY = { x: 0, y: -9.81, z: 0 };

export function createPhysics(): PhysicsSys {
  let world: RAPIER.World | null = null;
  let nextId = 1;
  const bodies = new Map<number, RAPIER.RigidBody>();

  const ready: Promise<void> = RAPIER.init().then(() => {
    world = new RAPIER.World(GRAVITY);
  });

  return {
    ready,

    step(dt: number): void {
      if (!world) return;
      world.timestep = dt;
      world.step();
    },

    addBody(o: BodyOpts): number {
      if (!world) return -1;
      const desc = o.static
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic();
      desc.setTranslation(o.x, o.y, o.z);
      const body = world.createRigidBody(desc);

      let collider: RAPIER.ColliderDesc;
      if (o.kind === 'box') {
        collider = RAPIER.ColliderDesc.cuboid(o.hx, o.hy, o.hz);
      } else if (o.kind === 'sphere') {
        collider = RAPIER.ColliderDesc.ball(Math.max(o.hx, 0.001));
      } else {
        collider = RAPIER.ColliderDesc.capsule(
          Math.max(o.hy, 0),
          Math.max(o.hx, 0.001),
        );
      }
      world.createCollider(collider, body);

      const id = nextId++;
      bodies.set(id, body);
      return id;
    },

    remove(id: number): void {
      const body = bodies.get(id);
      if (body && world) world.removeRigidBody(body);
      bodies.delete(id);
    },

    getPosition(id: number, out: { x: number; y: number; z: number }): void {
      const body = bodies.get(id);
      if (!body) return;
      const t = body.translation();
      out.x = t.x;
      out.y = t.y;
      out.z = t.z;
    },

    setVelocity(id: number, x: number, y: number, z: number): void {
      const body = bodies.get(id);
      if (body) body.setLinvel({ x, y, z }, true);
    },

    setKinematicPosition(id: number, x: number, y: number, z: number): void {
      const body = bodies.get(id);
      if (body) body.setTranslation({ x, y, z }, true);
    },
  };
}
