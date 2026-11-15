// The active character's simulation and host, and the swap between characters (GizeMate). One
// character is alive at a time. A swap saves the current companion synchronously, stops its host
// (timers, obstacle hooks), builds the next sim from that character's own file and a new host in the
// same pause / hidden / session state, and tells the overlays to redraw. The previous character's file
// is never touched after its final save. Electron-free (app.ts supplies the factories).
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from '../shared/characters/registry';
import type { CatSim } from '../shared/sim';
import type { Settings } from '../shared/settings';
import type { CatHost } from './catHost';
import type { Logger } from './contracts';
import type { CatStore } from './store/catStore';

export interface CharacterRuntimeDeps {
  /** One store per character (the cat's is cat-state.json). */
  storeFor(id: CharacterId): CatStore;
  /** A sim for `character`; `persisted` is null for a brand-new companion (the sim seeds it from the character's defaults). */
  createSim(character: CharacterId, persisted: ReturnType<CatStore['load']>['cat'] | null): CatSim;
  /** A host around `sim` that persists through `store`. Not started. */
  createHost(character: CharacterId, sim: CatSim, store: CatStore): CatHost;
  getSettings(): Settings;
  logger: Logger;
  /** After every adoption of a new live sim and host, a rollback to the previous character included (then both ids are equal): overlays redraw, UI refresh, rebind app-level references. Not called at the first start. */
  onSwapped?(character: CharacterId, previous: CharacterId): void;
  /**
   * After a swap that did not happen (the target could not be built and the previous character is live again):
   * the owner of the settings writes `character` back as general.activeCharacter, so the UI, the tracker and the
   * next unrelated change agree with the live companion.
   */
  onSwapFailed?(character: CharacterId, wanted: CharacterId): void;
}

export interface CharacterRuntime {
  readonly character: CharacterId;
  readonly sim: CatSim;
  readonly host: CatHost;
  readonly store: CatStore;
  /** What the first load found (cat: unchanged from the startup read). */
  readonly lastLoad: { recovered: boolean; source: 'file' | 'backup' | 'new' };
  /** Switches to `next`; false when it is the active one or not a character id. A failed build reverts to the previous character. */
  swapTo(next: CharacterId): boolean;
}

/** The sim input of a load: a character other than the cat that was born just now starts from its own defaults. */
function persistedFor(character: CharacterId, load: ReturnType<CatStore['load']>): ReturnType<CatStore['load']>['cat'] | null {
  // A newborn, or a file that parsed but failed validation with no usable backup (its stand-in was not made for this character).
  if (character === DEFAULT_CHARACTER) return load.cat;
  return load.source === 'new' || (load.recovered && load.source !== 'backup') ? null : load.cat;
}

export function createCharacterRuntime(deps: CharacterRuntimeDeps, initial: { character: CharacterId; load: ReturnType<CatStore['load']> }): CharacterRuntime {
  const log = deps.logger;
  let character = initial.character;
  let store = deps.storeFor(character);
  let sim = deps.createSim(character, persistedFor(character, initial.load));
  let host = deps.createHost(character, sim, store);
  let lastLoad = { recovered: initial.load.recovered, source: initial.load.source };
  store.attach(() => sim.serialize());

  function build(next: CharacterId): { sim: CatSim; host: CatHost; store: CatStore; load: ReturnType<CatStore['load']> } {
    const nextStore = deps.storeFor(next);
    const load = nextStore.load();
    if (load.recovered) log.warn('character state recovered', { character: next, source: load.source });
    const nextSim = deps.createSim(next, persistedFor(next, load));
    const nextHost = deps.createHost(next, nextSim, nextStore);
    return { sim: nextSim, host: nextHost, store: nextStore, load };
  }

  const runtime: CharacterRuntime = {
    get character() {
      return character;
    },
    get sim() {
      return sim;
    },
    get host() {
      return host;
    },
    get store() {
      return store;
    },
    get lastLoad() {
      return lastLoad;
    },
    swapTo(next) {
      if (!isCharacterId(next) || next === character) return false;
      const previous = character;
      const old = { host, store, sim };
      const wasRunning = old.host.running;
      // 1. Never lose the previous companion: a synchronous save first, then nothing touches its file again.
      // A false result (locked file, disk full) is logged and retried once; the swap then goes on (a store that
      // never saves, e.g. a locked file, must not make swapping impossible).
      let saved = false;
      for (let attemptNo = 1; attemptNo <= 2 && !saved; attemptNo++) {
        try {
          saved = old.store.saveSync();
        } catch (err) {
          log.error('character save before swap failed', { error: err, character: previous, attempt: attemptNo });
        }
      }
      if (!saved) log.error('character state could not be saved before the swap; up to one autosave interval of the previous companion may be lost', { character: previous });
      // 2. Silence the old host (tick and poll timers, obstacle hooks) and its autosave.
      try {
        old.host.stop();
      } catch (err) {
        log.error('host stop before swap failed', { error: err });
      }
      old.store.dispose();
      let built: ReturnType<typeof build>;
      try {
        built = build(next);
      } catch (err) {
        // The new character could not be built: bring the previous one back from the file just saved.
        log.error('character swap failed; keeping the previous character', { error: err, from: previous, to: next });
        try {
          built = build(previous);
        } catch (err2) {
          // Cannot happen short of a broken factory; keep the old objects alive rather than leave nothing.
          log.error('character swap rollback failed', { error: err2 });
          store = old.store;
          store.attach(() => old.sim.serialize());
          if (wasRunning) old.host.start();
          try {
            deps.onSwapFailed?.(previous, next);
          } catch (err3) {
            log.error('swap failure listener failed', { error: err3 });
          }
          return false;
        }
        adopt(previous, built, old.host, wasRunning, previous);
        try {
          deps.onSwapFailed?.(previous, next);
        } catch (err3) {
          log.error('swap failure listener failed', { error: err3 });
        }
        return false;
      }
      adopt(next, built, old.host, wasRunning, previous);
      return true;
    },
  };

  /** Installs `built` as the live character, carrying the old host's pause / hidden / session state over. */
  function adopt(id: CharacterId, built: ReturnType<typeof build>, oldHost: CatHost, wasRunning: boolean, previous: CharacterId): void {
    character = id;
    sim = built.sim;
    host = built.host;
    store = built.store;
    lastLoad = { recovered: built.load.recovered, source: built.load.source };
    store.attach(() => sim.serialize());
    host.setTimeScale(oldHost.timeScale);
    host.updateSettings(deps.getSettings());
    host.setPaused(oldHost.paused);
    host.setHidden(oldHost.hidden);
    if (oldHost.laserActive) host.setLaserMode(true);
    if (oldHost.eventsPaused) host.setEventsPaused(true);
    // A fresh companion gets its file at once, so a crash right after the swap leaves a valid one.
    store.saveSync();
    if (wasRunning) host.start();
    try {
      deps.onSwapped?.(id, previous);
    } catch (err) {
      log.error('swap listener failed', { error: err });
    }
  }

  return runtime;
}
