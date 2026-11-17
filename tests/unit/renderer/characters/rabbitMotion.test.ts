// Rabbit motion quality: the authored gestures are really its own (not a re-targeted neighbour), the pace
// shows in the hop, planted feet do not skate, and the burrow vanish/appear is a soft fade in every mode.
import { describe, expect, it } from 'vitest';
import type { AnimClip } from '../../../../src/shared/cat';
import { RABBIT_MODULE } from '../../../../src/shared/characters/rabbit';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import type { AnimInput } from '../../../../src/renderer/overlay/character/types';
import { RabbitRenderer } from '../../../../src/renderer/overlay/characters/rabbit';
import { sampleClip, type RClipCtx } from '../../../../src/renderer/overlay/characters/rabbit/clips';
import { createPose, POSE_KEYS, type RPose } from '../../../../src/renderer/overlay/characters/rabbit/pose';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: false, speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0.3, contentment: 0.5, animSpeed: 1, ...extra };
}

const ctx = (t: number, extra: Partial<RClipCtx> = {}): RClipCtx => ({ t, cycle: 0, speed: 0, vy: 0, impact: 0.6, arousal: 0, stride: 0, reduce: 0, ...extra });

function sample(clip: AnimClip, t: number, extra: Partial<RClipCtx> = {}): RPose {
  const p = createPose();
  sampleClip(p, clip, ctx(t, extra));
  return p;
}

/** Largest spread of one key over a clip's timeline. */
function spread(clip: AnimClip, key: (typeof POSE_KEYS)[number], extra: Partial<RClipCtx> = {}, len = 3): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t <= len; t += 0.02) {
    const v = sample(clip, t, extra)[key];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}

/** How far apart two clips' poses are, summed over keys and a handful of times. */
function distance(a: AnimClip, b: AnimClip, ts: readonly number[]): number {
  let d = 0;
  for (const t of ts) {
    const pa = sample(a, t);
    const pb = sample(b, t);
    for (const k of POSE_KEYS) d += Math.abs(pa[k] - pb[k]);
  }
  return d;
}

