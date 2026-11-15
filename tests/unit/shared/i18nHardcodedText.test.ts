// Best-effort static scan: user-facing English must come from the catalogues, not from literals in the
// settings window, the main-process lifecycle code or the web host. It looks for string literals assigned to
// the properties and attributes that become visible text (text, title, label, placeholder, alt, aria-label,
// textContent, message, body, description, tooltip) that read like English sentences or labels.
// It cannot see everything (a literal built elsewhere is invisible to it); the allowlist below is the
// deliberate, explained debt.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['src/renderer/settings', 'src/main/lifecycle', 'src/web'];
/** The catalogues themselves, secret-name plumbing and test/service-worker plumbing carry no UI copy. */
const SKIP_FILE = /(?:^|[\\/])(?:strings(?:\.\w+)*\.ts|secret\w*\.ts|testHook\.ts|sw\.ts|swCore\.ts|logger\.ts)$/;

/** file (posix, relative) -> literals allowed to stay. */
const ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  // Returned to the settings window as ActionResult.message over IPC; the next wave moves these to reason codes
  // that the window words through the catalogue (see the report: needs main/ipc + app.ts).
  'src/main/lifecycle/loginItem.ts': ['Could not save the setting; details are in the log.'],
};

const PROPERTY = /\b(?:text|title|label|placeholder|alt|ariaLabel|textContent|message|body|description|tooltip)\s*[:=]\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const ARIA = /'aria-label'\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const SET_ATTR = /setAttribute\(\s*'(?:aria-label|title|placeholder|alt)'\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const TEXT_NODE = /createTextNode\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
/** An English-looking phrase: a capitalised word followed by more words. Interpolations and identifiers do not count. */
const ENGLISH = /^[A-Z][a-z]+(?:\s+[A-Za-z']+)+/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

export function findLiterals(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  source.split('\n').forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    for (const re of [PROPERTY, ARIA, SET_ATTR, TEXT_NODE]) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        const text = m[2] ?? '';
        if (ENGLISH.test(text)) found.push({ line: i + 1, text });
      }
    }
  });
  return found;
}

describe('no hard-coded English UI text outside the catalogues', () => {
  it('the detector recognises the shapes it is meant to catch and ignores code-like text', () => {
    expect(findLiterals("h('p', { text: 'Loading settings…' })")).toHaveLength(1);
    expect(findLiterals("el.setAttribute('aria-label', 'Close the panel')")).toHaveLength(1);
    expect(findLiterals("const x = { 'aria-label': 'Settings sections' }")).toHaveLength(1);
    expect(findLiterals('const m = { message: `Could not save` }')).toHaveLength(1);
    expect(findLiterals("h('div', { class: 'boot', role: 'status' })")).toHaveLength(0);
    expect(findLiterals("const x = { title: S.app.title, label: 'ok', text: '' }")).toHaveLength(0);
    expect(findLiterals("// text: 'Not a real line'")).toHaveLength(0);
  });

  it('finds none in src/renderer/settings, src/main/lifecycle and src/web (outside the allowlist)', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir)).filter((f) => f.endsWith('.ts') && !SKIP_FILE.test(f))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const allowed = ALLOWLIST[rel] ?? [];
        for (const hit of findLiterals(fs.readFileSync(file, 'utf8'))) {
          if (!allowed.includes(hit.text)) offenders.push(`${rel}:${hit.line}: ${hit.text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still exists (no stale exceptions)', () => {
    for (const [rel, texts] of Object.entries(ALLOWLIST)) {
      const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const text of texts) expect(source, `${rel}: ${text}`).toContain(text);
    }
  });
});
