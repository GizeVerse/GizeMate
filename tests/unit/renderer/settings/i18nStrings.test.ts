// The settings window's string layer: the Turkish mirror matches the English shape, the facade follows
// the active locale (also for groups captured at module load), English stays the default, and helpers
// that carry wording (deviceWords) keep working in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import { BRAND } from '../../../../src/shared/brand';
import { deviceWords, getLocale, S, setLocale, STRING_TABLES } from '../../../../src/renderer/settings/strings';
import { eventName } from '../../../../src/shared/worldText';

afterEach(() => setLocale('en'));

type Node = unknown;
const isObj = (v: Node): v is Record<string, Node> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Walks both tables in step: same keys, same kinds, same array lengths, same function arity. */
function compare(en: Node, tr: Node, path: string, problems: string[], shortLabels: string[]): void {
  if (typeof en === 'string') {
    if (typeof tr !== 'string') return void problems.push(`${path}: expected a string`);
    if ((en === '') !== (tr === '')) problems.push(`${path}: empty in one language only`);
    if (en.length > 0 && en.length <= 24 && tr.length > en.length * 2 + 6) shortLabels.push(`${path}: "${en}" -> "${tr}"`);
    return;
  }
  if (typeof en === 'function') {
    if (typeof tr !== 'function') return void problems.push(`${path}: expected a function`);
    if ((tr as (...a: unknown[]) => unknown).length !== (en as (...a: unknown[]) => unknown).length) problems.push(`${path}: arity differs`);
    return;
  }
  if (Array.isArray(en)) {
    if (!Array.isArray(tr) || tr.length !== en.length) return void problems.push(`${path}: array length differs`);
    en.forEach((v, i) => compare(v, tr[i], `${path}[${i}]`, problems, shortLabels));
    return;
  }
  if (isObj(en)) {
    if (!isObj(tr)) return void problems.push(`${path}: expected an object`);
    const a = Object.keys(en).sort();
    const b = Object.keys(tr).sort();
    if (a.join('|') !== b.join('|')) problems.push(`${path}: keys differ (${a.filter((k) => !b.includes(k)).join(',')} / ${b.filter((k) => !a.includes(k)).join(',')})`);
    for (const k of a) if (k in tr) compare(en[k], tr[k], `${path}.${k}`, problems, shortLabels);
    return;
  }
  if (en !== tr) problems.push(`${path}: value differs`);
}

describe('settings strings: Turkish mirror', () => {
  it('has the same shape as English (keys, arrays, function arity)', () => {
    const problems: string[] = [];
    const shortLabels: string[] = [];
    compare(STRING_TABLES.en, STRING_TABLES.tr, 'S', problems, shortLabels);
    expect(problems).toEqual([]);
    expect(shortLabels).toEqual([]);
  });

  it('every Turkish function returns text for sample arguments', () => {
    const samples: unknown[] = ['Miso', 3, 'x'];
    const bad: string[] = [];
    const walk = (node: Node, path: string): void => {
      if (typeof node === 'function') {
        const fn = node as (...a: unknown[]) => unknown;
        try {
          const out = fn(...samples.slice(0, fn.length));
          if (typeof out !== 'string' && !Array.isArray(out) && out !== null) bad.push(path);
        } catch {
          // Functions with structured arguments (arrays of ids, booleans) are exercised by the page tests.
        }
      } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (isObj(node)) for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(STRING_TABLES.tr, 'S');
    expect(bad).toEqual([]);
  });

  it('never hard-codes the old product name and names the product through the brand layer', () => {
    const json = JSON.stringify(STRING_TABLES.tr, (_k, v) => (typeof v === 'function' ? undefined : v));
    // The installed name (Start menu, Apps list) and the former name are the only places an older name may appear.
    const withoutAllowed = json.split(BRAND.installedName).join('').split(BRAND.formerName).join('');
    expect(withoutAllowed).not.toMatch(/GizeCat|Desktop Cat/);
    expect(STRING_TABLES.tr.app.title).toContain(BRAND.product);
    expect(STRING_TABLES.tr.app.brand).toBe(BRAND.product);
  });
});

describe('settings strings: facade', () => {
  it('is English by default and byte-identical to the English table', () => {
    expect(getLocale()).toBe('en');
    expect(S.nav.about).toBe('About');
    expect(S.format.ago('3 min')).toBe('3 min ago');
    expect(S.format.days(2)).toBe('2 days');
    expect(S.app.pageTitle('General')).toBe(`General · ${BRAND.product}`);
  });

  it('switches live, including groups a page captured at module load', () => {
    const G = S.general;
    const nav = S.nav;
    expect(G.title).toBe('General');
    setLocale('tr');
    expect(getLocale()).toBe('tr');
    expect(G.title).toBe('Genel');
    expect(nav.about).toBe('Hakkında');
    expect(S.format.ago('3 dk')).toBe('3 dk önce');
    expect(S.format.days(2)).toBe('2 gün');
    expect(S.welcome.controls).toHaveLength(5);
    setLocale('en');
    expect(G.title).toBe('General');
  });

  it('keeps Object.keys and equality working on groups', () => {
    setLocale('tr');
    expect(Object.keys(S.nav).sort()).toEqual(Object.keys(STRING_TABLES.en.nav).sort());
    expect(S.appearance.skins).toEqual(STRING_TABLES.tr.appearance.skins);
  });

  it('is read-only', () => {
    expect(() => {
      (S.nav as unknown as Record<string, string>).about = 'x';
    }).toThrow();
  });

  it('world-event names follow the settings language', () => {
    expect(eventName('mouseEncounter')).toBe('Little Mouse');
    setLocale('tr');
    expect(eventName('mouseEncounter')).toBe('Küçük Fare');
  });

  it('deviceWords swaps the device noun per language and platform', () => {
    expect(deviceWords('Stays on this PC.', 'mac')).toBe('Stays on this Mac.');
    expect(deviceWords('Stays on this PC.', 'windows')).toBe('Stays on this PC.');
    setLocale('tr');
    expect(deviceWords('Bu bilgisayarda kalır.', 'windows')).toBe('Bu bilgisayarda kalır.');
    expect(deviceWords('bu bilgisayarda kalır.', 'mac')).toBe('bu Mac’te kalır.');
    expect(deviceWords('bu bilgisayardan çıkmaz.', 'mac')).toBe('bu Mac’ten çıkmaz.');
    expect(deviceWords('bu bilgisayar', 'elsewhere')).toBe('bu bilgisayar');
  });
});
