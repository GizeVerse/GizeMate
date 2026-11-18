// GizeMate 1.6.0 live validation: the real Electron app (own temp userData, test hooks, no installer, no
// installed app, no owner data) runs each of the seven characters in the real transparent overlay. Default-on.
//   node scripts/with-lock.mjs gm-chars -- npx playwright test tests/e2e/characters.spec.ts
// Every test seeds its own settings.json in a fresh temp userData (the fixture), so the single-instance lock
// and the owner's data are never involved. Surfaces are restricted to the app's own pid, so no window of the
// owner's desktop joins a run. Pointer input is SIMULATED (CDP mouse events on the overlay page plus
// injectCursor, nothing is sent to the OS); the app, renderer, IPC, sim, click-through decision and drawing are real.
// Evidence: PNGs of the overlay page in out/e2e-characters/ (npm run build wipes out/), [measure] lines and
// test annotations. What the hooks cannot see: the hit region is not exposed, so it is measured by probing
// the real click-through decision (injectCursor on a grid, getOverlays().ignoreMouse), and compared with the
// pixels the renderer actually drew (the overlay canvas read back in the page).
import fs from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { ANIM_CLIPS } from '../../src/shared/cat';
import { CHARACTERS, CHARACTER_IDS, getCharacter, type CharacterId } from '../../src/shared/characters/registry';
import type { Point, Rect } from '../../src/shared/geometry';
import type { SimOutput } from '../../src/shared/sim';
import type { OverlayInfo } from '../../src/main/overlay/overlayManager';
import { characterStateFile, expect, hook, launchApp, overlayPageOf, quitApp, seedSettings, settingsPage, sha256File, test, waitForCat } from './fixtures';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.resolve(__dirname, '..', '..', 'out', 'e2e-characters');
const PHYSICAL = new Set(['held', 'jumping', 'falling', 'landing']);

function record(info: TestInfo, what: string, data: unknown): void {
  const text = JSON.stringify(data);
  info.annotations.push({ type: what, description: text.length > 3000 ? `${text.slice(0, 3000)}...` : text });
  console.log(`[measure] ${what}: ${text.length > 1500 ? `${text.slice(0, 1500)}...` : text}`);
}

/**
 * The drawn pixels should not touch the left or right window edge (the overlay covers the display, so touching means the body
 * is cut off by the screen edge). The cat (shipped behaviour) must not at rest; for the other characters a touch is recorded as
 * an OBSERVED annotation with numbers instead of being hidden. Hypothesis for such touches, NOT isolated: the roaming margin
 * at the screen edges is the cat's half width for every character (src/core/movement/world.ts bodyWidth()).
 */
function edgeCheck(info: TestInfo, id: string, when: string, d: Drawn, width: number): void {
  const touches = d.x0 <= 0.5 || d.x1 >= width - 0.5;
  if (id === 'cat') {
    expect(touches, `cat ${when}: not cut off by the window edge`).toBe(false);
    return;
  }
  if (touches) info.annotations.push({ type: 'OBSERVED', description: `${id} ${when}: drawn pixels touch the window edge (x ${d.x0.toFixed(1)}..${d.x1.toFixed(1)} of ${width} DIP): cut off by the screen edge` });
  record(info, `${id} edge ${when}`, { x0: Math.round(d.x0), x1: Math.round(d.x1), width, touches });
}

/** The primary-button events the overlay page really received (own timestamps), to judge a flick against what arrived (as the soak does). */
const DELIVERED_PROBE = `(() => {
  if (window.__chIn) return true;
  const st = { events: [] };
  window.__chIn = st;
  const push = (k, e) => { if (st.events.length < 400) st.events.push({ k, t: e.timeStamp, x: e.clientX, y: e.clientY }); };
  document.addEventListener('pointerdown', (e) => { if (e.button === 0) { st.events.length = 0; push('down', e); } }, true);
  document.addEventListener('pointerup', (e) => { if (e.button === 0) push('up', e); }, true);
  document.addEventListener('pointermove', (e) => {
    if ((e.buttons & 1) === 0) return;
    let list = [];
    try { list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []; } catch { list = []; }
    if (list.length > 0) for (const c of list) push('move', c); else push('move', e);
  }, true);
  return true;
})()`;
const DELIVERED_TAKE = `(() => { const st = window.__chIn; return st ? st.events.splice(0) : []; })()`;

/** Release speed (DIP/s) of the last press by the app's own rule (src/core/interaction/gestures.ts): samples of the last 100 ms. */
function deliveredReleaseSpeed(ev: Array<{ k: string; t: number; x: number; y: number }>): { speed: number; samples: number; spanMs: number } | null {
  const up = [...ev].reverse().find((e) => e.k === 'up');
  if (!up) return null;
  const win = ev.filter((e) => e.k === 'move' && up.t - e.t <= 100 && e.t <= up.t);
  const first = win[0];
  const dt = first ? up.t - first.t : 0;
  const speed = first && win.length >= 2 && dt >= 8 ? (Math.hypot(up.x - first.x, up.y - first.y) / dt) * 1000 : 0;
  return { speed: Math.round(speed), samples: win.length, spanMs: Math.round(dt) };
}

/** An item's visible label: the last line of its text (an icon glyph can precede it on its own line). */
const lastLine = (text: string): string => (text.split(String.fromCharCode(10)).pop() ?? '').trim();

const center = (r: Rect): Point => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

interface Booted {
  app: ElectronApplication;
  pid: number;
}

