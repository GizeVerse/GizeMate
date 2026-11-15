// The slime renderer: every clip draws finite, bounded, clickable geometry in every palette, facing and
// style; reduced motion calms it; the pendant follows the body; NaN inputs never break it.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip, type CatRenderState } from '../../../../src/shared/cat';
import { SLIME_MODULE } from '../../../../src/shared/characters/slime';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import type { AnimInput } from '../../../../src/renderer/overlay/cat/animator';
import { MAX_HIT_RECTS, type CharacterRenderer, type DrawParams, type GeometryCollector } from '../../../../src/renderer/overlay/character/types';
import { createSlimeRenderer, resolveSlimeClip } from '../../../../src/renderer/overlay/characters/slime';
import { isNativeClip } from '../../../../src/renderer/overlay/characters/slime/clips';
import { getSlimePalette } from '../../../../src/renderer/overlay/characters/slime/skins';
import { CatScene } from '../../../../src/renderer/overlay/scene';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: clip === 'sleep', speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1, ...extra };
}

function speedFor(clip: AnimClip): number {
  return clip === 'bounce' || clip === 'hop' ? 1.2 : 0;
}

/** Runs the renderer `ms` forward on a steady clip. */
function run(r: CharacterRenderer, clip: AnimClip, ms: number, extra: Partial<AnimInput> = {}, t0 = 0): number {
  let t = t0;
  const end = t0 + ms;
  for (; t <= end; t += DT) r.advance(input(clip, { speed: speedFor(clip), clipStartedAt: t0, vy: clip === 'fall' ? 600 : clip === 'jump' ? -600 : 0, ...extra }), t, t === t0 ? 0 : DT, 0, 0);
  return t;
}

