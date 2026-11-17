// The fox renderer: every clip draws (natively or through an alias) with finite pose and bounds, the bounds
// cover everything drawn, the hit roles cover the body, reduced motion calms it, pixel mode and the pendant
// work, and the pose is deterministic.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, GAIT_LIMIT_DIP, HIT_FRONT_EXTENT_DIP, type AnimClip, type CatRenderState } from '../../../../src/shared/cat';
import { FOX_MODULE } from '../../../../src/shared/characters/fox';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import { applyMatX, applyMatY } from '../../../../src/renderer/overlay/character/kit';
import { MAX_HIT_RECTS, type AnimInput, type GeometryCollector } from '../../../../src/renderer/overlay/character/types';
import { GAIT_CLEAN_LIMIT_DIP } from '../../../../src/renderer/overlay/characters/fox/clips';
import { FoxRenderer, createFoxRenderer } from '../../../../src/renderer/overlay/characters/fox';
import { resolveFoxClip } from '../../../../src/renderer/overlay/characters/fox/animator';
import { LEG_COUNT } from '../../../../src/renderer/overlay/characters/fox/pose';
import { FOX_SKIN_IDS, getFoxSkin } from '../../../../src/renderer/overlay/characters/fox/skins';
import { CatScene, type DeviceRect, type Layer } from '../../../../src/renderer/overlay/scene';
import { boxInside, createExtentCtx } from '../extentCtx';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;
const MARGIN = 5;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return {
    clip,
    clipStartedAt: 0,
    sleeping: clip === 'sleep',
    speed: clip === 'walk' ? 0.7 : clip === 'run' ? 2.2 : clip === 'stalk' || clip === 'slink' || clip === 'climb' ? 0.3 : 0,
    vy: clip === 'jump' ? -300 : clip === 'fall' ? 400 : 0,
    lookX: 40,
    lookY: -20,
    hasLook: true,
    arousal: 0.4,
    contentment: 0.5,
    animSpeed: 1,
    ...extra,
  };
}

function runFox(clip: AnimClip, ms: number, extra: Partial<AnimInput> = {}, seed = 3): FoxRenderer {
  const r = new FoxRenderer(seededRandom(seed));
  for (let t = 0; t <= ms; t += DT) r.advance(input(clip, extra), t, t === 0 ? 0 : DT, clip === 'held' ? 2 : 0, 0);
  return r;
}

interface Box4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Collected extends Box4 {
  hits: Box4[];
  ground: number;
}

function collect(r: FoxRenderer): Collected {
  const empty = (): Box4 => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const c: Collected = { ...empty(), hits: Array.from({ length: MAX_HIT_RECTS }, empty), ground: 0 };
  const g: GeometryCollector = {
    add(x, y, rad, hit) {
      c.x0 = Math.min(c.x0, x - rad);
      c.y0 = Math.min(c.y0, y - rad);
      c.x1 = Math.max(c.x1, x + rad);
      c.y1 = Math.max(c.y1, y + rad);
      if (hit >= 0 && hit < MAX_HIT_RECTS) {
        const h = c.hits[hit]!;
        h.x0 = Math.min(h.x0, x - rad);
        h.y0 = Math.min(h.y0, y - rad);
        h.x1 = Math.max(h.x1, x + rad);
        h.y1 = Math.max(h.y1, y + rad);
      }
    },
    addGround(cx, half, rh) {
      c.ground++;
      c.x0 = Math.min(c.x0, cx - half);
      c.x1 = Math.max(c.x1, cx + half);
      c.y1 = Math.max(c.y1, -0.6 + rh);
    },
  };
  r.measure(g);
  return c;
}

const ALL = ANIM_CLIPS as readonly AnimClip[];
const SKINS = FOX_MODULE.skins;
const poseKey = (r: FoxRenderer): string => JSON.stringify(Object.values(r.pose).map((v) => Math.round(v * 10)));

