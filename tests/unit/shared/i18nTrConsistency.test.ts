// Turkish is the formal "siz" register everywhere, the companion is "arkadaş", and the same palette is worded
// the same on the desktop and on the web panel; the Android native Turkish text follows the same register.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tr } from '../../../src/shared/i18n';
import { UI_EN } from '../../../src/renderer/settings/strings.ui.en';
import { UI_TR } from '../../../src/renderer/settings/strings.ui.tr';
import { WEB_STRING_TABLES } from '../../../src/web/strings';

const INFORMAL = /(?<![\p{L}])(seni|senin|sana|sende|eşyalarının|Arkadaşın|durdurabilirsin|dokun|yapabilirsin|kullanabilirsin)(?![\p{L}])/u;

const flatten = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) flatten(x, out);
  return out;
};

describe('Turkish register and terms', () => {
  it('the character copy has no informal singular and calls the companion "arkadaş", never "yol arkadaşı"', () => {
    const text = flatten(tr.character).join('\n');
    expect(text).not.toMatch(INFORMAL);
    expect(text).not.toMatch(/yol arkadaş/i);
    expect(tr.character.ghost.personality.startsWith('Oyunbaz')).toBe(true);
  });

  it('the settings window and web panel say "arkadaş" and "Oyunbaz" consistently', () => {
    const text = flatten(UI_TR).concat(flatten(WEB_STRING_TABLES.tr)).join('\n');
    expect(text).not.toMatch(/yol arkadaş/i);
    expect(text).not.toMatch(INFORMAL);
  });

  it('the desktop and the web panel word each palette the same, in both languages', () => {
    const desktop = { en: UI_EN.ui.customize.skins as Record<string, string>, tr: UI_TR.ui.customize.skins as Record<string, string> };
    for (const locale of ['en', 'tr'] as const) {
      for (const [id, label] of Object.entries(WEB_STRING_TABLES[locale].palettes)) {
        if (id in desktop[locale]) expect(label, `${locale}:${id}`).toBe(desktop[locale][id]);
      }
    }
  });

  it('the Android Turkish strings use the formal register and say how the language is chosen', () => {
    const xml = readFileSync(resolve(__dirname, '../../../android/app/src/main/res/values-tr/strings.xml'), 'utf8');
    expect(xml).not.toMatch(INFORMAL);
    expect(xml).toMatch(/Arkadaşınız/);
    expect(xml).toMatch(/cihaz diline uyar/);
    expect(readFileSync(resolve(__dirname, '../../../android/app/src/main/res/values/strings.xml'), 'utf8')).toMatch(/follow the DEVICE language/);
  });
});
