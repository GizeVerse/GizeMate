// Every user-visible string of the settings window, behind a locale-aware facade. `S` keeps the exact
// shape the pages were written against (groups, strings, functions), but every read resolves against the
// ACTIVE locale (setLocale), including groups a page captured at module load (`const G = S.general`).
// English lives in strings.en.ts (the source of truth for the shape), Turkish in strings.tr.a.ts and
// strings.tr.b.ts, typed against it so a missing key is a compile error. Product names come from
// shared/brand.ts inside those files.
import { createLocaleFacade } from '../../shared/i18n/facade';
import type { Locale } from '../../shared/i18n/locale';
import type { AppStatus } from '../../shared/ipc';
import { setWorldTextLocale } from '../../shared/worldText';
import { S_EN } from './strings.en';
import { S_TR_A } from './strings.tr.a';
import { S_TR_B } from './strings.tr.b';

export type Strings = typeof S_EN;

const S_TR: Strings = { ...S_TR_A, ...S_TR_B } as unknown as Strings;
const handle = createLocaleFacade<Strings>({ en: S_EN, tr: S_TR });

/** The settings window's strings in the active locale. */
export const S: Strings = handle.facade;

/** Switches the whole settings window's text; call before (re)building the UI. */
export const setLocale = (locale: Locale): void => {
  handle.setLocale(locale);
  setWorldTextLocale(locale);
};
export const getLocale = (): Locale => handle.getLocale();
/** Both catalogues, for tests (parity, length) and tools; the UI reads `S`. */
export const STRING_TABLES: Readonly<Record<Locale, Strings>> = { en: S_EN, tr: S_TR };

/**
 * Which wording a platform-specific string uses (1.4.0): 'windows' on Windows and without a platform
 * report (the pre-1.4.0 text, unchanged), 'mac' on macOS, 'elsewhere' on any other platform. The keys
 * follow the same split: `x` (Windows), `xMac`, `xElsewhere`.
 */
export type PlatformWording = 'windows' | 'mac' | 'elsewhere';
export function platformWording(platform: Pick<NonNullable<AppStatus['platform']>, 'id'> | undefined | null): PlatformWording {
  if (!platform || platform.id === 'win32') return 'windows';
  return platform.id === 'darwin' ? 'mac' : 'elsewhere';
}

const DEVICE_NOUN = { mac: 'Mac', elsewhere: 'computer' } as const;

/**
 * A sentence written for Windows, in this platform's words (1.4.0). "this PC", "the PC" and "your PC"
 * are the only difference in the privacy and AI sentences, so they are swapped here instead of tripled.
 * Also covers what main sends (AI labels and block reasons from src/core/perception). On Windows the
 * sentence comes back unchanged. Turkish sentences say "bu bilgisayar" and are swapped the same way
 * ("bu Mac"); off macOS the Turkish word already fits.
 */
export function deviceWords(text: string, wording: PlatformWording): string {
  if (wording === 'windows') return text;
  if (handle.getLocale() === 'tr') {
    if (wording !== 'mac') return text;
    // Mac ends in a hard consonant, so the suffix after the apostrophe softens (-da -> -te, -ın -> -in).
    const suffix: Record<string, string> = { ın: 'in', da: 'te', dan: 'ten', daki: 'teki', a: 'e', ı: 'i' };
    return text
      .replace(/\bbu bilgisayar(daki|dan|da|ın|a|ı)?(?![\p{L}])/gu, (_m, s: string | undefined) => (s ? `bu Mac’${suffix[s]}` : 'bu Mac'))
      .replace(/\bbilgisayarınız(?![\p{L}])/gu, 'Mac’iniz');
  }
  return text.replace(/\b(this|the|your) PC\b/g, `$1 ${DEVICE_NOUN[wording]}`);
}
