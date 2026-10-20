/**
 * Fixed-timestep core loop with named scheduler phases.
 *
 * Owning knowledge: KB `core/03-game-loop.md` and the `local-engine-core-loop`
 * skill. Sim ticks at a fixed 60 Hz via an accumulator; render interpolates
 * between ticks (alpha = accumulator / STEP) and never drives simulation.
 *
 * Guards (all mandatory per the KB):
 * - frameTime clamped at 0.1 s: a hitch sheds sim time instead of spiraling.
 * - max 5 catch-up steps per frame: beyond that the sim sheds load and logs
 *   the shed (slow-motion under load beats a lockup).
 * - timeScale scales how much wall time enters the accumulator, never the
 *   step size: every sim step is still exactly 1/60.
 * - hitStop freezes the sim for N ms while the render phase keeps running,
 *   so particles/screenshake continue during the freeze.
 *
 * Phase order per frame: preupdate (input snapshot, once) -> N sim steps of
 * (update, postupdate) -> render. `step()` runs one full logical frame
 * (preupdate + one step) for tests; it ignores pause/timeScale.
 *
 * The single FrameCtx object is reused across phases (no per-frame alloc);
 * handlers must not retain it.
 */

export type Phase = 'preupdate' | 'update' | 'postupdate' | 'render';

export interface FrameCtx {
  /** Sim step dt (1/60) during sim phases; real frame dt during render. */
  dt: number;
  /** Monotonic sim tick. */
  tick: number;
  /** Render interpolation factor, 0..1 (accumulator / STEP). */
  alpha: number;
  /** Current time scale. */
  timeScale: number;
}

export interface Loop {
  on(phase: Phase, fn: (ctx: FrameCtx) => void): void;
  start(): void;
  stop(): void;
  /** Manual single step for tests (default 1/60). Runs preupdate + one step. */
  step(dt?: number): void;
  readonly tick: number;
  timeScale: number;
  paused: boolean;
  setTimeScale(x: number): void;
  setPaused(b: boolean): void;
  /** Freeze the sim for ms milliseconds; render keeps running. */
  hitStop(ms: number): void;
}

const STEP = 1 / 60;
const MAX_STEPS = 5;
const MAX_FRAME = 0.1;

// rAF with a setInterval fallback so headless/node harnesses can still start().
function nextFrame(cb: (t: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

export function createLoop(): Loop {
  const handlers: Record<Phase, Array<(ctx: FrameCtx) => void>> = {
    preupdate: [],
    update: [],
    postupdate: [],
    render: [],
  };
  // Module-pattern scratch: one ctx reused for every phase call.
  const ctx: FrameCtx = { dt: STEP, tick: 0, alpha: 1, timeScale: 1 };

  let tick = 0;
  let accumulator = 0;
  let last = 0;
  let rafId = 0;
  let running = false;
  let pausedFlag = false;
  let scale = 1;
  let hitStopMs = 0;
  let shedCount = 0;

  function runPhase(phase: Phase): void {
    const list = handlers[phase];
    for (let i = 0; i < list.length; i++) list[i](ctx);
  }

  function runSimStep(dt: number): void {
    tick++;
    ctx.tick = tick;
    ctx.dt = dt;
    ctx.timeScale = scale;
    runPhase('update');
    runPhase('postupdate');
  }

  function setScale(x: number): void {
    scale = x < 0 ? 0 : x;
    ctx.timeScale = scale;
  }

  function setPaused(b: boolean): void {
    pausedFlag = b;
    if (b) accumulator = 0; // never bank wall time while paused
  }

  function frame(now: number): void {
    if (!running) return;
    rafId = nextFrame(frame);

    let frameTime = (now - last) / 1000;
    last = now;
    if (frameTime > MAX_FRAME) frameTime = MAX_FRAME;
    if (frameTime < 0) frameTime = 0;

    ctx.timeScale = scale;

    // Preupdate: input snapshot, exactly once per frame.
    ctx.dt = STEP;
    runPhase('preupdate');

    if (hitStopMs > 0) {
      // Sim frozen; render still runs below.
      hitStopMs -= frameTime * 1000;
    } else if (!pausedFlag) {
      accumulator += frameTime * scale;
      let steps = 0;
      while (accumulator >= STEP && steps < MAX_STEPS) {
        runSimStep(STEP);
        accumulator -= STEP;
        steps++;
      }
      if (accumulator >= STEP) {
        // Sim cannot keep up: shed honestly, log it, keep the game alive.
        shedCount++;
        accumulator = 0;
        console.warn(`[keelcode] loop shed sim time (shed #${shedCount}): sim slower than wall clock`);
      }
    } else {
      accumulator = 0;
    }

    ctx.alpha = accumulator / STEP;
    ctx.dt = frameTime; // render phase: real frame dt for juice/smoothing
    runPhase('render');
  }

  return {
    on(phase: Phase, fn: (ctx: FrameCtx) => void): void {
      handlers[phase].push(fn);
    },

    start(): void {
      if (running) return;
      running = true;
      last = performance.now();
      rafId = nextFrame(frame);
    },

    stop(): void {
      running = false;
      cancelFrame(rafId);
    },

    step(dt: number = 1 / 60): void {
      ctx.dt = dt;
      runPhase('preupdate');
      runSimStep(dt);
    },

    get tick(): number {
      return tick;
    },

    get timeScale(): number {
      return scale;
    },
    set timeScale(x: number) {
      setScale(x);
    },

    get paused(): boolean {
      return pausedFlag;
    },
    set paused(b: boolean) {
      setPaused(b);
    },

    setTimeScale(x: number): void {
      setScale(x);
    },

    setPaused(b: boolean): void {
      setPaused(b);
    },

    hitStop(ms: number): void {
      if (ms > hitStopMs) hitStopMs = ms;
    },
  };
}
