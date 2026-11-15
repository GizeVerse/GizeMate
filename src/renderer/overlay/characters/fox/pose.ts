// The fox's parametric pose. All lengths are character-local DIP at scale 1, facing right (+x), y down,
// the ground anchor at (0, 0). Angles are radians; "+" is counter-clockwise on screen (nose up) unless noted.

export const POSE_KEYS = [
  // Global transform: offset, squash about the ground anchor, rotation about a pivot, roll (y-scale, a
  // belly-up roll) and turn (x-scale, a spin about the vertical axis).
  'offX',
  'offY',
  'sqX',
  'sqY',
  'rot',
  'pivX',
  'pivY',
  'rollY',
  'turnX',
  // Torso: centre, length/height multipliers, tilt (+ = front up), back arch -0.5..1, curl 0..1 (sleep), haunch 0..1 (sitting thigh).
  'bodyX',
  'bodyY',
  'bodyLen',
  'bodyH',
  'tilt',
  'arch',
  'curl',
  'haunch',
  // Head centre, rotation (+ = nose up), head flip (y-scale of the head alone: keeps it upright when the body rolls).
  'headX',
  'headY',
  'headRot',
  'headFlip',
  // Ears: near (N) and far (F): rotation (+ = backwards, - = forwards) and flatness 0..1.
  'earNR',
  'earFR',
  'earNF',
  'earFF',
  // Eyes: open 0..1, squint 0..1, happy-closed arc 0..1, pupil offset -1..1 (set by the look-at layer).
  'eyeOpen',
  'eyeSquint',
  'eyeHappy',
  'pupilX',
  'pupilY',
  // Mouth open 0..1, tongue 0..1.
  'mouthOpen',
  'tongue',
  // Feet targets (character-local) and paw axis angle (canvas radians, 0 = toes forward, + = toes down).
  // fn = front near, ff = front far, bn = hind near, bf = hind far.
  'fnX',
  'fnY',
  'fnPaw',
  'ffX',
  'ffY',
  'ffPaw',
  'bnX',
  'bnY',
  'bnPaw',
  'bfX',
  'bfY',
  'bfPaw',
  // Tail: base angle (0 = straight back, + = up), curl (+ = curls forward over the top), where the curl
  // happens (0 = towards the tip, 1 = near the base), puff 0..1, drawn in front of the body 0..1, stiffness 0..1.
  'tailBase',
  'tailCurl',
  'tailBend',
  'tailPuff',
  'tailFront',
  'tailStiff',
  // Layer controls.
  'lookW',
  'breath',
  'blinkOK',
  'shadow',
  'blush',
] as const;

export type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;

export const LEG_COUNT = 4;
export const LEG_FN = 0;
export const LEG_FF = 1;
export const LEG_BN = 2;
export const LEG_BF = 3;

export const LEG_POSE_KEYS: readonly (readonly [PoseKey, PoseKey, PoseKey])[] = [
  ['fnX', 'fnY', 'fnPaw'],
  ['ffX', 'ffY', 'ffPaw'],
  ['bnX', 'bnY', 'bnPaw'],
  ['bfX', 'bfY', 'bfPaw'],
];

/** Neutral standing pose. Clips start from this and override what they need. */
const BASE: Pose = {
  offX: 0,
  offY: 0,
  sqX: 1,
  sqY: 1,
  rot: 0,
  pivX: 0,
  pivY: -22,
  rollY: 1,
  turnX: 1,
  bodyX: -3,
  bodyY: -28.5,
  bodyLen: 1,
  bodyH: 1,
  tilt: 0,
  arch: 0,
  curl: 0,
  haunch: 0,
  headX: 26,
  headY: -40.5,
  headRot: 0,
  headFlip: 1,
  earNR: 0,
  earFR: 0,
  earNF: 0,
  earFF: 0,
  eyeOpen: 1,
  eyeSquint: 0,
  eyeHappy: 0,
  pupilX: 0.2,
  pupilY: 0,
  mouthOpen: 0,
  tongue: 0,
  fnX: 11,
  fnY: 0,
  fnPaw: 0,
  ffX: 6.5,
  ffY: 0,
  ffPaw: 0,
  bnX: -18.5,
  bnY: 0,
  bnPaw: 0,
  bfX: -23,
  bfY: 0,
  bfPaw: 0,
  tailBase: 0.12,
  tailCurl: -0.45,
  tailBend: 0.4,
  tailPuff: 0,
  tailFront: 0,
  tailStiff: 0.5,
  lookW: 1,
  breath: 1,
  blinkOK: 1,
  shadow: 1,
  blush: 0,
};

export const createPose = (): Pose => ({ ...BASE });

export function resetPose(out: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = BASE[k];
  return out;
}

export function copyPose(out: Pose, src: Pose): Pose {
  for (const k of POSE_KEYS) out[k] = src[k];
  return out;
}

/** out = a + (b - a) * t for every key. `out` may alias `a` or `b`. */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  for (const k of POSE_KEYS) {
    const av = a[k];
    out[k] = av + (b[k] - av) * t;
  }
  return out;
}

export function isPoseFinite(p: Pose): boolean {
  for (const k of POSE_KEYS) if (!Number.isFinite(p[k])) return false;
  return true;
}

/** Replaces non-finite keys with the neutral value; returns how many were fixed. */
export function sanitizePose(p: Pose): number {
  let fixed = 0;
  for (const k of POSE_KEYS) {
    if (!Number.isFinite(p[k])) {
      p[k] = BASE[k];
      fixed++;
    }
  }
  return fixed;
}

export function setFoot(p: Pose, leg: number, x: number, y: number, paw: number): void {
  const keys = LEG_POSE_KEYS[leg];
  if (!keys) return;
  p[keys[0]] = x;
  p[keys[1]] = y;
  p[keys[2]] = paw;
}