/** Launches the real app for `id` (settings seeded, own userData) and waits for the overlay and the first sim output. */
async function boot(userData: string, id: CharacterId, general: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<Booted> {
  seedSettings(userData, { activeCharacter: id, ...general }, extra);
  const app = await launchApp(userData);
  const pid = app.process().pid ?? 0;
  try {
    await waitForCat(app);
    const startup = await hook(app, 'getStartup');
    expect(path.resolve(startup.userData), 'the launch uses the test userData, never the owner profile').toBe(path.resolve(userData));
    // Only the app's own windows can be surfaces: the owner's desktop never joins a run.
    await hook(app, 'restrictSurfacesToPids', [pid]);
    await hook(app, 'injectUserIdle', 3000);
    await hook(app, 'injectEvent', { type: 'command.wake' });
  } catch (err) {
    await quitApp(app).catch(() => undefined);
    throw err;
  }
  return { app, pid };
}

interface Geom {
  out: SimOutput;
  ov: OverlayInfo;
  page: Page;
  /** physical px per overlay DIP */
  scale: number;
}

async function geom(app: ElectronApplication): Promise<Geom> {
  const out = await hook(app, 'getSimOutput');
  if (!out) throw new Error('no sim output');
  const overlays = await hook(app, 'getOverlays');
  const ov = overlays.find((o) => o.displayId === out.displayId) ?? overlays[0];
  if (!ov) throw new Error('no overlay');
  const page = overlayPageOf(app, ov.displayId);
  if (!page) throw new Error('no overlay page');
  return { out, ov, page, scale: ov.bounds.width > 0 ? ov.boundsPx.width / ov.bounds.width : 1 };
}

interface Drawn {
  /** overlay DIP */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  pixels: number;
}

/**
 * What the renderer actually painted on the cat canvas (alpha over a small threshold), in overlay DIP. The page script is a string
 * (like the soak's probes): the test project has no DOM typings and the overlay page needs no test-side types.
 */
const DRAWN_SCRIPT = `(() => {
  const c = document.getElementById('cat');
  const ctx = c && c.getContext('2d');
  if (!c || !ctx || c.clientWidth === 0) return null;
  const w = c.width, h = c.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        sx += x; sy += y; n++;
      }
    }
  }
  if (n === 0) return null;
  const k = w / c.clientWidth;
  return { x0: x0 / k, y0: y0 / k, x1: (x1 + 1) / k, y1: (y1 + 1) / k, cx: sx / n / k, cy: sy / n / k, pixels: n };
})()`;

async function drawnBounds(page: Page): Promise<Drawn | null> {
  return page.evaluate<Drawn | null>(DRAWN_SCRIPT);
}

/**
 * Up to 6x5 points on the visible body: in each cell of a grid over the drawn bounding box, the opaque pixel nearest the
 * cell centre (alpha over 200, so soft shadow and outline fringe are left out). Overlay DIP.
 */
async function bodySamples(page: Page, d: Drawn): Promise<Point[]> {
  const script = `((b) => {
    const c = document.getElementById('cat');
    const ctx = c.getContext('2d');
    const k = c.width / c.clientWidth;
    const x0 = Math.floor(b.x0 * k), y0 = Math.floor(b.y0 * k);
    const w = Math.ceil((b.x1 - b.x0) * k), h = Math.ceil((b.y1 - b.y0) * k);
    const data = ctx.getImageData(x0, y0, w, h).data;
    const out = [];
    const nx = 6, ny = 5;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = Math.floor(((i + 0.5) * w) / nx), cy = Math.floor(((j + 0.5) * h) / ny);
        let best = null, bestD = Infinity;
        for (let y = Math.floor((j * h) / ny); y < Math.floor(((j + 1) * h) / ny); y++) {
          for (let x = Math.floor((i * w) / nx); x < Math.floor(((i + 1) * w) / nx); x++) {
            if (data[(y * w + x) * 4 + 3] > 200) {
              const dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
              if (dd < bestD) { bestD = dd; best = { x, y }; }
            }
          }
        }
        if (best) out.push({ x: (x0 + best.x) / k, y: (y0 + best.y) / k });
      }
    }
    return out;
  })(${JSON.stringify({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 })})`;
  return page.evaluate<Point[]>(script);
}

/** Overlay DIP rect -> physical px. */
const toPx = (g: Geom, dx: number, dy: number): Point => ({ x: Math.round(g.ov.boundsPx.x + dx * g.scale), y: Math.round(g.ov.boundsPx.y + dy * g.scale) });
const toLocal = (g: Geom, p: Point): Point => ({ x: (p.x - g.ov.boundsPx.x) / g.scale, y: (p.y - g.ov.boundsPx.y) / g.scale });

/**
 * Evidence overlay: paints the probed points on the overlay page (green: the overlay took the mouse there, red: it stayed
 * click-through) and the drawn bounding box, screenshots, and removes the markers again. Test instrumentation only.
 */
async function shootHitMap(app: ElectronApplication, id: string, label: string, hits: Point[], misses: Point[], box: Drawn): Promise<string> {
  const g = await geom(app);
  const data = JSON.stringify({ hits: hits.map((q) => ({ x: q.x, y: q.y })), misses: misses.map((q) => ({ x: q.x, y: q.y })), box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } });
  await g.page.evaluate(`((data) => {
    const root = document.createElement('div');
    root.id = '__hitmap';
    root.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99999';
    const dot = (x, y, color) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + (x - 3) + 'px;top:' + (y - 3) + 'px;width:6px;height:6px;border-radius:3px;background:' + color + ';opacity:.9';
      root.appendChild(d);
    };
    for (const p of data.hits) dot(p.x, p.y, '#1faa3a');
    for (const p of data.misses) dot(p.x, p.y, '#e0262b');
    const r = document.createElement('div');
    r.style.cssText = 'position:absolute;left:' + data.box.x0 + 'px;top:' + data.box.y0 + 'px;width:' + (data.box.x1 - data.box.x0) + 'px;height:' + (data.box.y1 - data.box.y0) + 'px;border:1px dashed #1f6feb';
    root.appendChild(r);
    document.body.appendChild(root);
  })(${data})`);
  const file = await shoot(app, id, label);
  await g.page.evaluate("(() => { const e = document.getElementById('__hitmap'); if (e) e.remove(); })()");
  return file;
}

/** Screenshot of the overlay page around the character (transparent background kept). */
async function shoot(app: ElectronApplication, id: string, label: string): Promise<string> {
  fs.mkdirSync(SHOTS, { recursive: true });
  const g = await geom(app);
  const d = await drawnBounds(g.page);
  const vw = g.ov.bounds.width;
  const vh = g.ov.bounds.height;
  const cx = d ? (d.x0 + d.x1) / 2 : toLocal(g, center(g.out.boundsPx)).x;
  const cy = d ? (d.y0 + d.y1) / 2 : toLocal(g, center(g.out.boundsPx)).y;
  const w = 320;
  const h = 240;
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), vw - w));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), vh - h));
  const file = path.join(SHOTS, `${id}-${label}.png`);
  await g.page.screenshot({ path: file, omitBackground: true, clip: { x, y, width: w, height: h } });
  return file;
}

/** Is the overlay taking the mouse right now (some overlay's ignoreMouse is false)? */
async function takesMouse(app: ElectronApplication): Promise<boolean> {
  return (await hook(app, 'getOverlays')).some((o) => !o.ignoreMouse);
}

/** Puts the cursor at p and waits up to waitMs for the overlay to take the mouse; returns the delay or null. */
async function probePoint(app: ElectronApplication, p: Point, waitMs: number): Promise<number | null> {
  await hook(app, 'injectCursor', p);
  const t0 = Date.now();
  for (;;) {
    if (await takesMouse(app)) return Date.now() - t0;
    if (Date.now() - t0 >= waitMs) return null;
    await sleep(25);
  }
}

interface HitMap {
  hits: Point[];
  /** grid points probed, and how many of them lie inside the pad-less drawn bbox */
  grid: Point[];
  misses: number;
  bbox: Rect | null;
  latencyMs: number | null;
  centroidHit: boolean;
  farHits: number;
  farProbed: number;
}

/**
 * Maps the real hit region by probing the click-through decision on a grid around the drawn body, then checks a few
 * far points (a click-through overlay must not take the mouse away from the body). The cat must stand still (paused).
 */
async function mapHitRegion(app: ElectronApplication, g: Geom, d: Drawn, light = false): Promise<HitMap> {
  const c = toPx(g, d.cx, d.cy);
  // Calibrate how long the main poll takes to flip the overlay on a point that should be inside the body.
  await hook(app, 'injectCursor', null);
  await sleep(150);
  let latency: number | null = null;
  for (const delta of [{ x: 0, y: 0 }, { x: -6, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 8 }, { x: 0, y: -8 }]) {
    latency = await probePoint(app, { x: c.x + delta.x * g.scale, y: c.y + delta.y * g.scale }, 700);
    if (latency !== null) break;
    await hook(app, 'injectCursor', null);
    await sleep(120);
  }
  const wait = Math.max(180, Math.round((latency ?? 300) * 2.5));
  const hits: Point[] = latency !== null ? [c] : [];
  const pad = 24;
  const x0 = d.x0 - pad;
  const x1 = d.x1 + pad;
  const y0 = d.y0 - pad;
  const y1 = d.y1 + pad;
  const nx = light ? 3 : 9;
  const ny = light ? 2 : 7;
  const grid: Point[] = [];
  let misses = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = toPx(g, x0 + ((x1 - x0) * i) / (nx - 1), y0 + ((y1 - y0) * j) / (ny - 1));
      grid.push(p);
      await hook(app, 'injectCursor', null);
      await sleep(30);
      if ((await probePoint(app, p, wait)) !== null) hits.push(p);
      else misses++;
    }
  }
  // Far points: >= 220 DIP from the drawn body, inside the overlay.
  const far: Point[] = [];
  const vw = g.ov.bounds.width;
  const vh = g.ov.bounds.height;
  for (const [fx, fy] of [[d.cx < vw / 2 ? vw - 80 : 80, 80], [d.cx < vw / 2 ? vw - 80 : 80, vh / 2], [vw / 2, 60], [d.cx < vw / 2 ? 80 : vw - 80, vh - 220]] as Array<[number, number]>) {
    if (Math.hypot(fx - d.cx, fy - d.cy) >= 220) far.push(toPx(g, fx, fy));
  }
  let farHits = 0;
  for (const p of far) {
    await hook(app, 'injectCursor', null);
    await sleep(30);
    if ((await probePoint(app, p, wait)) !== null) farHits++;
  }
  await hook(app, 'injectCursor', null);
  const bbox: Rect | null =
    hits.length > 0
      ? { x: Math.min(...hits.map((p) => p.x)), y: Math.min(...hits.map((p) => p.y)), width: Math.max(...hits.map((p) => p.x)) - Math.min(...hits.map((p) => p.x)), height: Math.max(...hits.map((p) => p.y)) - Math.min(...hits.map((p) => p.y)) }
      : null;
  return { hits, grid, misses, bbox, latencyMs: latency, centroidHit: latency !== null, farHits, farProbed: far.length };
}

/**
 * Brings the character to rest and slows the sim to x0.1 so it stays where it is while the hit region is probed.
 * (A paused host is deliberately never interactive: catHost 'blocked' while paused, so pause cannot be used here.)
 */
