// The renderer seam (GizeMate): everything the scene needs from one drawable character. The scene
// owns the view transform (anchor, scale, squash-turn facing), opacity, the pixel/translucent layer,
// the dirty rect, emote placement, frame-rate policy and hit reporting; a renderer owns pose,
// physics, drawing and geometry. Pure canvas 2D: no DOM, no allocation per frame.
import type { CatAccessory } from '../../../shared/cat';
import type { CharacterId } from '../../../shared/characters/types';
import type { AnimInput } from '../cat/animator';
import type { Ctx2D } from '../cat/draw';

export type { Ctx2D, AnimInput, CharacterId };

/** Most hit rects a renderer may use (main accepts up to 8). Indices 0..7 are stable roles per character. */
export const MAX_HIT_RECTS = 8;

/**
 * Collects the drawn extent of a posed character. Coordinates are CHARACTER-LOCAL view terms: after
 * the renderer's own pose matrix, before the scene's facing/scale/anchor transform (so the cat adds
 * applyMat(m, x, y)). The scene maps them to overlay DIP.
 */
export interface GeometryCollector {
  /** A point with radius `r` (local units) added to the bounds and, when 0 <= hit < MAX_HIT_RECTS, to that hit rect. */
  add(x: number, y: number, r: number, hit: number): void;
  /**
   * The ground shadow's extent: its centre `cx` on the ground line (local x), `half` local units to
   * each side (scaled by |facing x scale|) and `rh` the end caps' vertical radius (local units, times
   * the vertical view scale). Bounds only, never a hit rect.
   */
  addGround(cx: number, half: number, rh: number): void;
}

/** Where the emote bubble sits, in the same local terms as GeometryCollector.add. */
export interface EmoteAnchor {
  /** The head (or top-most expressive point), local. */
  x: number;
  y: number;
  /** Distance the bubble's centre keeps above the higher of the head and the ground anchor (local units), before the emote's rise. Default 30.5. */
  lift: number;
  /** Sideways nudge towards the facing direction (local units). Default 5. */
  side: number;
}

export interface DrawParams {
  /** Outline width in local units. */
  outline: number;
  /** Draw the ground shadow as part of draw() (false when the scene draws it separately or not at all). */
  shadow: boolean;
  /** Device pixels per local unit; < 0.6 is pixel mode and must degrade gracefully. */
  pixelsPerUnit: number;
  /** Palette id local to the character (free string; unknown resolves to the character's first palette). */
  skin: string;
  accessory?: CatAccessory | undefined;
}

export interface CharacterRenderer {
  readonly id: CharacterId;
  /**
   * Advances one frame. `motionX/motionY` is the body motion since the last frame in character-local
   * units (facing-normalised, divided by scale).
   */
  advance(input: AnimInput, simTime: number, dtMs: number, motionX: number, motionY: number): void;
  /** Forget motion-derived state (tail/trail lag) after a position snap. */
  resetMotion(): void;
  /** A cross-fade or clip blend moved the last frame (frame-rate pacing). */
  readonly blending: boolean;
  /** A reaction layer (ear flick, tail flick, head tilt or equivalent) moved the last frame. */
  readonly reacting: boolean;
  /** Reports every drawn extent of the current pose (at most MAX_HIT_RECTS hit roles). */
  measure(g: GeometryCollector): void;
  /** Writes three tracked local points [x0,y0,x1,y1,x2,y2] after the pose matrix (frame-rate policy). */
  trackedPoints(out: Float64Array): void;
  /** Local anchor of the emote bubble. `out` arrives holding the defaults for lift and side. */
  emoteAnchor(out: EmoteAnchor): void;
  /** Paints the character in its local frame (the scene has set the view transform). */
  draw(ctx: Ctx2D, o: DrawParams): void;
  /** Paints only the ground shadow (pixel mode draws it behind the hardened sprite). */
  drawShadow(ctx: Ctx2D): void;
}

/** Creates a renderer; `random` drives its idle variation (injectable for deterministic tests). */
export type CharacterRendererFactory = (random: () => number) => CharacterRenderer;
