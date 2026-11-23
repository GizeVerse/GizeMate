// Frame-rate policy of the overlay renderer. The display rate (~60 fps) is used only
// while something moves fast; a calm cat is drawn at ~30 fps and a sleeping, still one
// at ~20 fps. Every animation is time-based (clip phases from the sim clock, layers and
// the tail from the frame's dt), so fewer frames never change a motion's speed.
import { ANIM_CLIPS, type AnimClip, type BehaviorState } from '../../shared/cat';
import { CLIP_META } from '../../shared/animationCatalog';

/** Minimum time between drawn frames: 0 draws on every display frame. */
export const FULL_RATE_MS = 0;
export const CALM_FRAME_MS = 1000 / 30;
export const QUIET_FRAME_MS = 50;
/**
 * A deeply sleeping cat only breathes, very slowly (the animator's period is ~5.7 s): its quiet rate
 * falls from QUIET_FRAME_MS (sleepDepth 0) to this (sleepDepth 1). Kept under the animator's
 * 100 ms layer-dt cap so the slower frames never slow the breathing down.
 */
export const DEEP_QUIET_FRAME_MS = 90;
/** rAF timestamps jitter: a frame this close to its due time is drawn. */
export const FRAME_SLACK_MS = 4;
/** Full rate is kept this long after the last fast motion, so short pauses do not flip the rate. */
export const FAST_HOLD_MS = 300;
/**
 * Pose points (tail tip, head, near front paw) faster than this are fast motion, in
 * cat-local DIP/s at size 1. Calm sways and breathing stay below ~110 even at high
 * arousal; a lashing tail, a paw strike or a grooming wipe go well past it.
 */
export const FAST_POSE_DIP_S = 140;

/** Locomotion, airborne, held and other quick clips are always drawn at full rate. */
const CAT_FULL_RATE_CLIPS: readonly AnimClip[] = [
  'walk',
  'run',
  'crouch',
  'jump',
  'fall',
  'land',
  'startle',
  'annoyed',
  'pawAt',
  'held',
  'rollOver',
  // v1.2: gaits, airborne, strikes, hard landings and the spin.
  'stalk',
  'sprint',
  'slink',
  'pounce',
  'slip',
  'impact',
  'landRecover',
  'swat',
  'hiss',
  'tailChase',
  // Living Companion: the shake-off and the ~7.5 Hz scratch are too quick for the calm rate.
  'scratch',
  'shake',
];

/**
 * GizeMate performance clips that are not calm. A loop with a pendulum swing or a dance moves its body
 * faster than the calm rate shows, in place, so the pose-speed heuristic (tuned to the cat) can sit
 * either side of its threshold and flip the rate. 'float', 'scan' and 'peek' are slow loops and stay
 * calm (a ghost or alien that merely floats must not cost full rate forever).
 */
const LIVELY_LOOP_CLIPS: readonly AnimClip[] = ['swing', 'dance'];

/**
 * Derived from the catalogue so a character's clips need no hard-coded list: a looping clip that is
 * both locomotion and play (hop, bounce, stalk) and a non-interruptible one-shot of priority >= 2
 * (vanish, appear, squish, beam, plus the cat's startle/hiss/swat/shake/impact) change the pose faster
 * than 30 fps shows well. For the cat's own clips this adds nothing to CAT_FULL_RATE_CLIPS.
 */
function derivedFullRate(clip: AnimClip): boolean {
  const m = CLIP_META[clip];
  if (m.loop) return m.tags.includes('locomotion') && m.tags.includes('play');
  return !m.interruptible && m.priority >= 2;
}

const FULL_RATE_CLIPS: ReadonlySet<AnimClip> = new Set<AnimClip>([
  ...CAT_FULL_RATE_CLIPS,
  ...LIVELY_LOOP_CLIPS,
  ...ANIM_CLIPS.filter(derivedFullRate),
]);

/** Does this clip always draw at the full display rate? (exported for the pacing tests) */
export function isFullRateClip(clip: AnimClip): boolean {
  return FULL_RATE_CLIPS.has(clip);
}
const FULL_RATE_STATES: ReadonlySet<BehaviorState> = new Set<BehaviorState>(['held', 'jumping', 'falling', 'landing']);

export interface FrameMotion {
  clip: AnimClip;
  state: BehaviorState;
  /** Gait rate (body lengths/s) of the snapshot. */
  speed: number;
  /** Vertical velocity (DIP/s) of the snapshot. */
  vy: number;
  /** The anchor moved since the previous drawn frame (or will on this one). */
  moved: boolean;
  /** A clip cross-fade, a facing turn or a reaction (ear/tail flick, head tilt) is playing or about to. */
  transition: boolean;
  /** Fastest pose point, cat-local DIP/s at size 1. */
  poseSpeed: number;
  /** Asleep and still except for breathing. */
  quiet: boolean;
  /** Living Companion: 0..1 sleep depth of the snapshot; absent = 0 (today's quiet rate). */
  sleepDepth?: number;
}

/** The quiet frame interval for a sleep depth (0..1; anything else counts as 0). */
export function quietIntervalMs(sleepDepth: number | undefined): number {
  const d = sleepDepth !== undefined && Number.isFinite(sleepDepth) ? Math.min(1, Math.max(0, sleepDepth)) : 0;
  return QUIET_FRAME_MS + (DEEP_QUIET_FRAME_MS - QUIET_FRAME_MS) * d;
}

export function isFastMotion(m: FrameMotion): boolean {
  if (FULL_RATE_CLIPS.has(m.clip) || FULL_RATE_STATES.has(m.state)) return true;
  if (Math.abs(m.speed) > 0.01 || Math.abs(m.vy) > 1) return true;
  return m.moved || m.transition || m.poseSpeed >= FAST_POSE_DIP_S;
}

/** Minimum frame interval (ms) for the motion, given the time since motion was last fast. */
export function frameIntervalMs(m: FrameMotion, sinceFastMs: number): number {
  if (isFastMotion(m) || sinceFastMs < FAST_HOLD_MS) return FULL_RATE_MS;
  return m.quiet ? quietIntervalMs(m.sleepDepth) : CALM_FRAME_MS;
}

/**
 * Decides which display frames are drawn for a minimum interval. Keeps a steady cadence
 * (due times advance by the interval, so rAF jitter neither drifts nor halves the rate)
 * and restarts it after a pause.
 */
export class FramePacer {
  private due = Number.NEGATIVE_INFINITY;

  /** True when the frame at `now` should be drawn. */
  shouldDraw(now: number, intervalMs: number): boolean {
    const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
    if (interval > 0 && now < this.due - FRAME_SLACK_MS) return false;
    this.due = interval > 0 && now - this.due < interval ? this.due + interval : now + interval;
    return true;
  }

  reset(): void {
    this.due = Number.NEGATIVE_INFINITY;
  }
}
