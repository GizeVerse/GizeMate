// The ghost renderer: every clip, facing and palette draws finite, balanced and inside its reported
// bounds; hit rects cover the body without ballooning; reduced motion, pixel mode, the heart pendant,
// resetMotion, determinism and hostile input all behave.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip, type CatRenderState, type RenderStyle } from '../../../../src/shared/cat';
import { GHOST_MODULE } from '../../../../src/shared/characters/ghost';
import type { AnimInput } from '../../../../src/renderer/overlay/cat/animator';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import { HELD_SCRUFF } from '../../../../src/renderer/overlay/cat/clips';
import { GHOST_PALETTES } from '../../../../src/renderer/overlay/characters/ghost/palette';
import { resolveGhostClip } from '../../../../src/renderer/overlay/characters/ghost/clips';
import { createGhostRenderer, GhostRenderer } from '../../../../src/renderer/overlay/characters/ghost';
import { MAX_HIT_RECTS, type GeometryCollector } from '../../../../src/renderer/overlay/character/types';
import { CatScene, type DeviceRect, type Layer } from '../../../../src/renderer/overlay/scene';
import { boxInside, createExtentCtx, paintDistance, type Box } from '../extentCtx';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;
const DRAW = { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: 'pale' } as const;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: clip === 'sleep', speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1, ...extra };
}

function state(clip: AnimClip, t: number, extra: Partial<CatRenderState> = {}): CatRenderState {
  return {
    seq: Math.round(t),
    t,
    x: 400,
    y: 300,
    snap: false,
    scale: 1,
    facing: 1,
    state: clip === 'sleep' ? 'sleeping' : 'idle',
    clip,
    clipStartedAt: 0,
    speed: clip === 'walk' || clip === 'float' ? 0.8 : clip === 'run' ? 2.5 : 0,
    vy: clip === 'jump' ? -200 : clip === 'fall' ? 200 : 0,
    look: { x: 450, y: 250 },
    arousal: 0.4,
    contentment: 0.5,
    emote: null,
    emoteStartedAt: 0,
    opacity: 1,
    visible: true,
    skin: 'pale',
    style: 'smooth',
    shadow: true,
    animSpeed: 1,
    character: 'ghost',
    ...extra,
  };
}

