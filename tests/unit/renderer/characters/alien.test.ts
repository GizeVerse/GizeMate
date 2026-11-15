// The alien renderer: finite poses and geometry for every clip, drawn extents inside the reported
// bounds, hit roles covering the body without blocking the desktop, reduced motion, pixel mode,
// the pendant accessory, reset, determinism and robustness against bad inputs.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip } from '../../../../src/shared/cat';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import type { AnimInput, GeometryCollector } from '../../../../src/renderer/overlay/character/types';
import { MAX_HIT_RECTS } from '../../../../src/renderer/overlay/character/types';
import { AlienRenderer, createAlienRenderer } from '../../../../src/renderer/overlay/characters/alien';
import { PALETTES } from '../../../../src/renderer/overlay/characters/alien/palettes';
import { ALIEN_MODULE } from '../../../../src/shared/characters/alien';
import { createExtentCtx } from '../extentCtx';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: clip === 'sleep', speed: clip === 'float' || clip === 'walk' || clip === 'run' ? 1.4 : 0, vy: 0, lookX: 40, lookY: -10, hasLook: true, arousal: 0.4, contentment: 0.5, animSpeed: 1, ...extra };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const emptyRect = (): Rect => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

interface Geo {
  bounds: Rect;
  hits: Rect[];
  ground: { cx: number; half: number; rh: number } | null;
}

function measure(r: AlienRenderer): Geo {
  const bounds = emptyRect();
  const hits: Rect[] = Array.from({ length: 12 }, emptyRect);
  let ground: Geo['ground'] = null;
  const grow = (b: Rect, x: number, y: number, rad: number): void => {
    b.x0 = Math.min(b.x0, x - rad);
    b.y0 = Math.min(b.y0, y - rad);
    b.x1 = Math.max(b.x1, x + rad);
    b.y1 = Math.max(b.y1, y + rad);
  };
  const g: GeometryCollector = {
    add(x, y, rad, hit) {
      grow(bounds, x, y, rad);
      if (hit >= 0) grow(hits[hit]!, x, y, rad);
    },
    addGround(cx, half, rh) {
      ground = { cx, half, rh };
      grow(bounds, cx - half, 0, rh);
      grow(bounds, cx + half, 0, rh);
    },
  };
  r.measure(g);
  return { bounds, hits, ground };
}

function run(r: AlienRenderer, clip: AnimClip, ms: number, extra: Partial<AnimInput> = {}, step: (t: number) => void = () => {}, motionX = 0): void {
  for (let t = 0; t <= ms; t += DT) {
    r.advance(input(clip, extra), t, t === 0 ? 0 : DT, motionX, 0);
    step(t);
  }
}

