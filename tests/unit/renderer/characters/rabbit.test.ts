// The rabbit renderer: every clip draws, stays finite and inside its reported bounds, its hit rects
// cover the visible body without spilling over the desktop, reduced motion calms it, pixel mode and
// the pendant work, and it is deterministic and robust against bad input.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip, type CatRenderState, type RenderStyle } from '../../../../src/shared/cat';
import { RABBIT_MODULE } from '../../../../src/shared/characters/rabbit';
import { seededRandom } from '../../../../src/renderer/overlay/cat/math';
import type { AnimInput } from '../../../../src/renderer/overlay/character/types';
import { createCharacterRenderer, hasOwnRenderer } from '../../../../src/renderer/overlay/characters/registry';
import { createRabbitRenderer, RabbitRenderer } from '../../../../src/renderer/overlay/characters/rabbit';
import { resolveClip } from '../../../../src/renderer/overlay/characters/rabbit/animator';
import { isPoseFinite, POSE_KEYS } from '../../../../src/renderer/overlay/characters/rabbit/pose';
import { PALETTE_IDS } from '../../../../src/renderer/overlay/characters/rabbit/palettes';
import { CatScene, type DeviceRect, type Layer } from '../../../../src/renderer/overlay/scene';
import { boxInside, createExtentCtx, paintDistance, type Box } from '../extentCtx';
import { createMockCtx } from '../mockCtx';

const DT = 1000 / 60;

function input(clip: AnimClip, extra: Partial<AnimInput> = {}): AnimInput {
  return { clip, clipStartedAt: 0, sleeping: clip === 'sleep', speed: clip === 'hop' || clip === 'walk' || clip === 'run' ? 1.2 : 0, vy: clip === 'jump' ? -300 : clip === 'fall' ? 300 : 0, lookX: 40, lookY: -20, hasLook: true, arousal: 0.4, contentment: 0.5, animSpeed: 1, ...extra };
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
    speed: clip === 'hop' || clip === 'walk' || clip === 'run' ? 1.2 : 0,
    vy: clip === 'jump' ? -300 : clip === 'fall' ? 300 : 0,
    look: { x: 450, y: 280 },
    arousal: 0.4,
    contentment: 0.5,
    emote: null,
    emoteStartedAt: 0,
    opacity: 1,
    visible: true,
    skin: 'white',
    style: 'smooth',
    shadow: true,
    animSpeed: 1,
    character: 'rabbit',
    ...extra,
  };
}

function runScene(scene: CatScene, clip: AnimClip, ms: number, extra: Partial<CatRenderState> = {}, each?: (t: number) => void): void {
  for (let t = 0; t <= ms; t += DT * 3) {
    const s = state(clip, t, extra);
    scene.update({ x: s.x, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : DT * 3, snapped: t === 0 });
    each?.(t);
  }
}

describe('rabbit renderer registration', () => {
  it('has its own renderer under its own id', () => {
    expect(hasOwnRenderer('rabbit')).toBe(true);
    const r = createCharacterRenderer('rabbit', seededRandom(1));
    expect(r.id).toBe('rabbit');
    expect(r).toBeInstanceOf(RabbitRenderer);
  });

  it('draws natively exactly the clips the module lists, and every clip resolves to one of them', () => {
    const native = new Set<AnimClip>(RABBIT_MODULE.clips);
    for (const c of ANIM_CLIPS) expect(native.has(resolveClip(c)), c).toBe(true);
    for (const c of RABBIT_MODULE.clips) expect(resolveClip(c), c).toBe(c);
  });

  it('has a palette for every skin id', () => {
    expect([...PALETTE_IDS].sort()).toEqual([...RABBIT_MODULE.skins].sort());
    expect(RABBIT_MODULE.skins.length).toBeGreaterThanOrEqual(4);
  });
});

