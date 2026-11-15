// Ghost: the pose. One flat record of numbers that a clip sampler writes, the animator layers on top
// of and the rig turns into geometry. Every field is finite after sanitizePose; blendPose lerps all
// of them, so a cross-fade is just a lerp. Body frame: x right, y down, origin at the centre of the
// hem line, the top of the sheet at y = -BODY_H (see rig.ts).
export interface GhostPose {
  /** Translation of the body frame (character-local). The resting hover is offY = -HOVER. */
  offX: number;
  offY: number;
  /** Tilt (rad, + = clockwise) about (pivX, pivY) in the scaled body frame. */
  rot: number;
  pivX: number;
  pivY: number;
  /** Squash and stretch about the point (0, scaleCY). */
  sx: number;
  sy: number;
  scaleCY: number;
  /** The head's sideways lead over the hem (units): the sheet leans into a motion. */
  lean: number;
  /** Hem: wave height, sideways sway, wave rate multiplier, stretch downwards, billow upwards, width. */
  hemAmp: number;
  hemSway: number;
  hemRate: number;
  hemDrop: number;
  hemFlare: number;
  hemWide: number;
  /** Arms: angle from hanging down (0) through straight out (pi/2) to straight up (pi), and length. */
  armL: number;
  armR: number;
  armLen: number;
  /** Face. */
  eyeOpen: number;
  eyeSmile: number;
  eyeSize: number;
  lookX: number;
  lookY: number;
  /** How much the look-at layer may steer the eyes (0 for sleep, hide, dances). */
  lookW: number;
  mouthOpen: number;
  mouthSmile: number;
  mouthW: number;
  faceX: number;
  faceY: number;
  faceVis: number;
  cheek: number;
  /** Brows: +1 angry, -1 worried. */
  brow: number;
  /** Body opacity, pale glow halo, whitening flare, sleepy darkening, reveal (vanish/appear). */
  alpha: number;
  glow: number;
  flare: number;
  dim: number;
  vis: number;
  /** Twirl about the vertical axis (rad); the face turns away at the back. */
  spin: number;
  /** Sparkle burst intensity 0..1. */
  sparkle: number;
  /** Ground shadow size multiplier. */
  shadowK: number;
}

/** Resting hover height of the hem line above the ground (units). */
export const HOVER = 16;

export const POSE_DEFAULTS: Readonly<GhostPose> = Object.freeze({
  offX: 0,
  offY: -HOVER,
  rot: 0,
  pivX: 0,
  pivY: -30,
  sx: 1,
  sy: 1,
  scaleCY: -26,
  lean: 0,
  hemAmp: 2.2,
  hemSway: 1.3,
  hemRate: 1,
  hemDrop: 0,
  hemFlare: 0,
  hemWide: 1,
  armL: 0.4,
  armR: 0.4,
  armLen: 1,
  eyeOpen: 1,
  eyeSmile: 0,
  eyeSize: 1,
  lookX: 0,
  lookY: 0,
  lookW: 1,
  mouthOpen: 0,
  mouthSmile: 0.45,
  mouthW: 1,
  faceX: 0,
  faceY: 0,
  faceVis: 1,
  cheek: 0,
  brow: 0,
  alpha: 1,
  glow: 0,
  flare: 0,
  dim: 0,
  vis: 1,
  spin: 0,
  sparkle: 0,
  shadowK: 1,
});

export const POSE_KEYS = Object.keys(POSE_DEFAULTS) as Array<keyof GhostPose>;

export function createPose(): GhostPose {
  return { ...POSE_DEFAULTS };
}

export function resetPose(p: GhostPose): GhostPose {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    p[k] = POSE_DEFAULTS[k];
  }
  return p;
}

export function copyPose(out: GhostPose, a: GhostPose): GhostPose {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    out[k] = a[k];
  }
  return out;
}

/** out = a + (b - a) * t, field by field. */
export function blendPose(out: GhostPose, a: GhostPose, b: GhostPose, t: number): GhostPose {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Replaces any non-finite field by its default. */
export function sanitizePose(p: GhostPose): void {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    if (!Number.isFinite(p[k])) p[k] = POSE_DEFAULTS[k];
  }
}