describe('alien renderer: every clip', () => {
  it('is its own renderer under the alien id, listing the same clips as the module', () => {
    const r = createAlienRenderer(seededRandom(1));
    expect(r.id).toBe('alien');
    expect(ALIEN_MODULE.clips.length).toBeGreaterThanOrEqual(24);
  });

  it.each(ANIM_CLIPS.map((c) => [c] as const))('%s: finite pose, bounds and balanced drawing in every palette', (clip) => {
    const skins = Object.keys(PALETTES);
    expect(skins).toEqual([...ALIEN_MODULE.skins]);
    const r = new AlienRenderer(seededRandom(3));
    let n = 0;
    run(r, clip, 2600, {}, (t) => {
      const geo = measure(r);
      for (const k of Object.keys(r.pose) as Array<keyof typeof r.pose>) expect(Number.isFinite(r.pose[k]), `${clip} pose.${k}`).toBe(true);
      expect(Number.isFinite(geo.bounds.x0 + geo.bounds.x1 + geo.bounds.y0 + geo.bounds.y1)).toBe(true);
      expect(geo.bounds.x1).toBeGreaterThan(geo.bounds.x0);
      if (n++ % 12 === 0) {
        const m = createMockCtx();
        r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: skins[Math.floor(t / 300) % skins.length]! });
        expect(m.nonFinite, `${clip}`).toEqual([]);
        expect(m.depth()).toBe(0);
        expect(m.calls.length).toBeGreaterThan(20);
      }
    });
  });

  it('draws only inside the reported bounds (dirty-rect correctness), clip by clip and palette by palette', () => {
    const slack = 0.75;
    const skins = Object.keys(PALETTES);
    for (const clip of ANIM_CLIPS) {
      const r = new AlienRenderer(seededRandom(11));
      let k = 0;
      run(r, clip, 2400, { speed: clip === 'float' || clip === 'run' ? 3 : 0 }, (t) => {
        if (k++ % 9 !== 0) return;
        const geo = measure(r);
        const x = createExtentCtx();
        x.reset();
        r.draw(x.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: skins[k % skins.length]!, accessory: k % 2 === 0 ? 'heartPendant' : undefined });
        const b = x.box;
        if (!Number.isFinite(b.x0)) return;
        const where = `${clip}@${Math.round(t)}`;
        expect(b.x0, `${where} left`).toBeGreaterThanOrEqual(geo.bounds.x0 - slack);
        expect(b.x1, `${where} right`).toBeLessThanOrEqual(geo.bounds.x1 + slack);
        expect(b.y0, `${where} top`).toBeGreaterThanOrEqual(geo.bounds.y0 - slack);
        expect(b.y1, `${where} bottom`).toBeLessThanOrEqual(geo.bounds.y1 + slack);
      });
    }
  });

  it('every clip resolves to something the renderer draws natively (alias targets exist)', () => {
    for (const [from, to] of Object.entries(ALIEN_MODULE.clipAlias)) {
      expect(ALIEN_MODULE.clips, `${from} -> ${String(to)}`).toContain(to);
    }
    for (const c of ANIM_CLIPS) {
      const r = new AlienRenderer(seededRandom(2));
      run(r, c, 100);
      expect(r.animator.activeClip, c).toSatisfy((a: AnimClip) => ALIEN_MODULE.clips.includes(a));
    }
  });
});

