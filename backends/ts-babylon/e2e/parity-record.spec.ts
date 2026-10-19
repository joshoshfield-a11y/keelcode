/**
 * Parity vector recorder (Wave 3, child C) for the ts-babylon backend.
 *
 * Records backend-local reference outcome vectors into
 * backends/ts-babylon/vectors/{move,combat}.json. The recording engine
 * lives in ./recorder.ts (same stop-rAF + synthetic-input + manual-step
 * technique as the ts-three recorder); this spec drives the double-run
 * determinism proof: each script is recorded TWICE (fresh page each) and
 * the vectors must be JSON-identical, or the spec fails.
 *
 * Backend-local only — NO cross-backend comparison (Havok ≠ Rapier;
 * determinism requirement dropped 2026-10-18; each backend passes its own
 * tests).
 */
import { test, expect } from './fixtures';
import { runScript, writeVectorFile } from './recorder';

// Batched recording is ~10x faster than per-tick evaluates, but the 900-tick
// combat script x2 runs still needs headroom on software GL.
test.setTimeout(600000);

for (const name of ['move', 'combat']) {
  test(`parity-record ${name}: two runs, identical vectors`, async ({ page }) => {
    test.slow(); // 900 ticks x evaluate round-trips needs the 3x budget
    const a = await runScript(page, name);
    const b = await runScript(page, name);
    const sa = JSON.stringify(a.vector);
    const sb = JSON.stringify(b.vector);
    expect(sb).toBe(sa); // determinism proof: the double-run diff must be empty
    writeVectorFile(name, sa);
    // Surface the pointer-lock result in the test output.
    console.log(`[parity-record] ${name}: pointerLocked=${a.pointerLocked}`);
  });
}