describe('fox renderer: every clip', () => {
  it('draws every clip of the vocabulary (native or alias) with finite pose, geometry and paint, over time and in both styles', () => {
    for (const clip of ALL) {
      const r = new FoxRenderer(seededRandom(4));
      for (let t = 0; t <= 2600; t += DT) {
        r.advance(input(clip, { mood: t > 1200 ? 'scared' : undefined }), t, t === 0 ? 0 : DT, 0, 0);
        if (Math.round(t / DT) % 17 !== 0) continue;
        for (const v of Object.values(r.pose)) expect(Number.isFinite(v), `${clip}@${t}`).toBe(true);
        const c = collect(r);
        expect(Number.isFinite(c.x0 + c.y0 + c.x1 + c.y1), clip).toBe(true);
        for (const ppu of [2, 0.4]) {
          const m = createMockCtx();
          r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: ppu, skin: SKINS[Math.round(t) % SKINS.length]! });
          expect(m.nonFinite, `${clip}@${t}`).toEqual([]);
          expect(m.depth(), clip).toBe(0);
        }
      }
      expect(FOX_MODULE.clips.includes(resolveFoxClip(clip)), clip).toBe(true);
    }
  });

  it('every native clip is its own authored pose (none is a stand in disguise)', () => {
    const base = poseKey(runFox('stand', 1200));
    for (const clip of FOX_MODULE.clips) {
      if (clip === 'stand') continue;
      expect(poseKey(runFox(clip, 1500)), clip).not.toBe(base);
    }
  });
});

