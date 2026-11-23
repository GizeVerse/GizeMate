// The static page text goes through the catalogue (src/web/pageText.ts), the status line speaks the
// companion's name in both languages, and index.html carries every id the script writes to.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BEHAVIOR_STATES } from '../../../src/shared/cat';
import { applyPageText, PAGE_TEXT_IDS, type PageTextElement } from '../../../src/web/pageText';
import { activityLabel, describeCat } from '../../../src/web/status';
import { createStrings, WEB_STRING_TABLES } from '../../../src/web/strings';

const INDEX = readFileSync(resolve(__dirname, '../../../src/web/index.html'), 'utf8');

function fakeDoc() {
  const els = new Map<string, FakeEl>();
  class FakeEl implements PageTextElement {
    textContent: string | null = '';
    attrs = new Map<string, string>();
    setAttribute(n: string, v: string): void {
      this.attrs.set(n, v);
    }
  }
  const get = (id: string): FakeEl => {
    let e = els.get(id);
    if (!e) els.set(id, (e = new FakeEl()));
    return e;
  };
  const meta = new FakeEl();
  return { doc: { getElementById: (id: string) => get(id), querySelector: (sel: string) => (sel.includes('description') ? meta : null) }, get, meta };
}

describe('static page text through the catalogue', () => {
  it('writes the toolbar, group label, boot text and meta description in each language', () => {
    for (const locale of ['en', 'tr'] as const) {
      const ws = createStrings(locale);
      const f = fakeDoc();
      applyPageText(f.doc, ws, 'Miso');
      expect(f.get('btn-call').textContent).toBe(ws.toolbar.call('Miso'));
      expect(f.get('btn-call').textContent).toContain('Miso');
      expect(f.get('btn-settings').textContent).toBe(ws.toolbar.settings);
      expect(f.get('btn-panel').textContent).toBe(ws.toolbar.panel);
      expect(f.get('boot-wait-text').textContent).toBe(ws.status.bootWaiting);
      expect(f.get('controls').attrs.get('aria-label')).toBe(ws.toolbar.group);
      expect(f.meta.attrs.get('content')).toBe(ws.status.description);
    }
    expect(createStrings('tr').toolbar.call('Miso')).toBe('Çağır: Miso');
    expect(createStrings('tr').toolbar.group).not.toMatch(/cat|kedi/i);
  });

  it('index.html has every id the script writes, and no cat wording', () => {
    for (const id of PAGE_TEXT_IDS) expect(INDEX, id).toContain(`id="${id}"`);
    expect(INDEX).toContain('name="description"');
    expect(INDEX).not.toMatch(/Call the cat|Cat controls|an animated cat|The cat needs/);
    expect(INDEX).toContain('lang="tr"'); // the failure and noscript lines carry Turkish too
  });

  it('the web catalogue never names the cat for the active companion', () => {
    for (const locale of ['en', 'tr'] as const) {
      const flat = JSON.stringify(WEB_STRING_TABLES[locale], (_k, v) => (typeof v === 'function' ? v('Name', 'Name') : v));
      expect(flat, locale).not.toMatch(locale === 'tr' ? /kedi/i : /\b(the|your|my|a) cat\b/i);
    }
  });
});

describe('privacy page and manifest', () => {
  const PRIVACY = readFileSync(resolve(__dirname, '../../../src/web/privacy.html'), 'utf8');
  const MANIFEST = readFileSync(resolve(__dirname, '../../../src/web/manifest.webmanifest'), 'utf8');
  it('is neutral about the character and carries a Turkish section', () => {
    const en = PRIVACY.slice(PRIVACY.indexOf('id="en"'), PRIVACY.indexOf('id="tr"'));
    expect(en).not.toMatch(/\bcats?\b/i);
    expect(PRIVACY).toContain('<section id="tr" lang="tr">');
    expect(PRIVACY.slice(PRIVACY.indexOf('id="tr"'))).not.toMatch(/\bkedi/i);
    expect(PRIVACY).toContain('href="#tr"');
  });
  it('has a neutral bilingual description and keeps its id', () => {
    const m = JSON.parse(MANIFEST) as { id: string; description: string };
    expect(m.id).toBe('gizecat');
    expect(m.description).not.toMatch(/\bcat\b/i);
    expect(m.description).toMatch(/arkadaşı/);
  });
});

describe('status line in both languages', () => {
  it('uses the companion name and the Turkish phrase table, never a case suffix', () => {
    const tr = createStrings('tr');
    for (const state of BEHAVIOR_STATES) {
      const line = describeCat({ name: 'Miso', state, paused: false }, tr);
      expect(line).toMatch(/^Miso \S.*\.$/);
      expect(line).not.toMatch(/\b(is|are)\b/);
    }
    expect(describeCat({ name: 'Miso', state: 'sleeping', paused: false }, tr)).toBe('Miso uyuyor.');
    expect(describeCat({ name: '', state: 'sleeping', paused: true }, tr)).toBe('Arkadaşınız duraklatıldı.');
    expect(activityLabel('walking', tr)).toBe('yürüyor');
    expect(activityLabel('walking', createStrings('en'))).toBe('walking');
  });
});