interface B4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Hit rects and overall extent as the renderer reports them (local space). */
function collect(r: GhostRenderer): { boxes: B4[]; all: B4 } {
  const boxes: B4[] = [];
  for (let i = 0; i < MAX_HIT_RECTS; i++) boxes.push({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const all: B4 = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const g: GeometryCollector = {
    add(x, y, rad, hit) {
      all.x0 = Math.min(all.x0, x - rad);
      all.y0 = Math.min(all.y0, y - rad);
      all.x1 = Math.max(all.x1, x + rad);
      all.y1 = Math.max(all.y1, y + rad);
      if (hit >= 0 && hit < MAX_HIT_RECTS) {
        const b = boxes[hit]!;
        b.x0 = Math.min(b.x0, x - rad);
        b.y0 = Math.min(b.y0, y - rad);
        b.x1 = Math.max(b.x1, x + rad);
        b.y1 = Math.max(b.y1, y + rad);
      }
    },
    addGround() {},
  };
  r.measure(g);
  return { boxes: boxes.filter((b) => Number.isFinite(b.x0)), all };
}

function run(r: GhostRenderer, clip: AnimClip, ms: number, extra: Partial<AnimInput> = {}, motion = 0): void {
  for (let t = 0; t <= ms; t += DT) r.advance(input(clip, extra), t, t === 0 ? 0 : DT, motion, 0);
}

const NATIVE: readonly AnimClip[] = GHOST_MODULE.clips;

describe('ghost renderer: every clip of the vocabulary', () => {
  it('draws finite, balanced and inside the dirty rect over time, in both facings and every palette (smooth and pixel)', () => {
    const failures: string[] = [];
    const skins = [...Object.keys(GHOST_PALETTES), 'no-such-palette'];
    for (const style of ['smooth', 'pixel'] as RenderStyle[]) {
      for (const clip of ANIM_CLIPS) {
        for (const facing of [1, -1] as const) {
          const skin = skins[(ANIM_CLIPS.indexOf(clip) + (facing === 1 ? 0 : 2)) % skins.length]!;
          const scene = new CatScene(seededRandom(3));
          const main = createExtentCtx();
          const lay = createExtentCtx();
          const layer: Layer = { canvas: {} as CanvasImageSource, ctx: lay.ctx };
          const rect: DeviceRect = { x: 0, y: 0, w: 0, h: 0 };
          const mock = createMockCtx();
          for (let t = 0; t <= 1900; t += 100) {
            const s = state(clip, t, { facing, skin, style, accessory: t % 200 === 0 ? 'heartPendant' : undefined });
            scene.update({ x: s.x + t * 0.05, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : 100, snapped: t === 0 });
            const tag = `${style}/${clip}/f${facing}/${skin}@${t}`;
            if (scene.hitCount < 1 || scene.hitCount > MAX_HIT_RECTS) failures.push(`${tag}: hitCount ${scene.hitCount}`);
            const b = scene.bounds;
            if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) failures.push(`${tag}: bounds`);
            for (let i = 0; i < scene.hitCount; i++) {
              const h = scene.hitRects[i]!;
              if (!(h.width > 0 && h.height > 0)) failures.push(`${tag}: empty hit ${i}`);
              if (h.x < b.x - 0.01 || h.y < b.y - 0.01 || h.x + h.width > b.x + b.width + 0.01 || h.y + h.height > b.y + b.height + 0.01) failures.push(`${tag}: hit ${i} outside bounds`);
              if (h.width > 140 || h.height > 140) failures.push(`${tag}: hit ${i} oversized ${h.width}x${h.height}`);
            }
            main.reset();
            lay.reset();
            scene.deviceRect(1, rect);
            scene.draw(main.ctx, 1, () => layer);
            const px = (bx: Box): Box => ({ x0: Math.floor(bx.x0), y0: Math.floor(bx.y0), x1: Math.ceil(bx.x1), y1: Math.ceil(bx.y1) });
            if (!boxInside(px(main.box), rect)) failures.push(`${tag}: painted ${JSON.stringify(px(main.box))} outside ${JSON.stringify(rect)}`);
            if (style === 'smooth' && t % 300 === 0) scene.draw(mock.ctx, 1, null);
          }
          if (mock.nonFinite.length > 0) failures.push(`${style}/${clip}/f${facing}: non-finite draw args`);
          if (mock.depth() !== 0) failures.push(`${style}/${clip}/f${facing}: unbalanced save/restore`);
        }
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  });

  it('every canonical clip resolves to a clip the ghost draws natively', () => {
    for (const c of ANIM_CLIPS) expect(NATIVE.includes(resolveGhostClip(c)), c).toBe(true);
  });

  it('native clips look different from one another (authored motion, not stand poses)', () => {
    const sig = (clip: AnimClip): string => {
      const r = new GhostRenderer(seededRandom(4));
      run(r, clip, 700, { speed: clip === 'float' ? 1 : 0, vy: clip === 'jump' ? -200 : 0 });
      const m = createMockCtx();
      r.draw(m.ctx, DRAW);
      return JSON.stringify(m.calls.map((c) => c.args.map((a) => (typeof a === 'number' ? Math.round(a * 10) : a))));
    };
    const seen = new Map<string, AnimClip>();
    for (const clip of NATIVE) {
      const s = sig(clip);
      expect(seen.has(s), `${clip} draws exactly like ${String(seen.get(s))}`).toBe(false);
      seen.set(s, clip);
    }
  });
});

describe('ghost renderer: geometry', () => {
  it('hit rects cover everything painted that is body, and reach no further than a little beyond it', () => {
    const covered: AnimClip[] = ['stand', 'sit', 'loaf', 'float', 'crouch', 'jump', 'fall', 'petted', 'held', 'hide', 'peek', 'dance', 'scan', 'confused', 'annoyed', 'yawn', 'squish'];
    for (const clip of covered) {
      const r = new GhostRenderer(seededRandom(8));
      run(r, clip, 900, { speed: clip === 'float' ? 1 : 0 });
      const { boxes, all } = collect(r);
      const x = createExtentCtx(4096, 4096, { record: true });
      r.draw(x.ctx, DRAW);
      const b = x.box;
      const hx0 = Math.min(...boxes.map((q) => q.x0));
      const hx1 = Math.max(...boxes.map((q) => q.x1));
      const hy0 = Math.min(...boxes.map((q) => q.y0));
      const hy1 = Math.max(...boxes.map((q) => q.y1));
      expect(hx0, clip).toBeGreaterThanOrEqual(b.x0 - 2.5);
      expect(hx1, clip).toBeLessThanOrEqual(b.x1 + 2.5);
      expect(hy0, clip).toBeGreaterThanOrEqual(b.y0 - 2.5);
      expect(hy1, clip).toBeLessThanOrEqual(b.y1 + 2.5);
      let missed = 0;
      for (let gx = Math.floor(b.x0); gx <= b.x1; gx += 1.5) {
        for (let gy = Math.floor(b.y0); gy <= b.y1; gy += 1.5) {
          if (paintDistance(x.shapes, gx, gy) > 0) continue;
          const d = Math.min(...boxes.map((q) => Math.hypot(Math.max(q.x0 - gx, 0, gx - q.x1), Math.max(q.y0 - gy, 0, gy - q.y1))));
          if (d > 2.4) missed++;
        }
      }
      expect(missed, `${clip}: painted body outside every hit rect`).toBe(0);
      expect(all.x1).toBeGreaterThan(all.x0);
    }
  });

  it('reports at most 8 hit roles, three tracked points and an emote anchor above the sheet', () => {
    const r = new GhostRenderer(seededRandom(2));
    run(r, 'stand', 500);
    const { boxes } = collect(r);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(boxes.length).toBeLessThanOrEqual(MAX_HIT_RECTS);
    const pts = new Float64Array(6);
    r.trackedPoints(pts);
    expect(Array.from(pts).every(Number.isFinite)).toBe(true);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    expect(a.y).toBeLessThan(-40);
    expect(a.lift).toBeGreaterThan(0);
  });

  it('keeps the held ghost hanging from the grip point (the cursor stays on the body)', () => {
    const r = new GhostRenderer(seededRandom(2));
    run(r, 'held', 1200);
    const { boxes } = collect(r);
    const hit = boxes.some((q) => HELD_SCRUFF.x >= q.x0 - 1 && HELD_SCRUFF.x <= q.x1 + 1 && HELD_SCRUFF.y >= q.y0 - 1 && HELD_SCRUFF.y <= q.y1 + 1);
    expect(hit).toBe(true);
    const pts = new Float64Array(6);
    r.trackedPoints(pts);
    expect(Math.abs(pts[0]! - HELD_SCRUFF.x)).toBeLessThan(2);
    expect(Math.abs(pts[1]! - HELD_SCRUFF.y)).toBeLessThan(2);
  });

  it('stays within the module hit-front extents for the strike-like clips', () => {
    for (const clip of ['crouch', 'land'] as const) {
      const r = new GhostRenderer(seededRandom(3));
      for (let t = 0; t <= 600; t += DT) {
        r.advance(input(clip), t, DT, 0, 0);
        const { boxes } = collect(r);
        const front = Math.max(...boxes.map((q) => q.x1));
        expect(front).toBeLessThanOrEqual(GHOST_MODULE.body.hitFrontExtentDip[clip]!);
      }
    }
  });

  it('keeps the ground shadow small, drawn through drawShadow', () => {
    const r = new GhostRenderer(seededRandom(3));
    run(r, 'stand', 300);
    const m = createMockCtx();
    r.drawShadow(m.ctx);
    const e = m.calls.find((c) => c.name === 'ellipse');
    expect(e).toBeDefined();
    expect(e!.args[2] as number).toBeLessThan(30);
  });
});

describe('ghost renderer: modes and robustness', () => {
  const spread = (clip: AnimClip, reduced: boolean): number => {
    const r = new GhostRenderer(seededRandom(6));
    let lo = Infinity;
    let hi = -Infinity;
    let lox = Infinity;
    let hix = -Infinity;
    const pts = new Float64Array(6);
    for (let t = 0; t <= 3000; t += DT) {
      r.advance(input(clip, { reducedMotion: reduced, speed: clip === 'float' ? 1 : 0 }), t, t === 0 ? 0 : DT, 0, 0);
      if (t < 1000) continue;
      r.trackedPoints(pts);
      lo = Math.min(lo, pts[1]!);
      hi = Math.max(hi, pts[1]!);
      lox = Math.min(lox, pts[0]!);
      hix = Math.max(hix, pts[0]!);
    }
    return hi - lo + (hix - lox);
  };

  it('reduced motion calms the loops and the showy one-shots', () => {
    for (const clip of ['stand', 'float', 'dance', 'petted', 'confused'] as const) {
      expect(spread(clip, true), clip).toBeLessThan(spread(clip, false) * 0.75);
    }
  });

  it('reduced motion turns vanish and appear into a plain fade: no shrink, no spin', () => {
    for (const clip of ['vanish', 'appear'] as const) {
      const r = new GhostRenderer(seededRandom(6));
      const widths: number[] = [];
      run(r, 'stand', 1000, { reducedMotion: true });
      for (let t = 0; t <= 900; t += DT) {
        r.advance(input(clip, { reducedMotion: true, clipStartedAt: 2000 }), 2000 + t, DT, 0, 0);
        if (t < 300) continue;
        const body = collect(r).boxes[0]!;
        // Fully faded frames only report a tiny hit point; compare the visible ones.
        if (body.x1 - body.x0 > 20) widths.push(body.x1 - body.x0);
      }
      expect(widths.length, clip).toBeGreaterThan(5);
      expect(Math.max(...widths) - Math.min(...widths), clip).toBeLessThan(10);
    }
  });

  it('vanish fades to nothing and appear fades back in at full size', () => {
    const r = new GhostRenderer(seededRandom(6));
    run(r, 'vanish', 1200);
    let m = createMockCtx();
    r.draw(m.ctx, DRAW);
    expect(m.calls.filter((c) => c.name === 'fill').length).toBe(0);
    const a = new GhostRenderer(seededRandom(6));
    run(a, 'appear', 1200);
    m = createMockCtx();
    a.draw(m.ctx, DRAW);
    expect(m.calls.filter((c) => c.name === 'fill').length).toBeGreaterThan(3);
  });

  it('sleeping is nearly still compared with standing', () => {
    expect(spread('sleep', false)).toBeLessThan(spread('stand', false) * 0.6);
  });

  it('pixel mode draws a simpler picture than smooth mode, without throwing', () => {
    for (const clip of NATIVE) {
      const r = new GhostRenderer(seededRandom(7));
      run(r, clip, 500, { speed: 1 });
      const smooth = createMockCtx();
      const pixel = createMockCtx();
      r.draw(smooth.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: 'mint' });
      expect(() => r.draw(pixel.ctx, { outline: 3, shadow: false, pixelsPerUnit: 0.4, skin: 'mint' }), clip).not.toThrow();
      expect(pixel.calls.length, clip).toBeLessThan(smooth.calls.length);
      expect(pixel.nonFinite).toEqual([]);
    }
  });

  it('the heart pendant adds drawing and follows the body (stays inside the sheet extent)', () => {
    for (const clip of ['stand', 'sit', 'float', 'jump', 'sleep', 'held', 'dance', 'peek'] as const) {
      const r = new GhostRenderer(seededRandom(7));
      run(r, clip, 700, { speed: clip === 'float' ? 1 : 0, vy: clip === 'jump' ? -200 : 0 });
      const plain = createMockCtx();
      const worn = createMockCtx();
      r.draw(plain.ctx, DRAW);
      r.draw(worn.ctx, { ...DRAW, accessory: 'heartPendant' });
      expect(worn.calls.length, clip).toBeGreaterThan(plain.calls.length + 10);
      expect(worn.nonFinite).toEqual([]);
      const a = createExtentCtx();
      const b = createExtentCtx();
      r.draw(a.ctx, DRAW);
      r.draw(b.ctx, { ...DRAW, accessory: 'heartPendant' });
      expect(b.box.y1, clip).toBeLessThanOrEqual(a.box.y1 + 1.5);
      expect(b.box.x1, clip).toBeLessThanOrEqual(a.box.x1 + 0.5);
      expect(b.box.x0, clip).toBeGreaterThanOrEqual(a.box.x0 - 0.5);
    }
  });

  it('resetMotion drops the motion lean (a position snap leaves no trail)', () => {
    const fresh = (): GhostRenderer => new GhostRenderer(seededRandom(11));
    const tip = (r: GhostRenderer): number => {
      const p = new Float64Array(6);
      r.trackedPoints(p);
      return p[0]!;
    };
    const A = fresh();
    const B = fresh();
    const C = fresh();
    for (let t = 0; t < 600; t += DT) {
      A.advance(input('stand'), t, DT, 6, 0);
      B.advance(input('stand'), t, DT, 0, 0);
      C.advance(input('stand'), t, DT, 6, 0);
    }
    A.resetMotion();
    A.advance(input('stand'), 600, DT, 0, 0);
    B.advance(input('stand'), 600, DT, 0, 0);
    C.advance(input('stand'), 600, DT, 0, 0);
    expect(Math.abs(tip(A) - tip(B))).toBeLessThan(Math.abs(tip(C) - tip(B)));
  });

  it('is deterministic for a seeded random', () => {
    const play = (): string => {
      const r = createGhostRenderer(seededRandom(99)) as GhostRenderer;
      const m = createMockCtx();
      for (let t = 0; t < 4000; t += DT) r.advance(input(t < 2000 ? 'stand' : 'dance', { hasLook: true, lookX: 30, lookY: -10 }), t, DT, 0.5, 0);
      r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: 'lavender' });
      return JSON.stringify(m.calls);
    };
    expect(play()).toBe(play());
  });

  it('survives NaN and Infinity everywhere and still draws finite geometry', () => {
    const bad = Number.NaN;
    for (const clip of ANIM_CLIPS) {
      const r = new GhostRenderer(seededRandom(5));
      for (let t = 0; t < 400; t += DT) {
        const inp = input(clip, { speed: bad, vy: Infinity, lookX: bad, lookY: -Infinity, hasLook: true, arousal: bad, contentment: bad, animSpeed: bad, clipStartedAt: bad, impact: bad, sleepDepth: bad });
        expect(() => r.advance(inp, t, t === 0 ? bad : DT, bad, Infinity)).not.toThrow();
      }
      const m = createMockCtx();
      r.draw(m.ctx, { outline: bad, shadow: true, pixelsPerUnit: bad, skin: 'pale', accessory: 'heartPendant' });
      expect(m.nonFinite, clip).toEqual([]);
      const { all } = collect(r);
      expect([all.x0, all.y0, all.x1, all.y1].every(Number.isFinite), clip).toBe(true);
    }
  });

  it('reuses its pose object frame to frame (no per-frame allocation in the solve)', () => {
    const r = new GhostRenderer(seededRandom(1));
    run(r, 'stand', 100);
    const before = (r as unknown as { pose: object }).pose;
    run(r, 'stand', 100);
    expect((r as unknown as { pose: object }).pose).toBe(before);
  });
});
