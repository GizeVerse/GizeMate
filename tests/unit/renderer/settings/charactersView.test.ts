// The Characters area's view logic: card text and badges for every character in both languages, names and
// palettes of the active character (the cat keeps its legacy fields), and the patches they produce.
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CHARACTERS } from '../../../../src/shared/characters/registry';
import { applySettingsPatch, defaultSettings } from '../../../../src/shared/settings';
import {
  activeCharacterOf,
  allCharacterIds,
  characterCard,
  defaultCharacterName,
  displayName,
  paletteOf,
  renameLeaf,
  skinLabel,
  skinLeaf,
  storedName,
} from '../../../../src/renderer/settings/charactersView';
import { S, setLocale, STRING_TABLES } from '../../../../src/renderer/settings/strings';

describe('character cards', () => {
  it('all seven characters have a name, tagline, description, personality and interactions in English and Turkish', () => {
    expect(allCharacterIds()).toEqual([...CHARACTER_IDS]);
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale);
      for (const id of CHARACTER_IDS) {
        const c = characterCard(id, locale);
        for (const text of [c.name, c.tagline, c.description, c.personality, c.interactions]) {
          expect(text.length, `${locale} ${id}`).toBeGreaterThan(2);
          expect(text).not.toMatch(/^character\./);
        }
      }
    }
    setLocale('en');
    expect(characterCard('cat', 'en').name).not.toBe(characterCard('cat', 'tr').name);
  });

  it('badges follow the module: kind, locomotion and only the abilities it has', () => {
    for (const m of CHARACTERS) {
      const c = characterCard(m.id, 'en');
      expect(c.kind).toBe(m.kind);
      expect(c.kindLabel).toBe(m.kind === 'animal' ? S.ui.characters.kindAnimal : S.ui.characters.kindFantasy);
      const n = Object.values(m.capabilities).filter(Boolean).length;
      expect(c.abilities).toHaveLength(n);
    }
    expect(characterCard('cat', 'en').kind).toBe('animal');
    expect(characterCard('ghost', 'en').kind).toBe('fantasy');
  });

  it('an unknown id shows the cat', () => {
    expect(characterCard('nope' as never, 'en').id).toBe('cat');
    expect(activeCharacterOf({ general: { ...defaultSettings().general, activeCharacter: 'nope' as never } })).toBe('cat');
  });
});

describe('names', () => {
  it('the cat uses catName, the others characterNames, and an unnamed one shows the catalogue name', () => {
    const s = defaultSettings();
    expect(storedName(s, 'cat')).toBe(s.general.catName);
    expect(storedName(s, 'fox')).toBeNull();
    expect(displayName(s, 'fox', 'tr')).toBe(defaultCharacterName('fox', 'tr'));
    const named = { general: { ...s.general, characterNames: { fox: 'Rusty' } } };
    expect(displayName(named, 'fox', 'en')).toBe('Rusty');
    expect(displayName(named, 'cat', 'en')).toBe(s.general.catName);
  });

  it('rename patches are accepted by the settings schema; clearing a non-cat name removes it', () => {
    const s = defaultSettings();
    expect(renameLeaf(s, 'cat', 'Pixel')).toEqual({ key: 'catName', value: 'Pixel' });
    const fox = renameLeaf(s, 'fox', 'Rusty');
    expect(fox).toEqual({ key: 'characterNames', value: { fox: 'Rusty' } });
    expect(applySettingsPatch(s, { general: { [fox.key]: fox.value } }).ok).toBe(true);
    const withFox = { general: { ...s.general, characterNames: { fox: 'Rusty', ghost: 'Boo' } } };
    // Deliberate change (review fix): clearing sends the explicit removal ('' for the id); a plain one-level merge could never delete.
    const clear = renameLeaf(withFox, 'fox', '');
    expect(clear).toEqual({ key: 'characterNames', value: { fox: '' } });
    const stored = applySettingsPatch(s, { general: { characterNames: { fox: 'Rusty', ghost: 'Boo' } } });
    expect(stored.ok && stored.settings.general.characterNames).toEqual({ fox: 'Rusty', ghost: 'Boo' });
    const cleared = stored.ok ? applySettingsPatch(stored.settings, { general: { [clear.key]: clear.value } }) : stored;
    expect(cleared.ok && cleared.settings.general.characterNames).toEqual({ ghost: 'Boo' });
  });
});

describe('palettes', () => {
  it('come from the module, the first is the default and an unknown stored id falls back to it', () => {
    const s = defaultSettings();
    for (const m of CHARACTERS) {
      const p = paletteOf(s, m.id);
      expect(p.skins).toEqual(m.skins);
      expect(m.skins).toContain(p.current);
    }
    const first = CHARACTERS.find((m) => m.id === 'fox')!.skins[0];
    expect(paletteOf(s, 'fox').current).toBe(first);
    expect(paletteOf({ appearance: { ...s.appearance, characterSkins: { fox: 'plaid' } } }, 'fox').current).toBe(first);
    expect(paletteOf({ appearance: { ...s.appearance, characterSkins: { fox: 'arctic' } } }, 'fox').current).toBe('arctic');
  });

  it('the cat keeps appearance.skin, the others characterSkins; patches are accepted by the schema', () => {
    const s = defaultSettings();
    expect(skinLeaf(s, 'cat', 'gray')).toEqual({ key: 'skin', value: 'gray' });
    const fox = skinLeaf(s, 'fox', 'arctic');
    expect(fox).toEqual({ key: 'characterSkins', value: { fox: 'arctic' } });
    expect(applySettingsPatch(s, { appearance: { [fox.key]: fox.value } }).ok).toBe(true);
  });

  it('every palette of every character has a label in both languages', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale);
      for (const m of CHARACTERS) for (const skin of m.skins) expect(skinLabel(m.id, skin), `${locale} ${m.id} ${skin}`).not.toBe(skin);
      expect(Object.keys(STRING_TABLES[locale].ui.customize.skins).length).toBeGreaterThan(10);
    }
    setLocale('en');
  });
});
