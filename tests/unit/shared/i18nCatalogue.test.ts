// The shared catalogue (src/shared/i18n): en/tr key parity, placeholders, fallback to English,
// locale resolution, plural/list helpers, and a length sanity check for short Turkish UI labels.
import { describe, expect, it } from 'vitest';
import { en, list, plural, resolveLocale, t, tr, type I18nKey } from '../../../src/shared/i18n';
import { isTurkishTag } from '../../../src/shared/i18n/locale';

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const EN = leaves(en);
const TR = new Map(leaves(tr));

describe('catalogue parity', () => {
  it('has exactly the same keys in English and Turkish', () => {
    expect([...TR.keys()].sort()).toEqual(EN.map(([k]) => k).sort());
  });

  it('keeps the same {placeholders} in every Turkish string', () => {
    for (const [key, text] of EN) expect(placeholders(TR.get(key) ?? ''), key).toEqual(placeholders(text));
  });

  it('has no empty or untranslated-looking Turkish string where English has text', () => {
    for (const [key, text] of EN) {
      const trText = TR.get(key) ?? '';
      expect(trText.length > 0, key).toBe(text.length > 0);
    }
  });

  it('plural() picks CLDR categories per locale and falls back to other', () => {
    // Turkish and English both select 'one' for 1 and 'other' otherwise; text after a numeral stays singular in Turkish.
    expect(plural('tr', 1, { one: 'a', other: 'b' })).toBe('a');
    expect(plural('tr', 5, { one: 'a', other: 'b' })).toBe('b');
    expect(plural('tr', 2, { other: 'only' })).toBe('only');
    expect(plural('en', 1, { one: 'a', other: 'b' })).toBe('a');
    expect(plural('en', 2, { one: 'a', other: 'b' })).toBe('b');
  });

  it('tray state names cover every behaviour state in both languages', async () => {
    const { BEHAVIOR_STATES } = await import('../../../src/shared/cat');
    for (const s of BEHAVIOR_STATES) {
      expect(t('en', `tray.state.${s}` as I18nKey)).not.toBe(`tray.state.${s}`);
      expect(t('tr', `tray.state.${s}` as I18nKey)).not.toBe(`tray.state.${s}`);
    }
  });
});

describe('t()', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(t('en', 'menu.show', { name: 'Miso' })).toBe('Show Miso');
    expect(t('tr', 'menu.show', { name: 'Miso' })).toContain('Miso');
    expect(t('en', 'menu.show')).toBe('Show {name}');
  });

  it('falls back to English for a key missing from the Turkish catalogue, then to the key itself', () => {
    const menu = (tr as unknown as { menu: Record<string, string> }).menu;
    const saved = menu.play;
    try {
      delete menu.play;
      expect(t('tr', 'menu.play')).toBe('Play');
    } finally {
      menu.play = saved as string;
    }
    expect(t('tr', 'no.such.key' as I18nKey)).toBe('no.such.key');
    // An own-property lookup only: a key naming an Object.prototype member never resolves to a function.
    expect(t('en', 'constructor' as I18nKey)).toBe('constructor');
    expect(t('en', 'menu.constructor' as I18nKey)).toBe('menu.constructor');
  });
});

describe('resolveLocale', () => {
  it('an explicit choice always wins over the system language', () => {
    expect(resolveLocale('tr', 'en-US')).toBe('tr');
    expect(resolveLocale('en', 'tr-TR')).toBe('en');
    expect(resolveLocale('en', ['tr', 'tr-TR'])).toBe('en');
    expect(resolveLocale('tr', undefined)).toBe('tr');
    expect(resolveLocale('tr', '')).toBe('tr');
  });

  it('auto follows a Turkish system language and is English otherwise', () => {
    for (const tag of ['tr', 'tr-TR', 'TR_tr', 'Tr-tr', ' tr-TR ']) expect(resolveLocale('auto', tag), tag).toBe('tr');
    for (const tag of ['en-US', 'en', 'de', 'de-DE', 'trk', 'tru-XX', '', '  ']) expect(resolveLocale('auto', tag), tag).toBe('en');
    expect(resolveLocale(undefined, 'tr-TR')).toBe('tr');
    expect(resolveLocale('auto', undefined)).toBe('en');
    expect(resolveLocale('auto', [])).toBe('en');
  });

  it('decides on the first usable language of a list only', () => {
    expect(resolveLocale('auto', ['tr-TR', 'en-US'])).toBe('tr');
    expect(resolveLocale('auto', ['en-US', 'tr-TR'])).toBe('en');
    expect(resolveLocale('auto', ['', 'tr'])).toBe('tr');
  });

  it('isTurkishTag rejects non-strings', () => {
    expect(isTurkishTag(undefined)).toBe(false);
    expect(isTurkishTag(null)).toBe(false);
  });
});

describe('list()', () => {
  it('joins in the locale style', () => {
    expect(list('en', ['a', 'b', 'c'])).toBe('a, b, and c');
    expect(list('tr', ['a', 'b'])).toMatch(/^a ve b$/);
  });
});

describe('Turkish text length', () => {
  // Short UI labels have little room (menus, buttons, tray). A Turkish label more than twice as long as the
  // English one (plus a few characters of slack for very short words) is flagged.
  const SHORT = 24;
  it('keeps short English labels from growing past twice their length', () => {
    const offenders: string[] = [];
    for (const [key, text] of EN) {
      if (text.length === 0 || text.length > SHORT) continue;
      const trText = TR.get(key) ?? '';
      if (trText.length > text.length * 2 + 6) offenders.push(`${key}: "${text}" (${text.length}) -> "${trText}" (${trText.length})`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the longest tray tooltip within the Windows limit in Turkish', async () => {
    const { trayTooltip } = await import('../../../src/main/lifecycle/menuModel');
    const { BEHAVIOR_STATES } = await import('../../../src/shared/cat');
    for (const state of BEHAVIOR_STATES) {
      for (const perceptionMode of ['off', 'local-stats', 'ai-local', 'ai-cloud'] as const) {
        const text = trayTooltip({
          catName: 'x',
          hidden: false,
          paused: false,
          state,
          interactionsEnabled: true,
          perceptionConfigured: true,
          perceptionPaused: true,
          perceptionMode,
          locale: 'tr',
        });
        expect(text.length).toBeLessThanOrEqual(127);
      }
    }
  });
});
