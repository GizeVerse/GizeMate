// The renderer seam: registry, runtime character swap, geometry roles, pendant helper, kit exports.
import { describe, expect, it } from 'vitest';
import { ANIM_CLIPS, type AnimClip, type CatRenderState } from '../../../src/shared/cat';
import { CHARACTER_IDS, type CharacterId } from '../../../src/shared/characters/registry';
import { seededRandom } from '../../../src/renderer/overlay/cat/math';
import { computeNecklace, createNecklaceGeom, drawNecklace } from '../../../src/renderer/overlay/cat/accessory';
import type { AnimInput } from '../../../src/renderer/overlay/cat/animator';
import { CatRenderer } from '../../../src/renderer/overlay/character/catRenderer';
import { clamp, drawPendantBetween, hardenAlpha, TailChain, traceClosedSpline } from '../../../src/renderer/overlay/character/kit';
import { MAX_HIT_RECTS, type CharacterRenderer } from '../../../src/renderer/overlay/character/types';
import { createCharacterRenderer, hasOwnRenderer } from '../../../src/renderer/overlay/characters/registry';
import { CatScene } from '../../../src/renderer/overlay/scene';
import { createMockCtx } from './mockCtx';

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
    speed: clip === 'walk' ? 0.7 : 0,
    vy: 0,
    look: { x: 450, y: 250 },
    arousal: 0.3,
    contentment: 0.5,
    emote: null,
    emoteStartedAt: 0,
    opacity: 1,
    visible: true,
    skin: 'ginger',
    style: 'smooth',
    shadow: true,
    animSpeed: 1,
    ...extra,
  };
}

function run(scene: CatScene, clip: AnimClip, ms: number, extra: Partial<CatRenderState> = {}, snapFirst = true): void {
  const dt = 1000 / 60;
  for (let t = 0; t <= ms; t += dt) {
    const s = state(clip, t, extra);
    scene.update({ x: s.x, y: s.y, state: s, simTime: t, dtMs: t === 0 ? 0 : dt, snapped: snapFirst && t === 0 });
  }
}

const IDLE_INPUT: AnimInput = { clip: 'stand', clipStartedAt: 0, sleeping: false, speed: 0, vy: 0, lookX: 0, lookY: 0, hasLook: false, arousal: 0, contentment: 0.5, animSpeed: 1 };

describe('renderer registry', () => {
  it('returns a working renderer for every character id, and the cat for anything unknown', () => {
    for (const id of CHARACTER_IDS) {
      const r = createCharacterRenderer(id, seededRandom(1));
      expect(typeof r.advance).toBe('function');
      expect(typeof r.measure).toBe('function');
      expect(typeof r.draw).toBe('function');
      // Until a character has its own renderer the cat stands in; once it has, the id matches.
      expect(r.id).toBe(hasOwnRenderer(id) ? id : 'cat');
    }
    expect(createCharacterRenderer('dragon', seededRandom(1)).id).toBe('cat');
    expect(hasOwnRenderer('cat')).toBe(true);
  });

  it('every renderer honours the seam contract on a clip sweep (finite geometry, at most 8 hit roles, balanced draw)', () => {
    for (const id of CHARACTER_IDS) {
      const scene = new CatScene(seededRandom(2));
      for (const clip of ANIM_CLIPS) {
        run(scene, clip, 400, { character: id, skin: 'unknown-palette' }, false);
        expect(scene.hitCount, `${id}/${clip}`).toBeGreaterThanOrEqual(1);
        expect(scene.hitCount).toBeLessThanOrEqual(MAX_HIT_RECTS);
        expect(Number.isFinite(scene.bounds.x + scene.bounds.y + scene.bounds.width + scene.bounds.height)).toBe(true);
        const m = createMockCtx();
        scene.draw(m.ctx, 1, null);
        expect(m.nonFinite, `${id}/${clip}`).toEqual([]);
        expect(m.depth()).toBe(0);
      }
    }
  });
});