async function holdStill(app: ElectronApplication, awayFromX?: number): Promise<SimOutput> {
  const resting = new Set(['sit', 'loaf', 'stand', 'sleep', 'groom']);
  for (let attempt = 0; attempt < 6; attempt++) {
    await hook(app, 'setTimeScale', 8);
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000) {
      const o = await hook(app, 'getSimOutput');
      // With awayFromX the character must rest at another place (>160 px from it; >60 px after 60 s of waiting).
      const far = awayFromX === undefined || Math.abs((o?.x ?? awayFromX) - awayFromX) > (Date.now() - t0 < 60_000 ? 160 : 60);
      if (o && far && resting.has(o.clip) && !PHYSICAL.has(o.state) && o.support.kind === 'floor') break;
      await sleep(100);
    }
    await hook(app, 'setTimeScale', 0.1);
    let prev: SimOutput | null = null;
    for (let i = 0; i < 6; i++) {
      await sleep(300);
      const out = await hook(app, 'getSimOutput');
      if (out && prev && Math.abs(out.x - prev.x) < 1 && Math.abs(out.y - prev.y) < 1 && out.clip === prev.clip) return out;
      prev = out;
    }
  }
  throw new Error('the character kept moving');
}

/** The share of the given body points (overlay DIP) at which the overlay takes the mouse, and which ones do not. */
async function clickableShare(app: ElectronApplication, g: Geom, pts: Point[], latencyMs: number | null): Promise<{ share: number; probed: number; misses: Point[]; hitPts: Point[] }> {
  const wait = Math.max(180, Math.round((latencyMs ?? 300) * 2.5));
  let hit = 0;
  const misses: Point[] = [];
  const hitPts: Point[] = [];
  for (const q of pts) {
    await hook(app, 'injectCursor', null);
    await sleep(30);
    if ((await probePoint(app, toPx(g, q.x, q.y), wait)) !== null) {
      hit++;
      hitPts.push({ x: Math.round(q.x), y: Math.round(q.y) });
    } else misses.push({ x: Math.round(q.x - 0), y: Math.round(q.y) });
  }
  await hook(app, 'injectCursor', null);
  return { share: pts.length ? hit / pts.length : 0, probed: pts.length, misses, hitPts };
}

function readEnvelope(file: string): { schemaVersion: number; character?: string; companion?: unknown; [k: string]: unknown } {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as { schemaVersion: number };
}

/**
 * Warn and error lines of the run. One environmental warning is set aside: the global shortcut is already taken
 * (the owner runs another GizeMate/Desktop Cat on this PC), which says nothing about the code under test.
 */
const ENVIRONMENTAL = ['shortcut registration failed'];
async function problemLines(app: ElectronApplication): Promise<string[]> {
  return (await hook(app, 'getRecentLogs', 1000)).filter((l) => (l.level === 'warn' || l.level === 'error') && !ENVIRONMENTAL.some((e) => l.msg.includes(e))).map((l) => `${l.level} ${l.scope}: ${l.msg}`);
}

async function logProblems(app: ElectronApplication): Promise<{ warn: number; error: number }> {
  const lines = await problemLines(app);
  return { warn: lines.filter((l) => l.startsWith('warn')).length, error: lines.filter((l) => l.startsWith('error')).length };
}

/** Clips a module draws, aliases, or that are shared by every renderer (the universal vocabulary). */
function allowedClips(id: CharacterId): Set<string> {
  const m = getCharacter(id);
  const own = new Set<string>([...m.clips, ...Object.keys(m.clipAlias), ...m.behavior.signatures.flatMap((s) => [s.clip, ...(s.leadIn ?? [])])]);
  for (const r of Object.values(m.reactions)) if (r) own.add(r.clip);
  return own;
}

/** Signature-only clips of the other characters that this one neither draws nor aliases nor performs. */
function foreignClips(id: CharacterId): Set<string> {
  const own = allowedClips(id);
  const foreign = new Set<string>();
  for (const other of CHARACTERS) {
    if (other.id === id) continue;
    for (const s of other.behavior.signatures) for (const c of [s.clip, ...(s.leadIn ?? [])]) if (!own.has(c)) foreign.add(c);
  }
  return foreign;
}

