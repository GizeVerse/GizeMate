// The structure of the web panels, read from the sources and the catalogues (no browser): four areas in
// both panels, every control the old panels had still reachable, the character and palette texts in both
// languages, and the CSP-safe rules (no innerHTML, no inline style, no fetch or eval) for every new file.
// REAL: reads the committed files and catalogues. It cannot say how the panels look or feel on a device.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, DEFAULT_CHARACTER } from '../../../src/shared/characters/registry';
import { en, tr } from '../../../src/shared/i18n';
import { WEB_STRING_TABLES } from '../../../src/web/strings';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UI_DIR = path.join(ROOT, 'src/web/ui');
const UI_FILES = fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.ts'));
const ANDROID = read('src/web/androidPanel.ts');
const SHEET = read('src/web/settingsPanel.ts');
const UI = UI_FILES.map((f) => read(`src/web/ui/${f}`)).join('\n');
const ALL = `${ANDROID}\n${SHEET}\n${UI}`;

describe('four areas in both panels', () => {
  it('the Android panel and the browser sheet each build Home, Characters, Customize and Settings with the shared tab bar', () => {
    for (const [name, src] of [['androidPanel', ANDROID], ['settingsPanel', SHEET]] as const) {
      for (const id of ['home', 'characters', 'customize', 'settings']) expect(src, `${name}: ${id}`).toContain(`id: '${id}'`);
      expect(src, name).toContain('createTabs(');
      expect(src, name).toContain('createCharactersView(');
      expect(src, name).toContain('createCustomizeView(');
      expect(src, name).toContain('createCoreSettings(');
      expect(src, name).toContain('createBrowserPreviewLoop()');
    }
  });

  it('the panel keeps its floating-companion elements and the sheet its transfer slot (main.ts and profileUi.ts rely on them)', () => {
    expect(ANDROID).toContain('floating: { start: startBtn, pause: pauseBtn, hide: hideBtn, stop: stopBtn, ask, askText, askOpen, askLater, status: statusLine }');
    expect(SHEET).toContain("id: 'transfer-slot'");
    expect(SHEET).toContain('setTransferVisible');
  });

  it('every setting field the old panels edited is still wired somewhere in the new structure', () => {
    const fields = [
      'catName', 'skin', 'activeCharacter', 'language', 'characterName', 'characterSkin', 'style', 'size', 'shadow', 'emotes',
      'soundEnabled', 'volume', 'soundCat', 'soundWorld', 'personality', 'eventsEnabled', 'rareEvents', 'reducedMotion', 'journalEnabled',
      'eventPace', 'eventToggle', 'preset', 'movementSpeed', 'autonomy', 'cursorPlay', 'sleepMinutes', 'petting', 'dragging', 'throwing', 'behaviorToggle',
    ];
    for (const f of fields) expect(ALL, f).toContain(`field: '${f}'`);
  });

  it('the name field keeps its attached helper on the real input, right after its change handler', () => {
    expect(UI).toContain('attachSecretNote(nameInput, deps.secret);');
    const at = UI.indexOf('attachSecretNote(nameInput, deps.secret);');
    expect(UI.lastIndexOf("nameInput.addEventListener('change'", at)).toBeGreaterThan(-1);
    expect(ALL.toLowerCase()).not.toMatch(/secret.?(name|egg)\b.*(text|label|title)\s*:/);
  });

  it('keeps the privacy and notices links in the sheet', () => {
    expect(SHEET).toContain('href: WS.about.privacyHref');
    expect(SHEET).not.toContain("href: 'privacy.html'");
    expect(WEB_STRING_TABLES.en.about.privacyHref).toBe('privacy.html#en');
    expect(WEB_STRING_TABLES.tr.about.privacyHref).toBe('privacy.html#tr');
    expect(SHEET).toContain("href: 'licenses.html'");
  });
});

describe('CSP-safe and offline', () => {
  it('uses no innerHTML, no inline style, no fetch, no eval, no remote URL in any panel file', () => {
    for (const [name, src] of [['androidPanel', ANDROID], ['settingsPanel', SHEET], ...UI_FILES.map((f) => [f, read(`src/web/ui/${f}`)] as const)] as const) {
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, name).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
      expect(code, name).not.toMatch(/\.style\.\w+\s*=|\.style\[|setAttribute\(\s*['"]style/);
      expect(code, name).not.toMatch(/\bfetch\(|\beval\(|new Function\(|XMLHttpRequest|WebSocket|https?:\/\//);
    }
  });

  it('keeps the preview loop one shared requestAnimationFrame user: only previewLoop.ts calls it', () => {
    for (const f of UI_FILES) {
      const src = read(`src/web/ui/${f}`);
      if (f === 'previewLoop.ts') continue;
      expect(src, f).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
    }
    expect(read('src/web/ui/previewLoop.ts')).toContain('requestAnimationFrame');
  });
});

describe('texts in both languages', () => {
  it('every character has name, tagline, description, personality and interactions, in English and Turkish', () => {
    for (const mod of CHARACTERS) {
      for (const part of ['name', 'tagline', 'description', 'personality', 'interactions'] as const) {
        const e = (en as unknown as { character: Record<string, Record<string, string>> }).character[mod.id]?.[part];
        const t = (tr as unknown as { character: Record<string, Record<string, string>> }).character[mod.id]?.[part];
        expect(e, `${mod.id}.${part} en`).toMatch(/\S/);
        expect(t, `${mod.id}.${part} tr`).toMatch(/\S/);
      }
    }
  });

  it('every palette of every non-cat character has a name in both languages; the cat uses the coat names', () => {
    for (const locale of ['en', 'tr'] as const) {
      const table = WEB_STRING_TABLES[locale];
      for (const mod of CHARACTERS) {
        if (mod.id === DEFAULT_CHARACTER) continue;
        for (const skin of mod.skins) expect(table.palettes[skin], `${locale}: ${mod.id}/${skin}`).toMatch(/\S/);
      }
    }
  });

  it('Turkish is not longer than 3 times the English text for the area and tab labels (text expansion room)', () => {
    for (const key of ['home', 'characters', 'customize', 'settings'] as const) {
      expect(WEB_STRING_TABLES.tr.nav[key].length, key).toBeLessThanOrEqual(WEB_STRING_TABLES.en.nav[key].length * 3);
    }
  });
});

describe('styles', () => {
  const CSS = read('src/web/web.css');
  it('has the tab bar, the folds, the character cards and visible focus on tabs', () => {
    for (const rule of ['.tabbar-bottom', '.tab:focus-within', '.fold > summary', '.char-card', '.preview-canvas', '.skip-link:focus', '.panel-content']) expect(CSS, rule).toContain(rule);
  });

  it('gives tabs and summaries a 48 px target', () => {
    expect(CSS).toMatch(/\.tab \{[^}]*min-height: 3rem/);
    expect(CSS).toMatch(/\.fold > summary \{[^}]*min-height: 3rem/);
  });
});