describe('scene character handling', () => {
  it('builds its first renderer through the factory and swaps it when the snapshot character changes', () => {
    const made: CharacterId[] = [];
    const scene = new CatScene(seededRandom(4), (id, random) => {
      made.push(id);
      return createCharacterRenderer(id, random);
    });
    expect(made).toEqual(['cat']);
    run(scene, 'walk', 300);
    const first = scene.renderer;
    // Absent and 'cat' are the same character: no swap.
    run(scene, 'walk', 300, { character: 'cat' }, false);
    expect(scene.renderer).toBe(first);
    expect(made).toEqual(['cat']);
    // A different character swaps once, then stays (no per-frame rebuild even with a stand-in renderer).
    run(scene, 'walk', 600, { character: 'fox' }, false);
    expect(made).toEqual(['cat', 'fox']);
    expect(scene.renderer).not.toBe(first);
    expect(scene.character).toBe('fox');
    // Back to the cat: a fresh renderer, fresh pose.
    run(scene, 'stand', 100, {}, false);
    expect(made).toEqual(['cat', 'fox', 'cat']);
    expect(scene.character).toBe('cat');
  });

  it('shows a fresh pose right after a swap (nothing carried over)', () => {
    const scene = new CatScene(seededRandom(4));
    run(scene, 'run', 800, {});
    const before = scene.puppet;
    run(scene, 'stand', 16, { character: 'monkey' }, false);
    expect(scene.puppet).not.toBe(before);
    expect(scene.isQuiet).toBe(false);
    expect(scene.hitCount).toBeGreaterThanOrEqual(2);
  });

  it('treats an unknown character id as the cat', () => {
    const scene = new CatScene(seededRandom(4));
    run(scene, 'sit', 300, { character: 'dragon' as unknown as CharacterId });
    expect(scene.character).toBe('cat');
    expect(scene.renderer).toBeInstanceOf(CatRenderer);
  });

  it('reuses its scratch objects in steady state (no renderer rebuild, same bounds and hit rect objects)', () => {
    const scene = new CatScene(seededRandom(4));
    run(scene, 'walk', 200);
    const bounds = scene.bounds;
    const rects = scene.hitRects;
    const renderer = scene.renderer;
    run(scene, 'walk', 400, {}, false);
    expect(scene.bounds).toBe(bounds);
    expect(scene.hitRects).toBe(rects);
    expect(scene.renderer).toBe(renderer);
  });
});

describe('CatRenderer geometry roles', () => {
  it('uses the seven documented hit roles, tracks three points and anchors the emote above the head', () => {
    const r: CharacterRenderer = new CatRenderer(seededRandom(9));
    for (let t = 0; t < 600; t += 16) r.advance(IDLE_INPUT, t, 16, 0, 0);
    const hits = new Set<number>();
    let ground = 0;
    r.measure({
      add: (_x, _y, _r, hit) => {
        if (hit >= 0) hits.add(hit);
      },
      addGround: () => {
        ground++;
      },
    });
    expect([...hits].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ground).toBe(1);
    const pts = new Float64Array(6);
    r.trackedPoints(pts);
    expect(Array.from(pts).every(Number.isFinite)).toBe(true);
    const a = { x: 0, y: 0, lift: 0, side: 0 };
    r.emoteAnchor(a);
    expect(a.lift).toBeCloseTo(30.5, 5);
    expect(a.side).toBe(5);
    expect(a.y).toBeLessThan(0);
  });
});

describe('pendant helper and kit', () => {
  it('drawNecklace keeps its output without a palette, and drawPendantBetween paints through it', () => {
    const puppet = new CatRenderer(seededRandom(1)).puppet;
    for (let t = 0; t < 300; t += 16) puppet.advance(IDLE_INPUT, t, 16, 0, 0);
    const g = createNecklaceGeom();
    computeNecklace(puppet.rig, puppet.pose, g);
    const a = createMockCtx();
    const b = createMockCtx();
    drawNecklace(a.ctx, g, '#222', 1.6, 1);
    drawNecklace(b.ctx, g, '#222', 1.6, 1, undefined);
    expect(a.calls).toEqual(b.calls);
    expect(a.calls.length).toBeGreaterThan(10);

    const m = createMockCtx();
    drawPendantBetween(m.ctx, -6, 0, 6, 0, 0, 1, 1, '#222', 1.6, 1);
    expect(m.calls.some((c) => c.name === 'bezierCurveTo')).toBe(true);
    expect(m.nonFinite).toEqual([]);
    expect(m.depth()).toBe(0);
    // Pixel mode, a custom palette and a degenerate hang direction stay finite and balanced.
    const p = createMockCtx();
    drawPendantBetween(p.ctx, 0, 0, 0, 0, 0, 0, 0.5, '#000', 1, 0.4, { chain: '#111', cord: '#222', cordEdge: '#333', heart: '#00ff88', heartRim: '#444', heartShine: '#555' });
    expect(p.nonFinite).toEqual([]);
    expect(p.depth()).toBe(0);
    expect(p.calls.some((c) => c.name === 'lineTo')).toBe(true);
    const n = createMockCtx();
    drawPendantBetween(n.ctx, Number.NaN, 0, 1, 1, 0, 1, 1, '#000', 1, 1);
    expect(n.calls.length).toBe(0);
  });

  it('re-exports the shared puppet helpers', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(new TailChain().count).toBeGreaterThan(2);
    expect(typeof hardenAlpha).toBe('function');
    expect(typeof traceClosedSpline).toBe('function');
  });
});
