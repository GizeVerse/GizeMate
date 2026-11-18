// Every user-visible string of the web host (1.4.0), behind a locale-aware facade. `WS` keeps the shape the
// host code was written against; every read resolves against the ACTIVE locale (setLocale). English lives in
// strings.en.ts (source of truth for the shape), Turkish in strings.tr.ts (typed against it). The coat,
// drawing style and personality labels are the desktop's own (src/renderer/settings/strings*.ts), copied
// rather than imported to keep the desktop settings strings (and what they import) out of the web bundle;
// tests/unit/web/strings.test.ts asserts they stay equal in both languages.
//
// A web host resolves its language with resolveLocale(settings.general.language, navigator.languages)
// and calls setLocale with the result (`hostLocale` below does both).
import { createLocaleFacade } from '../shared/i18n/facade';
import { resolveLocale, type LanguagePreference, type Locale } from '../shared/i18n/locale';
import { setWorldTextLocale } from '../shared/worldText';
import type { InstallHint } from './hostMode';
import { WS_EN } from './strings.en';
import { WS_TR } from './strings.tr';

export type { Place } from './strings.en';
export type WebStrings = typeof WS_EN;

const handle = createLocaleFacade<WebStrings>({ en: WS_EN, tr: WS_TR as unknown as WebStrings });

/** The web host's strings in the active locale. */
export const WS: WebStrings = handle.facade;

/** Both catalogues, for tests (parity, length) and tools; the host reads `WS`. */
export const WEB_STRING_TABLES: Readonly<Record<Locale, WebStrings>> = { en: WS_EN, tr: WS_TR as unknown as WebStrings };

/** The strings of one locale as a plain object (not the live facade), for code that holds a fixed language. */
export function createStrings(locale: Locale): WebStrings {
  return WEB_STRING_TABLES[locale];
}

/** Switches the whole web host's text (and the world-event text it shows); call before re-rendering. */
export function setLocale(locale: Locale): void {
  handle.setLocale(locale);
  setWorldTextLocale(locale);
}
export const getLocale = (): Locale => handle.getLocale();

/**
 * The language for this page: the stored preference ('auto' by default) against the browser's languages.
 * An explicit 'en' or 'tr' always wins; 'auto' follows the first browser language and never gets written back.
 */
export function hostLocale(preference: LanguagePreference | undefined, languages: readonly string[] | string | undefined): Locale {
  return resolveLocale(preference, languages);
}

/** The install section's text for a hint (the button label for 'prompt'); null shows no section. */
export function installText(hint: InstallHint): string | null {
  switch (hint) {
    case 'none':
      return null;
    case 'installed':
      return WS.install.installed;
    case 'prompt':
      return WS.install.promptDesc;
    case 'apple':
      return WS.install.apple;
    case 'menu':
      return WS.install.menu;
  }
}
