// GizeMate on the web host: per-character storage (migrate-on-read, corrupt-slot isolation, clean swap),
// the settings allow-lists, window bounds of every module at the smallest and largest size, the name
// the secret-name tracker is fed, and the locale wiring.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/behavior/random';
import { CHARACTER_IDS, getCharacter, type CharacterId } from '../../../src/shared/characters/registry';
import { t, type I18nKey } from '../../../src/shared/i18n';
import { defaultSettings } from '../../../src/shared/settings';
import { activeCharacterOf, applyWebLocale, companionName, effectiveSkin, renderAppearance } from '../../../src/web/characterHost';
import { STAGE_MAX_H_DP, STAGE_MAX_W_DP, TOUCH_MAX_DP } from '../../../src/web/floatingProtocol';
import { BODY_MARGIN_BOTTOM_DIP, BODY_MARGIN_SIDE_DIP, EMOTE_MARGIN_TOP_DIP } from '../../../src/main/overlay/renderMapping';
import { clampWinRects, touchRectFor, windowRectFor, windowSizeDip } from '../../../src/web/overlaySurface';
import { applyWebPatch, patchFor, rejectNonWebPatch } from '../../../src/web/settingsModel';
import { CAT_STORAGE_KEY, CHARACTERS_STORAGE_KEY, createWebCatStore, openWebStorage, storedSettings, webSettings, type StorageLike } from '../../../src/web/storage';
import { memoryLogger } from './helpers';

function memoryStorage(init: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), removeItem: (k) => void data.delete(k) };
}
const NOW = Date.UTC(2026, 10, 6);
const others = CHARACTER_IDS.filter((c) => c !== 'cat');