describe('rabbit authored gestures are its own', () => {
  // What each of these resolved to before it was authored (the alias target it used to be drawn as).
  const FORMER: readonly (readonly [AnimClip, AnimClip])[] = [
    ['pounce', 'jump'],
    ['swat', 'annoyed'],
    ['hiss', 'startle'],
    ['grumpy', 'annoyed'],
    ['balance', 'crouch'],
    ['edgeSit', 'sit'],
    ['tailChase', 'dance'],
    ['rollOver', 'loaf'],
    ['impact', 'land'],
    ['slip', 'startle'],
    ['meow', 'scan'],
    ['vanish', 'hide'],
    ['appear', 'peek'],
  ];

  it('lists each of them natively and no longer aliases them', () => {
    for (const [c] of FORMER) {
      expect(RABBIT_MODULE.clips, c).toContain(c);
      expect((RABBIT_MODULE.clipAlias as Record<string, string>)[c], c).toBeUndefined();
    }
  });

  it('draws each differently from the pose it used to borrow', () => {
    for (const [c, old] of FORMER) expect(distance(c, old, [0.1, 0.3, 0.6, 0.9]), `${c} vs ${old}`).toBeGreaterThan(8);
  });

  it('keeps the remaining aliases honest: gaits are the hop clip itself, the rest are poses that suit a rabbit', () => {
    const a = RABBIT_MODULE.clipAlias as Record<string, string>;
    for (const g of ['walk', 'run', 'sprint', 'stalk', 'slink']) expect(a[g], g).toBe('hop');
    expect(Object.keys(a).sort()).toEqual(['beam', 'climb', 'float', 'landRecover', 'run', 'slink', 'sprint', 'stalk', 'swing', 'walk']);
  });

  it('swat is two quick forepaw dabs that end back at rest', () => {
    let strikes = 0;
    let down = false;
    for (let t = 0.02; t <= 0.6; t += 0.01) {
      const lowered = sample('swat', t).fnX > 20;
      if (lowered && !down) strikes++;
      down = lowered;
    }
    expect(strikes).toBe(2);
    const end = sample('swat', 0.6);
    const rest = sample('sit', 0.6);
    expect(Math.abs(end.fnX - rest.fnX)).toBeLessThan(0.5);
  });

  it('hiss puffs the body up with the ears flat and thumps a hind foot twice', () => {
    const calm = sample('sit', 0.5);
    const mid = sample('hiss', 0.6);
    expect(mid.bodyRY).toBeGreaterThan(calm.bodyRY * 1.12);
    expect(mid.eNA).toBeGreaterThan(1.2);
    expect(mid.eFA).toBeGreaterThan(1.2);
    let lifts = 0;
    let up = false;
    for (let t = 0; t <= 1.2; t += 0.01) {
      const lifted = sample('hiss', t).hnY < -8;
      if (lifted && !up) lifts++;
      up = lifted;
    }
    expect(lifts).toBe(2);
  });

  it('grumpy sulks: ears back, narrowed eyes, turned away, with an occasional huff', () => {
    const p = sample('grumpy', 1.2);
    expect(p.eNA).toBeGreaterThan(0.9);
    expect(p.eyeOpen).toBeLessThan(0.7);
    expect(p.turn).toBeLessThan(-0.3);
    expect(spread('grumpy', 'bodyRY', {}, 4)).toBeGreaterThan(0.4);
  });

  it('balance is low and wide and rocks, with no anticipation wiggle of the crouch', () => {
    const p = sample('balance', 0.5);
    const c = sample('crouch', 0.5);
    expect(p.fnX).toBeGreaterThan(c.fnX);
    expect(p.hfX).toBeLessThan(c.hfX);
    expect(spread('balance', 'rot')).toBeGreaterThan(0.05);
    expect(spread('balance', 'hnX')).toBeLessThan(0.1);
  });

  it('edgeSit dangles the hind feet below the ground line and swings them', () => {
    const p = sample('edgeSit', 0.4);
    expect(p.hnY).toBeGreaterThan(3);
    expect(p.hfY).toBeGreaterThan(3);
    expect(spread('edgeSit', 'hnA')).toBeGreaterThan(0.2);
  });

  it('tailChase spins through a thin edge (the body mirrors) and calms to a wobble with reduced motion', () => {
    let neg = false;
    let pos = false;
    let minAbs = Infinity;
    for (let t = 0; t <= 3; t += 0.01) {
      const x = sample('tailChase', t).sqX;
      if (x < 0) neg = true;
      if (x > 0) pos = true;
      minAbs = Math.min(minAbs, Math.abs(x));
    }
    expect(neg && pos).toBe(true);
    expect(minAbs).toBeGreaterThanOrEqual(0.29);
    for (let t = 0; t <= 3; t += 0.01) expect(sample('tailChase', t, { reduce: 1 }).sqX).toBeGreaterThan(0.6);
  });

  it('rollOver flops onto its back (the body turns over) with the legs in the air', () => {
    const p = sample('rollOver', 1.5);
    expect(p.rot).toBeLessThan(-2.4);
    expect(p.fnY).toBeLessThan(-5);
  });

  it('impact flattens harder with a harder landing and recovers to rest', () => {
    const soft = sample('impact', 0.1, { impact: 0.1 });
    const hard = sample('impact', 0.1, { impact: 1 });
    expect(hard.sqY).toBeLessThan(soft.sqY);
    expect(hard.sqY).toBeLessThan(0.7);
    expect(Math.abs(sample('impact', 0.8).sqY - 1)).toBeLessThan(0.02);
  });

  it('pounce reaches nose-up on the rise and nose-down on the way in', () => {
    const rise = sample('pounce', 0.2, { vy: -400 });
    const fall = sample('pounce', 0.2, { vy: 400 });
    expect(rise.tilt).toBeGreaterThan(fall.tilt + 0.5);
    expect(rise.fnX).toBeGreaterThan(24);
    expect(rise.eNA).toBeGreaterThan(0.85);
  });

  it('slip scrabbles with the forepaws and ends upright', () => {
    expect(spread('slip', 'fnY', {}, 0.5)).toBeGreaterThan(4);
    const end = sample('slip', 0.89);
    expect(Math.abs(end.rot)).toBeLessThan(0.01);
  });
});

