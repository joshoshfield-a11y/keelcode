/**
 * Action-based input: gameplay reads logical actions, never physical keys.
 *
 * Owning knowledge: KB `core/07-input.md` and the engine-core-loop skill's
 * input rule — sample hardware once per frame (the loop calls `update()` in
 * preupdate); all sim substeps read the same snapshot. Edges (`pressed`) are
 * derived from polled state plus an event queue, so a tap shorter than one
 * frame still registers.
 *
 * Design notes:
 * - Bindings are data (`defineAction`), so remapping is a data edit.
 * - Keyboard uses `event.code` (physical position, layout-independent).
 * - Gamepad buttons polled per frame; analog triggers count as pressed past
 *   0.5. Stick axes are not in the contract's Binding type — axes are built
 *   from action pairs via `defineAxis` instead.
 * - `enableTouchControls` renders a floating left-half joystick (touch id
 *   'joy', exposed as directional ids joy-up/down/left/right with a 0.25
 *   dead zone) plus one button per action that has a non-joy touch binding.
 * - All held state clears on window blur (no stuck keys after alt-tab).
 *
 * No per-frame allocation in `update()`: the gamepad scratch array is
 * module-scope and reused.
 */

export type Binding =
  | { type: 'key'; code: string }
  | { type: 'mouse'; button: number }
  | { type: 'gamepad'; button: number }
  | { type: 'touch'; id: string };

export interface InputSys {
  defineAction(name: string, bindings: Binding[]): void;
  defineAxis(name: string, neg: string, pos: string): void;
  isDown(name: string): boolean;
  pressed(name: string): boolean;
  released(name: string): boolean;
  axis(name: string): number;
  attach(): void;
  detach(): void;
  /** Snapshot once per frame; the loop calls this in preupdate. */
  update(): void;
  /** Virtual joystick (touch id 'joy') + buttons. */
  enableTouchControls(container: HTMLElement): void;
}

interface ActionState {
  bindings: Binding[];
  down: boolean;
  prev: boolean;
  edgePressed: boolean;
  edgeReleased: boolean;
}

const JOY_RADIUS = 64;
const JOY_DEAD = 0.25;
const PAD_TRIGGER_THRESHOLD = 0.5;

// Module-scope scratch: gamepad button states, reused every update().
const padScratch: boolean[] = [];