describe('fox renderer: bounds and hit roles', () => {
  it('the measured bounds (plus the scene margin) contain everything drawn, every palette, smooth and pixel', () => {
    const failures: string[] = [];
    for (const clip of ALL) {
      for (const skin of SKINS) {
        for (const ppu of [2, 0.45]) {
          const r = runFox(clip, 1300 + (clip.length % 5) * 130);
          const c = collect(r);
          const x = createExtentCtx();
          r.draw(x.ctx, { outline: ppu < 0.6 ? 3 : 1.6, shadow: true, pixelsPerUnit: ppu, skin, accessory: 'heartPendant' });
          const b = x.box;
          if (!Number.isFinite(b.x0)) continue;
          if (b.x0 < c.x0 - MARGIN || b.y0 < c.y0 - MARGIN || b.x1 > c.x1 + MARGIN || b.y1 > c.y1 + MARGIN) {
            failures.push(`${clip}/${skin}/${ppu}: drawn ${JSON.stringify(b)} vs measured ${JSON.stringify({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('uses at most 8 stable hit roles, one ground extent, and the roles cover the head, body, legs, paws and tail', () => {
    for (const clip of FOX_MODULE.clips) {
      const r = runFox(clip, 1100);
      const c = collect(r);
      expect(c.ground, clip).toBe(1);
      const used = c.hits.filter((h) => Number.isFinite(h.x0));
      expect(used.length, clip).toBeGreaterThanOrEqual(5);
      expect(used.length, clip).toBeLessThanOrEqual(MAX_HIT_RECTS);
      const m = r.rig.m;
      const inside = (x: number, y: number): boolean => c.hits.some((h) => Number.isFinite(h.x0) && x >= h.x0 - 0.01 && x <= h.x1 + 0.01 && y >= h.y0 - 0.01 && y <= h.y1 + 0.01);
      const at = (x: number, y: number): [number, number] => [applyMatX(m, x, y), applyMatY(m, x, y)];
      const pts: Array<[string, [number, number]]> = [
        ['head', at(r.rig.headX, r.rig.headY)],
        ['torso', at(r.rig.bodyX, r.rig.bodyY)],
        ['tailRoot', at(r.tail.x[0]!, r.tail.y[0]!)],
        ['tailTip', at(r.tail.x[8]!, r.tail.y[8]!)],
      ];
      for (let i = 0; i < LEG_COUNT; i++) pts.push([`foot${i}`, at(r.rig.legs[i]!.fx, r.rig.legs[i]!.fy)]);
      for (const [name, [x, y]] of pts) expect(inside(x, y), `${clip}: ${name} uncovered`).toBe(true);
      // Never block the desktop: every hit rect stays inside the measured bounds and is body-sized.
      for (const h of used) {
        expect(h.x0).toBeGreaterThanOrEqual(c.x0 - 1e-6);
        expect(h.x1).toBeLessThanOrEqual(c.x1 + 1e-6);
        expect(h.y0).toBeGreaterThanOrEqual(c.y0 - 1e-6);
        expect(h.y1).toBeLessThanOrEqual(c.y1 + 1e-6);
        expect(h.x1 - h.x0).toBeLessThan(110);
        expect(h.y1 - h.y0).toBeLessThan(110);
      }
    }
  });

  it('the hit region never reaches further ahead than the module (or the cat) allows for the strike poses', () => {
    for (const clip of ['crouch', 'pounce', 'land', 'swat'] as const) {
      const limit = FOX_MODULE.body.hitFrontExtentDip[clip] ?? HIT_FRONT_EXTENT_DIP[clip];
      let reach = 0;
      const r = new FoxRenderer(seededRandom(2));
      for (let t = 0; t <= 4000; t += DT) {
        r.advance(input(clip, { impact: 0.5 }), t, t === 0 ? 0 : DT, 0, 0);
        const c = collect(r);
        for (const h of c.hits) if (Number.isFinite(h.x1)) reach = Math.max(reach, h.x1);
      }
      expect(reach, clip).toBeLessThanOrEqual(limit);
    }
  });

  it('draws inside the scene dirty rect (both facings, smooth and pixel, with the pendant)', () => {
    const failures: string[] = [];
    for (const style of ['smooth', 'pixel'] as const) {
      for (const facing of [1, -1] as const) {
        for (const clip of ['stand', 'sit', 'run', 'held', 'sleep', 'pounce', 'rollOver', 'tailChase', 'climb', 'dance'] as const) {
          const scene = new CatScene(seededRandom(5));
          const main = createExtentCtx();
          const lay = createExtentCtx();
          const layer: Layer = { canvas: {} as CanvasImageSource, ctx: lay.ctx };
          const rect: DeviceRect = { x: 0, y: 0, w: 0, h: 0 };
          for (let t = 0; t <= 1800; t += 100) {
            const s: CatRenderState = {
              seq: t,
              t,
              x: 600,
              y: 700,
              snap: false,
              scale: 1.3,
              facing,
              state: 'idle',
              clip,
              clipStartedAt: 0,
              speed: clip === 'run' ? 2 : 0,
              vy: 0,
              look: { x: 700, y: 650 },
              arousal: 0.6,
              contentment: 0.5,
              emote: null,
              emoteStartedAt: 0,
              opacity: 1,
              visible: true,
              skin: 'silver',
              style,
              shadow: true,
              animSpeed: 1,
              character: 'fox',
              accessory: 'heartPendant',
            };
            scene.update({ x: s.x, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : 100, snapped: t === 0 });
            main.reset();
            lay.reset();
            scene.deviceRect(1.25, rect);
            scene.draw(main.ctx, 1.25, () => layer);
            const b = main.box;
            if (!boxInside({ x0: Math.floor(b.x0), y0: Math.floor(b.y0), x1: Math.ceil(b.x1), y1: Math.ceil(b.y1) }, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })) failures.push(`${style}/${facing}/${clip}@${t}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('fox renderer: behaviours', () => {
  it('reduced motion calms the movement: smaller tracked-point travel for the lively clips', () => {
    const travel = (clip: AnimClip, reduced: boolean): number => {
      const r = new FoxRenderer(seededRandom(8));
      const out = new Float64Array(6);
      let prev: number[] | null = null;
      let total = 0;
      for (let t = 0; t <= 3000; t += DT) {
        r.advance(input(clip, { reducedMotion: reduced }), t, t === 0 ? 0 : DT, 0, 0);
        r.trackedPoints(out);
        if (prev) for (let i = 0; i < 6; i++) total += Math.abs(out[i]! - prev[i]!);
        prev = Array.from(out);
      }
      return total;
    };
    for (const clip of ['dance', 'tailChase', 'shake', 'startle', 'stand', 'scan'] as const) expect(travel(clip, true), clip).toBeLessThan(travel(clip, false));
  });

  it('a reduced-motion spin never goes edge-on and never mirrors', () => {
    const r = new FoxRenderer(seededRandom(2));
    let minX = Infinity;
    for (let t = 0; t <= 4000; t += DT) {
      r.advance(input('tailChase', { reducedMotion: true }), t, t === 0 ? 0 : DT, 0, 0);
      minX = Math.min(minX, r.rig.m[0]!);
    }
    expect(minX).toBeGreaterThan(0.2);
  });

  it('sleeping is nearly still, and distinctly lower than standing', () => {
    const sleep = new FoxRenderer(seededRandom(1));
    const stand = new FoxRenderer(seededRandom(1));
    const out = new Float64Array(6);
    const prev = new Float64Array(6);
    let moved = 0;
    for (let t = 0; t <= 6000; t += DT) {
      sleep.advance(input('sleep', { sleepDepth: 0.8 }), t, t === 0 ? 0 : DT, 0, 0);
      stand.advance(input('stand'), t, t === 0 ? 0 : DT, 0, 0);
      sleep.trackedPoints(out);
      if (t > 1500) for (let i = 0; i < 6; i++) moved = Math.max(moved, Math.abs(out[i]! - prev[i]!));
      prev.set(out);
    }
    expect(moved).toBeLessThan(0.25);
    expect(collect(sleep).y0).toBeGreaterThan(collect(stand).y0 + 20);
  });

  it('pixel mode draws a simpler picture than the fine one', () => {
    const r = runFox('stand', 800);
    const fine = createMockCtx();
    const px = createMockCtx();
    r.draw(fine.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red' });
    r.draw(px.ctx, { outline: 3, shadow: false, pixelsPerUnit: 0.4, skin: 'red' });
    expect(px.calls.length).toBeLessThan(fine.calls.length);
    expect(px.nonFinite).toEqual([]);
  });

  it('the heart pendant adds a drawing at the neck in every posture and stays inside the measured bounds', () => {
    for (const clip of ['stand', 'sit', 'walk', 'jump', 'sleep', 'held', 'run', 'loaf', 'rollOver', 'climb'] as const) {
      const r = runFox(clip, 1000);
      const a = createMockCtx();
      const b = createMockCtx();
      r.draw(a.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red' });
      r.draw(b.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red', accessory: 'heartPendant' });
      expect(b.calls.length, clip).toBeGreaterThan(a.calls.length);
      expect(b.nonFinite, clip).toEqual([]);
      expect(b.depth(), clip).toBe(0);
      const c = collect(r);
      const x = createExtentCtx();
      r.draw(x.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red', accessory: 'heartPendant' });
      expect(boxInside(x.box, { x: c.x0 - MARGIN, y: c.y0 - MARGIN, w: c.x1 - c.x0 + 2 * MARGIN, h: c.y1 - c.y0 + 2 * MARGIN }), clip).toBe(true);
    }
  });

  it('the pendant hangs at the neck: painted near the neck point in a stand and a sleep alike', () => {
    for (const clip of ['stand', 'sleep', 'sit'] as const) {
      const r = runFox(clip, 1000);
      const plain = createExtentCtx(4096, 4096, { record: true });
      const worn = createExtentCtx(4096, 4096, { record: true });
      r.draw(plain.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red' });
      r.draw(worn.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red', accessory: 'heartPendant' });
      expect(worn.shapes.length, clip).toBeGreaterThan(plain.shapes.length);
      const m = r.rig.m;
      const nx = applyMatX(m, (r.rig.nx0 + r.rig.nx1) / 2, (r.rig.ny0 + r.rig.ny1) / 2);
      const ny = applyMatY(m, (r.rig.nx0 + r.rig.nx1) / 2, (r.rig.ny0 + r.rig.ny1) / 2);
      // Some pendant shape (a shape only the worn drawing has) lies within 16 units of the neck.
      const extra = worn.shapes.slice(plain.shapes.length);
      let best = Infinity;
      for (const s of extra) for (const sub of s.subs) for (let i = 0; i + 1 < sub.length; i += 2) best = Math.min(best, Math.hypot(sub[i]! - nx, sub[i + 1]! - ny));
      expect(best, clip).toBeLessThan(16);
    }
  });

  it('resetMotion forgets the tail lag', () => {
    const fresh = new FoxRenderer(seededRandom(1));
    const moved = new FoxRenderer(seededRandom(1));
    for (let t = 0; t <= 600; t += DT) {
      moved.advance(input('run'), t, t === 0 ? 0 : DT, 0, -6);
      fresh.advance(input('run'), t, t === 0 ? 0 : DT, 0, 0);
    }
    expect(Math.abs(moved.tail.y[8]! - fresh.tail.y[8]!)).toBeGreaterThan(0.5);
    moved.resetMotion();
    fresh.resetMotion();
    moved.advance(input('run'), 700, DT, 0, 0);
    fresh.advance(input('run'), 700, DT, 0, 0);
    for (let i = 0; i < 9; i++) expect(moved.tail.y[i]).toBeCloseTo(fresh.tail.y[i]!, 6);
  });

  it('is deterministic for a seeded random', () => {
    const run = (): string => {
      const r = new FoxRenderer(seededRandom(11));
      const m = createMockCtx();
      for (let t = 0; t <= 3000; t += DT) r.advance(input(t < 1500 ? 'stand' : 'walk', { mood: 'happy' }), t, t === 0 ? 0 : DT, 0.1, 0);
      r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 2, skin: 'dusk' });
      return JSON.stringify([Object.values(r.pose), m.calls.map((c) => c.name + c.args.join(','))]);
    };
    expect(run()).toBe(run());
  });

  it('survives NaN and Infinity in every input', () => {
    const r = createFoxRenderer(seededRandom(3)) as FoxRenderer;
    const bad = Number.NaN;
    for (let t = 0; t <= 800; t += DT) {
      r.advance({ clip: 'walk', clipStartedAt: bad, sleeping: false, speed: bad, vy: Infinity, lookX: bad, lookY: -Infinity, hasLook: true, arousal: bad, contentment: Infinity, animSpeed: bad, impact: bad, sleepDepth: bad }, t, bad, bad, Infinity);
    }
    const c = collect(r);
    expect(Number.isFinite(c.x0 + c.y0 + c.x1 + c.y1)).toBe(true);
    const m = createMockCtx();
    r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 2, skin: 'nope' });
    expect(m.nonFinite).toEqual([]);
    const pts = new Float64Array(6);
    r.trackedPoints(pts);
    expect(Array.from(pts).every(Number.isFinite)).toBe(true);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    expect(Number.isFinite(a.x + a.y)).toBe(true);
  });

  it('the emote anchor sits above the head', () => {
    const r = runFox('stand', 800);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    expect(a.y).toBeLessThan(-30);
    expect(a.lift).toBeGreaterThan(25);
  });

  it('palettes: the renderer knows every palette of the module, all distinct, and falls back to the first', () => {
    expect([...FOX_SKIN_IDS]).toEqual([...SKINS]);
    expect(new Set(SKINS.map((s) => getFoxSkin(s).coat)).size).toBe(SKINS.length);
    expect(getFoxSkin('unknown').id).toBe(SKINS[0]);
    for (const s of SKINS) expect(getFoxSkin(s).outline).not.toBe(getFoxSkin(s).coat);
  });

  it('the gaits keep planted paws put up to the pace the mover allows', () => {
    const gait = FOX_MODULE.body.gaitScale * FOX_MODULE.behavior.speedScale * 1.1;
    for (const g of ['walk', 'run', 'stalk', 'slink', 'climb'] as const) expect(GAIT_CLEAN_LIMIT_DIP[g], g).toBeGreaterThanOrEqual(GAIT_LIMIT_DIP[g] * gait);
  });

  it('the held pose hangs the body from the scruff the mover keeps under the cursor', () => {
    const r = runFox('held', 1500);
    const m = r.rig.m;
    const sx = applyMatX(m, r.rig.nx0, r.rig.ny0);
    const sy = applyMatY(m, r.rig.nx0, r.rig.ny0);
    expect(Math.hypot(sx - -8, sy - -58)).toBeLessThan(9);
  });
});

describe('fox renderer: the soft vanish and appear', () => {
  const at = (clip: AnimClip, ms: number, extra: Partial<AnimInput> = {}): FoxRenderer => runFox(clip, ms, extra);
  const strokes = (r: FoxRenderer, ppu: number): number => {
    const m = createMockCtx();
    r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: ppu, skin: 'red' });
    return m.calls.filter((c) => c.name === 'fill' || c.name === 'stroke').length;
  };

  it('vanish ends fully hidden and appear ends fully visible, the body fading before the brush (and returning after it)', () => {
    const v0 = at('vanish', 10);
    expect(v0.pose.alpha).toBeGreaterThan(0.95);
    const vMid = at('vanish', 560);
    expect(vMid.pose.alpha).toBeLessThan(0.5);
    expect(vMid.pose.tailAlpha).toBeGreaterThan(0.8);
    const vEnd = at('vanish', 1300);
    expect(vEnd.pose.alpha).toBe(0);
    expect(vEnd.pose.tailAlpha).toBe(0);
    expect(vEnd.pose.sqY).toBeLessThan(0.6);
    const aEarly = at('appear', 150);
    expect(aEarly.pose.tailAlpha).toBeGreaterThan(aEarly.pose.alpha);
    const aEnd = at('appear', 1300);
    expect(aEnd.pose.alpha).toBe(1);
    expect(aEnd.pose.sqY).toBeGreaterThan(0.97);
    expect(aEnd.pose.sqY).toBeLessThan(1.03);
  });

  it('paints nothing when hidden, something while fading, in smooth and pixel mode alike; the dust puff stays inside the bounds', () => {
    for (const ppu of [2, 0.45]) {
      expect(strokes(at('vanish', 1300), ppu), `hidden ${ppu}`).toBe(0);
      expect(strokes(at('vanish', 400), ppu), `fading ${ppu}`).toBeGreaterThan(0);
      expect(strokes(at('appear', 1300), ppu), `shown ${ppu}`).toBeGreaterThan(0);
    }
    for (const clip of ['vanish', 'appear'] as const) {
      for (let ms = 300; ms <= 800; ms += 100) {
        const r = at(clip, ms);
        if (r.pose.dust < 0.05) continue;
        const c = collect(r);
        const m = createExtentCtx();
        r.draw(m.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 2, skin: 'red' });
        const b = m.box;
        expect(b.x0 >= c.x0 - MARGIN && b.y0 >= c.y0 - MARGIN && b.x1 <= c.x1 + MARGIN && b.y1 <= c.y1 + MARGIN, `${clip}@${ms}`).toBe(true);
      }
    }
  });

  it('reduced motion makes both a plain slow fade: no shrink, no dust, no pop', () => {
    for (const clip of ['vanish', 'appear'] as const) {
      let prev = clip === 'vanish' ? 1 : 0;
      for (let t = 0; t <= 1000; t += DT) {
        const r = new FoxRenderer(seededRandom(5));
        r.advance(input(clip, { reducedMotion: true }), t, t === 0 ? 0 : DT, 0, 0);
        // The animator eases reduced motion in; the clip itself never scales or puffs.
        expect(r.pose.dust, clip).toBe(0);
        expect(r.pose.sqY, clip).toBeGreaterThan(0.99);
        void prev;
        prev = r.pose.alpha;
      }
    }
    const r = new FoxRenderer(seededRandom(5));
    let last = 1;
    for (let t = 0; t <= 1100; t += DT) {
      r.advance(input('vanish', { reducedMotion: true }), t, t === 0 ? 0 : DT, 0, 0);
      expect(r.pose.alpha, 'monotone fade').toBeLessThanOrEqual(last + 1e-9);
      expect(last - r.pose.alpha, 'no pop').toBeLessThan(0.1);
      last = r.pose.alpha;
    }
    expect(last).toBeLessThan(0.02);
  });
});

describe('fox renderer: the authored scratch, yip, hop and squish', () => {
  it('the scratch raises a hind paw to the head and moves it fast; the yip opens the mouth wide; the hop leaves the ground; the squish flattens', () => {
    const lifted = runFox('scratch', 1500);
    expect(lifted.rig.legs[2]!.fy).toBeLessThan(-20);
    let lo = Infinity;
    let hi = -Infinity;
    const r = new FoxRenderer(seededRandom(3));
    for (let t = 0; t <= 2200; t += DT) {
      r.advance(input('scratch'), t, t === 0 ? 0 : DT, 0, 0);
      if (t > 900) {
        lo = Math.min(lo, r.pose.bnY);
        hi = Math.max(hi, r.pose.bnY);
      }
    }
    expect(hi - lo).toBeGreaterThan(4);
    let open = 0;
    const y = new FoxRenderer(seededRandom(3));
    for (let t = 0; t <= 900; t += DT) {
      y.advance(input('meow'), t, t === 0 ? 0 : DT, 0, 0);
      open = Math.max(open, y.pose.mouthOpen);
    }
    expect(open).toBeGreaterThan(0.8);
    let air = 0;
    const h = new FoxRenderer(seededRandom(3));
    for (let t = 0; t <= 1300; t += DT) {
      h.advance(input('hop'), t, t === 0 ? 0 : DT, 0, 0);
      air = Math.min(air, h.pose.offY);
    }
    expect(air).toBeLessThan(-8);
    let flat = 1;
    const q = new FoxRenderer(seededRandom(3));
    for (let t = 0; t <= 600; t += DT) {
      q.advance(input('squish'), t, t === 0 ? 0 : DT, 0, 0);
      flat = Math.min(flat, q.pose.sqY);
    }
    expect(flat).toBeLessThan(0.8);
  });

  it('the held fox keeps hanging from the scruff while it wriggles (paws paddle over the loop)', () => {
    const r = new FoxRenderer(seededRandom(3));
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t <= 7600; t += DT) {
      r.advance(input('held'), t, t === 0 ? 0 : DT, 0, 0);
      if (t > 1000 && t < 3000) {
        lo = Math.min(lo, r.pose.fnX);
        hi = Math.max(hi, r.pose.fnX);
      }
    }
    expect(hi - lo).toBeGreaterThan(3);
  });
});