describe('per-character storage', () => {
  it('keeps the cat in the v1 key, untouched, and the others in the registry key', () => {
    const mem = memoryStorage();
    const s = openWebStorage(() => mem, memoryLogger());
    const cat = s.loadCat(mulberry32(1), NOW).cat;
    const fox = s.loadCat(mulberry32(2), NOW, 'fox').cat;
    expect(s.saveCat(cat)).toBe(true);
    const catText = mem.data.get(CAT_STORAGE_KEY);
    expect(s.saveCat(fox, 'fox')).toBe(true);
    expect(mem.data.get(CAT_STORAGE_KEY)).toBe(catText);
    const reg = JSON.parse(mem.data.get(CHARACTERS_STORAGE_KEY) ?? '{}') as { schemaVersion: number; characters: Record<string, unknown> };
    expect(reg.schemaVersion).toBe(1);
    expect(Object.keys(reg.characters)).toEqual(['fox']);
    const again = openWebStorage(() => mem, memoryLogger());
    expect(again.loadCat(mulberry32(9), NOW + 1, 'fox').source).toBe('stored');
    expect(again.loadCat(mulberry32(9), NOW + 1, 'fox').cat).toEqual(fox);
  });

  it('loads v1.5.0 data (only the v1 cat key) unchanged and starts fresh companions for the others', () => {
    const seed = openWebStorage(() => memoryStorage(), memoryLogger()).loadCat(mulberry32(3), NOW).cat;
    const mem = memoryStorage({ [CAT_STORAGE_KEY]: JSON.stringify(seed) });
    const s = openWebStorage(() => mem, memoryLogger());
    expect(s.loadCat(mulberry32(4), NOW).source).toBe('stored');
    for (const id of others) expect(s.loadCat(mulberry32(5), NOW, id).source).toBe('new');
    expect(mem.data.has(CHARACTERS_STORAGE_KEY)).toBe(false);
  });

  it('isolates a corrupt entry: only that companion starts over; the cat and the others stay', () => {
    const mem = memoryStorage();
    const s = openWebStorage(() => mem, memoryLogger());
    const cat = s.loadCat(mulberry32(1), NOW).cat;
    s.saveCat(cat);
    const rabbit = s.loadCat(mulberry32(2), NOW, 'rabbit').cat;
    s.saveCat(rabbit, 'rabbit');
    s.saveCat(s.loadCat(mulberry32(3), NOW, 'ghost').cat, 'ghost');
    const reg = JSON.parse(mem.data.get(CHARACTERS_STORAGE_KEY) ?? '') as { characters: Record<string, unknown> };
    reg.characters['ghost'] = { schemaVersion: 'nope', junk: true };
    mem.data.set(CHARACTERS_STORAGE_KEY, JSON.stringify(reg));
    const s2 = openWebStorage(() => mem, memoryLogger());
    expect(s2.loadCat(mulberry32(7), NOW, 'ghost').source).toBe('recovered');
    expect(s2.loadCat(mulberry32(7), NOW, 'rabbit').source).toBe('stored');
    expect(s2.loadCat(mulberry32(7), NOW, 'rabbit').cat).toEqual(rabbit);
    expect(s2.loadCat(mulberry32(7), NOW).source).toBe('stored');
    expect(mem.data.get(CAT_STORAGE_KEY)).toBe(JSON.stringify(cat));
    // Saving another companion keeps the rabbit exactly.
    s2.saveCat(s2.loadCat(mulberry32(8), NOW, 'slime').cat, 'slime');
    expect(s2.loadCat(mulberry32(7), NOW, 'rabbit').cat).toEqual(rabbit);
  });

  it('treats an unreadable or foreign registry as fresh companions, never touching the cat', () => {
    for (const bad of ['{not json', '[]', '{"schemaVersion":99,"characters":{}}', '{"schemaVersion":1,"characters":5}']) {
      const mem = memoryStorage({ [CHARACTERS_STORAGE_KEY]: bad, [CAT_STORAGE_KEY]: 'cat-bytes' });
      const s = openWebStorage(() => mem, memoryLogger());
      expect(s.loadCat(mulberry32(1), NOW, 'monkey').source).toBe('recovered');
      expect(mem.data.get(CAT_STORAGE_KEY)).toBe('cat-bytes');
    }
  });

  it('clears the registry with the rest on Start over', () => {
    const mem = memoryStorage();
    const s = openWebStorage(() => mem, memoryLogger());
    s.saveCat(s.loadCat(mulberry32(1), NOW, 'alien').cat, 'alien');
    s.saveSettings(defaultSettings());
    expect(s.clearAll()).toBe(true);
    expect(mem.data.size).toBe(0);
  });

  it('a swap persists the current companion first: each store saves into its own slot', () => {
    const mem = memoryStorage();
    const storage = openWebStorage(() => mem, memoryLogger());
    const foxCat = storage.loadCat(mulberry32(2), NOW, 'fox').cat;
    const store = createWebCatStore({ storage, snapshot: () => foxCat, character: 'fox', logger: memoryLogger(), setInterval: () => 1, clearInterval: () => undefined });
    expect(store.saveSync()).toBe(true);
    store.freeze();
    expect(store.saveSync()).toBe(false);
    expect(mem.data.has(CAT_STORAGE_KEY)).toBe(false);
    expect(openWebStorage(() => mem, memoryLogger()).loadCat(mulberry32(1), NOW, 'fox').cat).toEqual(foxCat);
  });
});