describe('rabbit pose over time', () => {
  it('is finite for every clip, both with and without look-at, over a long run', () => {
    for (const clip of ANIM_CLIPS) {
      const r = new RabbitRenderer(seededRandom(3));
      const g = { add: (x: number, y: number, rad: number) => { expect(Number.isFinite(x + y + rad), clip).toBe(true); }, addGround: (a: number, b: number, c: number) => { expect(Number.isFinite(a + b + c)).toBe(true); } };
      for (let t = 0; t < 4000; t += DT * 2) {
        r.advance(input(clip, { hasLook: t % 800 < 400 }), t, DT * 2, 1.5, 0);
        expect(isPoseFinite(r.anim.pose), `${clip} t=${t}`).toBe(true);
        r.measure(g);
      }
    }
  });

  it('keeps every pose key inside sane limits', () => {
    for (const clip of ANIM_CLIPS) {
      const r = new RabbitRenderer(seededRandom(4));
      for (let t = 0; t < 3000; t += DT * 2) {
        r.advance(input(clip), t, DT * 2, 0, 0);
        const p = r.anim.pose;
        for (const k of POSE_KEYS) expect(Math.abs(p[k]), `${clip}.${k}`).toBeLessThan(120);
        expect(p.sqY, clip).toBeGreaterThan(0.4);
        expect(p.sqY, clip).toBeLessThan(1.6);
      }
    }
  });

  it('survives NaN and Infinity in every input without a non-finite pose or geometry', () => {
    const r = new RabbitRenderer(seededRandom(5));
    const bad = Number.NaN;
    const calls: number[] = [];
    const g = { add: (x: number, y: number, rad: number) => { calls.push(x, y, rad); }, addGround: (a: number, b: number, c: number) => { calls.push(a, b, c); } };
    for (const clip of ANIM_CLIPS) {
      r.advance({ clip, clipStartedAt: bad, sleeping: false, speed: bad, vy: Infinity, lookX: bad, lookY: -Infinity, hasLook: true, arousal: bad, contentment: Infinity, animSpeed: bad, impact: bad, balance: bad, sleepDepth: bad }, bad, bad, bad, bad);
      r.advance(input(clip), 10, DT, Infinity, -Infinity);
      expect(isPoseFinite(r.anim.pose), clip).toBe(true);
      r.measure(g);
    }
    expect(calls.every(Number.isFinite)).toBe(true);
    const m = createMockCtx();
    r.draw(m.ctx, { outline: 1.6, shadow: true, pixelsPerUnit: 1, skin: 'white' });
    expect(m.nonFinite).toEqual([]);
    expect(m.depth()).toBe(0);
  });

  it('is deterministic for a seeded random', () => {
    const trace = (seed: number): string => {
      const r = new RabbitRenderer(seededRandom(seed));
      let h = '';
      for (let t = 0; t < 8000; t += DT) {
        const clip: AnimClip = t < 3000 ? 'stand' : t < 5000 ? 'hop' : 'sit';
        r.advance(input(clip, { hasLook: false }), t, DT, 0, 0);
        if (Math.round(t / DT) % 10 === 0) h += `${r.anim.pose.eNA.toFixed(4)},${r.anim.pose.headRot.toFixed(4)},${r.anim.pose.mouth.toFixed(3)};`;
      }
      return h;
    };
    expect(trace(11)).toBe(trace(11));
    expect(trace(12)).not.toBe(trace(11));
  });

  it('resetMotion forgets the ear-lag and swing state', () => {
    const r = new RabbitRenderer(seededRandom(6));
    for (let t = 0; t < 800; t += DT) r.advance(input('held'), t, DT, 20, 0);
    const swung = Math.abs(r.anim.pose.rot);
    expect(swung).toBeGreaterThan(0.05);
    r.resetMotion();
    r.advance(input('stand'), 900, DT, 0, 0);
    expect(Math.abs(r.anim.pose.rot)).toBeLessThan(1e-6);
  });

  it('varies while idle: ears, nose and fidgets keep moving, so a standing rabbit is never frozen', () => {
    const r = new RabbitRenderer(seededRandom(8));
    const seen = new Set<string>();
    for (let t = 0; t < 30_000; t += 50) {
      r.advance(input('sit', { hasLook: false }), t, 50, 0, 0);
      seen.add(`${r.anim.pose.eNA.toFixed(2)},${r.anim.pose.headRot.toFixed(2)},${r.anim.pose.mouth.toFixed(2)}`);
    }
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe('hop gait', () => {
  it('hops faster with speed and leaves the ground', () => {
    function countHops(speed: number): { hops: number; maxLift: number } {
      const r = new RabbitRenderer(seededRandom(2));
      let hops = 0;
      let airborne = false;
      let maxLift = 0;
      for (let t = 0; t < 4000; t += DT) {
        r.advance(input('hop', { speed }), t, DT, 0, 0);
        const up = -r.anim.pose.offY;
        maxLift = Math.max(maxLift, up);
        if (up > 2 && !airborne) {
          airborne = true;
          hops++;
        } else if (up < 0.5) airborne = false;
      }
      return { hops, maxLift };
    }
    const slow = countHops(0.4);
    const fast = countHops(3);
    expect(slow.maxLift).toBeGreaterThan(4);
    expect(fast.maxLift).toBeGreaterThan(slow.maxLift);
    expect(fast.hops).toBeGreaterThan(slow.hops);
  });

  it('lags the ears behind the body: the ear angle differs between the rise and the landing', () => {
    const r = new RabbitRenderer(seededRandom(2));
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 3000; t += DT) {
      r.advance(input('hop', { speed: 1.5 }), t, DT, 0, 0);
      lo = Math.min(lo, r.anim.pose.eNA);
      hi = Math.max(hi, r.anim.pose.eNA);
    }
    expect(hi - lo).toBeGreaterThan(0.6);
  });
});

describe('sleep', () => {
  it('is visibly asleep (eyes shut, ears down) and nearly still', () => {
    const r = new RabbitRenderer(seededRandom(9));
    for (let t = 0; t < 2000; t += DT) r.advance(input('sleep', { sleepDepth: 1 }), t, DT, 0, 0);
    expect(r.anim.pose.eyeOpen).toBe(0);
    expect(r.anim.pose.eNA).toBeGreaterThan(1.3);
    expect(r.blending).toBe(false);
    expect(r.reacting).toBe(false);
    const a = { ...r.anim.pose };
    let travel = 0;
    for (let t = 2000; t < 6000; t += DT) {
      r.advance(input('sleep', { sleepDepth: 1 }), t, DT, 0, 0);
      for (const k of POSE_KEYS) travel = Math.max(travel, Math.abs(r.anim.pose[k] - a[k]));
    }
    // Slow breathing only: nothing moves by more than a couple of DIP.
    expect(travel).toBeLessThan(0.6);
  });
});

describe('held', () => {
  it('hangs from the scruff: the pivot is HELD_SCRUFF and the scruff stays inside the hit region', () => {
    const scene = new CatScene(seededRandom(2));
    runScene(scene, 'held', 600);
    const p = scene.hitRects;
    // HELD_SCRUFF (-8, -58) relative to the anchor (400, 300), facing right.
    const sx = 400 - 8;
    const sy = 300 - 58;
    let covered = false;
    for (let i = 0; i < scene.hitCount; i++) {
      const h = p[i]!;
      if (sx >= h.x && sx <= h.x + h.width && sy >= h.y && sy <= h.y + h.height) covered = true;
    }
    expect(covered).toBe(true);
    const r = new RabbitRenderer(seededRandom(2));
    r.advance(input('held'), 0, DT, 0, 0);
    expect(r.anim.pose.pivX).toBe(-8);
    expect(r.anim.pose.pivY).toBe(-58);
  });
});

describe('reduced motion', () => {
  function range(clip: AnimClip, reduced: boolean): { y: number; x: number } {
    const r = new RabbitRenderer(seededRandom(2));
    let y0 = Infinity;
    let y1 = -Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    const g = {
      add: (x: number, y: number) => {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      },
      addGround: () => undefined,
    };
    let fy0 = Infinity;
    let fy1 = -Infinity;
    for (let t = 0; t < 6000; t += DT) {
      r.advance(input(clip, { speed: 1.6, reducedMotion: reduced }), t, DT, 0, 0);
      if (t < 2500) continue;
      y0 = Infinity;
      y1 = -Infinity;
      x0 = Infinity;
      x1 = -Infinity;
      r.measure(g);
      fy0 = Math.min(fy0, r.rig.m[5]!);
      fy1 = Math.max(fy1, r.rig.m[5]!);
    }
    return { y: fy1 - fy0, x: x1 - x0 };
  }

  it('shrinks the vertical travel of hop, bounce and dance', () => {
    for (const clip of ['hop', 'bounce', 'dance'] as const) {
      const full = range(clip, false);
      const calm = range(clip, true);
      expect(calm.y, clip).toBeLessThan(full.y * 0.8);
    }
  });

  it('drops the mid-air twist and squash of the binky', () => {
    const squash = (reduced: boolean): number => {
      const r = new RabbitRenderer(seededRandom(2));
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < 6000; t += DT) {
        r.advance(input('bounce', { reducedMotion: reduced }), t, DT, 0, 0);
        if (t < 2500) continue;
        lo = Math.min(lo, r.anim.pose.sqY);
        hi = Math.max(hi, r.anim.pose.sqY);
      }
      return hi - lo;
    };
    expect(squash(true)).toBeLessThan(squash(false) * 0.8);
  });
});

describe('geometry through the scene', () => {
  const SKINS = RABBIT_MODULE.skins;

  function check(clip: AnimClip, facing: 1 | -1, skin: string, style: RenderStyle, scale: number, dpr: number, accessory?: 'heartPendant'): string | null {
    const scene = new CatScene(seededRandom(5));
    const main = createExtentCtx();
    const lay = createExtentCtx();
    let layerSize = { w: 0, h: 0 };
    const layer: Layer = { canvas: {} as CanvasImageSource, ctx: lay.ctx };
    const rect: DeviceRect = { x: 0, y: 0, w: 0, h: 0 };
    for (let t = 0; t <= 1500; t += 100) {
      const s = state(clip, t, { facing, skin, style, scale, x: 600 + t * 0.1, y: 700, accessory, emote: t > 400 ? 'heart' : null, emoteStartedAt: 400, mood: 'excited' });
      scene.update({ x: s.x, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : 100, snapped: t === 0 });
      main.reset();
      lay.reset();
      scene.deviceRect(dpr, rect);
      scene.draw(main.ctx, dpr, (w, h) => {
        layerSize = { w, h };
        return layer;
      });
      const px = (b: Box): Box => ({ x0: Math.floor(b.x0), y0: Math.floor(b.y0), x1: Math.ceil(b.x1), y1: Math.ceil(b.y1) });
      const tag = `${clip}/${facing}/${skin}/${style}/s${scale}/dpr${dpr} t=${t}`;
      if (!boxInside(px(main.box), rect)) return `${tag}: painted ${JSON.stringify(px(main.box))} outside dirty rect ${JSON.stringify(rect)}`;
      if (main.images.length > 0 && !boxInside(px(lay.box), { x: 0, y: 0, w: layerSize.w, h: layerSize.h })) return `${tag}: layer clipped`;
      if (scene.hitCount < 1 || scene.hitCount > 8) return `${tag}: hit count ${scene.hitCount}`;
    }
    return null;
  }

  it('paints inside the reported dirty rect for every clip, both facings, every palette, smooth and pixel', () => {
    for (const clip of ANIM_CLIPS) {
      for (const facing of [1, -1] as const) {
        const skin = SKINS[(ANIM_CLIPS.indexOf(clip) + (facing === 1 ? 0 : 1)) % SKINS.length]!;
        expect(check(clip, facing, skin, 'smooth', 1, 1), clip).toBeNull();
      }
      expect(check(clip, 1, 'brown', 'pixel', 1.4, 1.5), clip).toBeNull();
    }
    for (const skin of SKINS) expect(check('bounce', -1, skin, 'smooth', 2, 2, 'heartPendant'), skin).toBeNull();
    expect(check('hop', 1, 'unknown-palette', 'smooth', 0.7, 1.25)).toBeNull();
  });

  it('covers every filled part of the body with hit rects and never exceeds the bounds', () => {
    for (const clip of RABBIT_MODULE.clips) {
      const scene = new CatScene(seededRandom(5));
      const rec = createExtentCtx(4096, 4096, { record: true });
      for (let t = 0; t <= 1200; t += 100) {
        const s = state(clip, t, { shadow: false, y: 700, x: 700, emote: null });
        scene.update({ x: s.x, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : 100, snapped: t === 0 });
        if (t % 400 !== 0) continue;
        rec.reset();
        scene.draw(rec.ctx, 1, null);
        const b = scene.bounds;
        for (let i = 0; i < scene.hitCount; i++) {
          const h = scene.hitRects[i]!;
          expect(h.x, `${clip} rect ${i}`).toBeGreaterThanOrEqual(b.x - 1e-6);
          expect(h.y).toBeGreaterThanOrEqual(b.y - 1e-6);
          expect(h.x + h.width).toBeLessThanOrEqual(b.x + b.width + 1e-6);
          expect(h.y + h.height).toBeLessThanOrEqual(b.y + b.height + 1e-6);
          // Never block the desktop: no rect is larger than the character plus its ears.
          expect(h.width, `${clip} rect ${i} width`).toBeLessThan(110);
          expect(h.height, `${clip} rect ${i} height`).toBeLessThan(115);
        }
        // A burrowed-away rabbit (vanish after ~0.8 s, appear at its very start) is invisible: only a token spot
        // stays clickable, so it never blocks the desktop.
        if ((clip === 'vanish' && t >= 800) || (clip === 'appear' && t === 0)) continue;
        // Every vertex of every fill (body parts, face, ears) lies inside some hit rect.
        let bad = '';
        for (const sh of rec.shapes) {
          if (!sh.fill) continue;
          for (const sub of sh.subs) {
            for (let k = 0; k < sub.length; k += 2) {
              const px = sub[k]!;
              const py = sub[k + 1]!;
              let inside = false;
              for (let i = 0; i < scene.hitCount; i++) {
                const h = scene.hitRects[i]!;
                if (px >= h.x - 3 && px <= h.x + h.width + 3 && py >= h.y - 3 && py <= h.y + h.height + 3) inside = true;
              }
              if (!inside) bad = `${clip} t=${t}: fill vertex (${px.toFixed(1)}, ${py.toFixed(1)}) not covered`;
            }
          }
        }
        expect(bad).toBe('');
      }
    }
  });

  it('paints a body at the anchor: something is painted near it in every clip', () => {
    for (const clip of RABBIT_MODULE.clips) {
      const scene = new CatScene(seededRandom(5));
      const rec = createExtentCtx(4096, 4096, { record: true });
      const s = state(clip, 600, { shadow: false, y: 700, x: 700, speed: 0 });
      scene.update({ x: s.x, y: s.y, state: s, simTime: 600, dtMs: 0, snapped: true });
      scene.draw(rec.ctx, 1, null);
      expect(Number.isFinite(rec.box.x0), clip).toBe(true);
      expect(paintDistance(rec.shapes, 700, 700 - 18), clip).toBeLessThan(40);
    }
  });
});

describe('painting', () => {
  function drawCalls(accessory: boolean, ppu = 1): number {
    const r = createRabbitRenderer(seededRandom(1));
    r.advance(input('stand'), 0, DT, 0, 0);
    const m = createMockCtx();
    r.draw(m.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: ppu, skin: 'white', accessory: accessory ? 'heartPendant' : undefined });
    expect(m.nonFinite).toEqual([]);
    expect(m.depth()).toBe(0);
    return m.calls.length;
  }

  it('draws extra for the heart pendant, in every posture, following the body', () => {
    expect(drawCalls(true)).toBeGreaterThan(drawCalls(false) + 10);
    // The pendant sits on the chest: its drawn extent moves with the pose.
    const centre = (clip: AnimClip): number => {
      const r = new RabbitRenderer(seededRandom(1));
      for (let t = 0; t < 400; t += DT) r.advance(input(clip, { hasLook: false }), t, DT, 0, 0);
      const e0 = createExtentCtx();
      r.draw(e0.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: 'white' });
      const e1 = createExtentCtx();
      r.draw(e1.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin: 'white', accessory: 'heartPendant' });
      // Extent growth is bounded: the pendant hangs within the body's box (plus a little).
      expect(e1.box.y1).toBeGreaterThanOrEqual(e0.box.y0);
      expect(e1.box.y1 - e0.box.y1).toBeLessThan(14);
      expect(e1.box.x1 - e0.box.x1).toBeLessThan(10);
      return (e1.box.x0 + e1.box.x1) / 2;
    };
    for (const clip of ['stand', 'sit', 'sleep', 'hop', 'jump', 'held', 'scan'] as const) expect(Number.isFinite(centre(clip)), clip).toBe(true);
  });

  it('degrades gracefully in pixel mode: it draws, with fewer operations', () => {
    expect(drawCalls(false, 0.4)).toBeGreaterThan(20);
    expect(drawCalls(false, 0.4)).toBeLessThan(drawCalls(false, 1.2));
  });

  it('uses a different palette per skin and the default for unknown ones', () => {
    const fills = (skin: string): string => {
      const r = createRabbitRenderer(seededRandom(1));
      r.advance(input('stand'), 0, DT, 0, 0);
      const m = createMockCtx();
      r.draw(m.ctx, { outline: 1.6, shadow: false, pixelsPerUnit: 1, skin });
      return JSON.stringify(m.calls.filter((c) => c.name === 'fill').length);
    };
    expect(fills('spotted')).not.toBe(fills('white'));
    expect(fills('nope')).toBe(fills('white'));
  });

  it('keeps the emote anchor above the head and reports three tracked points', () => {
    const r = new RabbitRenderer(seededRandom(1));
    r.advance(input('stand'), 0, DT, 0, 0);
    const a = { x: 0, y: 0, lift: 30.5, side: 5 };
    r.emoteAnchor(a);
    expect(Number.isFinite(a.x + a.y + a.lift + a.side)).toBe(true);
    expect(a.y).toBeLessThan(r.rig.headY);
    const out = new Float64Array(6);
    r.trackedPoints(out);
    expect(out.every(Number.isFinite)).toBe(true);
  });
});
