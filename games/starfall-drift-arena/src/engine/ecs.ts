/**
 * ECS-lite: entity ids plus per-component data maps.
 *
 * Owning knowledge: ENGINE-ARCHITECTURE.md §1.3 (entity/component model
 * mapping — the TS backend keeps entity ids + component data for the sim and
 * maps onto scene-graph nodes for rendering) and the engine-core-loop skill's
 * rule that spawning/destroying mid-iteration must queue for phase end, so
 * behavior never depends on mutation order inside a loop.
 *
 * Hot-path rule: `query()` returns a fresh id array (a snapshot), so systems
 * may spawn/despawn while iterating it safely. Pending ops are applied at
 * phase end via `flush()` — called automatically at the start of `query()`
 * and `count()`, or explicitly by the loop's phase boundary.
 */

export const C = {
  Transform: 'Transform',
  Velocity: 'Velocity',
  Health: 'Health',
  Collider: 'Collider',
  Renderable: 'Renderable',
  Input: 'Input',
  AI: 'AI',
  Lifetime: 'Lifetime',
  Pickup: 'Pickup',
  Projectile: 'Projectile',
  Player: 'Player',
  Enemy: 'Enemy',
} as const;

export interface TransformC {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
}
export interface VelocityC { x: number; y: number; z: number }
export interface HealthC { hp: number; maxHp: number }
export interface ColliderC {
  kind: 'box' | 'sphere' | 'capsule';
  hx: number; hy: number; hz: number;
  static: boolean;
}
export interface RenderableC {
  mesh: 'player' | 'enemy' | 'projectile' | 'pickup' | 'prop';
  tint: number;
  visible: boolean;
}
export interface InputC { controlled: boolean }
export interface AIC { brain: 'chaser'; state: string; t: number; target: number }
export interface LifetimeC { t: number; max: number }
export interface PickupC { kind: 'health'; amount: number; taken: boolean }
export interface ProjectileC { damage: number; fromPlayer: boolean }

export interface World {
  spawn(comps: Record<string, unknown>): number;
  despawn(id: number): void;
  get<T>(id: number, name: string): T | undefined;
  set(id: number, name: string, data: unknown): void;
  has(id: number, name: string): boolean;
  query(...names: string[]): number[];
  count(): number;
  /** Apply queued spawn/despawn ops. Additive to the contract: the phase-end hook. */
  flush(): void;
}

export function createWorld(): World {
  let nextId = 1;
  const store = new Map<number, Map<string, unknown>>();
  const spawnQueue = new Map<number, Record<string, unknown>>();
  const despawnQueue = new Set<number>();

  function applyPending(): void {
    if (despawnQueue.size > 0) {
      for (const id of despawnQueue) {
        store.delete(id);
        spawnQueue.delete(id);
      }
      despawnQueue.clear();
    }
    if (spawnQueue.size > 0) {
      for (const [id, comps] of spawnQueue) {
        store.set(id, new Map(Object.entries(comps)));
      }
      spawnQueue.clear();
    }
  }

  function committed(id: number): Map<string, unknown> | undefined {
    if (despawnQueue.has(id)) return undefined;
    return store.get(id);
  }

  return {
    spawn(comps: Record<string, unknown>): number {
      const id = nextId++;
      spawnQueue.set(id, { ...comps });
      return id;
    },

    despawn(id: number): void {
      despawnQueue.add(id);
    },

    get<T>(id: number, name: string): T | undefined {
      if (despawnQueue.has(id)) return undefined;
      const pending = spawnQueue.get(id);
      if (pending) return pending[name] as T | undefined;
      return committed(id)?.get(name) as T | undefined;
    },

    set(id: number, name: string, data: unknown): void {
      if (despawnQueue.has(id)) return;
      const pending = spawnQueue.get(id);
      if (pending) {
        pending[name] = data;
        return;
      }
      committed(id)?.set(name, data);
    },

    has(id: number, name: string): boolean {
      if (despawnQueue.has(id)) return false;
      const pending = spawnQueue.get(id);
      if (pending) return name in pending;
      return committed(id)?.has(name) ?? false;
    },

    query(...names: string[]): number[] {
      applyPending();
      const out: number[] = [];
      for (const [id, comps] of store) {
        let ok = true;
        for (const n of names) {
          if (!comps.has(n)) {
            ok = false;
            break;
          }
        }
        if (ok) out.push(id);
      }
      return out;
    },

    count(): number {
      applyPending();
      return store.size;
    },

    flush(): void {
      applyPending();
    },
  };
}
