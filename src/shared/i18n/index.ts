// GizeMate localisation: one typed catalogue shared by the Windows main process, the settings window and
// the web/Android host. `en` is the source of truth for the key set; `tr` must mirror it exactly (a
// missing key is a compile error, and a test checks placeholders and plural forms too). Catalogues are
// plain bundled objects: no fetch, no eval (the settings window's CSP forbids both).
//
// Values are strings with {name} placeholders, filled by `t`. Plurals and lists use Intl through the
// helpers below. A missing key at run time (an older catalogue, a typo past the type system) falls back
// to English, then to the key itself, so the UI never shows `undefined`.
import { en } from './en';
import { tr } from './tr';
import { DEFAULT_LOCALE, type Locale } from './locale';

export * from './locale';
export { en, tr };

/** Every key of the catalogue as a dotted path: 'character.monkey.name'. */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends Record<string, unknown> ? Paths<T[K], `${P}${K}.`> : never;
}[keyof T & string];
export type I18nKey = Paths<typeof en>;

const CATALOGUES: Readonly<Record<Locale, unknown>> = { en, tr };

function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type I18nParams = Readonly<Record<string, string | number>>;

/** The text for `key` in `locale`, with {placeholders} replaced; falls back to English, then to the key. */
export function t(locale: Locale, key: I18nKey, params?: I18nParams): string {
  const raw = lookup(CATALOGUES[locale], key) ?? lookup(CATALOGUES[DEFAULT_LOCALE], key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m));
}

/** Plural form of `count` for `locale`: pass the CLDR categories you have ('one', 'other'); 'other' is required. */
export function plural(locale: Locale, count: number, forms: Readonly<{ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>>): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return forms[rule] ?? forms.other;
}

/** "a, b and c" in the locale's list style. */
export function list(locale: Locale, items: readonly string[]): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}
