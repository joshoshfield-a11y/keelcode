/**
 * Save slots over localStorage with atomic writes and forward-only migration.
 *
 * Owning knowledge: KB `core/12-save-persistence.md` and the
 * `local-save-persistence` skill.
 *
 * - Atomicity: write temp key, then set the live key, then remove temp.
 *   There is never a moment where a partial payload sits at the live key.
 * - Integrity: every payload carries an FNV-1a checksum over the canonical
 *   JSON; a mismatch fails clean (load returns null), never loads garbage.
 * - Versioning: `format_version` stamped on write. Loads run forward-only
 *   migrations (N -> N+1 -> ...); a save from a newer version fails clean.
 * - Backend guard: if localStorage is unavailable (private mode, headless),
 *   an in-memory fallback keeps the game working instead of crashing.
 * - Slots are namespaced (`${namespace}:save:${slot}`); autosaves should use
 *   a distinct slot name so they can never eat a manual save.
 */

export interface SaveData {
  engine: 'keelcode';
  format_version: number;
  seed: number;
  tick: number;
  components: Record<number, Record<string, unknown>>;
}

export interface SaveSys {
  save(slot: string, data: SaveData): void;
  load(slot: string): SaveData | null;
  list(): string[];
  remove(slot: string): void;
}

/** Bump when the persisted shape changes; add a migration entry below. */
const CURRENT_VERSION = 1;

type Migration = (d: SaveData) => SaveData;
/** Forward-only: each entry migrates version N -> N+1. */
const migrations: Record<number, Migration> = {
  // e.g. 1: (d) => ({ ...d, newField: defaultValue }),
};

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
  keys(): string[];
}

function validShape(d: unknown): d is SaveData {
  if (typeof d !== 'object' || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    o['engine'] === 'keelcode' &&
    typeof o['format_version'] === 'number' &&
    typeof o['seed'] === 'number' &&
    typeof o['tick'] === 'number' &&
    typeof o['components'] === 'object' &&
    o['components'] !== null
  );
}

export function createSave(namespace: string): SaveSys {
  const prefix = `${namespace}:save:`;
  const mem = new Map<string, string>();

  // Probe localStorage once; fall back to memory on any failure.
  let useLocalStorage = false;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = `${namespace}:probe`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      useLocalStorage = true;
    }
  } catch {
    useLocalStorage = false;
  }

  const store: Store = useLocalStorage
    ? {
        get: (k) => window.localStorage.getItem(k),
        set: (k, v) => window.localStorage.setItem(k, v),
        remove: (k) => window.localStorage.removeItem(k),
        keys: () => {
          const out: string[] = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (k !== null) out.push(k);
          }
          return out;
        },
      }
    : {
        get: (k) => mem.get(k) ?? null,
        set: (k, v) => {
          mem.set(k, v);
        },
        remove: (k) => {
          mem.delete(k);
        },
        keys: () => [...mem.keys()],
      };

  const liveKey = (slot: string): string => `${prefix}${slot}`;
  const tempKey = (slot: string): string => `${prefix}${slot}.tmp`;

  return {
    save(slot: string, data: SaveData): void {
      const stamped: SaveData = { ...data, engine: 'keelcode', format_version: CURRENT_VERSION };
      const inner = JSON.stringify(stamped);
      const envelope = JSON.stringify({ sum: fnv1a(inner), data: inner });
      try {
        store.set(tempKey(slot), envelope);
        store.set(liveKey(slot), envelope);
        store.remove(tempKey(slot));
      } catch (err) {
        // Never leave a temp behind on quota failure; the old save stays live.
        try {
          store.remove(tempKey(slot));
        } catch {
          /* best effort */
        }
        throw err;
      }
    },

    load(slot: string): SaveData | null {
      const raw = store.get(liveKey(slot));
      if (raw === null) return null;

      let envelope: { sum?: number; data?: string };
      try {
        envelope = JSON.parse(raw) as { sum?: number; data?: string };
      } catch {
        return null; // not JSON at all: corrupted, fail clean
      }
      if (typeof envelope.sum !== 'number' || typeof envelope.data !== 'string') return null;
      if (fnv1a(envelope.data) !== envelope.sum) return null; // checksum mismatch: do not trust a byte

      let data: unknown;
      try {
        data = JSON.parse(envelope.data) as unknown;
      } catch {
        return null;
      }
      if (!validShape(data)) return null;

      if (data.format_version > CURRENT_VERSION) {
        return null; // save from a newer version: fail clean, never guess
      }
      let migrated: SaveData = data;
      while (migrated.format_version < CURRENT_VERSION) {
        const migrate = migrations[migrated.format_version];
        if (!migrate) return null; // no path forward: refuse rather than half-migrate
        migrated = migrate(migrated);
        migrated = { ...migrated, format_version: migrated.format_version + 1 };
      }
      return validShape(migrated) ? migrated : null;
    },

    list(): string[] {
      return store
        .keys()
        .filter((k) => k.startsWith(prefix) && !k.endsWith('.tmp'))
        .map((k) => k.slice(prefix.length))
        .sort();
    },

    remove(slot: string): void {
      store.remove(liveKey(slot));
      store.remove(tempKey(slot));
    },
  };
}
