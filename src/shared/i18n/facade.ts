// A locale-aware facade over a pair of typed string tables (used by the settings window's `S` and the
// web host's `WS`). The facade keeps the table's exact shape, so existing call sites (`S.nav.about`,
// `S.format.ago(d)`) keep compiling, and resolves every property against the ACTIVE locale at access
// time. That includes code that captured a group at module load (`const G = S.general`): nested groups
// are lazy proxies, so a live language change shows up on the next read without re-importing anything.
import { DEFAULT_LOCALE, type Locale } from './locale';

/**
 * The shape a translation must have: strings stay strings (any text), functions keep their parameters,
 * tuples keep their length, objects keep their keys. A missing or extra key is a compile error.
 */
export type Mirror<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Mirror<R>
    : T extends readonly unknown[]
      ? { [K in keyof T]: Mirror<T[K]> }
      : T extends object
        ? { [K in keyof T]: Mirror<T[K]> }
        : T;

export interface LocaleFacade<T extends object> {
  /** Same shape as the English table; every read follows the active locale. */
  readonly facade: T;
  setLocale(locale: Locale): void;
  getLocale(): Locale;
}

type Tables<T> = Readonly<Record<Locale, T>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function resolve(tables: Tables<object>, locale: Locale, path: readonly string[]): unknown {
  const walk = (root: unknown): unknown => {
    let node: unknown = root;
    for (const key of path) {
      if (!isPlainObject(node) && !Array.isArray(node)) return undefined;
      if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  };
  // A key missing from the active table (an older catalogue) falls back to English, never to undefined.
  const hit = walk(tables[locale]);
  return hit !== undefined ? hit : walk(tables[DEFAULT_LOCALE]);
}

export function createLocaleFacade<T extends object>(tables: Tables<T>, initial: Locale = DEFAULT_LOCALE): LocaleFacade<T> {
  let active: Locale = initial;

  const node = (path: readonly string[]): object => {
    const english = resolve(tables, DEFAULT_LOCALE, path);
    const target = (isPlainObject(english) ? english : {}) as object;
    return new Proxy(target, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        const value = resolve(tables, active, [...path, prop]);
        return isPlainObject(value) ? node([...path, prop]) : value;
      },
      has: (_t, prop) => typeof prop === 'string' && resolve(tables, active, [...path, prop]) !== undefined,
      ownKeys: () => {
        const here = resolve(tables, active, path);
        return isPlainObject(here) ? Object.keys(here) : [];
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        const value = resolve(tables, active, [...path, prop]);
        if (value === undefined) return undefined;
        return { value: isPlainObject(value) ? node([...path, prop]) : value, enumerable: true, configurable: true, writable: true };
      },
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
    });
  };

  return {
    facade: node([]) as T,
    setLocale: (locale) => {
      active = locale;
    },
    getLocale: () => active,
  };
}