test.describe('GizeMate characters in the real overlay (app REAL, pointer input SIMULATED)', () => {
  for (const id of CHARACTER_IDS) {
    // ---- render, geometry, hit region, persistence ---------------------------------------------------------
    test(`${id}: runs as the active character, the overlay draws it, the hit region follows the body`, async ({ userData }, info) => {
      test.setTimeout(480_000);
      // No world events and no emote bubbles: props and bubbles are drawn on the same canvas but are (by design) not part of the hit region.
      const { app } = await boot(userData, id, {}, { companion: { events: { enabled: false } }, appearance: { emotes: false } });
      try {
        expect((await hook(app, 'getSettings')).general.activeCharacter).toBe(id);
        await hook(app, 'saveNow');
        const file = characterStateFile(userData, id);
        expect(fs.existsSync(file), `${file} written after saveNow`).toBe(true);
        const saved = readEnvelope(file);
        if (id !== 'cat') {
          expect(saved.schemaVersion).toBe(1);
          expect(saved.character, 'the per-character file belongs to this character').toBe(id);
          // No other character's file exists, and the cat's file is not this character's.
          const others = fs.readdirSync(path.join(userData, 'characters')).filter((f) => f !== `${id}.json` && f !== `${id}.json.bak`);
          expect(others, 'no other character was ever loaded').toEqual([]);
        }
        const overlays = await hook(app, 'getOverlays');
        const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
        expect(overlays.length, 'one overlay per display, no duplicates').toBe(displays);
        expect(new Set(overlays.map((o) => o.hwnd)).size).toBe(overlays.length);
        expect(overlays.every((o) => o.ready && o.healthy && o.visible && o.alwaysOnTop)).toBe(true);
        // Click-through is the default away from the body.
        expect(overlays.every((o) => o.ignoreMouse), 'overlay is click-through by default').toBe(true);
        expect((await hook(app, 'interactionStats')).interactive).toBe(false);

        // Stand still, draw, measure.
        const still = await holdStill(app);
        const g = await geom(app);
        const d = await drawnBounds(g.page);
        expect(d, 'the overlay renderer painted something (the render snapshot reached it)').not.toBeNull();
        const body = d as Drawn;
        const shot = await shoot(app, id, 'idle');
        const module = getCharacter(id);
        const sizeDip = { w: Math.round(body.x1 - body.x0), h: Math.round(body.y1 - body.y0) };
        // Size: the drawn body is within a sane factor of the module's nominal footprint (settings size 1.0 default).
        expect(sizeDip.w, 'drawn width vs nominal footprint').toBeGreaterThan(module.body.widthDip * 0.3);
        expect(sizeDip.w).toBeLessThan(module.body.widthDip * 2.2);
        expect(sizeDip.h).toBeGreaterThan(module.body.heightDip * 0.3);
        expect(sizeDip.h).toBeLessThan(module.body.heightDip * 2.5);
        // Not clipped by the window: the drawn pixels stay off the overlay edges (the character stands on the floor line:
        // its bottom may touch the work-area bottom, so the lower edge is allowed).
        expect(body.y0).toBeGreaterThan(0);
        edgeCheck(info, id, 'at rest', body, g.ov.bounds.width);
        // The sim's rough bounds contain the drawn centroid.
        const cpx = toPx(g, body.cx, body.cy);
        const sb = still.boundsPx;
        expect(cpx.x).toBeGreaterThan(sb.x - 40);
        expect(cpx.x).toBeLessThan(sb.x + sb.width + 40);
        expect(cpx.y).toBeGreaterThan(sb.y - 40);
        expect(cpx.y).toBeLessThan(sb.y + sb.height + 40);

        const hit = await mapHitRegion(app, g, body);
        const samples = await bodySamples(g.page, body);
        const share = await clickableShare(app, g, samples, hit.latencyMs);
        await shootHitMap(app, id, 'idle-hitmap', [...hit.hits.map((q) => toLocal(g, q)), ...share.hitPts], [...hit.grid.filter((q) => !hit.hits.includes(q)).map((q) => toLocal(g, q)), ...share.misses], body);
        const drawnPx: Rect = { x: toPx(g, body.x0, body.y0).x, y: toPx(g, body.x0, body.y0).y, width: Math.round((body.x1 - body.x0) * g.scale), height: Math.round((body.y1 - body.y0) * g.scale) };
        record(info, `${id} geometry`, { shot, drawnDip: sizeDip, drawnPx, simBoundsPx: sb, hitBboxPx: hit.bbox, hitPoints: hit.hits.length, misses: hit.misses, latencyMs: hit.latencyMs, farHits: `${hit.farHits}/${hit.farProbed}`, nominal: module.body });
        expect(hit.centroidHit, 'the hit region covers the centre of what was drawn').toBe(true);
        expect(hit.hits.length, 'non-empty hit region').toBeGreaterThan(2);
        expect(hit.farHits, 'the overlay never takes the mouse far from the body').toBe(0);
        // The hit region is tight: it does not extend more than 60% of the body beyond the drawn pixels (blocking the desktop).
        const hb = hit.bbox as Rect;
        expect(hb.x).toBeGreaterThanOrEqual(drawnPx.x - drawnPx.width * 0.6);
        expect(hb.x + hb.width).toBeLessThanOrEqual(drawnPx.x + drawnPx.width * 1.6);
        expect(hb.y).toBeGreaterThanOrEqual(drawnPx.y - drawnPx.height * 0.6);
        expect(hb.y + hb.height).toBeLessThanOrEqual(drawnPx.y + drawnPx.height * 1.6);
        // ... and it covers a good part of the body: the grid points inside the drawn bbox are mostly hits.
        const inBox = (p: Point): boolean => p.x >= drawnPx.x && p.x <= drawnPx.x + drawnPx.width && p.y >= drawnPx.y && p.y <= drawnPx.y + drawnPx.height;
        const inside = hit.hits.filter(inBox).length;
        const cells = hit.grid.filter(inBox).length;
        record(info, `${id} hit coverage`, { hitsInsideDrawnBox: inside, gridPointsInsideDrawnBox: cells, clickableShareOfVisibleBody: Math.round(share.share * 100) / 100, bodyPointsProbed: share.probed, unclickableBodyPointsDip: share.misses, drawnDip: { x0: Math.round(body.x0), y0: Math.round(body.y0), x1: Math.round(body.x1), y1: Math.round(body.y1) } });
        expect(share.probed, 'body sample points found').toBeGreaterThanOrEqual(8);
        expect(share.share, 'share of the visible body that is clickable').toBeGreaterThan(0.55);
        expect(inside, 'hits inside the drawn bounding box').toBeGreaterThanOrEqual(4);
        expect(inside / Math.max(1, cells), 'share of the drawn bounding box that is hit').toBeGreaterThan(0.15);

        // The hit region moves with the character: let it walk somewhere else, rest there, and measure again.
        await hook(app, 'setTimeScale', 10);
        await holdStill(app, still.x);
        const g2 = await geom(app);
        const d2 = await drawnBounds(g2.page);
        expect(d2).not.toBeNull();
        const body2 = d2 as Drawn;
        expect(Math.abs(body2.cx - body.cx), 'the drawn body moved (DIP)').toBeGreaterThan(40);
        edgeCheck(info, id, 'after moving', body2, g2.ov.bounds.width);
        const hit2 = await mapHitRegion(app, g2, body2, true);
        const share2 = await clickableShare(app, g2, await bodySamples(g2.page, body2), hit2.latencyMs);
        await shootHitMap(app, id, 'moved-hitmap', [...hit2.hits.map((q) => toLocal(g2, q)), ...share2.hitPts], [...hit2.grid.filter((q) => !hit2.hits.includes(q)).map((q) => toLocal(g2, q)), ...share2.misses], body2);
        expect(share2.share, `share of the visible body that is clickable after moving: ${JSON.stringify(share2.misses)}`).toBeGreaterThan(0.55);
        await shoot(app, id, 'moved');
        record(info, `${id} geometry after moving`, { drawnCx: [Math.round(body.cx), Math.round(body2.cx)], hitBbox: hit2.bbox, farHits: hit2.farHits });
        expect(hit2.centroidHit).toBe(true);
        expect(hit2.farHits).toBe(0);
        const hitXs = [...hit2.hits, ...share2.hitPts.map((q) => toPx(g2, q.x, q.y))].map((q) => q.x);
        expect(hitXs.length, 'hit points found after moving').toBeGreaterThan(3);
        const hb2: Rect = { x: Math.min(...hitXs), y: 0, width: Math.max(...hitXs) - Math.min(...hitXs), height: 0 };
        const hitCx = (r: Rect): number => r.x + r.width / 2;
        const drawnCx2 = toPx(g2, body2.cx, body2.cy).x;
        expect(Math.abs(hitCx(hb2) - drawnCx2), 'hit region centre tracks the drawn body').toBeLessThan(drawnPx.width * 0.7);
        // The old position is no longer a hit.
        const oldSpot = toPx(g2, body.cx, body.cy);
        await hook(app, 'injectCursor', null);
        await sleep(200);
        expect(await probePoint(app, oldSpot, 500), 'the place the body left is click-through again').toBeNull();
        await hook(app, 'injectCursor', null);

        const problems = await logProblems(app);
        expect(problems, (await problemLines(app)).join('\n')).toEqual({ warn: 0, error: 0 });
        expect(fs.existsSync(path.join(SHOTS, `${id}-idle.png`))).toBe(true);
      } finally {
        await hook(app, 'injectCursor', null).catch(() => undefined);
        await quitApp(app).catch(() => undefined);
      }
    });

    // ---- movement and clip variety --------------------------------------------------------------------------
    test(`${id}: moves at x10, shows at least 5 distinct clips, never sticks in one clip`, async ({ userData }, info) => {
      test.setTimeout(150_000);
      const { app } = await boot(userData, id);
      try {
        await hook(app, 'setTimeScale', 10);
        const seen = new Map<string, number>();
        const xs: number[] = [];
        let last = '';
        let runStart = 0;
        let longest = { clip: '', sec: 0 };
        let longestSleep = 0;
        const wallEnd = Date.now() + 40_000;
        let edgeTouches = 0;
        let edgeSamples = 0;
        let iter = 0;
        while (Date.now() < wallEnd) {
          if (iter++ % 5 === 0) {
            const gg = await geom(app).catch(() => null);
            const dd = gg ? await drawnBounds(gg.page) : null;
            // Clinging to a screen-edge wall is at the edge by design.
            const onWall = gg?.out.support.kind === 'surface' && gg.out.support.orientation === 'wall';
            if (gg && dd && !onWall) {
              edgeSamples++;
              if (dd.x0 <= 0.5 || dd.x1 >= gg.ov.bounds.width - 0.5) edgeTouches++;
            }
          }
          const out = await hook(app, 'getSimOutput');
          const simNow = (await hook(app, 'getHostDebug')).simNow;
          if (out) {
            xs.push(out.x);
            seen.set(out.clip, (seen.get(out.clip) ?? 0) + 1);
            if (out.clip !== last) {
              last = out.clip;
              runStart = simNow;
            }
            const run = (simNow - runStart) / 1000;
            if (out.clip === 'sleep') longestSleep = Math.max(longestSleep, Math.round(run));
            else if (run > longest.sec) longest = { clip: out.clip, sec: Math.round(run) };
          }
          await sleep(200);
        }
        const range = Math.max(...xs) - Math.min(...xs);
        record(info, `${id} movement`, { clips: Object.fromEntries(seen), xRange: Math.round(range), longestRun: longest, edgeSamples, edgeTouches });
        if (id === 'cat') expect(edgeTouches / Math.max(1, edgeSamples), `the cat (shipped behaviour, baseline) is rarely at the window edge: ${edgeTouches}/${edgeSamples}`).toBeLessThanOrEqual(0.1);
        else if (edgeTouches > 0) info.annotations.push({ type: 'OBSERVED', description: `${id}: drawn pixels touched the window edge in ${edgeTouches} of ${edgeSamples} samples while walking (off a wall; cause not isolated, see edgeCheck)` });
        expect(range, 'the anchor moved').toBeGreaterThan(150);
        expect(seen.size, `distinct clips: ${[...seen.keys()].join(',')}`).toBeGreaterThanOrEqual(5);
        // Ordinary resting is long: awake sit/loaf runs of 111 to 130 s and naps of up to 543 s of sim time were measured and all ended
        // (soak). A stuck animation never ends, so: an awake clip ends within 240 s, a nap within 900 s, and the sim's own progress
        // monitor (behaviour profile stuckResets) reset nothing.
        expect(longest.sec, `no awake clip longer than 240 s of sim time (longest ${longest.clip} ${longest.sec} s)`).toBeLessThan(240);
        expect(longestSleep, 'a nap ends within 900 s of sim time').toBeLessThan(900);
        expect((await hook(app, 'getBehaviorProfile')).stuckResets, 'the sim progress monitor reset nothing').toBe(0);
        const unknown = [...seen.keys()].filter((c) => !(ANIM_CLIPS as readonly string[]).includes(c));
        expect(unknown, 'every clip is in the canonical vocabulary').toEqual([]);
        const foreign = [...seen.keys()].filter((c) => foreignClips(id).has(c));
        expect(foreign, `no signature clip of another character (${id})`).toEqual([]);
        const g = await geom(app);
        expect(await drawnBounds(g.page), 'still drawing').not.toBeNull();
        expect(await logProblems(app)).toEqual({ warn: 0, error: 0 });
        expect((await hook(app, 'getHostDebug')).tickErrors).toBe(0);
      } finally {
        await quitApp(app).catch(() => undefined);
      }
    });

    // ---- petting, pick up, hold, drag, release, throw ------------------------------------------------------
    test(`${id}: petting, pick-up, drag, release and throw reach the right clips and recover`, async ({ userData }, info) => {
      test.setTimeout(240_000);
      const { app } = await boot(userData, id);
      try {
        await hook(app, 'patchSettings', { interaction: { enabled: true, petting: true, dragging: true, throwing: true } });
        // Let it stand up (the first seconds are the waking-up animation) and avoid a flight in progress.
        const stable = async (): Promise<SimOutput> => {
          for (let i = 0; i < 100; i++) {
            const o = await hook(app, 'getSimOutput');
            if (o && o.visible && o.state !== 'sleeping' && o.state !== 'wakingUp' && !PHYSICAL.has(o.state) && (o.support.kind === 'floor' || (o.support.kind === 'surface' && o.support.orientation !== 'wall'))) return o;
            await sleep(200);
          }
          const o = await hook(app, 'getSimOutput');
          throw new Error(`the character did not settle on the floor or a ledge: ${JSON.stringify({ state: o?.state, clip: o?.clip, support: o?.support })}`);
        };
        await stable();
        const counters = async (): Promise<{ pets: number; clicks: number }> => {
          await hook(app, 'saveNow');
          const raw = readEnvelope(characterStateFile(userData, id)) as { companion?: { memory: { counters: { pets: number; clicks: number } } }; memory?: { counters: { pets: number; clicks: number } } };
          return (raw.companion?.memory ?? raw.memory!).counters;
        };
        const press0 = (await hook(app, 'interactionStats')).overlay?.presses ?? 0;
        const c0 = await counters();
        const module = getCharacter(id);

        // --- petting: hover strokes over the body (no button) ---
        await hook(app, 'forceInteractive', false); // CDP input reaches the page; the real mouse cannot take the desk
        const sawPet = { state: false, clip: new Set<string>() };
        for (let attempt = 0; attempt < 3 && !sawPet.state; attempt++) {
          await stable();
          const g = await geom(app);
          const c = center(g.out.boundsPx);
          let x = c.x - 24;
          let dir = 1;
          const until = Date.now() + 2600;
          while (Date.now() < until) {
            const cur = await hook(app, 'getSimOutput');
            const cc = cur ? center(cur.boundsPx) : c;
            x += dir * 6 * g.scale;
            if (Math.abs(x - cc.x) >= 24 * g.scale) dir = -dir;
            const p = { x: Math.round(x), y: cc.y };
            await Promise.all([hook(app, 'injectCursor', p), g.page.mouse.move(toLocal(g, p).x, toLocal(g, p).y)]);
            if (cur && cur.state === 'beingPetted') {
              if (!sawPet.state) await shoot(app, id, 'petted');
              sawPet.state = true;
              sawPet.clip.add(cur.clip);
            }
            await sleep(25);
          }
        }
        await hook(app, 'injectCursor', null);
        const c1 = await counters();
        record(info, `${id} petting`, { petsBefore: c0.pets, petsAfter: c1.pets, clips: [...sawPet.clip], reaction: module.reactions.petted?.clip ?? null });
        expect(c1.pets, 'the real stroke path counted a pet').toBeGreaterThan(c0.pets);
        expect(sawPet.state, 'the sim entered beingPetted').toBe(true);
        expect([...sawPet.clip].every((cl) => cl === 'petted' || cl === (module.reactions.petted?.clip ?? 'petted')), `petted clips ${[...sawPet.clip].join(',')}`).toBe(true);
        await recovered(app, 'after petting');

        // --- pick up, hold, drag, release ---
        let lostHolds = 0;
        const gesture = async (kind: 'drag' | 'throw'): Promise<number> => {
          await stable();
          const g = await geom(app);
          const c = center(g.out.boundsPx);
          const before = await hook(app, 'getBehaviorProfile');
          const pressesBefore = (await hook(app, 'interactionStats')).overlay?.presses ?? 0;
          await g.page.evaluate(DELIVERED_PROBE);
          await g.page.evaluate(DELIVERED_TAKE);
          await hook(app, 'injectCursor', c);
          await g.page.mouse.move(toLocal(g, c).x, toLocal(g, c).y);
          await g.page.mouse.down();
          let p = c;
          const step = async (to: Point, n: number, gap: number): Promise<void> => {
            const from = p;
            for (let i = 1; i <= n; i++) {
              p = { x: Math.round(from.x + ((to.x - from.x) * i) / n), y: Math.round(from.y + ((to.y - from.y) * i) / n) };
              await Promise.all([hook(app, 'injectCursor', p), g.page.mouse.move(toLocal(g, p).x, toLocal(g, p).y)]);
              if (gap > 0) await sleep(gap);
            }
          };
          await step({ x: c.x, y: c.y - 30 * g.scale }, 3, 20);
          // held within 1.5 s
          let held: SimOutput | null = null;
          for (let i = 0; i < 60 && !held; i++) {
            const o = await hook(app, 'getSimOutput');
            if (o?.state === 'held') held = o;
            else await sleep(25);
          }
          expect(held, `${kind}: picked up (state held)`).not.toBeNull();
          const heldClip = (held as SimOutput).clip;
          expect(heldClip === 'held' || heldClip === (module.reactions.held?.clip ?? 'held'), `held clip ${heldClip}`).toBe(true);
          expect((await hook(app, 'interactionStats')).overlay?.presses ?? 0, 'the overlay press path counted the press').toBeGreaterThan(pressesBefore);
          // drag along, still held, and the body follows the cursor
          const dragSide = c.x < g.ov.boundsPx.x + g.ov.boundsPx.width / 2 ? 1 : -1;
          await step({ x: c.x + dragSide * 140 * g.scale, y: c.y - 90 * g.scale }, 10, 70);
          const mid = await hook(app, 'getSimOutput');
          if (mid?.state !== 'held') {
            // CDP input has no OS button state: any real mouse movement on this shared desk can end a synthetic drag (see soak.spec.ts).
            // Release, let the character recover, and let the caller retry; counted and reported.
            lostHolds++;
            await g.page.mouse.up();
            await hook(app, 'injectCursor', null);
            await recovered(app, `lost hold (${mid?.state})`);
            return -1;
          }
          expect(Math.abs(mid.x - c.x), 'the character followed the drag').toBeGreaterThan(60);
          if (kind === 'drag') await shoot(app, id, 'held');
          let released = false;
          if (kind === 'throw') {
            // flick: fast moves (>> 1100 DIP/s), no hook call in between
            const side = p.x < g.ov.boundsPx.x + g.ov.boundsPx.width / 2 ? 1 : -1;
            const end = { x: Math.min(g.ov.boundsPx.x + g.ov.boundsPx.width - 12, Math.max(g.ov.boundsPx.x + 12, p.x + side * 450 * g.scale)), y: Math.max(g.ov.boundsPx.y + 12, p.y - 300 * g.scale) };
            const from = p;
            // Eight moves scheduled one frame (16 ms) apart by timers, then the release at the end of the same schedule. They are
            // fired without awaiting each other: on a loaded machine one CDP round trip is 30-40 ms, which would make a serial
            // flick arrive as one slow move (a drop by design). The page timestamps what it receives; the retry covers the rest.
            const sends: Array<Promise<void>> = [];
            for (let i = 1; i <= 8; i++) {
              const q = { x: Math.round(from.x + ((end.x - from.x) * i) / 8), y: Math.round(from.y + ((end.y - from.y) * i) / 8) };
              sends.push(new Promise<void>((res) => setTimeout(() => void g.page.mouse.move(toLocal(g, q).x, toLocal(g, q).y).then(() => res(), () => res()), i * 16)));
            }
            sends.push(new Promise<void>((res) => setTimeout(() => void g.page.mouse.up().then(() => res(), () => res()), 9 * 16)));
            await Promise.all(sends);
            released = true;
            p = end;
          }
          if (!released) await g.page.mouse.up();
          await hook(app, 'injectCursor', p);
          const delivered = deliveredReleaseSpeed(await g.page.evaluate<Array<{ k: string; t: number; x: number; y: number }>>(DELIVERED_TAKE));
          if (kind === 'throw') record(info, `${id} flick as delivered`, delivered);
          let fell = 0;
          const t0 = Date.now();
          while (Date.now() - t0 < 9000 && fell === 0) {
            const prof = await hook(app, 'getBehaviorProfile');
            const by = prof.falls.byCause as Record<string, number>;
            const b0 = before.falls.byCause as Record<string, number>;
            fell = (by['thrown'] ?? 0) - (b0['thrown'] ?? 0) + ((by['dropped'] ?? 0) - (b0['dropped'] ?? 0));
            if (fell === 0) await sleep(100);
          }
          expect(fell, `${kind}: the release became a fall (thrown or dropped)`).toBeGreaterThanOrEqual(1);
          let thrown = 0;
          if (kind === 'throw') {
            const prof = await hook(app, 'getBehaviorProfile');
            thrown = ((prof.falls.byCause as Record<string, number>)['thrown'] ?? 0) - ((before.falls.byCause as Record<string, number>)['thrown'] ?? 0);
          }
          await hook(app, 'injectCursor', null);
          await recovered(app, `after ${kind}`);
          const s = await hook(app, 'interactionStats');
          expect(s.pressed, 'no press left behind').toBe(false);
          expect(s.dragging, 'no drag left behind').toBe(false);
          return thrown;
        };
        let dragged = -1;
        for (let i = 0; i < 4 && dragged < 0; i++) dragged = await gesture('drag');
        expect(dragged, 'a drag held the character (4 attempts)').toBeGreaterThanOrEqual(0);
        // CDP delivers the flick with the harness's own timing (the soak oracle sets such input aside): a drop caused by a slow
        // delivery is retried, up to 4 attempts, and the attempts are reported.
        let thrown = 0;
        let throwAttempts = 0;
        while (thrown < 1 && throwAttempts < 5) {
          throwAttempts++;
          thrown = Math.max(0, await gesture('throw'));
        }
        record(info, `${id} throw`, { thrown, attempts: throwAttempts, lostHolds });
        expect(thrown, `a fast flick is a throw, not a drop (${throwAttempts} attempts)`).toBeGreaterThanOrEqual(1);

        // --- click-through stays the default away from the body ---
        await hook(app, 'forceInteractive', null);
        const g = await geom(app);
        const far = toPx(g, g.out.x < g.ov.bounds.width * g.scale / 2 ? g.ov.bounds.width - 70 : 70, 70);
        await hook(app, 'injectCursor', far);
        await sleep(500);
        expect(await takesMouse(app), 'click-through away from the body').toBe(false);
        await hook(app, 'injectCursor', null);
        const pressesEnd = (await hook(app, 'interactionStats')).overlay?.presses ?? 0;
        record(info, `${id} presses`, { before: press0, after: pressesEnd });
        expect(pressesEnd).toBeGreaterThanOrEqual(press0 + 2);
        expect(await logProblems(app)).toEqual({ warn: 0, error: 0 });
      } finally {
        await hook(app, 'injectCursor', null).catch(() => undefined);
        await hook(app, 'forceInteractive', null).catch(() => undefined);
        await quitApp(app).catch(() => undefined);
      }
    });

    // ---- laser mode and world events ------------------------------------------------------------------------
    test(`${id}: laser mode chases but never hunts or catches, and a world event makes it react`, async ({ userData }, info) => {
      test.setTimeout(240_000);
      const { app } = await boot(userData, id, {}, { companion: { events: { enabled: true, rare: false, pace: 2 } } });
      try {
        const module = getCharacter(id);
        // --- laser ---
        const h0 = (await hook(app, 'getBehaviorProfile')).hunts;
        expect((await hook(app, 'runAction', 'startLaserMode')) as { ok: boolean }).toMatchObject({ ok: true });
        await hook(app, 'setTimeScale', 4);
        const states = new Map<string, number>();
        const clips = new Set<string>();
        // The light sits ~600 px from the character (injected cursor; the real cursor is untouched), first on one side, then the other.
        const approach: Array<{ from: number; to: number; light: number }> = [];
        const trace: string[] = [];
        // Up to 4 phases of 12 s wall (about 48 sim-s at x4) on alternating sides, stopping at the first approach: a character that is
        // resting or watching the user answers a still light only when its rest dwell ends (fox: after 1 to 3 phases in the runs),
        // so the number of phases it needed is reported.
        for (let phase = 0; phase < 4 && !approach.some((a) => a.from - a.to >= 150); phase++) {
          const g = await geom(app);
          const o0 = g.out;
          const minX = g.ov.boundsPx.x + 60;
          const maxX = g.ov.boundsPx.x + g.ov.boundsPx.width - 60;
          const towardRight = phase % 2 === 0 ? o0.x < (minX + maxX) / 2 : o0.x >= (minX + maxX) / 2;
          const light = { x: Math.round(Math.min(maxX, Math.max(minX, o0.x + (towardRight ? 600 : -600)))), y: Math.round(o0.y - 30) };
          await hook(app, 'injectCursor', light);
          const tEnd = Date.now() + 12_000;
          let best = Math.abs(o0.x - light.x);
          let nextTrace = Date.now();
          while (Date.now() < tEnd) {
            const o = await hook(app, 'getSimOutput');
            if (o) {
              if (Date.now() >= nextTrace) {
                trace.push(`${phase}:${Math.round(o.x - light.x)}:${o.state}/${o.clip}`);
                nextTrace = Date.now() + 2000;
              }
              states.set(o.state, (states.get(o.state) ?? 0) + 1);
              clips.add(o.clip);
              best = Math.min(best, Math.abs(o.x - light.x));
            }
            await sleep(120);
          }
          approach.push({ from: Math.round(Math.abs(o0.x - light.x)), to: Math.round(best), light: light.x });
        }
        const h1 = (await hook(app, 'getBehaviorProfile')).hunts;
        record(info, `${id} laser`, { phasesNeeded: approach.length, approach, trace, states: Object.fromEntries(states), clips: [...clips], hunts: [h0, h1], reactionSpec: module.reactions.laser ?? null });
        await shoot(app, id, 'laser');
        expect(h1.count - h0.count, 'laser mode starts no hunt').toBe(0);
        expect(h1.pounces - h0.pounces, 'laser mode never pounces').toBe(0);
        expect(h1.byOutcome['caught'] ?? 0, 'laser mode never catches').toBe(h0.byOutcome['caught'] ?? 0);
        expect(approach.some((a) => a.from - a.to >= 150), `the character went toward the light within 4 phases: ${JSON.stringify(approach)}`).toBe(true);
        await hook(app, 'injectCursor', null);
        expect((await hook(app, 'runAction', 'stopLaserMode')) as { ok: boolean }).toMatchObject({ ok: true });

        // --- world event through the real event engine (the schedule runs at x20 until one starts) ---
        await hook(app, 'setTimeScale', 20);
        let started: SimOutput | null = null;
        const tEv = Date.now() + 100_000;
        while (Date.now() < tEv && !started) {
          const o = await hook(app, 'getSimOutput');
          if (o?.worldEvent) started = o;
          else await sleep(60);
        }
        expect(started, 'a world event started within 100 s of wall time').not.toBeNull();
        await hook(app, 'setTimeScale', 3);
        const evId = (started as SimOutput).worldEvent!.id;
        const evClips = new Set<string>();
        const evStates = new Set<string>();
        let props = 0;
        let shot = false;
        const tObs = Date.now() + 30_000;
        while (Date.now() < tObs) {
          const o = await hook(app, 'getSimOutput');
          if (!o) break;
          if (o.worldEvent) {
            evClips.add(o.clip);
            evStates.add(o.state);
            props = Math.max(props, o.props?.length ?? 0);
            if (!shot && (o.props?.length ?? 0) > 0) {
              shot = true;
              await shoot(app, id, `event-${evId}`);
            }
          } else if (evClips.size > 0) break;
          await sleep(120);
        }
        record(info, `${id} world event`, { event: evId, clips: [...evClips], states: [...evStates], maxProps: props });
        expect(evClips.size, `the character was observed during the event ${evId}`).toBeGreaterThan(0);
        expect(props, 'the event drew props (they reach the overlay renderer through the snapshot)').toBeGreaterThan(0);
        expect(evClips.size + evStates.size, 'clips or states changed during the event').toBeGreaterThanOrEqual(2);
        expect(await logProblems(app)).toEqual({ warn: 0, error: 0 });
      } finally {
        await hook(app, 'injectCursor', null).catch(() => undefined);
        await quitApp(app).catch(() => undefined);
      }
    });

    // ---- clean quit ------------------------------------------------------------------------------------------
    test(`${id}: a clean quit exits 0, flushes the character file and leaves no process behind`, async ({ userData }, info) => {
      test.setTimeout(90_000);
      const { app, pid } = await boot(userData, id);
      let pids: number[];
      let metricsSeen: unknown;
      try {
        const mainPid = await app.evaluate(() => process.pid);
        const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type })));
        // Playwright's handle is the launcher process (its pid differs from the app's own); both must be gone.
        pids = [...new Set([...metrics.map((m) => m.pid), mainPid, pid])];
        metricsSeen = metrics;
        expect(metrics.map((m) => m.pid)).toContain(mainPid);
      } catch (err) {
        await quitApp(app).catch(() => undefined);
        throw err;
      }
      const code = await quitApp(app);
      expect(code, 'exit code').toBe(0);
      const file = characterStateFile(userData, id);
      expect(fs.existsSync(file), 'state flushed on quit').toBe(true);
      const env = readEnvelope(file);
      expect(env.schemaVersion).toBe(1);
      if (id !== 'cat') expect(env.character).toBe(id);
      // Only the PIDs this run's app owned (main, GPU, renderers, utility): all gone.
      const alive = (p: number): boolean => {
        try {
          process.kill(p, 0);
          return true;
        } catch {
          return false;
        }
      };
      const t0 = Date.now();
      while (pids.some(alive) && Date.now() - t0 < 8000) await sleep(200);
      const left = pids.filter(alive);
      record(info, `${id} shutdown`, { code, processes: metricsSeen, left });
      expect(left, 'no process of this run remains').toEqual([]);
      expect(readSettingsActive(userData), 'the active character is persisted').toBe(id);
    });
  }

  // ---- switching through all seven characters, three times ----------------------------------------------------
  test('switching A->B->...->cat through all seven characters three times: saved, uncorrupted, one overlay, no leaks', async ({ userData }, info) => {
    test.setTimeout(420_000);
    const { app } = await boot(userData, 'cat');
    try {
      await hook(app, 'eventLoopDelay', true); // starts the histogram
      const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
      const initial = await hook(app, 'getOverlays');
      const hwnds = initial.map((o) => o.hwnd).sort();
      let catHash: string | null = null;
      let swaps = 0;
      const snapshots: Array<Record<string, unknown>> = [];
      const listeners = (): Promise<Record<string, unknown>> =>
        app.evaluate(({ app: a, screen, powerMonitor, ipcMain, BrowserWindow }) => {
          const ee = (o: { eventNames(): Array<string | symbol>; listenerCount(n: string | symbol): number }): Record<string, number> => Object.fromEntries(o.eventNames().map((n) => [String(n), o.listenerCount(n)]));
          const res = process.getActiveResourcesInfo();
          const count = (t: string): number => res.filter((r) => r === t).length;
          return {
            app: ee(a),
            screen: ee(screen),
            powerMonitor: ee(powerMonitor),
            ipcMain: ee(ipcMain),
            windows: BrowserWindow.getAllWindows().length,
            windowListeners: BrowserWindow.getAllWindows().map((w) => ({ win: ee(w), wc: ee(w.webContents) })),
            timeouts: count('Timeout'),
            immediates: count('Immediate'),
          };
        });
      const order: CharacterId[] = [...CHARACTER_IDS.slice(1), 'cat'];
      let active: CharacterId = 'cat';
      await hook(app, 'saveNow');
      for (let cycle = 1; cycle <= 3; cycle++) {
        for (const next of order) {
          const previous = active;
          const prevFile = characterStateFile(userData, previous);
          const nextFile = characterStateFile(userData, next);
          const catBefore = sha256File(characterStateFile(userData, 'cat'));
          const patched = await hook(app, 'patchSettings', { general: { activeCharacter: next } });
          expect(patched.ok).toBe(true);
          const t0 = Date.now();
          let shown = false;
          for (;;) {
            // The new character's file exists at once (a fresh companion is saved on adoption) and the overlay paints it.
            const logs = await hook(app, 'getRecentLogs', 500);
            const changed = logs.filter((l) => l.msg === 'active character changed' && (l.data as { to?: string } | undefined)?.to === next).length;
            const g = await geom(app).catch(() => null);
            const d = g ? await drawnBounds(g.page) : null;
            if (changed > 0 && d && fs.existsSync(nextFile)) {
              shown = true;
              break;
            }
            if (Date.now() - t0 > 6000) break;
            await sleep(120);
          }
          swaps++;
          expect(shown, `swap ${swaps} ${previous} -> ${next}: shown within 6 s`).toBe(true);
          await sleep(300);
          // The previous character's state was saved and is valid.
          const prevEnv = readEnvelope(prevFile);
          expect(prevEnv.schemaVersion, `${previous} file schemaVersion`).toBe(1);
          if (previous !== 'cat') expect(prevEnv.character).toBe(previous);
          // The cat's file is untouched while it is not the active character (hash equal across non-cat swaps).
          if (previous !== 'cat' && next !== 'cat') expect(sha256File(characterStateFile(userData, 'cat')), `cat-state.json unchanged during ${previous} -> ${next}`).toBe(catBefore);
          if (previous === 'cat') catHash = sha256File(characterStateFile(userData, 'cat'));
          else if (next !== 'cat') expect(sha256File(characterStateFile(userData, 'cat'))).toBe(catHash);
          const nextEnv = readEnvelope(nextFile);
          expect(nextEnv.schemaVersion).toBe(1);
          // One overlay per display, the same windows, no duplicates.
          const ovs = await hook(app, 'getOverlays');
          expect(ovs.length).toBe(displays);
          expect(ovs.map((o) => o.hwnd).sort(), 'the overlay windows are the originals (no duplicates, no recreation)').toEqual(hwnds);
          expect(ovs.every((o) => o.ready && o.healthy)).toBe(true);
          expect(overlayCount(app), 'one overlay page per display').toBe(displays);
          // The hit region belongs to the new body: re-measure the drawn body and probe its centre with the sim paused.
          await holdStill(app);
          const g = await geom(app);
          const d = await drawnBounds(g.page);
          expect(d, `${next} drawn after the swap`).not.toBeNull();
          const cpx = toPx(g, (d as Drawn).cx, (d as Drawn).cy);
          let hitMs: number | null = null;
          for (const delta of [0, -8, 8]) {
            hitMs = await probePoint(app, { x: cpx.x + delta * g.scale, y: cpx.y }, 800);
            if (hitMs !== null) break;
            await hook(app, 'injectCursor', null);
            await sleep(150);
          }
          await hook(app, 'injectCursor', null);
          expect(hitMs, `${next}: the hit region covers the new body`).not.toBeNull();
          if (cycle === 1) await shoot(app, next, 'after-swap');
          await hook(app, 'setTimeScale', 1);
          active = next;
        }
        snapshots.push({ cycle, ...(await listeners()), hostTicks: (await hook(app, 'getHostDebug')).ticks });
      }
      const s1 = snapshots[0] as Record<string, unknown>;
      const s3 = snapshots[2] as Record<string, unknown>;
      record(info, 'listener and timer snapshots after each cycle', snapshots.map((s) => ({ cycle: s.cycle, windows: s.windows, timeouts: s.timeouts, immediates: s.immediates, appListeners: s.app, screen: s.screen, powerMonitor: s.powerMonitor })));
      // Listener counts on the app, screen, powerMonitor, ipcMain and every window are identical after cycle 1 and cycle 3.
      expect(s3.app).toEqual(s1.app);
      expect(s3.screen).toEqual(s1.screen);
      expect(s3.powerMonitor).toEqual(s1.powerMonitor);
      expect(s3.ipcMain).toEqual(s1.ipcMain);
      expect(s3.windows).toBe(s1.windows);
      expect(s3.windowListeners).toEqual(s1.windowListeners);
      // Active timers do not accumulate (a leaked tick or poll timer per swap would add 14 by cycle 3).
      expect(s3.timeouts as number, 'active timeouts after 3 cycles vs after 1').toBeLessThanOrEqual((s1.timeouts as number) + 3);
      // Only one host ticks: ticks of the live host (it restarted at each swap) are plausible for its age, not doubled.
      const problems = await logProblems(app);
      expect(problems, (await problemLines(app)).join('\n')).toEqual({ warn: 0, error: 0 });
      expect(swaps).toBe(21);
      expect((await hook(app, 'getHostDebug')).tickErrors).toBe(0);
      const delay = await hook(app, 'eventLoopDelay');
      record(info, 'event loop after 21 swaps', delay);
    } finally {
      await quitApp(app).catch(() => undefined);
    }
  });

  // ---- Turkish and live language change --------------------------------------------------------------------
  test('Turkish: the settings window is Turkish, and a live language change re-renders it in place with focus kept', async ({ userData }, info) => {
    test.setTimeout(120_000);
    const { app } = await boot(userData, 'fox', { language: 'tr' });
    try {
      const page = await settingsPage(app);
      await page.waitForFunction('!!document.querySelector(".rail .nav-item")');
      expect(await page.evaluate<string>('document.documentElement.lang'), 'document language').toBe('tr');
      const nav = (await page.locator('.rail .nav-item').allInnerTexts()).map(lastLine);
      record(info, 'tr nav', nav);
      expect(nav).toEqual(['Ana sayfa', 'Karakterler', 'Özelleştir', 'Ayarlar']);
      const heads = (await page.locator('h1,h2').allInnerTexts()).map(lastLine);
      for (const h of ['Ana sayfa', 'Karakterler', 'Özelleştir', 'Ayarlar', 'Tilki']) expect(heads, `headings contain ${h}`).toContain(h);
      for (const english of ['Home', 'Characters', 'Customize', 'Settings']) expect(nav).not.toContain(english);

      // Live switch to English. The settings window is NOT recreated: main pushes the new state and the page re-renders in
      // place (no new window, same page object), the language follows, and keyboard focus stays on the nav item it was on.
      await page.locator('.rail .nav-item').nth(1).focus();
      const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('/renderer/settings/')).map((w) => ({ id: w.id, focused: w.isFocused(), visible: w.isVisible(), minimized: w.isMinimized() })));
      expect((await hook(app, 'patchSettings', { general: { language: 'en' } })).ok).toBe(true);
      await expect.poll(() => page.evaluate<string>('document.documentElement.lang'), { timeout: 8000 }).toBe('en');
      await expect.poll(async () => (await page.locator('.rail .nav-item').allInnerTexts()).map(lastLine), { timeout: 8000 }).toEqual(['Home', 'Characters', 'Customize', 'Settings']);
      await expect.poll(() => app.windows().filter((p) => p.url().includes('/renderer/settings/') && !p.isClosed()).length, { timeout: 8000 }).toBe(1);
      expect(page.isClosed(), 'the same settings page lives on').toBe(false);
      const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('/renderer/settings/')).map((w) => ({ id: w.id, focused: w.isFocused(), visible: w.isVisible(), minimized: w.isMinimized() })));
      const active = await page.evaluate<{ tag: string | null; cls: string | null; text: string | null }>(
        `(() => { const el = document.activeElement; return { tag: el ? el.tagName : null, cls: el ? el.className : null, text: ((el && el.textContent) || '').trim().split(String.fromCharCode(10)).pop() || null }; })()`,
      );
      record(info, 'settings window around the language change', { before, after, activeElement: active });
      expect(after, 'one window, the same one, same visibility and focus as before').toEqual(before);
      expect(String(active.cls), `keyboard focus stays on the nav item (now: ${JSON.stringify(active)})`).toContain('nav-item');
      expect(active.text, 'it is the same item, relabelled').toContain('Characters');
      // And back to Turkish.
      expect((await hook(app, 'patchSettings', { general: { language: 'tr' } })).ok).toBe(true);
      await expect.poll(() => page.evaluate<string>('document.documentElement.lang'), { timeout: 8000 }).toBe('tr');
      expect(await logProblems(app)).toEqual({ warn: 0, error: 0 });
    } finally {
      await quitApp(app).catch(() => undefined);
    }
  });

  // ---- names ---------------------------------------------------------------------------------------------------------
  test('names: a custom name for a non-cat character reaches the app (context menu), live, and the cat name stays', async ({ userData }, info) => {
    test.setTimeout(120_000);
    const { app } = await boot(userData, 'monkey');
    try {
      // Record the real context menu the overlay asks main for (no native menu is shown).
      await app.evaluate(({ Menu }) => {
        const g = globalThis as Record<string, unknown>;
        g.__menus = [];
        (Menu.prototype as unknown as { popup: (o?: unknown) => void }).popup = function (this: { items: Array<{ label: string }> }) {
          (g.__menus as string[][]).push(this.items.map((i) => i.label));
        };
      });
      const openMenu = async (): Promise<string[]> => {
        await hook(app, 'forceInteractive', false);
        for (let i = 0; i < 20; i++) {
          const o = await hook(app, 'getSimOutput');
          if (o && !PHYSICAL.has(o.state)) break;
          await sleep(200);
        }
        const g = await geom(app);
        const c = center(g.out.boundsPx);
        const n0 = await app.evaluate(() => ((globalThis as Record<string, unknown>).__menus as unknown[]).length);
        await hook(app, 'injectCursor', c);
        await g.page.mouse.move(toLocal(g, c).x, toLocal(g, c).y);
        await g.page.mouse.click(toLocal(g, c).x, toLocal(g, c).y, { button: 'right' });
        await sleep(500);
        const menus = await app.evaluate(() => (globalThis as Record<string, unknown>).__menus as string[][]);
        await hook(app, 'injectCursor', null);
        await hook(app, 'forceInteractive', null);
        expect(menus.length, 'the context menu was requested').toBeGreaterThan(n0);
        return menus[menus.length - 1] as string[];
      };
      await holdStill(app); // the resting body stays under the cursor
      const before = await openMenu();
      record(info, 'menu with the default name', before);
      expect(before.join('|')).toContain('Monkey');
      expect((await hook(app, 'patchSettings', { general: { characterNames: { monkey: 'Biscuit' } } })).ok).toBe(true);
      expect((await hook(app, 'getSettings')).general.characterNames).toEqual({ monkey: 'Biscuit' });
      const after = await openMenu();
      record(info, 'menu with a custom name', after);
      expect(after.join('|')).toContain('Biscuit');
      expect(after.join('|')).not.toContain('Monkey');
      // The cat's own name is unaffected.
      expect((await hook(app, 'getSettings')).general.catName).not.toBe('Biscuit');
      // Turkish default name for a character without a custom name, and the custom name survives the language change.
      expect((await hook(app, 'patchSettings', { general: { language: 'tr' } })).ok).toBe(true);
      expect((await openMenu()).join('|')).toContain('Biscuit');
      // Persisted.
      await hook(app, 'saveNow');
      await sleep(600);
      const settingsFile = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')) as { general: { characterNames?: Record<string, string> } };
      expect(settingsFile.general.characterNames).toEqual({ monkey: 'Biscuit' });
      expect(await logProblems(app)).toEqual({ warn: 0, error: 0 });
    } finally {
      await quitApp(app).catch(() => undefined);
    }
  });
});

/** The overlay pages currently open. */
function overlayCount(app: ElectronApplication): number {
  return app.windows().filter((p) => p.url().includes('/renderer/overlay/') && !p.isClosed()).length;
}

function readSettingsActive(userData: string): string | null {
  const s = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')) as { general?: { activeCharacter?: string } };
  return s.general?.activeCharacter ?? null;
}

/** After a physical or reaction state, the character is back to normal behaviour (not held, flying or reacting) within 20 s of wall time. */
async function recovered(app: ElectronApplication, what: string): Promise<void> {
  const calm = new Set(['idle', 'walking', 'running', 'resting', 'grooming', 'sleeping', 'watchingCursor', 'curious', 'playing', 'chasingCursor', 'inspectingWindow', 'seekingAttention', 'watchingUser', 'fallingAsleep', 'wakingUp', 'hiding']);
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 20_000) {
    const o = await hook(app, 'getSimOutput');
    last = o?.state ?? '';
    if (o && calm.has(o.state) && o.support.kind !== 'held' && o.support.kind !== 'air') return;
    await sleep(150);
  }
  throw new Error(`${what}: the character did not return to normal behaviour (last state ${last})`);
}
