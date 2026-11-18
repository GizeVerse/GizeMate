// Locale resolution (GizeMate). Pure and platform-agnostic: the host passes the system language it
// reads (Electron's app.getLocale(), the WebView's navigator.language); this file decides.
//
// Rules: an explicit user choice ('en' or 'tr') always wins and is never overwritten by detection;
// 'auto' (the default) is Turkish when the system language is Turkish and English for everything
// else. The detected language itself is never stored.

export const LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** The stored choice: a language, or follow the system. */
export type LanguagePreference = Locale | 'auto';

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** True for 'tr', 'tr-TR', 'TR_tr' and other tags whose primary language subtag is Turkish. */
export function isTurkishTag(tag: string | undefined | null): boolean {
  if (typeof tag !== 'string') return false;
  return /^tr(?:[-_]|$)/i.test(tag.trim());
}

/**
 * The effective language. `systemLocales` are the system's language tags, most preferred first (a
 * single tag is fine); only the first usable one decides, so a Turkish-second list stays English.
 */
export function resolveLocale(preference: LanguagePreference | undefined, systemLocales: string | readonly string[] | undefined): Locale {
  if (preference === 'en' || preference === 'tr') return preference;
  const list = typeof systemLocales === 'string' ? [systemLocales] : (systemLocales ?? []);
  const first = list.find((t) => typeof t === 'string' && t.trim().length > 0);
  return isTurkishTag(first) ? 'tr' : 'en';
}

/**
 * The system language from a chain of readers, most trustworthy first. A reader may throw or return an
 * empty value (an API that is only valid after a host is ready); it is skipped, never fatal. Empty when no
 * reader yields a tag, which resolveLocale reads as English.
 */
export function firstSystemLocale(readers: ReadonlyArray<() => string | undefined | null>): string {
  for (const read of readers) {
    try {
      const tag = read();
      if (typeof tag === 'string' && tag.trim().length > 0) return tag.trim();
    } catch {
      // try the next reader
    }
  }
  return '';
}
