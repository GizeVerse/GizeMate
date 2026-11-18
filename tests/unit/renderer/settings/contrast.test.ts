// WCAG 2.1 contrast of the design tokens, computed from the CSS custom properties themselves (settings window
// and web host panel, light and dark). Text pairs need 4.5:1 (1.4.3), UI components and focus indicators 3:1 (1.4.11).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type Rgba = readonly [number, number, number, number];
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function parseColor(raw: string): Rgba {
  const v = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) {
    const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`unparseable colour: ${raw}`);
}

function blend(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

function luminance(c: Rgba): number {
  const f = (x: number): number => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** Contrast of `fg` painted over `bg` (a translucent fg is composited over bg first; bg must be opaque or sit over `under`). */
function ratio(fg: Rgba, bg: Rgba, under: Rgba = [255, 255, 255, 1]): number {
  const base = bg[3] < 1 ? blend(bg, under) : bg;
  const top = fg[3] < 1 ? blend(fg, base) : fg;
  const a = luminance(top);
  const b = luminance(base);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

/** The first `:root { }` block, and the one inside the first prefers-color-scheme: dark media query. */
function themes(file: string): { light: Map<string, string>; dark: Map<string, string> } {
  const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const dark = /:root\s*\{([^}]*)\}/.exec(css.slice(darkAt));
  if (!root || darkAt < 0 || !dark) throw new Error(`no token blocks in ${file}`);
  const light = declarations(root[1]!);
  return { light, dark: new Map([...light, ...declarations(dark[1]!)]) };
}

interface Pair {
  fg: string;
  bg: string;
  min: number;
  /** Surface a translucent bg sits on. */
  under?: string;
}
const T = 4.5;
const U = 3;

const SETTINGS_TEXT_ON: Record<string, string[]> = {
  '--bg': ['--text', '--text-2', '--accent-text'],
  '--card': ['--text', '--text-2', '--accent-text', '--ok', '--warn', '--danger', '--violet'],
  '--control': ['--text', '--text-2', '--text-3'],
  '--subtle-fill': ['--text', '--text-2'],
  '--subtle-fill-2': ['--text', '--text-2'],
  '--dialog-bg': ['--text', '--text-2', '--danger'],
  '--dialog-footer': ['--text', '--text-2'],
  '--ok-bg': ['--ok', '--text'],
  '--warn-bg': ['--warn', '--text'],
  '--danger-bg': ['--danger', '--text'],
  '--info-bg': ['--accent-text', '--text'],
  '--violet-bg': ['--violet', '--text'],
  '--hero-a': ['--text', '--text-2'],
  '--hero-b': ['--text', '--text-2'],
  '--accent': ['--on-accent'],
  '--danger-solid': ['--on-danger'],
  '--danger-solid-hover': ['--on-danger'],
};
const settingsPairs: Pair[] = [];
for (const [bg, fgs] of Object.entries(SETTINGS_TEXT_ON)) for (const fg of fgs) settingsPairs.push({ fg, bg, min: T });
for (const bg of ['--bg', '--card', '--dialog-bg']) settingsPairs.push({ fg: '--focus-outer', bg, min: U });
for (const bg of ['--bg', '--card', '--control', '--dialog-bg']) settingsPairs.push({ fg: '--accent', bg, min: U });
settingsPairs.push({ fg: '--input-bottom', bg: '--control', min: U });
settingsPairs.push({ fg: '--toggle-off', bg: '--card', min: U, under: '--card' });
settingsPairs.push({ fg: '--toggle-off', bg: '--bg', min: U, under: '--bg' });
settingsPairs.push({ fg: '--slider-track', bg: '--card', min: U, under: '--card' });

const WEB_TEXT_ON: Record<string, string[]> = {
  '--bg': ['--fg', '--muted', '--accent', '--danger'],
  '--button-bg': ['--fg', '--muted', '--accent', '--danger'],
  '--sheet-bg': ['--fg', '--muted', '--accent', '--danger'],
  '--accent': ['--accent-fg'],
};
const webPairs: Pair[] = [];
for (const [bg, fgs] of Object.entries(WEB_TEXT_ON)) for (const fg of fgs) webPairs.push({ fg, bg, min: T });
for (const bg of ['--bg', '--button-bg', '--sheet-bg']) webPairs.push({ fg: '--focus', bg, min: U });
for (const bg of ['--bg', '--sheet-bg']) webPairs.push({ fg: '--button-border', bg, min: U });
for (const bg of ['--bg', '--sheet-bg']) webPairs.push({ fg: '--accent', bg, min: U });

function check(file: string, pairs: Pair[]): void {
  const { light, dark } = themes(file);
  for (const [name, tokens] of [['light', light], ['dark', dark]] as const) {
    describe(`${path.basename(file)} ${name} theme`, () => {
      for (const p of pairs) {
        it(`${p.fg} on ${p.bg} >= ${p.min}:1`, () => {
          const get = (t: string): Rgba => {
            const v = tokens.get(t);
            if (v === undefined) throw new Error(`token ${t} not declared`);
            return parseColor(v);
          };
          const r = ratio(get(p.fg), get(p.bg), p.under ? get(p.under) : undefined);
          expect(r, `${p.fg} on ${p.bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(p.min);
        });
      }
    });
  }
}

check('src/renderer/settings/styles.css', settingsPairs);
check('src/web/web.css', webPairs);

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(ratio(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5);
    expect(ratio(parseColor('#777777'), parseColor('#ffffff'))).toBeCloseTo(4.48, 1);
  });
});
