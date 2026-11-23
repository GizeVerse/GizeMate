// Review fix: the browser settings sheet reopens after a restart of the page (a flag in sessionStorage).
import { afterEach, describe, expect, it } from 'vitest';
import { sheetOpenFlag } from '../../../src/web/settingsPanel';

const g = globalThis as { sessionStorage?: unknown };
afterEach(() => {
  delete g.sessionStorage;
});

describe('sheetOpenFlag', () => {
  it('is set while open, cleared on close, and false without sessionStorage', () => {
    expect(sheetOpenFlag()).toBe(false);
    const data = new Map<string, string>();
    g.sessionStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    expect(sheetOpenFlag()).toBe(false);
    expect(sheetOpenFlag(true)).toBe(true);
    expect(sheetOpenFlag()).toBe(true);
    expect(sheetOpenFlag(false)).toBe(false);
  });
  it('never throws when sessionStorage refuses', () => {
    g.sessionStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(sheetOpenFlag(true)).toBe(false);
  });
});