describe('settings allow-lists for GizeMate', () => {
  it('lets the active companion, language, names and palettes through, validated like the schema', () => {
    expect(patchFor({ field: 'activeCharacter', value: 'ghost' })).toEqual({ general: { activeCharacter: 'ghost' } });
    expect(patchFor({ field: 'activeCharacter', value: 'dragon' as CharacterId })).toBeNull();
    expect(patchFor({ field: 'language', value: 'tr' })).toEqual({ general: { language: 'tr' } });
    expect(patchFor({ field: 'language', value: 'de' as 'en' })).toBeNull();
    expect(patchFor({ field: 'characterName', id: 'slime', value: '  Jel ' })).toEqual({ general: { characterNames: { slime: 'Jel' } } });
    expect(patchFor({ field: 'characterName', id: 'slime', value: ' ' })).toBeNull();
    expect(patchFor({ field: 'characterName', id: 'slime', value: 'x'.repeat(25) })).toBeNull();
    expect(patchFor({ field: 'characterName', id: 'cat', value: 'Pamuk' })).toBeNull();
    const skin = getCharacter('fox').skins[0] ?? '';
    expect(patchFor({ field: 'characterSkin', id: 'fox', value: skin })).toEqual({ appearance: { characterSkins: { fox: skin } } });
    expect(patchFor({ field: 'characterSkin', id: 'fox', value: 'no-such-palette' })).toBeNull();
    let cur = webSettings(null);
    const patches = [
      { general: { activeCharacter: 'ghost', language: 'tr' } },
      { general: { characterNames: { ghost: 'Hayalet' } } },
      { appearance: { characterSkins: { ghost: getCharacter('ghost').skins[0] } } },
    ];
    for (const p of patches) {
      const r = applyWebPatch(cur, p);
      expect(r.ok).toBe(true);
      if (r.ok) cur = r.settings;
    }
    expect(cur.general.activeCharacter).toBe('ghost');
    expect(cur.general.language).toBe('tr');
    expect(cur.general.characterNames).toEqual({ ghost: 'Hayalet' });
  });

  it('refuses bad maps and keeps everything else outside the list refused', () => {
    expect(rejectNonWebPatch({ general: { characterNames: { cat: 'x' } } })).not.toBeNull();
    expect(rejectNonWebPatch({ general: { characterNames: { dragon: 'x' } } })).not.toBeNull();
    expect(rejectNonWebPatch({ appearance: { characterSkins: { fox: 'no-such-palette' } } })).not.toBeNull();
    expect(rejectNonWebPatch({ general: { launchAtLogin: true } })).not.toBeNull();
    expect(applyWebPatch(webSettings(null), { general: { activeCharacter: 'nope' } }).ok).toBe(false);
  });

  it('stores and reads back the choices; perception stays forced off', () => {
    const s = webSettings(null);
    s.general.activeCharacter = 'alien';
    s.general.language = 'tr';
    s.general.characterNames = { alien: 'Zuzu' };
    s.appearance.characterSkins = { alien: getCharacter('alien').skins[0] ?? 'x' };
    const back = webSettings(JSON.parse(JSON.stringify(storedSettings(s))));
    expect(back.general.activeCharacter).toBe('alien');
    expect(back.general.language).toBe('tr');
    expect(back.general.characterNames).toEqual({ alien: 'Zuzu' });
    expect(back.appearance.characterSkins).toEqual(s.appearance.characterSkins);
    expect(back.perception.visualMode).toBe('off');
    // v1.5.0 stored settings (no new fields) read as the cat, automatic language.
    const old = webSettings({ schemaVersion: 3, general: { catName: 'Pamuk' } });
    expect(old.general.catName).toBe('Pamuk');
    expect(old.general.activeCharacter).toBe('cat');
    expect(old.general.language).toBe('auto');
  });
});

