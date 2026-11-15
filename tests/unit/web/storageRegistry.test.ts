// Review fixes: a fresh or recovered non-cat companion is born with its own traits and id; the characters
// registry is never overwritten when this build cannot safely rewrite it.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/behavior/random';
import { getCharacter } from '../../../src/shared/characters/registry';
import { CHARACTERS_STORAGE_KEY, MAX_STORED_CHARS, openWebStorage, type StorageLike } from '../../../src/web/storage';
import { memoryLogger } from './helpers';

function mem(init: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)) };
}
const NOW = Date.UTC(2026, 10, 6);

describe('web storage: non-cat birth', () => {
  it('a missing, corrupt or invalid entry is born as that character (id prefix and traits), not as a cat', () => {
    const cases: Record<string, string>[] = [
      {},
      { [CHARACTERS_STORAGE_KEY]: '{not json' },
      { [CHARACTERS_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, characters: { fox: { junk: true } } }) },
    ];
    for (const init of cases) {
      const s = openWebStorage(() => mem(init), memoryLogger());
      const { cat } = s.loadCat(mulberry32(7), NOW, 'fox');
      expect(cat.catId.startsWith('fox-')).toBe(true);
    }
    const a = openWebStorage(() => mem(), memoryLogger()).loadCat(mulberry32(7), NOW, 'ghost').cat;
    const b = openWebStorage(() => mem(), memoryLogger()).loadCat(mulberry32(7), NOW).cat;
    expect(a.catId.startsWith('ghost-')).toBe(true);
    expect(b.catId.startsWith('cat-')).toBe(true);
    expect(getCharacter('ghost').personality.means).toBeTruthy();
  });
});

describe('web storage: the registry is never destroyed', () => {
  const sampleCat = () => openWebStorage(() => mem(), memoryLogger()).loadCat(mulberry32(3), NOW, 'rabbit').cat;
  it('refuses to write over newer-schema, corrupt, oversized or non-object registries', () => {
    const bad = [
      JSON.stringify({ schemaVersion: 2, characters: { fox: { a: 1 }, ghost: { b: 2 } } }),
      '{broken',
      'x'.repeat(MAX_STORED_CHARS + 1),
      '[]',
    ];
    for (const raw of bad) {
      const m = mem({ [CHARACTERS_STORAGE_KEY]: raw });
      const log = memoryLogger();
      const s = openWebStorage(() => m, log);
      expect(s.saveCat(sampleCat(), 'rabbit')).toBe(false);
      expect(m.data.get(CHARACTERS_STORAGE_KEY)).toBe(raw);
      expect(log.entries.some((e) => e.level === 'warn')).toBe(true);
    }
  });
  it('keeps unknown ids and raw entries of a usable registry, and still writes when it is missing', () => {
    const init = JSON.stringify({ schemaVersion: 1, characters: { fox: { raw: 'keep' }, dragon: { future: true } } });
    const m = mem({ [CHARACTERS_STORAGE_KEY]: init });
    const s = openWebStorage(() => m, memoryLogger());
    expect(s.saveCat(sampleCat(), 'rabbit')).toBe(true);
    const reg = JSON.parse(m.data.get(CHARACTERS_STORAGE_KEY) ?? '') as { characters: Record<string, unknown> };
    expect(reg.characters.fox).toEqual({ raw: 'keep' });
    expect(reg.characters.dragon).toEqual({ future: true });
    expect(reg.characters.rabbit).toBeTruthy();
    const empty = mem();
    expect(openWebStorage(() => empty, memoryLogger()).saveCat(sampleCat(), 'rabbit')).toBe(true);
  });
});

describe('session backup (restart without localStorage)', () => {
  it('carries the chosen settings and the live companions across a restart, validated on the way back', async () => {
    const { openSessionBackup, SESSION_BACKUP_KEY, webSettings } = await import('../../../src/web/storage');
    const m = mem();
    const store = openSessionBackup(() => m);
    expect(store.load()).toBeNull();
    const s = webSettings(null);
    s.general.activeCharacter = 'fox';
    const fox = openWebStorage(() => mem(), memoryLogger()).loadCat(mulberry32(5), NOW, 'fox').cat;
    expect(store.save({ settings: s, cats: { fox } })).toBe(true);
    const back = store.load();
    expect(back?.settings.general.activeCharacter).toBe('fox');
    expect(back?.cats.fox?.catId).toBe(fox.catId);
    // a damaged cat entry is dropped, never adopted
    m.data.set(SESSION_BACKUP_KEY, JSON.stringify({ settings: {}, cats: { fox: { junk: 1 }, dragon: fox } }));
    expect(openSessionBackup(() => m).load()?.cats).toEqual({});
  });
  it('reports a refusing or missing sessionStorage as a failed save', async () => {
    const { openSessionBackup, webSettings } = await import('../../../src/web/storage');
    const s = webSettings(null);
    expect(openSessionBackup(() => null).save({ settings: s, cats: {} })).toBe(false);
    expect(openSessionBackup(() => { throw new Error('denied'); }).save({ settings: s, cats: {} })).toBe(false);
    const full: StorageLike = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(openSessionBackup(() => full).save({ settings: s, cats: {} })).toBe(false);
  });
});
