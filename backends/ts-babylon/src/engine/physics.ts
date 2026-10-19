/**
 * Physics integration layer over Havok (`@babylonjs/havok`, pinned 1.3.14).
 *
 * Owning knowledge: KB `core/05-physics.md` and the `local-physics-integration`
 * skill. Backend choice, one line: Havok — MIT-licensed WASM with a fixed
 * 1/60 step mode that matches the spec's sim tick, and Babylon's officially
 * supported physics plugin for this backend.
 *
 * Integration rules followed:
 * - The world steps at the sim's fixed dt (the loop calls `step(dt)` from a
 *   fixed-step phase), never at frame dt. The plugin is constructed with
 *   `useDeltaForWorldStep = false`, so every step advances exactly its
 *   internal fixed 1/60 step regardless of the dt passed in.
 * - Driver-owned stepping: `scene.physicsEnabled` is set to `false` right
 *   after `enablePhysics`, so `scene.render()` never advances Havok on its
 *   own. This is a supported mechanism, not a hack: Scene.render gates the
 *   physics step on `scene.physicsEnabled`, and the joined physics-engine
 *   component only routes through the plugin when the flag is true
 *   (verified in @babylonjs/core 9.31.0 source). `step(dt)` calls the public
 *   `plugin.executeStep(dt, bodies)` entry point directly.
 * - Characters are NOT full dynamic bodies here: non-static bodies are
 *   `PhysicsMotionType.ANIMATED` (the kinematic analog — never pushed by
 *   other bodies, still push dynamics out of the way). Note the Havok
 *   consequence: gravity is NOT applied to ANIMATED bodies, so vertical
 *   motion is fully owned by the controller above this layer (setVelocity
 *   each tick) — same ownership as the Rapier backend's teleport-driven
 *   character model, different mechanism.
 * - `setKinematicPosition` is teleport-style: it writes the target into the
 *   body's private dummy TransformNode. The body's prestep type is TELEPORT,
 *   so the next `executeStep` pre-step applies the node's transform to the
 *   body via a hard QTransform set (not a velocity). The teleport lands at
 *   the next `step(dt)` — one fixed tick, which is where the sim reads
 *   positions anyway.
 * - Shape mapping: box -> PhysicsShapeBox with FULL extents (2*hx, 2*hy,
 *   2*hz); sphere -> PhysicsShapeSphere(hx as radius); capsule ->
 *   PhysicsShapeCapsule((0,-hy,0), (0,+hy,0), hx as radius).
 * - Each body is attached to a private dummy TransformNode (never rendered);
 *   the plugin syncs body -> node after every step, and `getPosition` reads
 *   the node.
 *
 * `ready` resolves once the Havok WASM boots and the plugin + world exist;
 * calls before that are safe no-ops (`addBody` returns -1 when the world
 * isn't up yet).
 */

import {
  HavokPlugin,
  NullEngine,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsPrestepType,
  PhysicsShape,
  PhysicsShapeBox,
  PhysicsShapeCapsule,
  PhysicsShapeSphere,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
// Side effect: registers Scene.enablePhysics / the joined physics engine
// component. Not in the root barrel, so it is imported explicitly.
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import HavokPhysics from '@babylonjs/havok';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

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

const GRAVITY = new Vector3(0, -9.81, 0);

// Module-scope scratch: reused every setVelocity so the driver allocates
// nothing on the sim hot path.
const velScratch = new Vector3(0, 0, 0);

interface BodyEntry {
  body: PhysicsBody;
  node: TransformNode;
}

export function createPhysics(): PhysicsSys {
  let plugin: HavokPlugin | null = null;
  let scene: Scene | null = null;
  let nextId = 1;
  const entries = new Map<number, BodyEntry>();
  const bodyList: PhysicsBody[] = [];

  const ready: Promise<void> = (async () => {
    const hk = await HavokPhysics({ locateFile: () => havokWasmUrl });
    plugin = new HavokPlugin(false, hk);
    // Headless scene: the driver owns the physics world; nothing here is
    // ever rendered. NullEngine keeps the driver free of any canvas.
    const engine = new NullEngine();
    scene = new Scene(engine);
    scene.enablePhysics(GRAVITY, plugin);
    // Driver-owned stepping (see header): the sim advances Havok only via
    // step(dt) below. render() must never move bodies on its own.
    scene.physicsEnabled = false;
  })();

  function makeShape(o: BodyOpts): PhysicsShape {
    const s = scene as Scene;
    if (o.kind === 'box') {
      // PhysicsShapeBox takes FULL extents, unlike Rapier's cuboid halves.
      return new PhysicsShapeBox(
        Vector3.Zero(),
        Quaternion.Identity(),
        new Vector3(o.hx * 2, o.hy * 2, o.hz * 2),
        s,
      );
    }
    if (o.kind === 'sphere') {
      return new PhysicsShapeSphere(Vector3.Zero(), Math.max(o.hx, 0.001), s);
    }
    return new PhysicsShapeCapsule(
      new Vector3(0, -Math.max(o.hy, 0), 0),
      new Vector3(0, Math.max(o.hy, 0), 0),
      Math.max(o.hx, 0.001),
      s,
    );
  }

  const sys: PhysicsSys = {
    ready,

    step(dt: number): void {
      if (!plugin) return;
      // With useDeltaForWorldStep=false the plugin steps its fixed 1/60
      // internally; dt is passed through for the API but does not change
      // the step size. The sim always calls step(1/60).
      plugin.executeStep(dt, bodyList);
    },

    addBody(o: BodyOpts): number {
      if (!plugin || !scene) return -1;
      const id = nextId++;
      const node = new TransformNode(`keel-body-${id}`, scene);
      node.position.set(o.x, o.y, o.z);
      node.rotationQuaternion = Quaternion.Identity();
      const body = new PhysicsBody(
        node,
        o.static ? PhysicsMotionType.STATIC : PhysicsMotionType.ANIMATED,
        false,
        scene,
      );
      body.shape = makeShape(o);
      // Teleport prestep: setKinematicPosition writes the node; the next
      // step's pre-step applies it to the body as a hard transform set.
      body.setPrestepType(PhysicsPrestepType.TELEPORT);
      entries.set(id, { body, node });
      bodyList.push(body);
      return id;
    },

    remove(id: number): void {
      const entry = entries.get(id);
      if (!entry) return;
      entries.delete(id);
      const idx = bodyList.indexOf(entry.body);
      if (idx >= 0) bodyList.splice(idx, 1);
      entry.body.dispose();
      entry.node.dispose();
    },

    getPosition(id: number, out: { x: number; y: number; z: number }): void {
      const entry = entries.get(id);
      if (!entry) return;
      const p = entry.node.position;
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
    },

    setVelocity(id: number, x: number, y: number, z: number): void {
      const entry = entries.get(id);
      if (entry) entry.body.setLinearVelocity(velScratch.set(x, y, z));
    },

    setKinematicPosition(id: number, x: number, y: number, z: number): void {
      const entry = entries.get(id);
      if (entry) entry.node.position.set(x, y, z);
    },
  };

  // Probe hook (NOT part of the PhysicsSys contract): exposes the internal
  // Babylon scene so tests can call scene.render() and verify it never
  // advances Havok on its own. Invisible to the typed API surface.
  (sys as unknown as Record<string, unknown>).__scene = () => scene;

  return sys;
}
