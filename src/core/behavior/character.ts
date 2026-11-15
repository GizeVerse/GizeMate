// GizeMate: how the shared simulation reads a CharacterModule. Pure functions: the clip a character
// actually draws (locomotion mapping, alias and fallbacks), the decision tuning (multipliers and
// eligible signature actions), the signature timeline and the teleport target. The sim layer that
// applies them is simCharacter.ts; the cat's module is all-neutral, so none of this changes the cat.
import type { AnimClip, Emote } from '../../shared/cat';
import { CLIP_FALLBACK, CLIP_META } from '../../shared/animationCatalog';
import type { Mood } from '../../shared/companion';
import { sevenTraitsOf, type SevenSource } from '../../shared/characters/seven';
import type { CharacterModule, SevenTraits, SignatureAction } from '../../shared/characters/types';
import type { CharacterTuning, SignatureOffer } from './decide';

// ---- clips ---------------------------------------------------------------------------------------

/** The gait clips a locomotion style replaces (the cat's own cycles are walk and run; the rest are its stealthy gaits). */
const GAIT_CLIPS: ReadonlySet<AnimClip> = new Set<AnimClip>(['walk', 'run', 'stalk', 'slink', 'sprint']);

/**
 * Shared last-resort fallbacks, after the character's clipAlias and CLIP_FALLBACK: a clip no
 * character draws natively should still look like a nearby pose, not always like a stand.
 */
const LOCAL_FALLBACK: Readonly<Partial<Record<AnimClip, AnimClip>>> = {
  loaf: 'sit',
  groom: 'sit',
  meow: 'sit',
  pawAt: 'sit',
  crouch: 'stand',
  rollOver: 'loaf',
  edgeSit: 'sit',
  climb: 'stand',
  balance: 'stand',
  pounce: 'jump',
  wake: 'stand',
  yawn: 'sit',
  held: 'fall',
};

/** True when the module draws the clip natively. */
export function listsClip(m: CharacterModule, clip: AnimClip): boolean {
  return m.clips.includes(clip);
}

/**
 * The clip the module's renderer draws for a canonical one: itself when listed, else its clipAlias
 * target, else the shared fallbacks (CLIP_FALLBACK, then a few generic ones), each hop checked
 * against the listed clips; the floor is 'stand' (or the first listed clip when even that is missing).
 * Deterministic and total: the result is always a clip the module lists.
 */
export function resolveForCharacter(m: CharacterModule, clip: AnimClip): AnimClip {
  if (m.clips.includes(clip)) return clip;
  let c: AnimClip | undefined = clip;
  for (let hops = 0; hops < 8 && c !== undefined; hops++) {
    const next: AnimClip | undefined = m.clipAlias[c] ?? CLIP_FALLBACK[c] ?? LOCAL_FALLBACK[c];
    if (next === undefined) break;
    if (m.clips.includes(next)) return next;
    c = next;
  }
  if (m.clips.includes('stand')) return 'stand';
  return m.clips[0] ?? 'stand';
}

/**
 * The movement clip of a locomotion style: walk-style characters keep the cycles they have; 'hop'
 * hops along the ground (a run is simply faster hops: the gait rate follows the speed); 'float' and
 * 'glide' float; 'bounce' bounces. Non-gait clips (sit, loaf, sleep, idle poses, physics) are unchanged.
 */
export function locomotionClip(m: CharacterModule, clip: AnimClip): AnimClip {
  if (!GAIT_CLIPS.has(clip)) return clip;
  switch (m.locomotion) {
    case 'hop':
      return 'hop';
    case 'float':
    case 'glide':
      return 'float';
    case 'bounce':
      return 'bounce';
    default:
      return clip;
  }
}

// ---- decision tuning ---------------------------------------------------------------------------------

/** True when every multiplier is 1 and no signature action exists: the cat. */
export function isNeutral(m: CharacterModule): boolean {
  const b = m.behavior;
  return b.restBias === 1 && b.exploreBias === 1 && b.playBias === 1 && b.cursorInterest === 1 && b.shyness === 1 && b.signatures.length === 0;
}

const finiteOr = (v: number, d: number): number => (Number.isFinite(v) && v > 0 ? v : d);

