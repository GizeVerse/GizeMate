import { describe, expect, it } from 'vitest';
import type { CatHost } from '../../../src/main/catHost';
import { createCharacterRuntime, type CharacterRuntimeDeps } from '../../../src/main/characterRuntime';
import type { CatLoadResult, CatStore } from '../../../src/main/store/catStore';
import { PersistedCatSchema, type PersistedCat } from '../../../src/shared/catState';
import type { CharacterId } from '../../../src/shared/characters/registry';
import { defaultSettings } from '../../../src/shared/settings';
import type { CatSim } from '../../../src/shared/sim';
import { memoryLogger } from './helpers';

const cat = (id: string): PersistedCat => PersistedCatSchema.parse({ schemaVersion: 1, catId: id.padEnd(8, '_'), bornAt: 1000, savedAt: 1 });

interface FakeStore extends CatStore {
  log: string[];
  snapshot: (() => PersistedCat) | null;
  loadResult: CatLoadResult;
}

function fakeStore(id: string, loadResult?: Partial<CatLoadResult>, log: string[] = []): FakeStore {
  const s: FakeStore = {
    log,
    snapshot: null,
    loadResult: { cat: cat(`${id}-stored`), recovered: false, source: 'file', ...loadResult },
    load() {
      log.push(`${id}:load`);
      return s.loadResult;
    },
    attach(fn) {
      s.snapshot = fn;
      log.push(`${id}:attach`);
    },
    markDirty() {},
    dirty: false,
    save() {
      log.push(`${id}:save`);
      return Promise.resolve(true);
    },
    saveSync() {
      log.push(`${id}:saveSync:${s.snapshot ? s.snapshot().catId : 'none'}`);
      return true;
    },
    dispose() {
      log.push(`${id}:dispose`);
    },
  };
  return s;
}

function fakeHost(id: string, log: string[]): CatHost & { calls: string[] } {
  const h = {
    calls: [] as string[],
    running: false,
    paused: false,
    hidden: false,
    laserActive: false,
    eventsPaused: false,
    timeScale: 1,
    start() {
      h.running = true;
      log.push(`${id}:host.start`);
    },
    stop() {
      h.running = false;
      log.push(`${id}:host.stop`);
    },
    setPaused(p: boolean) {
      h.paused = p;
      h.calls.push(`paused:${p}`);
    },
    setHidden(v: boolean) {
      h.hidden = v;
      h.calls.push(`hidden:${v}`);
    },
    setLaserMode(v: boolean) {
      h.laserActive = v;
    },
    setEventsPaused(v: boolean) {
      h.eventsPaused = v;
    },
    setTimeScale(v: number) {
      h.timeScale = v;
    },
    updateSettings() {
      h.calls.push('updateSettings');
    },
  };
  return h as unknown as CatHost & { calls: string[] };
}

function setup(opts: { failBuildFor?: CharacterId } = {}) {
  const log: string[] = [];
  const stores = new Map<CharacterId, FakeStore>();
  const simsMade: Array<{ character: CharacterId; persisted: PersistedCat | null }> = [];
  const swapped: Array<[CharacterId, CharacterId]> = [];
  const hosts: Array<ReturnType<typeof fakeHost>> = [];
  const deps: CharacterRuntimeDeps = {
    storeFor: (id) => {
      let s = stores.get(id);
      if (!s) {
        s = fakeStore(id, id === 'monkey' ? { cat: cat('monkey-stored') } : undefined, log);
        stores.set(id, s);
      }
      return s;
    },
    createSim: (character, persisted) => {
      if (opts.failBuildFor === character) throw new Error('no such sim');
      simsMade.push({ character, persisted });
      const id = persisted?.catId ?? `${character}-new`;
      return { serialize: () => cat(`${character}:${id}`), state: 'idle' } as unknown as CatSim;
    },
    createHost: (character) => {
      const h = fakeHost(character, log);
      hosts.push(h);
      return h;
    },
    getSettings: () => defaultSettings(),
    logger: memoryLogger(),
    onSwapped: (to, from) => swapped.push([to, from]),
  };
  const catLoad: CatLoadResult = { cat: cat('cat-stored'), recovered: false, source: 'file' };
  const runtime = createCharacterRuntime(deps, { character: 'cat', load: catLoad });
  return { runtime, log, stores, simsMade, swapped, hosts };
}