export function createInput(): InputSys {
  const actions = new Map<string, ActionState>();
  const axes = new Map<string, { neg: string; pos: string }>();
  const keys = new Set<string>();
  const mouse = new Set<number>();
  const touchState = new Map<string, boolean>();
  // Queued press edges for taps shorter than one frame (event -> queue -> poll).
  const pressQueue = new Set<string>();
  const sourceToActions = new Map<string, string[]>();
  const boundCodes = new Set<string>();
  const boundMouse = new Set<number>();
  let attached = false;
  let touchUiBuilt = false;
  let joyTouchId: number | null = null;
  let joyBase: HTMLDivElement | null = null;
  let joyKnob: HTMLDivElement | null = null;
  let joyAnchorX = 0;
  let joyAnchorY = 0;

  function sourceKey(b: Binding): string {
    if (b.type === 'key') return `key:${b.code}`;
    if (b.type === 'mouse') return `mouse:${b.button}`;
    if (b.type === 'gamepad') return `pad:${b.button}`;
    return `touch:${b.id}`;
  }

  function rebuildBindingIndex(): void {
    sourceToActions.clear();
    boundCodes.clear();
    boundMouse.clear();
    for (const [name, a] of actions) {
      for (const b of a.bindings) {
        const sk = sourceKey(b);
        let list = sourceToActions.get(sk);
        if (!list) {
          list = [];
          sourceToActions.set(sk, list);
        }
        if (!list.includes(name)) list.push(name);
        if (b.type === 'key') boundCodes.add(b.code);
        if (b.type === 'mouse') boundMouse.add(b.button);
      }
    }
  }

  function queuePressForSource(sk: string): void {
    const names = sourceToActions.get(sk);
    if (!names) return;
    for (const n of names) pressQueue.add(n);
  }

  function pollGamepads(): void {
    for (let i = 0; i < padScratch.length; i++) padScratch[i] = false;
    try {
      const pads = navigator.getGamepads();
      for (let p = 0; p < pads.length; p++) {
        const gp = pads[p];
        if (!gp) continue;
        for (let i = 0; i < gp.buttons.length; i++) {
          const btn = gp.buttons[i];
          if (btn.pressed || btn.value > PAD_TRIGGER_THRESHOLD) padScratch[i] = true;
        }
      }
    } catch {
      // Gamepad API unavailable in this context; keyboard/mouse/touch still work.
    }
  }

  function sampleAction(a: ActionState): boolean {
    for (const b of a.bindings) {
      if (b.type === 'key') {
        if (keys.has(b.code)) return true;
      } else if (b.type === 'mouse') {
        if (mouse.has(b.button)) return true;
      } else if (b.type === 'gamepad') {
        if (padScratch[b.button] === true) return true;
      } else {
        if (b.id === 'joy') {
          if (
            touchState.get('joy-up') === true ||
            touchState.get('joy-down') === true ||
            touchState.get('joy-left') === true ||
            touchState.get('joy-right') === true
          ) {
            return true;
          }
        } else if (touchState.get(b.id) === true) {
          return true;
        }
      }
    }
    return false;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (boundCodes.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    queuePressForSource(`key:${e.code}`);
  }

  function onKeyUp(e: KeyboardEvent): void {
    keys.delete(e.code);
  }

  function onMouseDown(e: MouseEvent): void {
    if (boundMouse.has(e.button)) e.preventDefault();
    mouse.add(e.button);
    queuePressForSource(`mouse:${e.button}`);
  }

  function onMouseUp(e: MouseEvent): void {
    mouse.delete(e.button);
  }

  function onContextMenu(e: Event): void {
    if (boundMouse.size > 0) e.preventDefault();
  }

  function onBlur(): void {
    // Never leave a key/button stuck down after alt-tab or notification.
    keys.clear();
    mouse.clear();
    touchState.clear();
    joyTouchId = null;
    if (joyBase) joyBase.style.display = 'none';
  }

  function setJoyDirection(nx: number, ny: number): void {
    const mag = Math.hypot(nx, ny);
    const active = mag > JOY_DEAD;
    touchState.set('joy-up', active && ny < -JOY_DEAD);
    touchState.set('joy-down', active && ny > JOY_DEAD);
    touchState.set('joy-left', active && nx < -JOY_DEAD);
    touchState.set('joy-right', active && nx > JOY_DEAD);
  }

  function clearJoy(): void {
    joyTouchId = null;
    touchState.set('joy-up', false);
    touchState.set('joy-down', false);
    touchState.set('joy-left', false);
    touchState.set('joy-right', false);
    if (joyBase) joyBase.style.display = 'none';
  }

  function enableTouchControls(container: HTMLElement): void {
    if (touchUiBuilt) return;
    touchUiBuilt = true;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.style.touchAction = 'none';
    container.style.userSelect = 'none';

    // Floating joystick visuals (hidden until the left thumb lands).
    joyBase = document.createElement('div');
    joyBase.style.cssText =
      'position:absolute;width:128px;height:128px;border-radius:50%;' +
      'border:2px solid rgba(255,255,255,0.35);background:rgba(255,255,255,0.06);' +
      'display:none;pointer-events:none;z-index:20;';
    joyKnob = document.createElement('div');
    joyKnob.style.cssText =
      'position:absolute;left:50%;top:50%;width:52px;height:52px;border-radius:50%;' +
      'background:rgba(255,255,255,0.35);transform:translate(-50%,-50%);';
    joyBase.appendChild(joyKnob);
    container.appendChild(joyBase);

    container.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && target.closest('[data-kc-btn]')) return; // button handles it
        if (joyTouchId !== null) return;
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const t = e.changedTouches[0];
        if (t.clientX - rect.left > rect.width * 0.45) return; // stick lives left
        joyTouchId = t.identifier;
        joyAnchorX = t.clientX;
        joyAnchorY = t.clientY;
        if (joyBase) {
          joyBase.style.display = 'block';
          joyBase.style.left = `${t.clientX - rect.left - 64}px`;
          joyBase.style.top = `${t.clientY - rect.top - 64}px`;
        }
        setJoyDirection(0, 0);
      },
      { passive: false },
    );

    container.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (joyTouchId === null) return;
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier !== joyTouchId) continue;
          let dx = t.clientX - joyAnchorX;
          let dy = t.clientY - joyAnchorY;
          const len = Math.hypot(dx, dy);
          if (len > JOY_RADIUS) {
            dx = (dx / len) * JOY_RADIUS;
            dy = (dy / len) * JOY_RADIUS;
          }
          if (joyKnob) {
            joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          }
          setJoyDirection(dx / JOY_RADIUS, dy / JOY_RADIUS);
        }
      },
      { passive: false },
    );

    const endTouch = (e: TouchEvent): void => {
      if (joyTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joyTouchId) {
          if (joyKnob) joyKnob.style.transform = 'translate(-50%,-50%)';
          clearJoy();
          break;
        }
      }
    };
    container.addEventListener('touchend', endTouch);
    container.addEventListener('touchcancel', endTouch);

    // One button per action that has a non-joy touch binding, labeled by action.
    let btnIndex = 0;
    for (const [name, a] of actions) {
      const touchBindings = a.bindings.filter(
        (b): b is { type: 'touch'; id: string } => b.type === 'touch' && b.id !== 'joy',
      );
      for (const b of touchBindings) {
        const btn = document.createElement('div');
        btn.setAttribute('data-kc-btn', name);
        btn.textContent = name;
        btn.style.cssText =
          'position:absolute;right:16px;' +
          `bottom:${16 + btnIndex * 76}px;width:64px;height:64px;border-radius:50%;` +
          'border:2px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.12);' +
          'color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;' +
          'z-index:20;touch-action:none;';
        btn.addEventListener(
          'touchstart',
          (ev: TouchEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            touchState.set(b.id, true);
            pressQueue.add(name);
          },
          { passive: false },
        );
        const release = (ev: TouchEvent): void => {
          ev.stopPropagation();
          touchState.set(b.id, false);
        };
        btn.addEventListener('touchend', release);
        btn.addEventListener('touchcancel', release);
        container.appendChild(btn);
        btnIndex++;
      }
    }
  }

  return {
    defineAction(name: string, bindings: Binding[]): void {
      actions.set(name, {
        bindings: [...bindings],
        down: false,
        prev: false,
        edgePressed: false,
        edgeReleased: false,
      });
      rebuildBindingIndex();
    },

    defineAxis(name: string, neg: string, pos: string): void {
      axes.set(name, { neg, pos });
    },

    isDown(name: string): boolean {
      return actions.get(name)?.down ?? false;
    },

    pressed(name: string): boolean {
      return actions.get(name)?.edgePressed ?? false;
    },

    released(name: string): boolean {
      return actions.get(name)?.edgeReleased ?? false;
    },

    axis(name: string): number {
      const ax = axes.get(name);
      if (!ax) return 0;
      const p = actions.get(ax.pos)?.down === true ? 1 : 0;
      const n = actions.get(ax.neg)?.down === true ? 1 : 0;
      return p - n;
    },

    attach(): void {
      if (attached) return;
      attached = true;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onBlur);
      window.addEventListener('contextmenu', onContextMenu);
    },

    detach(): void {
      if (!attached) return;
      attached = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', onContextMenu);
      onBlur();
    },

    update(): void {
      pollGamepads();
      for (const [name, a] of actions) {
        const down = sampleAction(a);
        a.edgePressed = (down && !a.prev) || pressQueue.has(name);
        a.edgeReleased = !down && a.prev;
        a.prev = down;
        a.down = down;
      }
      pressQueue.clear();
    },

    enableTouchControls(container: HTMLElement): void {
      enableTouchControls(container);
    },
  };
}
