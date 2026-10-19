// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { C, createWorld, type World } from '../src/engine/ecs';

/**
 * ECS contract under test (src/engine/ecs.ts):
 * - spawn takes initial components and queues the entity; ids are numbers
 * - despawn is queued and applied at phase end (flush, or implicitly by query/count)
 * - query() returns a snapshot array, so despawning mid-iteration is safe
 * - component names come from the C constant
 */

const transform = (x = 0, y = 0, z = 0) => ({ x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
const health = (hp: number, maxHp: number) => ({ hp, maxHp });

describe('World (ECS)', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld();
  });

  it('spawns entities with unique numeric ids', () => {
    const a = world.spawn({ [C.Health]: health(10, 10) });
    const b = world.spawn({ [C.Health]: health(10, 10) });
    expect(typeof a).toBe('number');
    expect(b).not.toBe(a);
    expect(world.has(a, C.Health)).toBe(true);
  });

  it('spawned components are readable immediately (pending spawns are visible)', () => {
    const id = world.spawn({ [C.Transform]: transform(1, 2, 3), [C.Health]: health(40, 100) });
    expect(world.get(id, C.Transform)).toEqual(transform(1, 2, 3));
    expect(world.get(id, C.Health)).toEqual(health(40, 100));
  });

  it('get() returns undefined for missing components instead of throwing', () => {
    const id = world.spawn({});
    expect(world.get(id, C.Health)).toBeUndefined();
    expect(world.get(id, 'NoSuchComponent')).toBeUndefined();
  });

  it('set() writes and overwrites component data', () => {
    const id = world.spawn({ [C.Health]: health(100, 100) });
    world.set(id, C.Health, health(40, 100));
    expect(world.get(id, C.Health)).toEqual(health(40, 100));
  });

  it('query() returns entities having ALL listed components', () => {
    const a = world.spawn({ [C.Transform]: transform(), [C.Health]: health(10, 10) });
    const b = world.spawn({ [C.Transform]: transform() });
    const c = world.spawn({ [C.Health]: health(10, 10) });

    expect(world.query(C.Transform, C.Health)).toEqual([a]);
    expect(world.query(C.Transform)).toEqual([a, b]);
    expect(world.query(C.Health)).toEqual([a, c]);
  });

  it('despawn() is queued: the entity reads dead immediately, leaves on flush', () => {
    const id = world.spawn({ [C.Transform]: transform(), [C.Health]: health(5, 10) });
    world.query(C.Health); // apply the pending spawn

    world.despawn(id);
    expect(world.get(id, C.Transform)).toBeUndefined();
    expect(world.has(id, C.Health)).toBe(false);
    expect(world.query(C.Transform)).not.toContain(id); // query() applies the queue
    expect(world.count()).toBe(0);
  });

  it('despawn() is idempotent and safe on unknown ids', () => {
    const id = world.spawn({ [C.Health]: health(10, 10) });
    world.despawn(id);
    expect(() => world.despawn(id)).not.toThrow();
    expect(() => world.despawn(999_999)).not.toThrow();
    world.flush();
    expect(world.count()).toBe(0);
  });

  it('set() on a despawn-queued entity is ignored, not resurrected', () => {
    const id = world.spawn({ [C.Health]: health(10, 10) });
    world.despawn(id);
    world.set(id, C.Health, health(99, 99));
    world.flush();
    expect(world.get(id, C.Health)).toBeUndefined();
    expect(world.count()).toBe(0);
  });

  it('despawning every query result mid-iteration is safe', () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(world.spawn({ [C.Health]: health(10, 10) }));
    }

    for (const id of world.query(C.Health)) world.despawn(id);

    expect(world.query(C.Health)).toEqual([]);
    expect(world.count()).toBe(0);
  });

  it('despawning one entity mid-iteration does not skip its neighbors', () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(world.spawn({ [C.Health]: health(10, 10) }));
    }

    const visited: number[] = [];
    for (const id of world.query(C.Health)) {
      visited.push(id);
      if (id === ids[1] || id === ids[3]) world.despawn(id);
    }

    expect(visited).toEqual(ids); // snapshot: all five visited exactly once
    expect(world.query(C.Health)).toEqual([ids[0], ids[2], ids[4]]);
  });

  it('spawning mid-iteration does not corrupt the in-flight snapshot', () => {
    for (let i = 0; i < 3; i++) world.spawn({ [C.Health]: health(10, 10) });

    const visited: number[] = [];
    for (const id of world.query(C.Health)) {
      visited.push(id);
      world.spawn({ [C.Health]: health(10, 10) }); // queued, applied at next query
    }

    expect(visited).toHaveLength(3);
    expect(world.query(C.Health)).toHaveLength(6);
  });

  it('flush() applies queued spawns explicitly', () => {
    world.spawn({ [C.Health]: health(1, 1) });
    world.spawn({ [C.Health]: health(2, 2) });
    world.flush();
    expect(world.count()).toBe(2);
    expect(world.query(C.Health)).toHaveLength(2);
  });
});
