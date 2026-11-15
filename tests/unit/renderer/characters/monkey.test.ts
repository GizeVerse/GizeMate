// The monkey renderer: every clip draws finite geometry inside its reported bounds, hit rects cover the body,
// reduced motion calms it, pixel mode and the pendant work, and nothing throws on garbage input.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip, type JumpKind } from '../../../../src/shared/cat';
import { MONKEY_MODULE } from '../../../../src/shared/characters/monkey';
import { HELD_SCRUFF } from '../../../../src/renderer/overlay/cat/clips';
import type { AnimInput } from '../../../../src/renderer/overlay/cat/animator';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import { MAX_HIT_RECTS, type GeometryCollector } from '../../../../src/renderer/overlay/character/types';
import { MonkeyRenderer, createMonkeyRenderer } from '../../../../src/renderer/overlay/characters/monkey';
import { createCharacterRenderer, hasOwnRenderer } from '../../../../src/renderer/overlay/characters/registry';
import { poseFinite } from '../../../../src/renderer/overlay/characters/monkey/rig';
import { createExtentCtx } from '../extentCtx';
import { createMockCtx } from '../mockCtx';

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  const walking = clip === 'walk' || clip === 'climb';
  return {
    clip,
    clipStartedAt: 0,
    sleeping: clip === 'sleep',
    speed: walking ? 0.7 : clip === 'run' ? 2.6 : 0,
    vy: clip === 'fall' ? 400 : clip === 'jump' ? -400 : 0,
    lookX: 60,
    lookY: -20,
    hasLook: true,
    arousal: 0.4,
    contentment: 0.5,
    animSpeed: 1,
    ...extra,
  };
}

