// Regression tests for the independent review of the character renderers (each one fails without its fix):
// alien/ghost fade to a token hit region, the ghost's held grip, the alien's antenna lag at dt = 0,
// the monkey's reset after a snap, the slime's long frames and pendant collar.
import { describe, expect, it } from 'vitest';
import type { AnimClip } from '../../../../src/shared/cat';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import { MAX_HIT_RECTS, type AnimInput, type CharacterRenderer, type DrawParams, type GeometryCollector } from '../../../../src/renderer/overlay/character/types';
import { AlienRenderer } from '../../../../src/renderer/overlay/characters/alien';
import { createGhostRenderer } from '../../../../src/renderer/overlay/characters/ghost';
import { MonkeyRenderer } from '../../../../src/renderer/overlay/characters/monkey';
import { pendantCollarHeight, SlimeRenderer } from '../../../../src/renderer/overlay/characters/slime';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: clip === 'sleep', speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1, ...extra };
}

/** Summed area of the hit rects (view units squared) and how many roles are present. */
function hitArea(r: CharacterRenderer): { area: number; roles: number } {
  const rects: Array<{ x0: number; y0: number; x1: number; y1: number } | undefined> = new Array(MAX_HIT_RECTS).fill(undefined);
  const g: GeometryCollector = {
    add(x, y, rad, hit) {
      if (hit < 0) return;
      const h = (rects[hit] ??= { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      h.x0 = Math.min(h.x0, x - rad);
      h.y0 = Math.min(h.y0, y - rad);
      h.x1 = Math.max(h.x1, x + rad);
      h.y1 = Math.max(h.y1, y + rad);
    },
    addGround() {},
  };
  r.measure(g);
  let area = 0;
  let roles = 0;
  for (const h of rects) {
    if (!h) continue;
    roles++;
    area += (h.x1 - h.x0) * (h.y1 - h.y0);
  }
  return { area, roles };
}

const drawParams = (ppu: number): DrawParams => ({ outline: 1.6, shadow: false, pixelsPerUnit: ppu, skin: '' });

describe('alien: invisible while teleported away', () => {
  it('collapses its hit region to one small token rect once vanished, and is whole again when visible', () => {
    const r = new AlienRenderer(seededRandom(2));
    for (let t = 0; t <= 800; t += DT) r.advance(input('stand'), t, t === 0 ? 0 : DT, 0, 0);
    const whole = hitArea(r);
    expect(whole.roles).toBeGreaterThanOrEqual(6);
    expect(whole.area).toBeGreaterThan(1500);
    for (let t = 800; t <= 3200; t += DT) r.advance(input('vanish', { clipStartedAt: 800 }), t, DT, 0, 0);
    expect(r.pose.alpha).toBeLessThan(0.02);
    const gone = hitArea(r);
    expect(gone.roles).toBe(1);
    expect(gone.area).toBeLessThan(100);
  });

  it('restores the body once it has appeared again', () => {
    const r = new AlienRenderer(seededRandom(2));
    for (let t = 0; t <= 3200; t += DT) r.advance(input('vanish'), t, t === 0 ? 0 : DT, 0, 0);
    for (let t = 3200; t <= 6000; t += DT) r.advance(input('appear', { clipStartedAt: 3200 }), t, DT, 0, 0);
    expect(r.pose.alpha).toBeGreaterThan(0.9);
    expect(hitArea(r).roles).toBeGreaterThanOrEqual(6);
  });
});

describe('alien: a dt = 0 frame keeps the antenna lag', () => {
  it('does not snap the stalks to their rest angle', () => {
    const r = new AlienRenderer(seededRandom(4));
    let t = 0;
    for (; t <= 700; t += DT) r.advance(input('dance', { clipStartedAt: 0 }), t, t === 0 ? 0 : DT, 3, 0);
    const stalk = r.rig.antenna[1]!;
    const before = { x: stalk.tx, y: stalk.ty, ang: stalk.ang };
    r.advance(input('dance', { clipStartedAt: 0 }), t, 0, 3, 0);
    expect(Math.abs(stalk.ang - before.ang)).toBeLessThan(1e-9);
    expect(Math.hypot(stalk.tx - before.x, stalk.ty - before.y)).toBeLessThan(1e-6);
  });
});

describe('ghost: held grip and the fading hit region', () => {
  const heldTops = (extra: Partial<AnimInput>): Array<{ x: number; y: number }> => {
    const r = createGhostRenderer(seededRandom(6));
    const out = new Float64Array(6);
    const tops: Array<{ x: number; y: number }> = [];
    for (let t = 0; t <= 3000; t += DT) {
      r.advance(input('held', extra), t, t === 0 ? 0 : DT, 0, 0);
      if (t > 1500) {
        r.trackedPoints(out);
        tops.push({ x: out[0]!, y: out[1]! });
      }
    }
    return tops;
  };
  const rangeY = (a: Array<{ y: number }>): number => Math.max(...a.map((p) => p.y)) - Math.min(...a.map((p) => p.y));
  const meanY = (a: Array<{ y: number }>): number => a.reduce((s, p) => s + p.y, 0) / a.length;

  it('keeps the grip still while breathing and a sleepy mood run on top of the held clip', () => {
    const calm = heldTops({});
    const sleepy = heldTops({ mood: 'sleepy' });
    // The sleepy mood alone shifted the grip by 1.5 units, breathing by up to 0.24.
    expect(rangeY(sleepy)).toBeLessThan(0.05);
    expect(rangeY(calm)).toBeLessThan(0.05);
    expect(Math.abs(meanY(sleepy) - meanY(calm))).toBeLessThan(0.05);
  });

  it('shrinks the hit region to a token while the sprite is faded below what pixel mode keeps', () => {
    const areas = (ppu: number): number[] => {
      const r = createGhostRenderer(seededRandom(7));
      const ctx = createMockCtx();
      const out: number[] = [];
      for (let t = 0; t <= 2200; t += DT) {
        r.advance(input('vanish'), t, t === 0 ? 0 : DT, 0, 0);
        r.draw(ctx.ctx, drawParams(ppu));
        out.push(hitArea(r).area);
      }
      return out;
    };
    const smooth = areas(1);
    const pixel = areas(0.3);
    expect(pixel.length).toBe(smooth.length);
    let tighter = 0;
    for (let i = 0; i < smooth.length; i++) {
      expect(pixel[i]!).toBeLessThanOrEqual(smooth[i]! + 1e-9);
      if (pixel[i]! < smooth[i]! * 0.2) tighter++;
    }
    // The vanish tail between 8% and 39% reveal lasts several frames.
    expect(tighter).toBeGreaterThan(3);
  });
});

describe('monkey: resetMotion after a snap', () => {
  it('forgets the pendulum, the climb velocity and the look lag', () => {
    const r = new MonkeyRenderer(seededRandom(8));
    for (let t = 0; t <= 800; t += DT) r.advance(input('held', { lookX: 90, lookY: -40, hasLook: true }), t, t === 0 ? 0 : DT, 25, 6);
    const s = r as unknown as { swA: number; swV: number; climbVy: number; lx: number; ly: number };
    expect(Math.abs(s.swA) + Math.abs(s.swV)).toBeGreaterThan(0.05);
    r.resetMotion();
    expect(s.swA).toBe(0);
    expect(s.swV).toBe(0);
    expect(s.climbVy).toBe(0);
    expect(s.lx).toBe(0);
    expect(s.ly).toBe(0);
  });
});

describe('slime: long frames and the pendant collar', () => {
  it('integrates a 100 ms frame in full (previews and deep-sleep frames are that long)', () => {
    const r = new SlimeRenderer(seededRandom(9));
    const s = r as unknown as { clock: number };
    r.advance(input('stand'), 0, 0, 0, 0);
    const c0 = s.clock;
    r.advance(input('stand'), 100, 100, 0, 0);
    expect(s.clock - c0).toBeCloseTo(0.1, 6);
    r.advance(input('stand'), 400, 400, 0, 0);
    expect(s.clock - c0).toBeCloseTo(0.2, 6);
  });

  it('keeps the jelly spring finite and bounded at 100 ms frames while hopping', () => {
    const r = new SlimeRenderer(seededRandom(9));
    for (let t = 0; t <= 6000; t += 100) {
      r.advance(input(t % 1200 < 600 ? 'hop' : 'squish', { speed: 1.2, clipStartedAt: t - (t % 600) }), t, t === 0 ? 0 : 100, 40, 0);
      const a = hitArea(r);
      expect(Number.isFinite(a.area)).toBe(true);
      expect(a.area).toBeLessThan(40000);
    }
  });

  it('hangs the collar above the mouth in loaf, held, fall, sit, sleep and stand', () => {
    for (const clip of ['loaf', 'held', 'fall', 'sit', 'sleep', 'stand'] as AnimClip[]) {
      const r = new SlimeRenderer(seededRandom(10));
      for (let t = 0; t <= 1500; t += DT) r.advance(input(clip, { vy: clip === 'fall' ? 500 : 0 }), t, t === 0 ? 0 : DT, 0, 0);
      const f = r as unknown as { Hh: number; fy: number; lift: number; fit: number };
      const collar = pendantCollarHeight(f.Hh, f.fy - f.lift, f.fit);
      const mouth = f.fy - f.lift - 6.4 * f.fit;
      expect(collar, clip).toBeLessThan(mouth);
      expect(collar, clip).toBeGreaterThanOrEqual(0.15 * f.Hh - 1e-9);
    }
  });
});