interface Extents {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Collects bounds and hit rects the way the scene does. */
function measureOf(r: CharacterRenderer): { bounds: Extents; hits: Array<Extents | null> } {
  const bounds: Extents = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const hits: Array<Extents | null> = [null, null, null, null, null, null, null, null];
  const grow = (e: Extents, x: number, y: number, rr: number): void => {
    e.x0 = Math.min(e.x0, x - rr);
    e.y0 = Math.min(e.y0, y - rr);
    e.x1 = Math.max(e.x1, x + rr);
    e.y1 = Math.max(e.y1, y + rr);
  };
  const g: GeometryCollector = {
    add(x, y, rr, hit) {
      grow(bounds, x, y, rr);
      if (hit >= 0) {
        expect(hit).toBeLessThan(MAX_HIT_RECTS);
        const h = (hits[hit] ??= { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        grow(h, x, y, rr);
      }
    },
    addGround(cx, half, rh) {
      grow(bounds, cx - half, -0.6, rh);
      grow(bounds, cx + half, -0.6, rh);
    },
  };
  r.measure(g);
  return { bounds, hits };
}

/** A recording context: extents of every path point (stroked paths widened by half the line width). */
function recorder(): { ctx: ReturnType<typeof createMockCtx>; ext: Extents; calls: () => number } {
  const m = createMockCtx();
  const ext: Extents = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let px0 = Infinity;
  let py0 = Infinity;
  let px1 = -Infinity;
  let py1 = -Infinity;
  const pt = (x: number, y: number, rr = 0): void => {
    px0 = Math.min(px0, x - rr);
    py0 = Math.min(py0, y - rr);
    px1 = Math.max(px1, x + rr);
    py1 = Math.max(py1, y + rr);
  };
  const flush = (pad: number): void => {
    if (px0 <= px1) {
      ext.x0 = Math.min(ext.x0, px0 - pad);
      ext.y0 = Math.min(ext.y0, py0 - pad);
      ext.x1 = Math.max(ext.x1, px1 + pad);
      ext.y1 = Math.max(ext.y1, py1 + pad);
    }
  };
  // The mock is a Proxy whose getter builds recorders; shadow the drawing calls on a thin wrapper instead.
  const wrapped = new Proxy(m.ctx, {
    get(t, key) {
      const v = (t as unknown as Record<string | symbol, unknown>)[key];
      if (typeof key !== 'string') return v;
      switch (key) {
        case 'beginPath':
          return (...a: unknown[]) => {
            px0 = py0 = Infinity;
            px1 = py1 = -Infinity;
            return (v as (...x: unknown[]) => unknown)(...a);
          };
        case 'moveTo':
        case 'lineTo':
          return (x: number, y: number) => {
            pt(x, y);
            return (v as (...x: unknown[]) => unknown)(x, y);
          };
        case 'quadraticCurveTo':
          return (cx: number, cy: number, x: number, y: number) => {
            pt(cx, cy);
            pt(x, y);
            return (v as (...x: unknown[]) => unknown)(cx, cy, x, y);
          };
        case 'bezierCurveTo':
          return (a: number, b: number, c: number, d: number, x: number, y: number) => {
            pt(a, b);
            pt(c, d);
            pt(x, y);
            return (v as (...x: unknown[]) => unknown)(a, b, c, d, x, y);
          };
        case 'arc':
          return (x: number, y: number, rr: number, ...rest: unknown[]) => {
            pt(x, y, rr);
            return (v as (...x: unknown[]) => unknown)(x, y, rr, ...rest);
          };
        case 'ellipse':
          return (x: number, y: number, rx: number, ry: number, ...rest: unknown[]) => {
            expect(rx).toBeGreaterThanOrEqual(0);
            expect(ry).toBeGreaterThanOrEqual(0);
            const rot = typeof rest[0] === 'number' ? rest[0] : 0;
            const hx = Math.hypot(rx * Math.cos(rot), ry * Math.sin(rot));
            const hy = Math.hypot(rx * Math.sin(rot), ry * Math.cos(rot));
            pt(x - hx, y - hy);
            pt(x + hx, y + hy);
            return (v as (...x: unknown[]) => unknown)(x, y, rx, ry, ...rest);
          };
        case 'stroke':
          return (...a: unknown[]) => {
            flush(((t as unknown as Record<string, number>).lineWidth ?? 1) / 2);
            return (v as (...x: unknown[]) => unknown)(...a);
          };
        case 'fill':
          return (...a: unknown[]) => {
            flush(0);
            return (v as (...x: unknown[]) => unknown)(...a);
          };
        default:
          return v;
      }
    },
    set(t, key, value) {
      (t as unknown as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
  return { ctx: { ...m, ctx: wrapped }, ext, calls: () => m.calls.length };
}

const PARAMS = (skin = 'lime', over: Partial<DrawParams> = {}): DrawParams => ({ outline: 1.6, shadow: false, pixelsPerUnit: 1, skin, ...over });

function drawExtents(r: CharacterRenderer, p: DrawParams): { ext: Extents; calls: number; nonFinite: number; depth: number } {
  const rec = recorder();
  r.draw(rec.ctx.ctx, p);
  return { ext: rec.ext, calls: rec.ctx.calls.length, nonFinite: rec.ctx.nonFinite.length, depth: rec.ctx.depth() };
}

describe('slime clip coverage', () => {
  it('every clip of the vocabulary resolves to a native clip of the module, natively drawn', () => {
    for (const c of ANIM_CLIPS) {
      const n = resolveSlimeClip(c);
      expect(SLIME_MODULE.clips.includes(n), `${c} -> ${n}`).toBe(true);
      expect(isNativeClip(n), `${n} has a sampler`).toBe(true);
    }
    for (const c of SLIME_MODULE.clips) expect(isNativeClip(c), c).toBe(true);
  });

  it('each native clip is a real animation, not a stand pose (its geometry changes over time or differs from the stand)', () => {
    const base = createSlimeRenderer(seededRandom(1));
    run(base, 'stand', 100);
    const stand = measureOf(base).bounds;
    for (const c of SLIME_MODULE.clips) {
      if (c === 'stand') continue;
      const r = createSlimeRenderer(seededRandom(1));
      let moved = false;
      let first: Extents | null = null;
      let t = 0;
      for (let i = 0; i < 160 && !moved; i++) {
        r.advance(input(c, { speed: speedFor(c), vy: c === 'fall' ? 700 : c === 'jump' ? -700 : 0 }), t, i === 0 ? 0 : DT, 0, 0);
        t += DT;
        const b = measureOf(r).bounds;
        first ??= b;
        if (Math.abs(b.y1 - first.y1) > 0.5 || Math.abs(b.y0 - first.y0) > 0.5 || Math.abs(b.x1 - first.x1) > 0.5 || Math.abs(b.x0 - first.x0) > 0.5) moved = true;
      }
      const differs = Math.abs(first!.y0 - stand.y0) > 1 || Math.abs(first!.x1 - stand.x1) > 1 || Math.abs(first!.y1 - stand.y1) > 1;
      expect(moved || differs, c).toBe(true);
    }
  });
});

describe('slime geometry over every clip, palette and style', () => {
  for (const skin of [...SLIME_MODULE.skins, 'unknown-palette']) {
    it(`finite, balanced and inside the bounds: ${skin}`, () => {
      for (const clip of ANIM_CLIPS) {
        const r = createSlimeRenderer(seededRandom(3));
        let t = 0;
        for (let i = 0; i < 150; i++) {
          r.advance(input(clip, { speed: speedFor(clip), vy: clip === 'fall' ? 800 : 0, hasLook: true, lookX: 80, lookY: -40, impact: 0.6 }), t, i === 0 ? 0 : DT, i % 7 === 0 ? 2 : 0.5, 0);
          t += DT;
          if (i % 10 !== 0) continue;
          const { bounds, hits } = measureOf(r);
          expect(Number.isFinite(bounds.x0 + bounds.x1 + bounds.y0 + bounds.y1), `${clip} bounds`).toBe(true);
          const d = drawExtents(r, PARAMS(skin, { shadow: false }));
          expect(d.nonFinite, `${clip} nonFinite`).toBe(0);
          expect(d.depth, `${clip} save/restore`).toBe(0);
          if (d.ext.x0 <= d.ext.x1) {
            const tol = 0.75;
            expect(d.ext.x0, `${clip} x0`).toBeGreaterThanOrEqual(bounds.x0 - tol);
            expect(d.ext.y0, `${clip} y0`).toBeGreaterThanOrEqual(bounds.y0 - tol);
            expect(d.ext.x1, `${clip} x1`).toBeLessThanOrEqual(bounds.x1 + tol);
            expect(d.ext.y1, `${clip} y1`).toBeLessThanOrEqual(bounds.y1 + tol);
          }
          let used = 0;
          for (const h of hits) {
            if (!h) continue;
            used++;
            expect(h.x1).toBeGreaterThan(h.x0);
            expect(h.y1).toBeGreaterThan(h.y0);
            expect(h.x0).toBeGreaterThanOrEqual(bounds.x0 - 1e-6);
            expect(h.x1).toBeLessThanOrEqual(bounds.x1 + 1e-6);
            expect(h.y0).toBeGreaterThanOrEqual(bounds.y0 - 1e-6);
            expect(h.y1).toBeLessThanOrEqual(bounds.y1 + 1e-6);
          }
          expect(used, `${clip} hit rects`).toBeGreaterThanOrEqual(1);
          expect(used).toBeLessThanOrEqual(MAX_HIT_RECTS);
        }
      }
    });
  }

  it('the drawn shadow stays inside the reported ground extent', () => {
    for (const clip of ['stand', 'bounce', 'sleep', 'land'] as AnimClip[]) {
      const r = createSlimeRenderer(seededRandom(2));
      run(r, clip, 400);
      const { bounds } = measureOf(r);
      const rec = createMockCtx();
      r.drawShadow(rec.ctx);
      expect(rec.nonFinite).toEqual([]);
      const ell = rec.calls.find((c) => c.name === 'ellipse');
      expect(ell).toBeDefined();
      const [ex, , erx] = ell!.args as number[];
      expect(ex! - erx!).toBeGreaterThanOrEqual(bounds.x0 - 1);
      expect(ex! + erx!).toBeLessThanOrEqual(bounds.x1 + 1);
    }
  });

  it('works through the real scene in both facings (bounds in view terms contain the drawn pixels)', () => {
    for (const facing of [1, -1] as const) {
      const scene = new CatScene(seededRandom(5));
      for (const clip of ['stand', 'bounce', 'sleep', 'stretch', 'held', 'startle', 'beam'] as AnimClip[]) {
        for (let t = 0; t <= 700; t += DT) {
          const s: CatRenderState = {
            seq: Math.round(t), t, x: 400, y: 300, snap: false, scale: 1.2, facing, state: clip === 'sleep' ? 'sleeping' : 'idle', clip, clipStartedAt: 0, speed: speedFor(clip), vy: 0,
            look: { x: 460, y: 260 }, arousal: 0.3, contentment: 0.5, emote: null, emoteStartedAt: 0, opacity: 1, visible: true, skin: 'berry', style: 'smooth', shadow: true, animSpeed: 1, character: 'slime',
          };
          scene.update({ x: s.x, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : DT, snapped: t === 0 && clip === 'stand' && facing === 1 });
        }
        expect(scene.renderer.id).toBe('slime');
        expect(scene.hitCount).toBeGreaterThanOrEqual(1);
        const m = createMockCtx();
        scene.draw(m.ctx, 1, null);
        expect(m.nonFinite).toEqual([]);
        expect(m.depth()).toBe(0);
        expect(Number.isFinite(scene.bounds.x + scene.bounds.width + scene.bounds.y + scene.bounds.height)).toBe(true);
      }
    }
  });
});

describe('slime hit regions', () => {
  it('cover the visible body and never reach far beyond it', () => {
    for (const clip of ['stand', 'sit', 'loaf', 'sleep', 'bounce', 'hop', 'jump', 'fall', 'land', 'stretch', 'held', 'startle', 'squish', 'petted', 'hide', 'dance', 'scan'] as AnimClip[]) {
      const r = createSlimeRenderer(seededRandom(4));
      let t = 0;
      for (let i = 0; i < 100; i++) {
        r.advance(input(clip, { speed: speedFor(clip), vy: clip === 'fall' ? 700 : clip === 'jump' ? -700 : 0 }), t, i === 0 ? 0 : DT, 0, 0);
        t += DT;
      }
      const { hits } = measureOf(r);
      const drawn = drawExtents(r, PARAMS()).ext;
      const u: Extents = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const h of hits) {
        if (!h) continue;
        u.x0 = Math.min(u.x0, h.x0);
        u.y0 = Math.min(u.y0, h.y0);
        u.x1 = Math.max(u.x1, h.x1);
        u.y1 = Math.max(u.y1, h.y1);
      }
      // Covers the drawn width and height (the outline's stroke is not clickable but its inner edge is).
      expect(u.x0, `${clip} left`).toBeLessThanOrEqual(drawn.x0 + 3.2);
      expect(u.x1, `${clip} right`).toBeGreaterThanOrEqual(drawn.x1 - 3.2);
      expect(u.y0, `${clip} top`).toBeLessThanOrEqual(drawn.y0 + 3.2);
      expect(u.y1, `${clip} bottom`).toBeGreaterThanOrEqual(drawn.y1 - 3.2);
      // Never blocks the desktop beyond the body plus small padding.
      expect(u.x0, `${clip} left pad`).toBeGreaterThanOrEqual(drawn.x0 - 3);
      expect(u.x1, `${clip} right pad`).toBeLessThanOrEqual(drawn.x1 + 3);
      expect(u.y0, `${clip} top pad`).toBeGreaterThanOrEqual(drawn.y0 - 3);
      expect(u.y1, `${clip} bottom pad`).toBeLessThanOrEqual(drawn.y1 + 3);
      // The centre of the face and the tracked points are clickable.
      const inside = (x: number, y: number): boolean => hits.some((h) => h !== null && x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
      const pts = new Float64Array(6);
      r.trackedPoints(pts);
      for (let i = 0; i < 3; i++) expect(inside(pts[i * 2]!, pts[i * 2 + 1]!), `${clip} tracked ${i}`).toBe(true);
    }
  });

  it('the hit rects of a stand fill most of the body box (tight bands, not one oversized box)', () => {
    const r = createSlimeRenderer(seededRandom(4));
    run(r, 'stand', 300);
    const { hits, bounds } = measureOf(r);
    let area = 0;
    for (const h of hits) if (h) area += Math.min(h.x1 - h.x0, 1e4) * (h.y1 - h.y0);
    const box = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
    expect(area).toBeGreaterThan(0.3 * box);
  });
});

describe('slime behaviour of the rig', () => {
  it('keeps volume while squashing: a squash is wider and lower, a stretch narrower and taller', () => {
    const w = (clip: AnimClip, ms: number): { w: number; h: number } => {
      const r = createSlimeRenderer(seededRandom(1));
      run(r, clip, ms);
      const { hits } = measureOf(r);
      const body = hits[0]!;
      const u = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      for (const h of hits) if (h) {
        u.x0 = Math.min(u.x0, h.x0);
        u.x1 = Math.max(u.x1, h.x1);
        u.y0 = Math.min(u.y0, h.y0);
        u.y1 = Math.max(u.y1, h.y1);
      }
      void body;
      return { w: u.x1 - u.x0, h: u.y1 - u.y0 };
    };
    const stand = w('stand', 400);
    const tall = w('stretch', 760);
    const flat = w('loaf', 1200);
    expect(tall.h).toBeGreaterThan(stand.h * 1.25);
    expect(tall.w).toBeLessThan(stand.w);
    expect(flat.h).toBeLessThan(stand.h * 0.8);
    expect(flat.w).toBeGreaterThan(stand.w * 0.95);
  });

  it('the bounce cycle leaves the ground, squashes on contact and runs faster with speed', () => {
    const r = createSlimeRenderer(seededRandom(1));
    let t = 0;
    let minBottom = Infinity;
    let maxBottom = -Infinity;
    let maxH = 0;
    let minH = Infinity;
    for (let i = 0; i < 120; i++) {
      r.advance(input('bounce', { speed: 1.2 }), t, i === 0 ? 0 : DT, 0, 0);
      t += DT;
      const rec = drawExtents(r, PARAMS());
      minBottom = Math.min(minBottom, rec.ext.y1);
      maxBottom = Math.max(maxBottom, rec.ext.y1);
      maxH = Math.max(maxH, rec.ext.y1 - rec.ext.y0);
      minH = Math.min(minH, rec.ext.y1 - rec.ext.y0);
    }
    expect(minBottom).toBeLessThan(-8);
    expect(maxBottom).toBeGreaterThan(-1);
    expect(maxH).toBeGreaterThan(minH * 1.4);
    const cycles = (speed: number): number => {
      const q = createSlimeRenderer(seededRandom(1));
      let tt = 0;
      let ups = 0;
      let above = false;
      for (let i = 0; i < 240; i++) {
        q.advance(input('bounce', { speed }), tt, i === 0 ? 0 : DT, 0, 0);
        tt += DT;
        const up = drawExtents(q, PARAMS()).ext.y1 < -6;
        if (up && !above) ups++;
        above = up;
      }
      return ups;
    };
    expect(cycles(2.4)).toBeGreaterThan(cycles(0.2));
  });

  it('sleeping is nearly still and settles (not blending)', () => {
    const r = createSlimeRenderer(seededRandom(1));
    const t = run(r, 'sleep', 2000, { sleepDepth: 1 });
    expect(r.blending).toBe(false);
    const pts = new Float64Array(6);
    r.trackedPoints(pts);
    const a = Array.from(pts);
    r.advance(input('sleep', { sleepDepth: 1 }), t + DT, DT, 0, 0);
    r.trackedPoints(pts);
    const speed = Math.hypot(pts[0]! - a[0]!, pts[1]! - a[1]!) / (DT / 1000);
    expect(speed).toBeLessThan(3);
    const b = createSlimeRenderer(seededRandom(1));
    run(b, 'bounce', 1500);
    const p2 = new Float64Array(6);
    b.trackedPoints(p2);
    const a2 = Array.from(p2);
    b.advance(input('bounce', { speed: 1.2 }), 1520, DT, 0, 0);
    b.trackedPoints(p2);
    expect(Math.hypot(p2[0]! - a2[0]!, p2[1]! - a2[1]!) / (DT / 1000)).toBeGreaterThan(speed);
  });

  it('the held clip hangs from the grip point so the cursor stays on the body', () => {
    const r = createSlimeRenderer(seededRandom(1));
    run(r, 'held', 1200);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    // HELD_SCRUFF_DIP = (-8, -58): the top of the body is at the grip point (the body swings a little around it).
    expect(Math.abs(a.y + 58)).toBeLessThan(6);
    expect(Math.abs(a.x + 8)).toBeLessThan(7);
    const { hits } = measureOf(r);
    const inside = hits.some((h) => h !== null && -8 >= h.x0 && -8 <= h.x1 && -56 >= h.y0 && -56 <= h.y1);
    expect(inside).toBe(true);
  });

  it('the emote anchor sits at the top of the body and tracked points are finite', () => {
    for (const clip of ANIM_CLIPS) {
      const r = createSlimeRenderer(seededRandom(1));
      run(r, clip, 300, { vy: 300 });
      const a = { x: 0, y: 0, lift: 0, side: 0 };
      r.emoteAnchor(a);
      const { bounds } = measureOf(r);
      expect(Number.isFinite(a.x + a.y + a.lift + a.side)).toBe(true);
      expect(a.y).toBeLessThanOrEqual(bounds.y1);
      const pts = new Float64Array(6);
      r.trackedPoints(pts);
      expect(Array.from(pts).every(Number.isFinite)).toBe(true);
    }
  });

  it('a reaction layer reports reacting once and lets go', () => {
    const r = createSlimeRenderer(seededRandom(1));
    const t = run(r, 'stand', 200);
    r.advance(input('stand', { reaction: { kind: 'earFlick', at: t } }), t, DT, 0, 0);
    expect(r.reacting).toBe(true);
    run(r, 'stand', 900, {}, t);
    expect(r.reacting).toBe(false);
  });

  it('a clip change reports blending for a while', () => {
    const r = createSlimeRenderer(seededRandom(1));
    run(r, 'stand', 500);
    r.advance(input('petted', { clipStartedAt: 600 }), 600, DT, 0, 0);
    expect(r.blending).toBe(true);
    run(r, 'petted', 1200, { clipStartedAt: 600 }, 616);
    expect(r.blending).toBe(false);
  });
});

describe('slime reduced motion, pixel mode and accessory', () => {
  const range = (clip: AnimClip, reduced: boolean): number => {
    const r = createSlimeRenderer(seededRandom(8));
    let t = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let wlo = Infinity;
    let whi = -Infinity;
    for (let i = 0; i < 260; i++) {
      r.advance(input(clip, { speed: speedFor(clip), reducedMotion: reduced }), t, i === 0 ? 0 : DT, 0, 0);
      t += DT;
      if (i < 60) continue;
      const b = measureOf(r).bounds;
      lo = Math.min(lo, b.y0);
      hi = Math.max(hi, b.y1);
      wlo = Math.min(wlo, b.x1 - b.x0);
      whi = Math.max(whi, b.x1 - b.x0);
    }
    return hi - lo + (whi - wlo);
  };

  it('reduced motion makes every loop smaller in amplitude', () => {
    for (const clip of ['bounce', 'hop', 'dance', 'scan', 'petted', 'stand'] as AnimClip[]) {
      expect(range(clip, true), clip).toBeLessThan(range(clip, false));
    }
  });

  it('reduced motion turns vanish into a plain fade without the melt', () => {
    const calm = createSlimeRenderer(seededRandom(1));
    const full = createSlimeRenderer(seededRandom(1));
    const a = input('vanish', { reducedMotion: true });
    const b = input('vanish');
    let t = 0;
    for (let i = 0; i < 30; i++) {
      calm.advance(a, t, i === 0 ? 0 : DT, 0, 0);
      full.advance(b, t, i === 0 ? 0 : DT, 0, 0);
      t += DT;
    }
    const hc = measureOf(calm).bounds;
    const hf = measureOf(full).bounds;
    expect(hc.y0).toBeLessThan(hf.y0);
  });

  it('pixel mode draws every clip without throwing and with fewer details', () => {
    for (const clip of ANIM_CLIPS) {
      const r = createSlimeRenderer(seededRandom(2));
      run(r, clip, 300, { vy: 400 });
      const fine = drawExtents(r, PARAMS('lime', { pixelsPerUnit: 1.5 }));
      const px = drawExtents(r, PARAMS('lime', { pixelsPerUnit: 0.4 }));
      expect(px.nonFinite).toBe(0);
      expect(px.depth).toBe(0);
      expect(px.calls).toBeLessThanOrEqual(fine.calls);
    }
  });

  it('the heart pendant draws extra, inside the body, in every pose', () => {
    for (const clip of ['stand', 'sit', 'loaf', 'sleep', 'bounce', 'jump', 'fall', 'land', 'held', 'petted', 'stretch', 'hide', 'squish'] as AnimClip[]) {
      const r = createSlimeRenderer(seededRandom(6));
      run(r, clip, 500, { vy: clip === 'jump' ? -500 : clip === 'fall' ? 500 : 0 });
      const plain = createMockCtx();
      r.draw(plain.ctx, PARAMS());
      const rec = recorder();
      r.draw(rec.ctx.ctx, PARAMS('lime', { accessory: 'heartPendant' }));
      expect(rec.ctx.nonFinite, clip).toEqual([]);
      expect(rec.ctx.depth()).toBe(0);
      expect(rec.ctx.calls.length, clip).toBeGreaterThan(plain.calls.length + 10);
      // The pendant's own calls are the tail of the recording; they all lie on the body.
      const tail = rec.ctx.calls.slice(plain.calls.length);
      const { hits, bounds } = measureOf(r);
      let n = 0;
      for (const c of tail) {
        if (c.name !== 'moveTo' && c.name !== 'lineTo' && c.name !== 'bezierCurveTo') continue;
        const a = c.args as number[];
        const x = a[a.length - 2]!;
        const y = a[a.length - 1]!;
        n++;
        expect(x, clip).toBeGreaterThanOrEqual(bounds.x0);
        expect(x, clip).toBeLessThanOrEqual(bounds.x1);
        expect(y, clip).toBeGreaterThanOrEqual(bounds.y0);
        expect(y, clip).toBeLessThanOrEqual(bounds.y1);
        expect(hits.some((h) => h !== null && x >= h.x0 - 2 && x <= h.x1 + 2 && y >= h.y0 - 2 && y <= h.y1 + 2), `${clip} pendant on body (${x.toFixed(1)}, ${y.toFixed(1)})`).toBe(true);
      }
      expect(n).toBeGreaterThan(5);
    }
  });
});

describe('slime robustness', () => {
  it('resetMotion drops the spring energy of a hard stop', () => {
    const r = createSlimeRenderer(seededRandom(1));
    let t = 0;
    for (let i = 0; i < 40; i++) {
      r.advance(input('bounce', { speed: 2 }), t, i === 0 ? 0 : DT, i === 20 ? 40 : 4, 0);
      t += DT;
    }
    const priv = r as unknown as { sv: number; lv: number };
    priv.lv = 2;
    r.resetMotion();
    expect(priv.sv).toBe(0);
    expect(priv.lv).toBe(0);
  });

  it('is deterministic for a seeded random', () => {
    const log = (): string => {
      const r = createSlimeRenderer(seededRandom(11));
      run(r, 'stand', 4000);
      const m = createMockCtx();
      r.draw(m.ctx, PARAMS('ocean', { shadow: true }));
      return JSON.stringify(m.calls);
    };
    expect(log()).toBe(log());
  });

  it('never throws or draws non-finite numbers on NaN and Infinity inputs', () => {
    const bad = [Number.NaN, Infinity, -Infinity, 1e12, -1e12];
    for (const clip of ANIM_CLIPS) {
      const r = createSlimeRenderer(seededRandom(1));
      run(r, clip, 100);
      for (const v of bad) {
        r.advance(
          input(clip, { clipStartedAt: v, speed: v, vy: v, lookX: v, lookY: v, hasLook: true, arousal: v, contentment: v, animSpeed: v, impact: v, sleepDepth: v, reaction: { kind: 'headTilt', at: v } }),
          v,
          v,
          v,
          v,
        );
        const m = createMockCtx();
        r.draw(m.ctx, PARAMS('lime', { outline: v, pixelsPerUnit: v, shadow: true }));
        expect(m.nonFinite, `${clip} ${v}`).toEqual([]);
        const { bounds } = measureOf(r);
        expect(Number.isFinite(bounds.x0 + bounds.x1 + bounds.y0 + bounds.y1), `${clip} ${v} bounds`).toBe(true);
        r.advance(input(clip), 0, DT, 0, 0);
      }
    }
  });

  it('every palette has outline, fill and highlight colours that differ', () => {
    for (const skin of SLIME_MODULE.skins) {
      const p = getSlimePalette(skin);
      expect(p.outline).not.toBe(p.body);
      expect(p.light).not.toBe(p.body);
      expect(p.core).not.toBe(p.body);
    }
    expect(getSlimePalette('does-not-exist')).toBe(getSlimePalette(SLIME_MODULE.skins[0]!));
  });
});