/** The multipliers of a module (sanitised: non-finite or non-positive values count as 1). */
export function multipliersOf(m: CharacterModule): Omit<CharacterTuning, 'signatures'> {
  const b = m.behavior;
  return {
    restBias: finiteOr(b.restBias, 1),
    exploreBias: finiteOr(b.exploreBias, 1),
    playBias: finiteOr(b.playBias, 1),
    cursorInterest: finiteOr(b.cursorInterest, 1),
    shyness: finiteOr(b.shyness, 1),
  };
}

// ---- signature actions -----------------------------------------------------------------------------------

/** No signature of any kind starts within this long after another (ms): they stay occasional whatever their weights say. */
export const SIGNATURE_GLOBAL_GAP_MS = 30_000;
/** Bounds of a trait-bias factor. */
export const TRAIT_BIAS_MIN = 0.1;
export const TRAIT_BIAS_MAX = 3;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * The weight multiplier of a signature's traitBias: for each listed trait `1 + bias * (trait - 0.5) * 2`,
 * each clamped to 0.1..3, multiplied together and clamped to 0.1..3 again.
 */
export function traitBiasFactor(sig: SignatureAction, seven: SevenTraits): number {
  const bias = sig.traitBias;
  if (!bias) return 1;
  let f = 1;
  for (const k of Object.keys(bias) as Array<keyof SevenTraits>) {
    const b = bias[k];
    if (b === undefined || !Number.isFinite(b)) continue;
    f *= clamp(1 + b * (seven[k] - 0.5) * 2, TRAIT_BIAS_MIN, TRAIT_BIAS_MAX);
  }
  return clamp(f, TRAIT_BIAS_MIN, TRAIT_BIAS_MAX);
}

/** What a signature's requirements are checked against. */
export interface SignatureContext {
  energy: number;
  mood: Mood;
  /** The character is sleepy (high effective sleepiness). */
  sleepy: boolean;
  /** Standing on an elevated ledge (a window top, a strip, a taskbar). */
  onLedge: boolean;
  /** At the foot of a wall, a strip end or a corner. */
  atWall: boolean;
  cursorNear: boolean;
  seven: SevenTraits;
  /** Milliseconds since the signature last started (Infinity: never). */
  sinceMs: number;
  /** Milliseconds since any signature last started (Infinity: never). */
  sinceAnyMs: number;
  /** Typing is going on or just happened: no moving signatures then. */
  typing: boolean;
  /** Whether the clip it starts with may replace the clip that is playing (catalogue priorities). */
  clipSwitchable: boolean;
  /** Whether a relocating action has room (teleport needs a floor to land on). */
  canRelocate: boolean;
}

/** Does the signature relocate or travel (it is kept away from typing and from ledges)? */
export function isMoving(sig: SignatureAction): boolean {
  return sig.movement !== undefined && sig.movement !== 'none';
}

/**
 * The final selection weight of a signature right now, 0 when it is not eligible: its cooldown (and the
 * global gap) must have passed, its requires must hold, and the clip it starts with must be allowed to
 * replace the one playing. Otherwise weight x traitBias factor.
 */
export function signatureWeight(sig: SignatureAction, c: SignatureContext): number {
  if (!(sig.weight > 0) || !Number.isFinite(sig.weight)) return 0;
  if (c.sinceMs < sig.cooldownMs || c.sinceAnyMs < SIGNATURE_GLOBAL_GAP_MS) return 0;
  if (!c.clipSwitchable) return 0;
  if (c.typing && isMoving(sig)) return 0;
  if (sig.movement === 'teleport' && !c.canRelocate) return 0;
  const r = sig.requires;
  if (r) {
    if (r.minEnergy !== undefined && c.energy < r.minEnergy) return 0;
    if (r.maxEnergy !== undefined && c.energy > r.maxEnergy) return 0;
    if (r.moods !== undefined && !r.moods.includes(c.mood)) return 0;
    if (r.needsLedge === true && !c.onLedge) return 0;
    if (r.needsWall === true && !c.atWall) return 0;
    if (r.cursorNear === true && !c.cursorNear) return 0;
    if (r.notWhileSleepy === true && c.sleepy) return 0;
  }
  return sig.weight * traitBiasFactor(sig, c.seven);
}

/** The eligible signatures of a module as decision offers. */
export function signatureOffers(m: CharacterModule, ctxOf: (sig: SignatureAction) => SignatureContext): SignatureOffer[] {
  const out: SignatureOffer[] = [];
  for (const sig of m.behavior.signatures) {
    const w = signatureWeight(sig, ctxOf(sig));
    if (w > 0) out.push({ id: sig.id, weight: w });
  }
  return out;
}

