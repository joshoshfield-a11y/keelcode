/**
 * Shared test doubles for the KeelCode ts-three unit suite.
 *
 * Vitest runs with environment 'node', so browser globals (localStorage,
 * KeyboardEvent) are provided here as minimal, behavior-faithful doubles
 * instead of being assumed.
 */

/** Minimal in-memory implementation of the Web Storage interface. */
export class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = [...this.store.keys()];
    return index >= 0 && index < keys.length ? keys[index] : null;
  }

  getItem(key: string): string | null {
    const v = this.store.get(key);
    return v === undefined ? null : v;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Install a fresh MockStorage as globalThis.localStorage; returns it. */
export function installMockStorage(): MockStorage {
  const storage = new MockStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;
  return storage;
}

/** Remove the mock localStorage installed by installMockStorage(). */
export function uninstallMockStorage(): void {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
}

/**
 * Node ships Event/EventTarget but no KeyboardEvent. The input module maps
 * real keyboard events, so tests install this minimal polyfill carrying the
 * fields the engine reads: `code`, `key`, `repeat`. It is a real Event, so
 * dispatchEvent/preventDefault behave like the browser.
 */
export function installKeyboardEventPolyfill(): void {
  const g = globalThis as unknown as { KeyboardEvent?: unknown };
  if (typeof g.KeyboardEvent !== 'undefined') return;

  class FakeKeyboardEvent extends Event {
    readonly code: string;
    readonly key: string;
    readonly repeat: boolean;

    constructor(
      type: string,
      init: {
        code?: string;
        key?: string;
        repeat?: boolean;
        bubbles?: boolean;
        cancelable?: boolean;
      } = {},
    ) {
      super(type, { bubbles: init.bubbles ?? false, cancelable: init.cancelable ?? false });
      this.code = init.code ?? '';
      this.key = init.key ?? this.code;
      this.repeat = init.repeat ?? false;
    }
  }

  g.KeyboardEvent = FakeKeyboardEvent;
}

/** Dispatch a synthetic KeyboardEvent on a target, like the browser would. */
export function dispatchKey(
  target: EventTarget,
  type: 'keydown' | 'keyup',
  code: string,
  repeat = false,
): void {
  const KE = (globalThis as unknown as { KeyboardEvent: new (t: string, i: object) => Event })
    .KeyboardEvent;
  target.dispatchEvent(new KE(type, { code, key: code, repeat, bubbles: true, cancelable: true }));
}

/**
 * Install a `window` stub (the engine's input/save modules touch `window`
 * directly). Each test file gets fresh globals, so stubs never leak across
 * files; still, uninstall in afterEach for hygiene.
 */
export function installWindowStub(value: unknown): void {
  (globalThis as unknown as { window?: unknown }).window = value;
}

/** Remove the `window` stub installed by installWindowStub(). */
export function uninstallWindowStub(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}