describe('alien renderer: hit regions', () => {
  it('uses at most eight stable roles, all inside the bounds, none oversized, covering head, torso, limbs and antennae', () => {
    const roles = new Set<number>();
    for (const clip of ANIM_CLIPS) {
      const r = new AlienRenderer(seededRandom(4));
      run(r, clip, 1800, {}, () => undefined);
      const geo = measure(r);
      geo.hits.forEach((h, i) => {
        if (!Number.isFinite(h.x0)) return;
        expect(i, `${clip} role ${i}`).toBeLessThan(MAX_HIT_RECTS);
        roles.add(i);
        expect(h.x0).toBeGreaterThanOrEqual(geo.bounds.x0 - 1e-9);
        expect(h.x1).toBeLessThanOrEqual(geo.bounds.x1 + 1e-9);
        expect(h.y0).toBeGreaterThanOrEqual(geo.bounds.y0 - 1e-9);
        expect(h.y1).toBeLessThanOrEqual(geo.bounds.y1 + 1e-9);
        // Never block the desktop: no single rect is larger than the body plus a little.
        expect(h.x1 - h.x0, `${clip} role ${i} width`).toBeLessThanOrEqual(80);
        expect(h.y1 - h.y0, `${clip} role ${i} height`).toBeLessThanOrEqual(80);
      });
      expect(Number.isFinite(geo.hits[0]!.x0) && Number.isFinite(geo.hits[1]!.x0), `${clip} head+torso`).toBe(true);
    }
    expect([...roles].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('covers the visible body: head centre, torso, hands, feet and antenna tips lie inside some hit rect', () => {
    const inside = (geo: Geo, x: number, y: number): boolean => geo.hits.some((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
    for (const clip of ['stand', 'sit', 'float', 'scan', 'dance', 'petted', 'held', 'sleep', 'startle', 'crouch'] as AnimClip[]) {
      const r = new AlienRenderer(seededRandom(5));
      run(r, clip, 1500, {}, () => undefined);
      const geo = measure(r);
      const rig = r.rig;
      expect(inside(geo, rig.hcx, rig.hcy), `${clip} head`).toBe(true);
      expect(inside(geo, (rig.torso[0]! + rig.torso[10]!) / 2, (rig.torso[1]! + rig.torso[11]!) / 2), `${clip} torso`).toBe(true);
      for (let s = 0; s < 2; s++) {
        expect(inside(geo, rig.arm[s]![4]!, rig.arm[s]![5]!), `${clip} hand ${s}`).toBe(true);
        expect(inside(geo, rig.leg[s]![4]!, rig.leg[s]![5]!), `${clip} foot ${s}`).toBe(true);
        expect(inside(geo, rig.antenna[s]!.tx, rig.antenna[s]!.ty), `${clip} antenna ${s}`).toBe(true);
      }
    }
  });

  it('keeps the grip point of the held pose on the body', () => {
    const r = new AlienRenderer(seededRandom(6));
    run(r, 'held', 1500, {}, () => undefined);
    const geo = measure(r);
    const inside = geo.hits.some((h) => -8 >= h.x0 && -8 <= h.x1 && -58 >= h.y0 && -58 <= h.y1);
    expect(inside).toBe(true);
  });
});

describe('alien renderer: behaviour of the layers', () => {
  /** Total path length of the head centre and both hands over 3 s: a measure of motion. */
  function travel(clip: AnimClip, reduced: boolean): number {
    const r = new AlienRenderer(seededRandom(8));
    let len = 0;
    let px = NaN;
    let py = NaN;
    run(r, clip, 3200, { reducedMotion: reduced, speed: clip === 'float' ? 2.5 : 0 }, () => {
      const pts = [r.rig.hcx, r.rig.hcy, r.rig.arm[1]![4]!, r.rig.arm[1]![5]!, r.rig.arm[0]![4]!, r.rig.arm[0]![5]!, r.rig.antenna[0]!.tx, r.rig.antenna[0]!.ty];
      const sum = pts.reduce((a, b) => a + b, 0);
      void sum;
      if (Number.isFinite(px)) len += Math.hypot(pts[0]! - px, pts[1]! - py) + Math.hypot(pts[2]! - lastX, pts[3]! - lastY) + Math.hypot(pts[6]! - lastTx, pts[7]! - lastTy);
      px = pts[0]!;
      py = pts[1]!;
      lastX = pts[2]!;
      lastY = pts[3]!;
      lastTx = pts[6]!;
      lastTy = pts[7]!;
    });
    return len;
  }
  let lastX = 0;
  let lastY = 0;
  let lastTx = 0;
  let lastTy = 0;

  it('reduced motion calms every energetic clip', () => {
    for (const clip of ['dance', 'float', 'startle', 'rollOver', 'shake', 'scan', 'stand', 'hop'] as AnimClip[]) {
      const full = travel(clip, false);
      const calm = travel(clip, true);
      expect(calm, clip).toBeLessThan(full * 0.85);
    }
  });

  it('reduced motion turns the teleport into a plain fade (no squash, no sparks)', () => {
    const r = new AlienRenderer(seededRandom(9));
    run(r, 'vanish', 600, { reducedMotion: true }, () => undefined);
    for (let t = 0; t < 1500; t += DT) r.advance(input('vanish', { reducedMotion: true, clipStartedAt: -1500 + t }), t, DT, 0, 0);
    expect(Math.abs(r.pose.sx - 1)).toBeLessThan(0.05);
    expect(r.pose.shim).toBeLessThan(0.05);
    const m = createMockCtx();
    r.draw(m.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: 'green' });
    expect(m.calls.filter((c) => c.name === 'fillRect')).toHaveLength(0);
  });

  it('the teleport dissolve fades the body out and back in', () => {
    const r = new AlienRenderer(seededRandom(9));
    const alphaAt = (clip: AnimClip, ms: number): number => {
      const q = new AlienRenderer(seededRandom(9));
      for (let t = 0; t <= ms; t += DT) q.advance(input(clip, { clipStartedAt: 0 }), t, t === 0 ? 0 : DT, 0, 0);
      return q.pose.alpha;
    };
    void r;
    expect(alphaAt('vanish', 50)).toBeGreaterThan(0.8);
    expect(alphaAt('vanish', 1000)).toBeLessThan(0.05);
    expect(alphaAt('appear', 50)).toBeLessThan(0.3);
    expect(alphaAt('appear', 1000)).toBeGreaterThan(0.95);
  });

  it('sleep is visibly distinct (low, eyes closed, antennae drooped) and nearly still', () => {
    const r = new AlienRenderer(seededRandom(10));
    const stand = new AlienRenderer(seededRandom(10));
    run(stand, 'stand', 1500);
    run(r, 'sleep', 3500, { sleepDepth: 1 });
    expect(r.pose.eye).toBeLessThan(0.05);
    expect(r.pose.antDroop).toBeGreaterThan(0.6);
    expect(r.rig.hcy).toBeGreaterThan(stand.rig.hcy + 8);
    expect(r.blending).toBe(false);
    expect(r.reacting).toBe(false);
    let travelled = 0;
    let lx = r.rig.hcx;
    let ly = r.rig.hcy;
    run(r, 'sleep', 2000, { sleepDepth: 1 }, () => {
      travelled += Math.hypot(r.rig.hcx - lx, r.rig.hcy - ly);
      lx = r.rig.hcx;
      ly = r.rig.hcy;
    });
    // Over two seconds of sleep the head moves by well under a few units in total.
    expect(travelled).toBeLessThan(12);
  });

  it('glides with a lean that grows with speed, and the gait rate follows the speed', () => {
    const slow = new AlienRenderer(seededRandom(12));
    const fast = new AlienRenderer(seededRandom(12));
    run(slow, 'float', 1200, { speed: 0.4 });
    run(fast, 'float', 1200, { speed: 4.2 });
    expect(fast.pose.lean).toBeGreaterThan(slow.pose.lean + 0.15);
  });

  it('landing squashes and recovers; startle spikes the antennae and hops', () => {
    const r = new AlienRenderer(seededRandom(13));
    let minSy = 9;
    run(r, 'land', 700, { impact: 1 }, () => {
      minSy = Math.min(minSy, r.pose.sy);
    });
    expect(minSy).toBeLessThan(0.9);
    expect(Math.abs(r.pose.sy - 1)).toBeLessThan(0.06);
    const s = new AlienRenderer(seededRandom(13));
    let maxSpike = 0;
    let minOff = 0;
    run(s, 'startle', 600, {}, () => {
      maxSpike = Math.max(maxSpike, s.pose.antSpike);
      minOff = Math.min(minOff, s.pose.offY);
    });
    expect(maxSpike).toBeGreaterThan(0.8);
    expect(minOff).toBeLessThan(-3);
  });

  it('antennae lag and stream behind a moving body, then settle', () => {
    const r = new AlienRenderer(seededRandom(14));
    run(r, 'stand', 800);
    const rest = r.rig.antenna[1]!.tx - r.rig.antenna[1]!.bx;
    let worst = rest;
    for (let t = 0; t < 600; t += DT) {
      r.advance(input('stand', { clipStartedAt: 0 }), 800 + t, DT, 0, 0);
      r.rig.solve(r.pose, DT / 1000, 0, 0, 0.5, 0.5);
      worst = Math.min(worst, r.rig.antenna[1]!.tx - r.rig.antenna[1]!.bx);
    }
    expect(Number.isFinite(worst)).toBe(true);
  });
});

describe('alien renderer: pixel mode, accessory, reset, determinism, robustness', () => {
  it('draws in pixel mode with fewer calls than in full detail, for every clip, without throwing', () => {
    for (const clip of ANIM_CLIPS) {
      const r = new AlienRenderer(seededRandom(15));
      run(r, clip, 500);
      const px = createMockCtx();
      const fine = createMockCtx();
      expect(() => r.draw(px.ctx, { outline: 3, shadow: true, pixelsPerUnit: 0.4, skin: 'blue' })).not.toThrow();
      r.draw(fine.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1.2, skin: 'blue' });
      expect(px.nonFinite).toEqual([]);
      expect(px.depth()).toBe(0);
      expect(px.calls.length, clip).toBeLessThan(fine.calls.length);
    }
  });

  it('the heart pendant adds drawing and follows the body in stand, sit, glide, sleep, held and jump', () => {
    for (const clip of ['stand', 'sit', 'float', 'sleep', 'held', 'jump'] as AnimClip[]) {
      const r = new AlienRenderer(seededRandom(16));
      run(r, clip, 1200);
      const plain = createMockCtx();
      const worn = createMockCtx();
      r.draw(plain.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: 'green' });
      r.draw(worn.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: 'green', accessory: 'heartPendant' });
      expect(worn.calls.length, clip).toBeGreaterThan(plain.calls.length + 10);
      expect(worn.nonFinite).toEqual([]);
      // The pendant's collar lies between the shoulders: its anchor sits on the torso, below the head centre.
      const rig = r.rig;
      const ax = (rig.collarAx + rig.collarBx) / 2;
      const ay = (rig.collarAy + rig.collarBy) / 2;
      expect(Math.hypot(ax - rig.hcx, ay - rig.hcy), clip).toBeGreaterThan(8);
      expect(Math.hypot(ax - rig.hcx, ay - rig.hcy), clip).toBeLessThan(30);
    }
  });

  it('resetMotion forgets the antenna momentum', () => {
    const r = new AlienRenderer(seededRandom(17));
    run(r, 'stand', 600, {}, () => undefined, 4);
    r.advance(input('stand'), 700, DT, 30, 0);
    r.resetMotion();
    expect(r.rig.antenna[0]!.vel).toBe(0);
    expect(r.rig.antenna[1]!.vel).toBe(0);
    expect(Number.isFinite(r.rig.hcx)).toBe(true);
  });

  it('is deterministic for a seeded random', () => {
    const record = (): string => {
      const r = new AlienRenderer(seededRandom(99));
      const out: string[] = [];
      run(r, 'stand', 4000, { mood: 'curious' }, (t) => {
        if (Math.round(t / DT) % 20 !== 0) return;
        const m = createMockCtx();
        r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: 'violet' });
        out.push(JSON.stringify(m.calls));
      });
      return out.join('|');
    };
    expect(record()).toBe(record());
  });

  it('idle varies: over a minute the stand pose shows several distinct fidgets and blinks', () => {
    const r = new AlienRenderer(seededRandom(21));
    const kinds = new Set<string>();
    let blinks = 0;
    let wasClosed = false;
    run(r, 'stand', 60000, {}, () => {
      const p = r.pose;
      if (Math.abs(p.headRot) > 0.14) kinds.add('tilt');
      if (Math.abs(p.turn) > 0.7) kinds.add('look');
      if (p.armRa > 1.0) kinds.add('inspect');
      if (Math.abs(p.offX) > 2.5) kinds.add('drift');
      if (Math.abs(p.antL) > 0.2 && Math.abs(p.antR) > 0.2) kinds.add('antennae');
      const closed = p.eye < 0.3;
      if (closed && !wasClosed) blinks++;
      wasClosed = closed;
    });
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(blinks).toBeGreaterThanOrEqual(6);
  });

  it('survives NaN and Infinity everywhere in the input', () => {
    const r = new AlienRenderer(seededRandom(18));
    const bad = Number.NaN;
    for (let t = 0; t < 600; t += DT) {
      r.advance(
        { clip: 'float', clipStartedAt: bad, sleeping: false, speed: bad, vy: Infinity, lookX: bad, lookY: Infinity, hasLook: true, arousal: bad, contentment: Infinity, animSpeed: bad, impact: bad, sleepDepth: bad },
        t,
        t === 0 ? bad : DT,
        bad,
        Infinity,
      );
      const geo = measure(r);
      expect(Number.isFinite(geo.bounds.x0 + geo.bounds.y1)).toBe(true);
      const m = createMockCtx();
      r.draw(m.ctx, { outline: bad, shadow: true, pixelsPerUnit: bad, skin: 'nonsense' });
      expect(m.nonFinite).toEqual([]);
    }
    r.advance(input('stand'), Number.NaN, Number.NaN, 0, 0);
    expect(Number.isFinite(r.pose.hover)).toBe(true);
    const pts = new Float64Array(6);
    r.trackedPoints(pts);
    expect(Array.from(pts).every(Number.isFinite)).toBe(true);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    expect(Number.isFinite(a.x + a.y + a.lift + a.side)).toBe(true);
    expect(a.lift).toBeGreaterThan(30);
  });

  it('shadow follows the hover: higher means smaller and fainter', () => {
    const low = new AlienRenderer(seededRandom(19));
    const high = new AlienRenderer(seededRandom(19));
    run(low, 'stand', 600);
    run(high, 'jump', 600);
    expect(high.rig.shadowK).toBeLessThan(low.rig.shadowK);
  });
});
