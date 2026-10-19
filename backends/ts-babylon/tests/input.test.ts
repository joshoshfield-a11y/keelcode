// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInput, type InputSys } from '../src/engine/input';
import {
  dispatchKey,
  installKeyboardEventPolyfill,
  installWindowStub,
  uninstallWindowStub,
} from './helpers';

/**
 * Input contract under test (src/engine/input.ts):
 * - actions are defined over Binding data ({type:'key', code}); axes pair
 *   two actions via defineAxis(neg, pos)
 * - attach()/detach() bind window; update() snapshots once per frame
 * - pressed() is edge-triggered (a sub-frame tap still registers via the
 *   press queue); isDown() latches; released() fires on key-up
 * - held-key auto-repeat never re-triggers pressed(); blur clears held keys
 */
describe('InputSys', () => {
  let win: EventTarget;
  let input: InputSys;

  beforeEach(() => {
    installKeyboardEventPolyfill();
    win = new EventTarget();
    installWindowStub(win);
    input = createInput();
    input.attach();
    input.defineAction('jump', [{ type: 'key', code: 'Space' }]);
    input.defineAction('boost', [{ type: 'key', code: 'KeyW' }]);
    input.defineAction('brake', [{ type: 'key', code: 'KeyS' }]);
    input.defineAxis('throttle', 'brake', 'boost');
  });

  afterEach(() => {
    input.detach();
    uninstallWindowStub();
  });

  it('maps a synthetic keydown to pressed() and isDown() after update()', () => {
    dispatchKey(win, 'keydown', 'Space');
    input.update();
    expect(input.pressed('jump')).toBe(true);
    expect(input.isDown('jump')).toBe(true);
  });

  it('pressed() is an edge: clears on the next update(); released() fires on key-up', () => {
    dispatchKey(win, 'keydown', 'Space');
    input.update();
    expect(input.pressed('jump')).toBe(true);

    input.update();
    expect(input.pressed('jump')).toBe(false);
    expect(input.isDown('jump')).toBe(true);

    dispatchKey(win, 'keyup', 'Space');
    input.update();
    expect(input.isDown('jump')).toBe(false);
    expect(input.released('jump')).toBe(true);

    input.update();
    expect(input.released('jump')).toBe(false);
  });

  it('a tap shorter than one frame still registers pressed()', () => {
    dispatchKey(win, 'keydown', 'Space');
    dispatchKey(win, 'keyup', 'Space');
    input.update();
    expect(input.pressed('jump')).toBe(true);
    expect(input.isDown('jump')).toBe(false);
  });

  it('ignores held-key auto-repeat for the pressed() edge', () => {
    dispatchKey(win, 'keydown', 'Space');
    input.update();

    dispatchKey(win, 'keydown', 'Space', true); // OS key repeat
    input.update();
    expect(input.pressed('jump')).toBe(false);
    expect(input.isDown('jump')).toBe(true);
  });

  it('computes a -1..1 axis from a negative/positive action pair', () => {
    expect(input.axis('throttle')).toBe(0);

    dispatchKey(win, 'keydown', 'KeyW');
    input.update();
    expect(input.axis('throttle')).toBe(1);

    dispatchKey(win, 'keydown', 'KeyS');
    input.update();
    expect(input.axis('throttle')).toBe(0); // opposed actions cancel

    dispatchKey(win, 'keyup', 'KeyW');
    input.update();
    expect(input.axis('throttle')).toBe(-1);

    dispatchKey(win, 'keyup', 'KeyS');
    input.update();
    expect(input.axis('throttle')).toBe(0);
  });

  it('unknown actions/axes read as inactive instead of throwing', () => {
    expect(input.pressed('nope')).toBe(false);
    expect(input.isDown('nope')).toBe(false);
    expect(input.released('nope')).toBe(false);
    expect(input.axis('nope')).toBe(0);
  });

  it('detach() stops listening to the window', () => {
    input.detach();
    dispatchKey(win, 'keydown', 'Space');
    input.update();
    expect(input.pressed('jump')).toBe(false);
    expect(input.isDown('jump')).toBe(false);
  });

  it('window blur clears held keys (no stuck keys after alt-tab)', () => {
    dispatchKey(win, 'keydown', 'Space');
    input.update();
    expect(input.isDown('jump')).toBe(true);

    win.dispatchEvent(new Event('blur'));
    input.update();
    expect(input.isDown('jump')).toBe(false);
  });

  it('preventDefault()s bound keys but leaves unbound keys alone', () => {
    const KE = (
      globalThis as unknown as { KeyboardEvent: new (t: string, i: Record<string, unknown>) => Event }
    ).KeyboardEvent;

    const bound = new KE('keydown', { code: 'Space', cancelable: true });
    win.dispatchEvent(bound);
    expect(bound.defaultPrevented).toBe(true);

    const unbound = new KE('keydown', { code: 'KeyQ', cancelable: true });
    win.dispatchEvent(unbound);
    expect(unbound.defaultPrevented).toBe(false);
  });
});