describe('window bounds of every module', () => {
  for (const id of CHARACTER_IDS) {
    for (const size of [0.5, 2.5]) {
      it(`${id} at size ${size} stays inside native caps (touch included)`, () => {
        for (const emotes of [true, false]) {
          const w = windowSizeDip({ size, emotes }, id);
          expect(w.width).toBeGreaterThan(0);
          expect(w.width).toBeLessThanOrEqual(STAGE_MAX_W_DP);
          expect(w.height).toBeLessThanOrEqual(STAGE_MAX_H_DP);
          const body = getCharacter(id).body;
          const bounds = { x: 100, y: 100, width: body.widthDip * size, height: body.heightDip * size };
          const rect = windowRectFor(bounds, { size, emotes }, 2.625, id);
          const touch = touchRectFor(bounds, 2.625);
          expect(rect.width).toBeLessThanOrEqual(STAGE_MAX_W_DP);
          expect(rect.height).toBeLessThanOrEqual(STAGE_MAX_H_DP);
          expect(touch.width).toBeLessThanOrEqual(TOUCH_MAX_DP);
          expect(touch.height).toBeLessThanOrEqual(TOUCH_MAX_DP);
          expect(touch.width).toBeLessThanOrEqual(rect.width);
          expect(touch.height).toBeLessThanOrEqual(rect.height);
        }
      });
    }
  }

  it('keeps the cat numbers unchanged (430 x 490 at 2.5 with the emote room)', () => {
    expect(windowSizeDip({ size: 2.5, emotes: true })).toEqual({ width: 430, height: 490 });
    expect(windowSizeDip({ size: 1, emotes: true }, 'cat')).toEqual({ width: 84 + 2 * BODY_MARGIN_SIDE_DIP, height: 64 + EMOTE_MARGIN_TOP_DIP + BODY_MARGIN_BOTTOM_DIP });
  });

  it('sizes a tall ghost and a wide fox from their own body', () => {
    expect(windowSizeDip({ size: 1, emotes: true }, 'ghost').height).toBeGreaterThan(windowSizeDip({ size: 1, emotes: true }, 'cat').height);
    expect(windowSizeDip({ size: 1, emotes: true }, 'fox').width).toBeGreaterThan(windowSizeDip({ size: 1, emotes: true }, 'cat').width);
  });

  it('clamps a message native would drop (too large stage or touch, touch beyond the stage)', () => {
    expect(clampWinRects({ w: 9000, h: 2000, tw: 900, th: 900 })).toEqual({ w: STAGE_MAX_W_DP, h: STAGE_MAX_H_DP, tw: TOUCH_MAX_DP, th: TOUCH_MAX_DP });
    expect(clampWinRects({ w: 300, h: 200, tw: 400, th: 400 })).toEqual({ w: 300, h: 200, tw: 300, th: 200 });
    expect(clampWinRects({ w: 300, h: 200, tw: 100, th: 50 })).toEqual({ w: 300, h: 200, tw: 100, th: 50 });
  });
});

describe('the active companion for the renderer and the name tracker', () => {
  it('feeds the cat its catName and the others their chosen or localised default name', () => {
    const s = defaultSettings();
    s.general.catName = 'Pamuk';
    expect(activeCharacterOf(s)).toBe('cat');
    expect(companionName(s, 'en')).toBe('Pamuk');
    for (const id of others) {
      s.general.activeCharacter = id;
      s.general.characterNames = {};
      expect(companionName(s, 'tr')).toBe(t('tr', `character.${id}.name` as I18nKey));
      expect(companionName(s, 'en')).toBe(t('en', `character.${id}.name` as I18nKey));
      s.general.characterNames = { [id]: 'Benim' };
      expect(companionName(s, 'en')).toBe('Benim');
    }
  });

  it('uses the cat appearance untouched and a character palette for the others', () => {
    const s = defaultSettings();
    expect(renderAppearance(s)).toBe(s.appearance);
    s.general.activeCharacter = 'fox';
    expect(effectiveSkin(s)).toBe(getCharacter('fox').skins[0]);
    const second = getCharacter('fox').skins[1];
    if (second) {
      s.appearance.characterSkins = { fox: second };
      expect(renderAppearance(s).skin).toBe(second);
    }
    s.appearance.characterSkins = { fox: 'bogus' };
    expect(effectiveSkin(s)).toBe(getCharacter('fox').skins[0]);
  });
});

describe('locale wiring', () => {
  const doc = () => ({ documentElement: { lang: '' } });
  it('resolves the preference over the browser list, sets <html lang> and hands it to the strings layer', () => {
    const s = defaultSettings();
    const d = doc();
    const seen: string[] = [];
    expect(applyWebLocale(s, ['tr-TR', 'en'], d, (l) => seen.push(l))).toBe('tr');
    expect(d.documentElement.lang).toBe('tr');
    expect(applyWebLocale(s, ['de-DE'], d, (l) => seen.push(l))).toBe('en');
    s.general.language = 'tr';
    expect(applyWebLocale(s, ['en-US'], d, (l) => seen.push(l))).toBe('tr');
    s.general.language = 'en';
    expect(applyWebLocale(s, ['tr'], d)).toBe('en');
    expect(seen).toEqual(['tr', 'en', 'tr']);
  });

  it('never stores the detected language', () => {
    const s = webSettings(null);
    applyWebLocale(s, ['tr-TR'], doc());
    expect(s.general.language).toBe('auto');
    expect(JSON.stringify(storedSettings(s))).toContain('"language":"auto"');
  });
});