function collector(): { g: GeometryCollector; b: Bounds; hits: Array<Bounds | null> } {
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const hits: Array<Bounds | null> = Array.from({ length: MAX_HIT_RECTS }, () => null);
  const g: GeometryCollector = {
    add(x, y, r, hit) {
      expect(Number.isFinite(x + y + r)).toBe(true);
      b.x0 = Math.min(b.x0, x - r);
      b.y0 = Math.min(b.y0, y - r);
      b.x1 = Math.max(b.x1, x + r);
      b.y1 = Math.max(b.y1, y + r);
      if (hit >= 0) {
        expect(hit).toBeLessThan(MAX_HIT_RECTS);
        const h = (hits[hit] ??= { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        h.x0 = Math.min(h.x0, x - r);
        h.y0 = Math.min(h.y0, y - r);
        h.x1 = Math.max(h.x1, x + r);
        h.y1 = Math.max(h.y1, y + r);
      }
    },
    addGround(cx, half, rh) {
      expect(Number.isFinite(cx + half + rh)).toBe(true);
      b.x0 = Math.min(b.x0, cx - half - rh);
      b.x1 = Math.max(b.x1, cx + half + rh);
      b.y0 = Math.min(b.y0, -0.6 - rh);
      b.y1 = Math.max(b.y1, -0.6 + rh);
    },
  };
  return { g, b, hits };
}

function play(r: MonkeyRenderer, clip: AnimClip, ms: number, extra: Partial<AnimInput> = {}, t0 = 0): void {
  const dt = 1000 / 60;
  for (let t = 0; t <= ms; t += dt) r.advance(input(clip, extra), t0 + t, t === 0 ? 0 : dt, clip === 'walk' ? 1.2 : 0, 0);
}

const inside = (p: { x: number; y: number }, h: Bounds | null): boolean => h !== null && p.x >= h.x0 && p.x <= h.x1 && p.y >= h.y0 && p.y <= h.y1;

describe('monkey renderer', () => {
  it('is registered as its own renderer', () => {
    expect(hasOwnRenderer('monkey')).toBe(true);
    expect(createCharacterRenderer('monkey', seededRandom(1)).id).toBe('monkey');
  });

  it('draws every clip over time with finite pose and bounds that contain all paint, in every palette', () => {
    for (const clip of ANIM_CLIPS) {
      const r = new MonkeyRenderer(seededRandom(3));
      for (const skin of MONKEY_MODULE.skins) {
        for (let step = 0; step < 10; step++) {
          play(r, clip, step === 0 ? 0 : 140, { jumpKind: (step % 2 ? 'leap' : 'hop') as JumpKind, impact: 0.8 }, step * 140);
          expect(poseFinite(r.pose), `${clip} pose`).toBe(true);
          const c = collector();
          r.measure(c.g);
          expect(Number.isFinite(c.b.x0 + c.b.y0 + c.b.x1 + c.b.y1), clip).toBe(true);
          const ex = createExtentCtx(4096, 4096, { record: true });
          r.draw(ex.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1.2, skin });
          const e = ex.box;
          if (Number.isFinite(e.x0)) {
            expect(e.x0, `${clip}/${skin} left`).toBeGreaterThanOrEqual(c.b.x0 - 0.01);
            expect(e.x1, `${clip}/${skin} right`).toBeLessThanOrEqual(c.b.x1 + 0.01);
            expect(e.y0, `${clip}/${skin} top`).toBeGreaterThanOrEqual(c.b.y0 - 0.01);
            expect(e.y1, `${clip}/${skin} bottom`).toBeLessThanOrEqual(c.b.y1 + 0.01);
          }
        }
      }
    }
  });

  it('reports at most 8 hit rects inside the bounds that cover head, torso, hands and feet', () => {
    for (const clip of ANIM_CLIPS) {
      const r = new MonkeyRenderer(seededRandom(4));
      play(r, clip, 700, { jumpKind: 'up' });
      const c = collector();
      r.measure(c.g);
      const used = c.hits.filter((h): h is Bounds => h !== null);
      expect(used.length, clip).toBeGreaterThanOrEqual(3);
      expect(used.length).toBeLessThanOrEqual(MAX_HIT_RECTS);
      for (const h of used) {
        expect(h.x1).toBeGreaterThan(h.x0);
        expect(h.y1).toBeGreaterThan(h.y0);
        expect(h.x0).toBeGreaterThanOrEqual(c.b.x0 - 1e-6);
        expect(h.x1).toBeLessThanOrEqual(c.b.x1 + 1e-6);
        expect(h.y0).toBeGreaterThanOrEqual(c.b.y0 - 1e-6);
        expect(h.y1).toBeLessThanOrEqual(c.b.y1 + 1e-6);
      }
      const m = r.rig.m;
      const map = (x: number, y: number) => ({ x: m[0]! * x + m[2]! * y + m[4]!, y: m[1]! * x + m[3]! * y + m[5]! });
      const rig = r.rig;
      const pts = [map(rig.headX, rig.headY), map(rig.chestX, rig.chestY), map(rig.hipX, rig.hipY), map(rig.hand[0]!, rig.hand[1]!), map(rig.foot[0]!, rig.foot[1]!), map(rig.hand[2]!, rig.hand[3]!), map(rig.foot[2]!, rig.foot[3]!)];
      for (const p of pts) expect(c.hits.some((h) => inside(p, h)), `${clip} body point (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) uncovered`).toBe(true);
    }
  });

  it('keeps every hit rect close to the body', () => {
    for (const clip of ANIM_CLIPS) {
      const r = new MonkeyRenderer(seededRandom(5));
      play(r, clip, 900);
      const c = collector();
      r.measure(c.g);
      for (const h of c.hits) if (h) expect(Math.max(h.x1 - h.x0, h.y1 - h.y0), clip).toBeLessThan(120);
    }
  });

  it('respects the module hit-front extents', () => {
    for (const [clip, ext] of Object.entries(MONKEY_MODULE.body.hitFrontExtentDip)) {
      const r = new MonkeyRenderer(seededRandom(6));
      let worst = 0;
      for (let k = 0; k < 24; k++) {
        play(r, clip as AnimClip, 120, { jumpKind: 'hop' }, k * 120);
        const c = collector();
        r.measure(c.g);
        for (const h of c.hits) if (h) worst = Math.max(worst, h.x1);
      }
      expect(worst, clip).toBeLessThanOrEqual(ext);
    }
  });

  it('hangs from the scruff: the held clip keeps the grip point on the body', () => {
    const r = new MonkeyRenderer(seededRandom(7));
    for (let t = 0; t < 900; t += 16) {
      r.advance(input('held'), t, 16, 4 * Math.sin(t / 150), 0);
      const c = collector();
      r.measure(c.g);
      const p = { x: HELD_SCRUFF.x, y: HELD_SCRUFF.y };
      expect(
        c.hits.some((h) => inside(p, h)),
        `t=${t}`,
      ).toBe(true);
    }
  });

  it('swing grips at the anchor and the body hangs below it', () => {
    const r = new MonkeyRenderer(seededRandom(8));
    play(r, 'swing', 1200);
    expect(Math.hypot(r.rig.hand[0]!, r.rig.hand[1]!)).toBeLessThan(12);
    expect(r.rig.hipY).toBeGreaterThan(30);
  });

  it('reduced motion calms the lively clips', () => {
    const range = (clip: AnimClip, reduced: boolean): number => {
      const r = new MonkeyRenderer(seededRandom(9));
      const pts = new Float64Array(6);
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < 3000; t += 16) {
        r.advance(input(clip, { reducedMotion: reduced, jumpKind: 'leap' }), t, 16, 0, 0);
        if (t > 800) {
          r.trackedPoints(pts);
          lo = Math.min(lo, pts[5]!, pts[3]!);
          hi = Math.max(hi, pts[5]!, pts[3]!);
        }
      }
      return hi - lo;
    };
    for (const clip of ['dance', 'hop', 'scratch', 'swing'] as AnimClip[]) expect(range(clip, true), clip).toBeLessThan(range(clip, false));
  });

  it('sleeping is nearly still and visibly asleep', () => {
    const r = new MonkeyRenderer(seededRandom(10));
    const pts = new Float64Array(6);
    play(r, 'sleep', 1500, { sleepDepth: 0.8 });
    r.trackedPoints(pts);
    const a = Array.from(pts);
    let worst = 0;
    for (let t = 1500; t < 5000; t += 16) {
      r.advance(input('sleep', { sleepDepth: 0.8 }), t, 16, 0, 0);
      r.trackedPoints(pts);
      for (let i = 0; i < 6; i++) worst = Math.max(worst, Math.abs(pts[i]! - a[i]!));
    }
    expect(worst).toBeLessThan(3.5);
    expect(r.pose.eyeOpen).toBeLessThan(0.05);
  });

  it('draws in pixel mode and with the pendant (which adds paint), balanced and finite', () => {
    const r = new MonkeyRenderer(seededRandom(11));
    for (const clip of ['stand', 'sit', 'sleep', 'walk', 'jump', 'held', 'climb', 'swing'] as AnimClip[]) {
      play(r, clip, 400);
      const px = createMockCtx();
      r.draw(px.ctx, { outline: 3, shadow: false, pixelsPerUnit: 0.3, skin: 'black' });
      expect(px.nonFinite).toEqual([]);
      expect(px.depth()).toBe(0);
      const plain = createMockCtx();
      const worn = createMockCtx();
      r.draw(plain.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: 'brown' });
      r.draw(worn.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: 'brown', accessory: 'heartPendant' });
      expect(worn.calls.length, clip).toBeGreaterThan(plain.calls.length);
      expect(worn.nonFinite).toEqual([]);
      expect(worn.depth()).toBe(0);
    }
  });

  it('resetMotion works and the renderer is deterministic for a seed', () => {
    const run = (): number[] => {
      const r = createMonkeyRenderer(seededRandom(12)) as MonkeyRenderer;
      play(r, 'stand', 6000);
      r.resetMotion();
      const out = new Float64Array(6);
      r.trackedPoints(out);
      return [...out, r.pose.headRot, r.pose.eyeOpen, r.pose.handNx];
    };
    expect(run()).toEqual(run());
  });

  it('survives NaN and Infinity inputs', () => {
    const r = new MonkeyRenderer(seededRandom(13));
    const bad = Number.NaN;
    for (const clip of ANIM_CLIPS) {
      r.advance({ ...input(clip), speed: bad, vy: Infinity, lookX: bad, lookY: -Infinity, arousal: bad, contentment: bad, animSpeed: bad, impact: bad, sleepDepth: bad, clipStartedAt: bad }, bad, bad, bad, Infinity);
      expect(poseFinite(r.pose), clip).toBe(true);
      const c = collector();
      r.measure(c.g);
      const m = createMockCtx();
      r.draw(m.ctx, { outline: bad, shadow: true, pixelsPerUnit: bad, skin: '???' });
      expect(m.nonFinite).toEqual([]);
    }
  });

  it('tracks three points and anchors the emote above the head', () => {
    const r = new MonkeyRenderer(seededRandom(14));
    play(r, 'walk', 300);
    const out = new Float64Array(6);
    r.trackedPoints(out);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    expect(a.y).toBeLessThan(0);
    expect(a.lift).toBeGreaterThan(20);
  });

  it('flips on a big leap and not on a hop', () => {
    const flipped = (kind: JumpKind): number => {
      const r = new MonkeyRenderer(seededRandom(15));
      let worst = 0;
      for (let t = 0; t < 500; t += 16) {
        r.advance(input('jump', { jumpKind: kind, vy: -300 }), t, 16, 0, 0);
        worst = Math.max(worst, Math.abs(r.pose.rot));
      }
      return worst;
    };
    expect(flipped('leap')).toBeGreaterThan(1.5);
    expect(flipped('hop')).toBeLessThan(0.01);
  });
});