describe('the pace shows in the hop', () => {
  function run(speed: number, secs = 3): { lift: number; headY: number; ear: number; maxHeadX: number } {
    const r = new RabbitRenderer(seededRandom(2));
    let lift = 0;
    let headY = 0;
    let ear = 0;
    let n = 0;
    let maxHeadX = -Infinity;
    for (let t = 0; t < secs * 1000; t += DT) {
      r.advance(input('hop', { speed }), t, DT, 0, 0);
      if (t < 800) continue;
      const p = r.anim.pose;
      lift = Math.max(lift, -p.offY);
      headY += p.headY;
      ear += p.eNA;
      maxHeadX = Math.max(maxHeadX, p.headX);
      n++;
    }
    return { lift, headY: headY / n, ear: ear / n, maxHeadX };
  }

  it('a creep (stalk or slink pace) is low with the ears back and small hops; a sprint is long and flat', () => {
    const creep = run(24 / 84);
    const walk = run(70 / 84);
    const dash = run(360 / 84);
    expect(creep.lift).toBeLessThan(walk.lift * 0.8);
    expect(creep.headY).toBeGreaterThan(walk.headY + 2.5);
    expect(creep.ear).toBeGreaterThan(walk.ear + 0.15);
    expect(dash.lift).toBeGreaterThan(walk.lift);
    expect(dash.maxHeadX).toBeGreaterThan(walk.maxHeadX + 2);
    expect(dash.ear).toBeGreaterThan(walk.ear);
  });

  it('every pace hops: it leaves the ground', () => {
    for (const v of [24, 42, 70, 260, 360]) expect(run(v / 84).lift, `${v}`).toBeGreaterThan(2);
  });
});

describe('planted feet do not skate', () => {
  /** Ground slide of a hind foot between landing and take-off, in DIP, with or without the planting. */
  function slide(stride: number, plant: boolean, foot: 'hnX' | 'fnX'): number {
    const lo = 0.84;
    const hi = foot === 'hnX' ? 1.3 : 1.34;
    const x = (ph: number): number => {
      const p = createPose();
      sampleClip(p, 'hop', ctx(0, { cycle: ph, speed: 1, stride: plant ? stride : 0 }));
      return p[foot];
    };
    let total = 0;
    const steps = 80;
    for (let i = 0; i < steps; i++) {
      const a = lo + ((hi - lo) * i) / steps;
      const b = lo + ((hi - lo) * (i + 1)) / steps;
      // Body travel over the step plus the foot's own motion in body space = the foot's motion over the ground (backwards positive).
      total += Math.abs(stride * (b - a) + x(b) - x(a));
    }
    return total;
  }

  it('the hind feet slide at most half as far as unplanted ones at walking and creeping hop rates', () => {
    for (const stride of [22, 26, 30]) expect(slide(stride, true, 'hnX'), `stride ${stride}`).toBeLessThan(slide(stride, false, 'hnX') * 0.5);
  });

  it('the forepaws are planted too', () => {
    for (const stride of [22, 26, 30]) expect(slide(stride, true, 'fnX'), `stride ${stride}`).toBeLessThan(slide(stride, false, 'fnX') * 0.7);
  });
});

