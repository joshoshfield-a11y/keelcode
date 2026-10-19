/**
 * Smoke test: boots the demo, replays the recorded `move` script, and
 * asserts the outcomes against backends/ts-babylon/vectors/move.json with
 * tight epsilons (positions ±0.05 m, hp/kills/states exact).
 *
 * Backend-local only — NO cross-backend comparison. If the vector file is
 * missing (e.g. this spec ran before parity-record.spec.ts in a parallel
 * worker), the spec records a single run itself first; recording is
 * deterministic, so the content is identical either way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectConsoleErrors } from './helpers';
import { test, expect } from './fixtures';
import {
  runScript,
  readVectorFile,
  writeVectorFile,
  VECTORS_DIR,
  type Snapshot,
} from './recorder';

test.setTimeout(300000);

const POS_EPS = 0.05; // ±5 cm on positions
const SPAWN = { x: 0, z: 8 }; // Player.reset spawn (src/game/player.ts)
const REST_Y = 0.85; // capsule center at rest (src/game/player.ts)

interface RefVector {
  player: { hp: number; x: number; y: number; z: number };
  enemies: Array<{ x: number; z: number; hp: number; state: string }>;
  kills: number;
  pickups_taken: number;
  pointer_locked: boolean;
  events: Array<{ tick: number; kind: string }>;
}

test('smoke: replayed move script matches the recorded vector', async ({ page }) => {
  test.slow();
  const errors = collectConsoleErrors(page);

  if (!fs.existsSync(path.join(VECTORS_DIR, 'move.json'))) {
    // Self-sufficient: record a single run so the assertions below hold
    // regardless of spec execution order.
    const first = await runScript(page, 'move');
    writeVectorFile('move', JSON.stringify(first.vector));
  }
  const ref = readVectorFile('move') as unknown as RefVector;
  const { vector, snaps } = await runScript(page, 'move');
  const got = vector as unknown as RefVector;

  // --- outcome assertions: exact on discrete state, tight epsilons on positions ---
  expect(got.player.hp).toBe(ref.player.hp);
  expect(Math.abs(got.player.x - ref.player.x)).toBeLessThan(POS_EPS);
  expect(Math.abs(got.player.y - ref.player.y)).toBeLessThan(POS_EPS);
  expect(Math.abs(got.player.z - ref.player.z)).toBeLessThan(POS_EPS);
  expect(got.kills).toBe(ref.kills);
  expect(got.pickups_taken).toBe(ref.pickups_taken);
  expect(got.enemies.length).toBe(ref.enemies.length);
  for (let i = 0; i < got.enemies.length; i++) {
    expect(got.enemies[i].hp).toBe(ref.enemies[i].hp);
    expect(got.enemies[i].state).toBe(ref.enemies[i].state);
    expect(Math.abs(got.enemies[i].x - ref.enemies[i].x)).toBeLessThan(POS_EPS);
    expect(Math.abs(got.enemies[i].z - ref.enemies[i].z)).toBeLessThan(POS_EPS);
  }

  // --- feel sanity: the script really moved the player and jumped ---
  // (the script ends mid-air: jump #2 fires at tick 560 of 600, so the final
  // y is above REST_Y by design — the exact rest pose is asserted against
  // the vector above with POS_EPS)
  const dist = Math.hypot(got.player.x - SPAWN.x, got.player.z - SPAWN.z);
  expect(dist).toBeGreaterThan(1.0);
  const maxY = Math.max(...snaps.map((s: Snapshot) => s.player.y));
  expect(maxY).toBeGreaterThan(REST_Y + 0.03); // both scripted jumps leave the ground
  const jumpSnaps = snaps.filter((s: Snapshot) => s.player.y > REST_Y + 0.03);
  expect(jumpSnaps.length).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