/** The seven-trait view of a stored companion (re-export for the sim). */
export const sevenOf = (s: SevenSource): SevenTraits => sevenTraitsOf(s);

// ---- the signature timeline -----------------------------------------------------------------------------

export type SigStepKind = 'leadIn' | 'travel' | 'vanish' | 'appear' | 'main';

export interface SigStep {
  kind: SigStepKind;
  /** The clip to show (resolved for the character by the caller); travel steps show the locomotion clip. */
  clip: AnimClip;
  /** Length of the step, ms. */
  ms: number;
}

/** Default length of a one-shot clip without a length of its own, ms. */
const ONE_SHOT_DEFAULT_MS = 700;

/** The catalogue length of a clip in ms (its one-shot duration, or 0 for a loop). */
export function clipMs(clip: AnimClip): number {
  const s = CLIP_META[clip].durationS;
  return s === null ? 0 : Math.round(s * 1000);
}

/** Longest a travel step may take (ms): a short stroll or hop sequence, never a long trip. */
export const TRAVEL_MAX_MS = 2600;

/**
 * The steps of a signature: lead-in clips in order (each its own length, loops get a short beat), a
 * travel step for the moving kinds, the vanish / appear pair for a teleport (a reduced-motion swap
 * leaves them out: the relocation happens between two ticks), and the main clip for a duration drawn
 * between the two ends of durationMs (a one-shot main clip plays at least its own length).
 */
export function buildSteps(sig: SignatureAction, drawMs: number, opts: { reducedMotion: boolean }): SigStep[] {
  const steps: SigStep[] = [];
  for (const c of sig.leadIn ?? []) steps.push({ kind: 'leadIn', clip: c, ms: Math.max(clipMs(c), ONE_SHOT_DEFAULT_MS) });
  const mv = sig.movement ?? 'none';
  if (mv === 'teleport') {
    if (!opts.reducedMotion) {
      steps.push({ kind: 'vanish', clip: 'vanish', ms: Math.max(clipMs('vanish'), ONE_SHOT_DEFAULT_MS) });
      steps.push({ kind: 'appear', clip: 'appear', ms: Math.max(clipMs('appear'), ONE_SHOT_DEFAULT_MS) });
    } else {
      // The swap: no vanish or appear clip at all; a single zero-length marker relocates between ticks.
      steps.push({ kind: 'vanish', clip: sig.clip, ms: 0 });
    }
    if (sig.clip === 'vanish' || sig.clip === 'appear') return steps;
  } else if (mv !== 'none') {
    steps.push({ kind: 'travel', clip: 'walk', ms: TRAVEL_MAX_MS });
  }
  const [lo, hi] = sig.durationMs;
  const span = Math.max(0, Math.min(hi, 1e7) - Math.max(0, lo));
  const base = Math.max(0, lo) + span * clamp(drawMs, 0, 1);
  steps.push({ kind: 'main', clip: sig.clip, ms: Math.max(base, clipMs(sig.clip)) });
  return steps;
}

export function totalMs(steps: readonly SigStep[]): number {
  let t = 0;
  for (const s of steps) t += s.ms;
  return t;
}

// ---- teleport ------------------------------------------------------------------------------------------

/**
 * Where a teleporting character reappears: a spot 3 to 8 body widths away to either side (the side with
 * more room when the draw would leave the area), always at least `margin` inside the usable span
 * [x0, x1]. Pure: `u1` picks the side and `u2` the distance (both 0..1).
 */
export function teleportTarget(x: number, span: { x0: number; x1: number }, bodyWidth: number, u1: number, u2: number): number {
  const margin = 0.6 * bodyWidth;
  const lo = span.x0 + margin;
  const hi = span.x1 - margin;
  if (!(hi > lo)) return clamp(x, span.x0, Math.max(span.x0, span.x1));
  const dist = (3 + 5 * clamp(u2, 0, 1)) * bodyWidth;
  let dir = u1 < 0.5 ? -1 : 1;
  let t = x + dir * dist;
  if (t < lo || t > hi) {
    dir = -dir;
    t = x + dir * dist;
  }
  if (t < lo || t > hi) t = clamp(t, lo, hi);
  return clamp(t, lo, hi);
}

/** The emote a signature shows (re-export type helper). */
export type SigEmote = Emote | undefined;
