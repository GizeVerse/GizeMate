// The web host's strings in Turkish: same shape as English, live locale switching, and the copied labels
// stay equal to the desktop's in both languages.
import { afterEach, describe, expect, it } from 'vitest';
import { STRING_TABLES } from '../../../src/renderer/settings/strings';
import { createStrings, getLocale, hostLocale, installText, setLocale, WEB_STRING_TABLES, WS } from '../../../src/web/strings';

afterEach(() => setLocale('en'));

type Node = unknown;
const isObj = (v: Node): v is Record<string, Node> => typeof v === 'object' && v !== null && !Array.isArray(v);

function shapeProblems(en: Node, tr: Node, path: string, out: string[]): void {
  if (typeof en === 'string') {
    if (typeof tr !== 'string') out.push(`${path}: not a string`);
    else if ((en === '') !== (tr === '')) out.push(`${path}: empty in one language only`);
    return;
  }
  if (typeof en === 'function') {
    if (typeof tr !== 'function' || (tr as (...a: unknown[]) => unknown).length !== (en as (...a: unknown[]) => unknown).length) out.push(`${path}: function mismatch`);
    return;
  }
  if (Array.isArray(en)) {
    if (!Array.isArray(tr) || tr.length !== en.length) {
      out.push(`${path}: array length`);
      return;
    }
    en.forEach((v, i) => shapeProblems(v, tr[i], `${path}[${i}]`, out));
    return;
  }
  if (isObj(en)) {
    if (!isObj(tr)) {
      out.push(`${path}: not an object`);
      return;
    }
    if (Object.keys(en).sort().join('|') !== Object.keys(tr).sort().join('|')) out.push(`${path}: keys differ`);
    for (const k of Object.keys(en)) if (k in tr) shapeProblems(en[k], tr[k], `${path}.${k}`, out);
  }
}

describe('web strings: Turkish', () => {
  it('has the same shape as English', () => {
    const out: string[] = [];
    shapeProblems(WEB_STRING_TABLES.en, WEB_STRING_TABLES.tr, 'WS', out);
    expect(out).toEqual([]);
  });

  it('copies the desktop coat, style and preset labels exactly, in both languages', () => {
    for (const locale of ['en', 'tr'] as const) {
      expect(WEB_STRING_TABLES[locale].skins, locale).toEqual(STRING_TABLES[locale].appearance.skins);
      expect(WEB_STRING_TABLES[locale].styles, locale).toEqual(STRING_TABLES[locale].appearance.styles);
      expect(WEB_STRING_TABLES[locale].presets, locale).toEqual(STRING_TABLES[locale].behavior.presets);
    }
  });

  it('is English by default and follows setLocale live, including captured groups', () => {
    const toolbar = WS.toolbar;
    expect(getLocale()).toBe('en');
    expect(toolbar.settings).toBe('Settings');
    setLocale('tr');
    expect(toolbar.settings).toBe('Ayarlar');
    expect(WS.storage.status('app', null)).toContain('bu uygulamanın');
    expect(installText('menu')).toMatch(/\S/);
    expect(createStrings('en').toolbar.settings).toBe('Settings');
    expect(createStrings('tr').toolbar.settings).toBe('Ayarlar');
  });

  it('the Turkish clear-journal confirmation says it cannot be undone', () => {
    expect(WEB_STRING_TABLES.tr.panel.journal.clearAsk).toMatch(/geri alınamaz/);
  });

  it('hostLocale: explicit choice wins, auto follows the first browser language', () => {
    expect(hostLocale('tr', ['en-US'])).toBe('tr');
    expect(hostLocale('en', ['tr-TR'])).toBe('en');
    expect(hostLocale('auto', ['tr-TR', 'en'])).toBe('tr');
    expect(hostLocale('auto', ['de'])).toBe('en');
    expect(hostLocale(undefined, undefined)).toBe('en');
  });
});