describe('character runtime: the swap', () => {
  it('starts on the given character with its sim fed from the startup load and its store attached', () => {
    const { runtime, simsMade, stores } = setup();
    expect(runtime.character).toBe('cat');
    expect(simsMade).toEqual([{ character: 'cat', persisted: expect.objectContaining({ catId: 'cat-stored' }) }]);
    expect(stores.get('cat')?.snapshot).not.toBeNull();
    expect(runtime.lastLoad).toEqual({ recovered: false, source: 'file' });
  });

  it('saves the current companion synchronously before anything else, then stops, disposes and builds the next', () => {
    const { runtime, log } = setup();
    runtime.host.start();
    log.length = 0;
    expect(runtime.swapTo('monkey')).toBe(true);
    expect(log.slice(0, 4)).toEqual(['cat:saveSync:cat:cat-stored', 'cat:host.stop', 'cat:dispose', 'monkey:load']);
    expect(runtime.character).toBe('monkey');
    expect(runtime.sim.serialize().catId).toBe('monkey:monkey-stored');
    // a fresh file is written at once and the new host runs because the old one did
    expect(log).toContain('monkey:saveSync:monkey:monkey-stored');
    expect(log[log.length - 1]).toBe('monkey:host.start');
  });

  it('carries pause, hidden, time scale and session toggles over, and leaves a stopped host stopped', () => {
    const { runtime, hosts } = setup();
    const first = runtime.host;
    first.setPaused(true);
    first.setHidden(true);
    first.setTimeScale(4);
    first.setLaserMode(true);
    first.setEventsPaused(true);
    runtime.swapTo('fox');
    const next = runtime.host;
    expect(next).not.toBe(first);
    expect(hosts).toHaveLength(2);
    expect(next.paused).toBe(true);
    expect(next.hidden).toBe(true);
    expect(next.timeScale).toBe(4);
    expect(next.laserActive).toBe(true);
    expect(next.eventsPaused).toBe(true);
    expect(next.running).toBe(false);
    expect(first.running).toBe(false);
  });

  it('is a no-op for the active character or an unknown id', () => {
    const { runtime, log, swapped } = setup();
    log.length = 0;
    expect(runtime.swapTo('cat')).toBe(false);
    expect(runtime.swapTo('dragon' as CharacterId)).toBe(false);
    expect(log).toEqual([]);
    expect(swapped).toEqual([]);
  });

  it('a new non-cat companion is created from its own defaults (no persisted input); the cat is never', () => {
    const { runtime, stores, simsMade } = setup();
    stores.set('fox', fakeStore('fox', { source: 'new', recovered: false }));
    runtime.swapTo('fox');
    expect(simsMade[simsMade.length - 1]).toEqual({ character: 'fox', persisted: null });
    // back to the cat: its stored state, even if the load says 'new'
    stores.get('cat')!.loadResult = { cat: cat('cat-fresh'), recovered: false, source: 'new' };
    runtime.swapTo('cat');
    expect(simsMade[simsMade.length - 1]).toEqual({ character: 'cat', persisted: expect.objectContaining({ catId: 'cat-fresh' }) });
  });

  it('keeps each character state: A, B, A saves A, saves B, and reloads A from its own store', () => {
    const { runtime, log, stores } = setup();
    runtime.swapTo('monkey');
    runtime.swapTo('cat');
    const saves = log.filter((l) => l.includes('saveSync'));
    expect(saves).toContain('cat:saveSync:cat:cat-stored');
    expect(saves).toContain('monkey:saveSync:monkey:monkey-stored');
    expect(log.filter((l) => l === 'cat:load')).toHaveLength(1);
    expect(runtime.sim.serialize().catId).toContain('cat:');
    // no leak: every swap disposed the store of the character it left, and each store is attached to the live sim only
    expect(log.filter((l) => l === 'cat:dispose')).toHaveLength(1);
    expect(log.filter((l) => l === 'monkey:dispose')).toHaveLength(1);
    expect(stores.get('cat')?.snapshot?.().catId).toBe(runtime.sim.serialize().catId);
  });

  it('reports a recovered (corrupt) character file and still builds a companion', () => {
    const { runtime, stores } = setup();
    stores.set('rabbit', fakeStore('rabbit', { source: 'new', recovered: true }));
    expect(runtime.swapTo('rabbit')).toBe(true);
    expect(runtime.lastLoad).toEqual({ recovered: true, source: 'new' });
  });

  it('notifies once per adoption with (new, previous)', () => {
    const { runtime, swapped } = setup();
    runtime.swapTo('ghost');
    runtime.swapTo('slime');
    expect(swapped).toEqual([
      ['ghost', 'cat'],
      ['slime', 'ghost'],
    ]);
  });

  it('a character that cannot be built rolls back to the previous one from its saved file', () => {
    const { runtime, log, swapped, hosts } = setup({ failBuildFor: 'alien' });
    runtime.host.start();
    log.length = 0;
    expect(runtime.swapTo('alien')).toBe(false);
    expect(runtime.character).toBe('cat');
    expect(log[0]).toBe('cat:saveSync:cat:cat-stored');
    expect(runtime.host.running).toBe(true);
    expect(hosts[hosts.length - 1]).toBe(runtime.host);
    expect(swapped).toEqual([['cat', 'cat']]);
    // the cat can still be saved
    runtime.store.saveSync();
    expect(log.filter((l) => l.startsWith('cat:saveSync')).length).toBeGreaterThanOrEqual(2);
  });
});
