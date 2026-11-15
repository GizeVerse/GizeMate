// Per-character companion state (GizeMate). The cat keeps cat-state.json exactly as shipped (the
// plain PersistedCat, schema 1: catStore.ts). Every other character lives in its own file,
// userData/characters/<id>.json, written through the same crash-safe jsonStore (atomic writes, .bak,
// quarantine of unparseable files) inside a small envelope with its own schemaVersion:
//   { schemaVersion: 1, character: '<id>', savedAt: <epoch ms>, companion: <PersistedCat> }
// A missing, corrupt or foreign file yields a fresh companion for that character only; no other
// character's file (and never the cat's) is read, moved or written. Electron-free.
import path from 'node:path';
import { migrateCatState } from '../../core/behavior';
import type { PersistedCat } from '../../shared/catState';
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from '../../shared/characters/registry';
import type { Logger } from '../contracts';
import { createCatStore, type CatStore } from './catStore';
import { createJsonStore, type JsonReadResult, type JsonStore } from './jsonStore';

/** Envelope version of characters/<id>.json (independent of the cat file's schema). */
export const CHARACTER_STATE_SCHEMA_VERSION = 1;
export const CHARACTER_STATE_DIR = 'characters';

export interface CharacterStateEnvelope {
  schemaVersion: number;
  character: CharacterId;
  savedAt: number;
  companion: PersistedCat;
}

/** userData/characters/<id>.json; only a known non-cat id has a path (anything else throws). */
export function characterStatePath(userData: string, id: CharacterId): string {
  if (!isCharacterId(id) || id === DEFAULT_CHARACTER) throw new Error(`no per-character file for '${String(id)}'`);
  return path.join(userData, CHARACTER_STATE_DIR, `${id}.json`);
}

/** The companion inside an envelope for `id`, or undefined when the value is not one (wrong shape, other character, bad version). */
function unwrap(value: unknown, id: CharacterId): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o.schemaVersion !== 'number' || !Number.isInteger(o.schemaVersion) || o.schemaVersion < 1) return undefined;
  if (o.character !== id) return undefined;
  if (o.companion === null || typeof o.companion !== 'object' || Array.isArray(o.companion)) return undefined;
  return o.companion;
}

/** Wraps a plain JsonStore so values are stored in the envelope and read back out of it. */
export function envelopeStore(inner: JsonStore, id: CharacterId, wallClock: () => number = Date.now): JsonStore {
  const wrap = (v: unknown): CharacterStateEnvelope => ({ schemaVersion: CHARACTER_STATE_SCHEMA_VERSION, character: id, savedAt: wallClock(), companion: v as PersistedCat });
  const read = (): JsonReadResult => {
    const r = inner.read();
    if (r.status === 'missing' || r.value === null) return r;
    // An unreadable or foreign envelope reads as an invalid value: the cat store then quarantines it and starts fresh.
    return { ...r, value: unwrap(r.value, id) ?? null };
  };
  return {
    filePath: inner.filePath,
    backupPath: inner.backupPath,
    read,
    readBackup() {
      const b = inner.readBackup();
      if (!b.ok) return b;
      const v = unwrap(b.value, id);
      return v === undefined ? { ok: false } : { ok: true, value: v };
    },
    quarantine: () => inner.quarantine(),
    writeSync: (v) => inner.writeSync(wrap(v)),
    write: (v) => inner.write(wrap(v)),
  };
}

export interface CharacterStoresOptions {
  userData: string;
  /** The existing cat store (cat-state.json); returned untouched for the cat. */
  catStore: CatStore;
  logger: Logger;
  random: () => number;
  wallClock?: () => number;
  autosaveMs?: number;
  /** Tests: a different JsonStore factory. */
  createStore?: (filePath: string) => JsonStore;
}

export interface CharacterStores {
  /** The store of one character; cached, so asking twice gives the same instance. */
  forCharacter(id: CharacterId): CatStore;
  /** Disposes every store this object created (autosave timers); the cat store is left to its owner. */
  dispose(): void;
}

export function createCharacterStores(opts: CharacterStoresOptions): CharacterStores {
  const cache = new Map<CharacterId, CatStore>();
  const makeStore = opts.createStore ?? ((filePath: string) => createJsonStore({ filePath, logger: opts.logger }));
  return {
    forCharacter(id) {
      if (id === DEFAULT_CHARACTER) return opts.catStore;
      let s = cache.get(id);
      if (!s) {
        s = createCatStore({
          store: envelopeStore(makeStore(characterStatePath(opts.userData, id)), id, opts.wallClock),
          migrate: migrateCatState,
          random: opts.random,
          wallClock: opts.wallClock,
          autosaveMs: opts.autosaveMs,
          logger: opts.logger,
        });
        cache.set(id, s);
      }
      return s;
    },
    dispose() {
      for (const s of cache.values()) s.dispose();
      cache.clear();
    },
  };
}