describe('burrow vanish and appear', () => {
  function alphas(clip: 'vanish' | 'appear', extra: Partial<AnimInput> = {}): { a: number[]; burrow: number[]; offY: number[] } {
    const r = new RabbitRenderer(seededRandom(3));
    const a: number[] = [];
    const burrow: number[] = [];
    const offY: number[] = [];
    // Start from where the sim would be: standing before a vanish, already burrowed away before an appear.
    const base = clip === 'appear' ? 2000 : 600;
    for (let t = 0; t < base; t += DT) r.advance(input(clip === 'appear' ? 'vanish' : 'stand', extra), t, DT, 0, 0);
    for (let t = 0; t <= 1400; t += DT) {
      r.advance(input(clip, { clipStartedAt: base, ...extra }), base + t, DT, 0, 0);
      a.push(r.anim.pose.alpha);
      burrow.push(r.anim.pose.burrow);
      offY.push(r.anim.pose.offY);
    }
    return { a, burrow, offY };
  }
  const maxStep = (v: number[]): number => v.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - v[i]!)), 0);

  it('vanish fades out softly while sinking into the ground, appear rises and fades back in', () => {
    const v = alphas('vanish');
    expect(v.a[0]).toBeGreaterThan(0.95);
    expect(v.a[v.a.length - 1]).toBeLessThan(0.02);
    expect(Math.max(...v.burrow)).toBe(1);
    expect(Math.max(...v.offY)).toBeGreaterThan(25);
    expect(maxStep(v.a)).toBeLessThan(0.09);
    const a = alphas('appear');
    expect(a.a[0]).toBeLessThan(0.1);
    expect(a.a[a.a.length - 1]).toBeGreaterThan(0.98);
    expect(a.burrow[a.burrow.length - 1]).toBe(0);
    expect(a.offY[a.offY.length - 1]).toBeLessThan(0.5);
    expect(maxStep(a.a)).toBeLessThan(0.09);
  });

  it('reduced motion is a slower, plain fade: no sink, no ground clip, no pop', () => {
    for (const clip of ['vanish', 'appear'] as const) {
      const r = alphas(clip, { reducedMotion: true });
      expect(Math.max(...r.burrow), clip).toBe(0);
      expect(Math.max(...r.offY.map(Math.abs)), clip).toBeLessThan(2);
      expect(maxStep(r.a), clip).toBeLessThan(0.06);
      const n = alphas(clip);
      // The calm fade takes longer than the normal one to get going and finish.
      const span = (x: number[]): number => x.filter((q) => q > 0.05 && q < 0.95).length;
      expect(span(r.a), clip).toBeGreaterThan(span(n.a));
    }
  });

  it('is invisible at the end of the vanish (the token hit only) and whole again after the appear', () => {
    const r = new RabbitRenderer(seededRandom(3));
    for (let t = 0; t < 2000; t += DT) r.advance(input('vanish'), t, DT, 0, 0);
    let hit = 0;
    r.measure({ add: (_x, _y, _r, h) => { if (h >= 0) hit++; }, addGround: () => undefined });
    expect(hit).toBe(1);
    for (let t = 2000; t < 4000; t += DT) r.advance(input('appear', { clipStartedAt: 2000 }), t, DT, 0, 0);
    hit = 0;
    r.measure({ add: (_x, _y, _r, h) => { if (h >= 0) hit++; }, addGround: () => undefined });
    expect(hit).toBeGreaterThan(30);
  });

  it('paints through the ground clip while burrowing and without it while standing; works in pixel mode', () => {
    const clips = (clip: AnimClip, t: number, ppu: number): number => {
      const r = new RabbitRenderer(seededRandom(3));
      for (let s = 0; s <= t; s += DT) r.advance(input(clip), s, DT, 0, 0);
      const m = createMockCtx();
      r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: ppu, skin: 'white' });
      expect(m.nonFinite).toEqual([]);
      expect(m.depth()).toBe(0);
      return m.calls.filter((c) => c.name === 'clip').length;
    };
    expect(clips('vanish', 500, 1)).toBeGreaterThan(0);
    expect(clips('vanish', 500, 0.4)).toBeGreaterThan(0);
    expect(clips('stand', 500, 1)).toBe(0);
  });
});

describe('module data', () => {
  it('has a rare, guarded burrow signature that teleports and respects the usual limits', () => {
    const s = RABBIT_MODULE.behavior.signatures.find((x) => x.id === 'burrow');
    expect(s).toBeDefined();
    expect(s!.movement).toBe('teleport');
    expect(s!.cooldownMs).toBeGreaterThanOrEqual(180_000);
    expect(s!.weight).toBeLessThan(1);
    expect(s!.requires?.notWhileSleepy).toBe(true);
  });
});
