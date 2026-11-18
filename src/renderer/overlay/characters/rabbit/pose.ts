// Rabbit pose: the parametric description of one frame. Local DIP at scale 1, facing right (+x),
// y down, the ground anchor at (0, 0). Angles in radians. Clips author these numbers, the animator
// layers breathing/blinks/ears on top, rig.ts turns them into geometry and draw.ts paints it.

export const POSE_KEYS = [
  // Global: offset, squash about the ground anchor, rotation (+ = clockwise on screen) about a pivot.
  'offX',
  'offY',
  'sqX',
  'sqY',
  'rot',
  'pivX',
  'pivY',
  // Torso: centre, radii, tilt (+ = front up, counter-clockwise on screen), haunch size multiplier.
  'bodyX',
  'bodyY',
  'bodyRX',
  'bodyRY',
  'tilt',
  'haunch',
  // Head: centre, rotation (+ = look up), turn (-1 looks away .. 1 faces the viewer), head scale.
  'headX',
  'headY',
  'headRot',
  'turn',
  // Ears: near (N) and far (F) angle from straight up (+ = leaning back, > 1.4 = drooping), bend of the
  // tip (+ = backwards), and a length scale (small = foreshortened, flopped towards the viewer).
  'eNA',
  'eNB',
  'eNL',
  'eFA',
  'eFB',
  'eFL',
  // Face: eye open 0..1, happy-closed arch 0..1, pupil offset, mouth open 0..1, chew phase offset,
  // whisker lift, blush 0..1, nose twitch amplitude 0..1.
  'eyeOpen',
  'eyeHappy',
  'pupilX',
  'pupilY',
  'mouth',
  'whisker',
  'blush',
  'noseAmp',
  // Legs: foot targets in local space. Front near/far paws; hind near/far foot centres and the
  // foot angle (+ = toes down, clockwise).
  'fnX',
  'fnY',
  'ffX',
  'ffY',
  'hnX',
  'hnY',
  'hnA',
  'hfX',
  'hfY',
  'hfA',
  // Cotton tail: lift above its rest spot, size multiplier.
  'tailLift',
  'tailS',
  // Procedural layer controls: breathing amount, lid factor (0 shut), ground shadow strength.
  'breath',
  'blinkOK',
  'shadow',
  // Burrow vanish/appear: body opacity 0..1 and the ground clip (> 0.5 hides everything below the ground line, so the body sinks into the earth).
  'alpha',
  'burrow',
] as const;

export type PoseKey = (typeof POSE_KEYS)[number];
export type RPose = Record<PoseKey, number>;

const BASE: RPose = {
  offX: 0,
  offY: 0,
  sqX: 1,
  sqY: 1,
  rot: 0,
  pivX: 0,
  pivY: -20,
  bodyX: -3,
  bodyY: -22,
  bodyRX: 20,
  bodyRY: 15.5,
  tilt: 0.14,
  haunch: 1,
  headX: 19,
  headY: -34,
  headRot: 0.05,
  turn: 0,
  eNA: 0.3,
  eNB: 0.16,
  eNL: 1,
  eFA: 0.0,
  eFB: 0.1,
  eFL: 1,
  eyeOpen: 1,
  eyeHappy: 0,
  pupilX: 0.1,
  pupilY: 0,
  mouth: 0,
  whisker: 0,
  blush: 0.25,
  noseAmp: 0.5,
  fnX: 13,
  fnY: -0.5,
  ffX: 8.5,
  ffY: -0.5,
  hnX: -3,
  hnY: -3.8,
  hnA: 0,
  hfX: -8,
  hfY: -3.8,
  hfA: 0,
  tailLift: 0,
  tailS: 1,
  breath: 1,
  blinkOK: 1,
  shadow: 1,
  alpha: 1,
  burrow: 0,
};

export function createPose(): RPose {
  return { ...BASE };
}

export function resetPose(out: RPose): RPose {
  for (const k of POSE_KEYS) out[k] = BASE[k];
  return out;
}

export function copyPose(out: RPose, src: RPose): RPose {
  for (const k of POSE_KEYS) out[k] = src[k];
  return out;
}

/** out = a + (b - a) * t for every key; `out` may alias `a` or `b`. */
export function blendPose(out: RPose, a: RPose, b: RPose, t: number): RPose {
  for (const k of POSE_KEYS) {
    const av = a[k];
    out[k] = av + (b[k] - av) * t;
  }
  return out;
}

export function isPoseFinite(p: RPose): boolean {
  for (const k of POSE_KEYS) if (!Number.isFinite(p[k])) return false;
  return true;
}

/** Replaces non-finite keys with the neutral value; returns how many were fixed. */
export function sanitizePose(p: RPose): number {
  let fixed = 0;
  for (const k of POSE_KEYS) {
    if (!Number.isFinite(p[k])) {
      p[k] = BASE[k];
      fixed++;
    }
  }
  return fixed;
}

export const NEUTRAL: Readonly<RPose> = BASE;
