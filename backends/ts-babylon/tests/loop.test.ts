// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLoop } from '../src/engine/loop';

/**
 * GameLoop contract under test (src/engine/loop.ts):
 * - fixed 60 Hz sim steps via an accumulator; phases preupdate/update/postupdate/render
 * - spiral-of-death guards: 0.1 s frame clamp + max 5 catch-up steps/frame + shed log
 * - timeScale scales wall-clock into the accumulator, never the step size
 * - hitStop(ms) freezes the sim in real milliseconds while render keeps running
 * - step() is the manual test path: preupdate + one step, ignoring pause/timeScale
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('GameLoop', () => {
  it('step() N times advances tick by N, each step dt = 1/60', () => {
    const loop = createLoop();
    const dts: number[] = [];
    const ticks: number[] = [];
    loop.on('update', (ctx) => {
      dts.push(ctx.dt);
      ticks.push(ctx.tick);
    });

    for (let i = 0; i < 120; i++) loop.step();

    expect(loop.tick).toBe(120);
    expect(dts).toHaveLength(120);
    expect(dts.every((dt) => dt === 1 / 60)).toBe(true);
    expect(ticks).toEqual([...Array(120).keys()].map((i) => i + 1));
  });

  it('step() runs preupdate, then update, in order', () => {
    const loop = createLoop();
    const order: string[] = [];
    loop.on('preupdate', () => order.push('preupdate'));
    loop.on('update', () => order.push('update'));
    loop.on('postupdate', () => order.push('postupdate'));
    loop.step();
    expect(order).toEqual(['preupdate', 'update', 'postupdate']);
  });

  it('step() ignores pause and timeScale (manual test path)', () => {
    const loop = createLoop();
    const dts: number[] = [];
    loop.on('update', (ctx) => dts.push(ctx.dt));
    loop.paused = true;
    loop.timeScale = 0;

    loop.step();
    loop.step();
    loop.step();

    expect(loop.tick).toBe(3);
    expect(dts).toEqual([1 / 60, 1 / 60, 1 / 60]);
  });

  it('clamps huge dt: at most 5 catch-up steps per frame, sheds with a log', async () => {
    const loop = createLoop();
    let updates = 0;
    loop.on('update', () => {
      updates++;
    });

    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg?: unknown) => {
      warns.push(String(msg));
    };
    const origNow = performance.now;
    let calls = 0;
    (performance as unknown as { now: () => number }).now = () => {
      calls++;
      return calls === 1 ? 0 : 10_000; // start() sees 0; every frame sees a 10 s jump
    };

    try {
      loop.start();
      await sleep(150); // several 16 ms frames elapse in real time
      loop.stop();
    } finally {
      (performance as unknown as { now: () => number }).now = origNow;
      console.warn = origWarn;
    }

    // The 10 s jump clamps to 0.1 s -> exactly 5 steps, remainder shed, never 600.
    expect(updates).toBe(5);
    expect(warns.some((w) => w.includes('shed'))).toBe(true);
  });

  it('pause freezes the running sim; unpause resumes it', async () => {
    const loop = createLoop();
    let updates = 0;
    loop.on('update', () => {
      updates++;
    });

    loop.start();
    await sleep(60);
    expect(updates).toBeGreaterThan(0);

    loop.paused = true;
    const frozen = updates;
    await sleep(60);
    expect(updates).toBe(frozen); // not one step while paused

    loop.paused = false;
    await sleep(60);
    expect(updates).toBeGreaterThan(frozen);
    loop.stop();
  });

  it('timeScale 0 freezes the sim without pausing', async () => {
    const loop = createLoop();
    let updates = 0;
    loop.on('update', () => {
      updates++;
    });
    loop.timeScale = 0;

    loop.start();
    await sleep(80);
    loop.stop();

    expect(updates).toBe(0);
  });

  it('timeScale 0.5 roughly halves the step rate (step size untouched)', async () => {
    async function countUpdates(scale: number, ms: number): Promise<number> {
      const loop = createLoop();
      let n = 0;
      loop.on('update', () => {
        n++;
      });
      loop.timeScale = scale;
      loop.start();
      await sleep(ms);
      loop.stop();
      return n;
    }

    const full = await countUpdates(1, 200);
    const half = await countUpdates(0.5, 200);

    expect(full).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
  });

  it('hitStop(ms) freezes the sim in real ms while render keeps running', async () => {
    const loop = createLoop();
    let updates = 0;
    let renders = 0;
    loop.on('update', () => {
      updates++;
    });
    loop.on('render', () => {
      renders++;
    });

    loop.start();
    loop.hitStop(200);
    await sleep(100);
    expect(updates).toBe(0); // 100 ms < 200 ms: still frozen
    expect(renders).toBeGreaterThan(0); // ...but the render phase keeps running

    await sleep(200); // 300 ms total: the freeze has elapsed
    const resumed = updates;
    await sleep(80);
    expect(updates).toBeGreaterThan(resumed);
    loop.stop();
  });

  it('hitStop never shortens an already-longer freeze', async () => {
    const loop = createLoop();
    let updates = 0;
    loop.on('update', () => {
      updates++;
    });

    loop.start();
    loop.hitStop(300);
    loop.hitStop(50); // shorter: must not cut the 300 ms freeze
    await sleep(150);
    expect(updates).toBe(0);
    loop.stop();
  });
});
