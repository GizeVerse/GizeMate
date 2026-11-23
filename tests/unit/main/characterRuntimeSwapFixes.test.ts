// Review fixes: a failed swap reports the live character back; the save before a swap is checked and retried once;
// a recovered non-cat file is not adopted as the companion.
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
const host = (): CatHost => ({ running: false, paused: false, hidden: false, laserActive: false, eventsPaused: false, timeScale: 1, start() {}, stop() {}, setPaused() {}, setHidden() {}, setLaserMode() {}, setEventsPaused() {}, setTimeScale() {}, updateSettings() {} }) as unknown as CatHost;

function build(opts: { failFor?: CharacterId; saveResults?: boolean[]; foxLoad?: Partial<CatLoadResult> }) {
  const saves: boolean[] = [...(opts.saveResults ?? [])];
  let saveCalls = 0;
  const persistedSeen: Array<[CharacterId, PersistedCat | null]> = [];
  const failed: Array<[CharacterId, CharacterId]> = [];
  const mk = (id: string): CatStore => ({
    load: () => ({ cat: cat(`${id}-stored`), recovered: false, source: 'file', ...(id === 'fox' ? opts.foxLoad : {}) }),
    attach() {},
    markDirty() {},
    dirty: false,
    save: () => Promise.resolve(true),
    saveSync: () => {
      if (id === 'cat') {
        saveCalls++;
        return saves.length ? (saves.shift() as boolean) : true;
      }
      return true;
    },
    dispose() {},
  });
  const stores = new Map<string, CatStore>();
  const deps: CharacterRuntimeDeps = {
    storeFor: (id) => stores.get(id) ?? (stores.set(id, mk(id)), stores.get(id) as CatStore),
    createSim: (c, p) => {
      if (opts.failFor === c) throw new Error('boom');
      persistedSeen.push([c, p]);
      return { serialize: () => cat(`${c}-x`) } as unknown as CatSim;
    },
    createHost: () => host(),
    getSettings: () => defaultSettings(),
    logger: memoryLogger(),
    onSwapFailed: (live, wanted) => failed.push([live, wanted]),
  };
  const rt = createCharacterRuntime(deps, { character: 'cat', load: { cat: cat('cat-stored'), recovered: false, source: 'file' } });
  return { rt, failed, persistedSeen, calls: () => saveCalls };
}

describe('character runtime review fixes', () => {
  it('a failed swap tells the owner which character is live so the setting can be written back', () => {
    const { rt, failed } = build({ failFor: 'fox' });
    expect(rt.swapTo('fox')).toBe(false);
    expect(rt.character).toBe('cat');
    expect(failed).toEqual([['cat', 'fox']]);
  });
  it('a successful swap does not report a failure', () => {
    const { rt, failed } = build({});
    expect(rt.swapTo('fox')).toBe(true);
    expect(failed).toEqual([]);
  });
  it('retries the save once when it returns false, and still swaps if both fail', () => {
    const ok = build({ saveResults: [false, true] });
    expect(ok.rt.swapTo('fox')).toBe(true);
    expect(ok.calls()).toBe(2);
    const bad = build({ saveResults: [false, false] });
    expect(bad.rt.swapTo('fox')).toBe(true);
    expect(bad.calls()).toBe(2);
  });
  it('a recovered non-cat file without backup is not adopted (the sim starts from the character defaults)', () => {
    const { rt, persistedSeen } = build({ foxLoad: { recovered: true, source: 'file' } });
    rt.swapTo('fox');
    expect(persistedSeen[persistedSeen.length - 1]).toEqual(['fox', null]);
    const b = build({ foxLoad: { recovered: true, source: 'backup' } });
    b.rt.swapTo('fox');
    expect(b.persistedSeen[b.persistedSeen.length - 1]?.[1]).not.toBeNull();
  });
});
