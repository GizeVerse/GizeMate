import { describe, expect, it } from 'vitest';
import { activeCharacterOf, appearanceFor, bodyMargins, characterDisplayName, characterPalette, effectiveLocale } from '../../../src/main/characterIdentity';
import { BODY_MARGIN_BOTTOM_DIP, BODY_MARGIN_SIDE_DIP, BODY_MARGIN_TOP_DIP, EMOTE_MARGIN_TOP_DIP, displaysShowingCat, presenceRectPx } from '../../../src/main/overlay/renderMapping';
import type { SimOutput } from '../../../src/shared/sim';
import { getCharacter } from '../../../src/shared/characters/registry';
import { t } from '../../../src/shared/i18n';
import { applySettingsPatch, defaultSettings, type Settings } from '../../../src/shared/settings';

function withSettings(patch: unknown): Settings {
  const r = applySettingsPatch(defaultSettings(), patch);
  if (!r.ok) throw new Error(r.error);
  return r.settings;
}

describe('names', () => {
  it('the cat is called general.catName', () => {
    const s = withSettings({ general: { catName: 'Pamuk' } });
    expect(characterDisplayName(s, 'cat', 'en')).toBe('Pamuk');
    expect(characterDisplayName(s, 'cat', 'tr')).toBe('Pamuk');
  });

  it('another character uses the user name, else the localised default, ignoring blank entries', () => {
    const s = withSettings({ general: { characterNames: { monkey: 'Coco' } } });
    expect(characterDisplayName(s, 'monkey', 'en')).toBe('Coco');
    expect(characterDisplayName(s, 'fox', 'en')).toBe(t('en', 'character.fox.name'));
    expect(characterDisplayName(s, 'fox', 'tr')).toBe(t('tr', 'character.fox.name'));
    const blank = { ...s, general: { ...s.general, characterNames: { monkey: '   ' } } };
    expect(characterDisplayName(blank, 'monkey', 'en')).toBe(t('en', 'character.monkey.name'));
    // the cat's name never leaks into another character
    expect(characterDisplayName(withSettings({ general: { catName: 'Pamuk' } }), 'rabbit', 'en')).toBe(t('en', 'character.rabbit.name'));
  });
});

describe('palettes', () => {
  it('the cat uses appearance.skin', () => {
    const s = withSettings({ appearance: { skin: 'calico' } });
    expect(characterPalette(s, 'cat')).toBe('calico');
    expect(appearanceFor(s, 'cat')).toBe(s.appearance);
  });

  it('another character uses its chosen palette when its module has it, else the first', () => {
    const skins = getCharacter('fox').skins;
    const second = skins[1] ?? skins[0]!;
    const s = withSettings({ appearance: { skin: 'black', characterSkins: { fox: second, rabbit: 'no-such-palette' } } });
    expect(characterPalette(s, 'fox')).toBe(second);
    expect(characterPalette(s, 'rabbit')).toBe(getCharacter('rabbit').skins[0]);
    expect(characterPalette(s, 'ghost')).toBe(getCharacter('ghost').skins[0]);
    expect(appearanceFor(s, 'fox').skin).toBe(second);
    // the cat's own skin is not a palette of another character
    expect(characterPalette(withSettings({ appearance: { skin: 'siamese' } }), 'monkey')).toBe(getCharacter('monkey').skins[0]);
  });
});

describe('active character and locale', () => {
  it('defaults to the cat and follows settings.general.activeCharacter', () => {
    expect(activeCharacterOf(defaultSettings())).toBe('cat');
    expect(activeCharacterOf(withSettings({ general: { activeCharacter: 'slime' } }))).toBe('slime');
  });

  it('resolves the locale from the setting, then the system language (auto)', () => {
    const auto = defaultSettings();
    expect(effectiveLocale(auto, 'tr-TR')).toBe('tr');
    expect(effectiveLocale(auto, 'en-US')).toBe('en');
    expect(effectiveLocale(auto, undefined)).toBe('en');
    expect(effectiveLocale(withSettings({ general: { language: 'en' } }), 'tr')).toBe('en');
    expect(effectiveLocale(withSettings({ general: { language: 'tr' } }), 'en-US')).toBe('tr');
  });
});

describe('presence margins', () => {
  it('are exactly the shipped margins for the cat and never smaller for another body', () => {
    expect(bodyMargins(getCharacter('cat'))).toEqual({ sideDip: BODY_MARGIN_SIDE_DIP, topDip: BODY_MARGIN_TOP_DIP, bottomDip: BODY_MARGIN_BOTTOM_DIP });
    for (const id of ['monkey', 'fox', 'rabbit', 'ghost', 'slime', 'alien'] as const) {
      const m = bodyMargins(getCharacter(id));
      expect(m.sideDip).toBeGreaterThanOrEqual(BODY_MARGIN_SIDE_DIP);
      expect(m.topDip).toBeGreaterThanOrEqual(BODY_MARGIN_TOP_DIP);
      expect(m.bottomDip).toBeGreaterThanOrEqual(BODY_MARGIN_BOTTOM_DIP);
    }
    expect(bodyMargins(getCharacter('monkey')).topDip).toBeGreaterThan(BODY_MARGIN_TOP_DIP);
  });
});

describe('presence rect follows the body', () => {
  const out = { boundsPx: { x: 1000, y: 800, width: 100, height: 80 } } as unknown as SimOutput;
  const look = { size: 1, emotes: false };

  it('without margins (and with the cat margins) the rect is the shipped one, with or without emotes', () => {
    const cat = bodyMargins(getCharacter('cat'));
    for (const emotes of [false, true]) {
      expect(presenceRectPx(out, { size: 1.5, emotes }, 2, cat)).toEqual(presenceRectPx(out, { size: 1.5, emotes }, 2));
    }
    expect(presenceRectPx(out, look, 1)).toEqual({ x: 1000 - BODY_MARGIN_SIDE_DIP, y: 800 - BODY_MARGIN_TOP_DIP, width: 100 + 2 * BODY_MARGIN_SIDE_DIP, height: 80 + BODY_MARGIN_TOP_DIP + BODY_MARGIN_BOTTOM_DIP });
    expect(presenceRectPx(out, { size: 1, emotes: true }, 1).y).toBe(800 - EMOTE_MARGIN_TOP_DIP);
  });

  it('a bigger body gets a bigger rect, scaled by size and display scale', () => {
    const m = { sideDip: 100, topDip: 120, bottomDip: 90 };
    const r = presenceRectPx(out, { size: 2, emotes: false }, 1.5, m);
    expect(r).toEqual({ x: 1000 - 100 * 3, y: 800 - 120 * 3, width: 100 + 2 * 300, height: 80 + 120 * 3 + 90 * 3 });
    expect(r.width).toBeGreaterThan(presenceRectPx(out, { size: 2, emotes: false }, 1.5).width);
  });

  it('displaysShowingCat uses the margins: a wide body reaches a display the cat margins do not', () => {
    const display = { id: 'd', boundsPx: { x: 1300, y: 0, width: 800, height: 1200 }, workAreaPx: { x: 1300, y: 0, width: 800, height: 1200 }, scaleFactor: 1 };
    const displays = [display] as unknown as Parameters<typeof displaysShowingCat>[1];
    const visible: SimOutput = { ...out, visible: true };
    const near: SimOutput = { ...visible, boundsPx: { x: 1100, y: 800, width: 100, height: 80 } };
    expect([...displaysShowingCat(near, displays, look, false)]).toEqual([]);
    expect([...displaysShowingCat(near, displays, look, false, { sideDip: 250, topDip: 60, bottomDip: 48 })]).toEqual(['d']);
  });
});
