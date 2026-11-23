// The alien's pose: a flat bag of numeric channels that every clip writes and the animator blends.
// Coordinates and angles are described at the channel level; the rig turns them into geometry.
// Body-local frame: x forward (+), y down (+), origin at the feet line of the upright body, ground
// at y = hover below it.
export interface Pose {
  /** Levitation height of the feet above the ground (DIP). */
  hover: number;
  offX: number;
  /** Vertical offset (+ = lower). */
  offY: number;
  /** Whole-body rotation (rad, + clockwise) about the pivot. */
  rot: number;
  sx: number;
  sy: number;
  /** 0 = pivot at the body centre, 1 = pivot at the grip point (held). */
  pivScruff: number;
  /** Lowering of the hips relative to the feet (folded legs). */
  hipDrop: number;
  /** Upper body lean about the hips (rad, + forward). */
  lean: number;
  headRot: number;
  headX: number;
  headY: number;
  /** Face turn -1 (looking back) .. 1 (looking forward). */
  turn: number;
  /** Look weight: how much the look-at layer steers head and eyes. */
  lookW: number;
  eye: number;
  happy: number;
  eyeSize: number;
  slant: number;
  mouth: number;
  smile: number;
  antL: number;
  antR: number;
  antBend: number;
  antDroop: number;
  antSpike: number;
  glow: number;
  armLa: number;
  armLb: number;
  armRa: number;
  armRb: number;
  legLa: number;
  legLb: number;
  legRa: number;
  legRb: number;
  /** Ground shadow strength multiplier. */
  shadow: number;
  /** 1 = arms are drawn behind the body (raised overhead), 0 = in front. */
  armsBack: number;
  /** Idle bob amplitude (DIP) and rate (rad/s). */
  bob: number;
  bobHz: number;
  /** Scan line sweep: < 0 off, 0..1 phase; scanPan lets the head follow it. */
  scan: number;
  /** Beam pulse progress: < 0 off, 0..1. */
  beam: number;
  /** Teleport dissolve 0..1 (0 solid) and direction (+1 vanishing, -1 appearing). */
  shim: number;
  shimDir: number;
  alpha: number;
}

export type PoseKey = keyof Pose;

export const POSE_KEYS: readonly PoseKey[] = [
  'hover', 'offX', 'offY', 'rot', 'sx', 'sy', 'pivScruff', 'hipDrop', 'lean', 'headRot', 'headX', 'headY', 'turn', 'lookW', 'eye', 'happy', 'eyeSize', 'slant', 'mouth', 'smile', 'antL', 'antR', 'antBend', 'antDroop', 'antSpike', 'glow', 'armLa', 'armLb', 'armRa', 'armRb', 'legLa', 'legLb', 'legRa', 'legRb', 'shadow', 'armsBack', 'bob', 'bobHz', 'scan', 'beam', 'shim', 'shimDir', 'alpha',
];

export function createPose(): Pose {
  const p = {} as Pose;
  resetPose(p);
  return p;
}

/** The neutral upright levitating pose; every clip starts from it. */
export function resetPose(p: Pose): void {
  p.hover = 7;
  p.offX = 0;
  p.offY = 0;
  p.rot = 0;
  p.sx = 1;
  p.sy = 1;
  p.pivScruff = 0;
  p.hipDrop = 0;
  p.lean = 0;
  p.headRot = 0;
  p.headX = 0;
  p.headY = 0;
  p.turn = 0;
  p.lookW = 1;
  p.eye = 1;
  p.happy = 0;
  p.eyeSize = 1;
  p.slant = 0;
  p.mouth = 0;
  p.smile = 0.15;
  p.antL = 0;
  p.antR = 0;
  p.antBend = 0;
  p.antDroop = 0;
  p.antSpike = 0;
  p.glow = 0.55;
  p.armLa = -0.2;
  p.armLb = -0.12;
  p.armRa = 0.2;
  p.armRb = 0.12;
  p.legLa = -0.08;
  p.legLb = 0.1;
  p.legRa = 0.08;
  p.legRb = -0.1;
  p.shadow = 1;
  p.armsBack = 0;
  p.bob = 1.6;
  p.bobHz = 3.4;
  p.scan = -1;
  p.beam = -1;
  p.shim = 0;
  p.shimDir = 1;
  p.alpha = 1;
}

export function copyPose(dst: Pose, src: Pose): void {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    dst[k] = src[k];
  }
}

/** dst = a + (b - a) * t. Effect channels (scan, beam) switch rather than blend. */
export function blendPose(dst: Pose, a: Pose, b: Pose, t: number): void {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    dst[k] = a[k] + (b[k] - a[k]) * t;
  }
  dst.scan = t >= 0.5 ? b.scan : a.scan;
  dst.beam = t >= 0.5 ? b.beam : a.beam;
  dst.shimDir = t >= 0.5 ? b.shimDir : a.shimDir;
}

const LIMITS: Readonly<Partial<Record<PoseKey, readonly [number, number]>>> = {
  hover: [-4, 40],
  offX: [-30, 30],
  offY: [-40, 40],
  rot: [-7, 7],
  sx: [0.2, 1.8],
  sy: [0.3, 1.8],
  hipDrop: [-4, 14],
  lean: [-1.2, 1.2],
  headRot: [-1, 1],
  headX: [-12, 12],
  headY: [-12, 12],
  turn: [-1.2, 1.2],
  lookW: [0, 1],
  eye: [0, 1.2],
  happy: [0, 1],
  eyeSize: [0.5, 1.5],
  slant: [-0.6, 0.8],
  mouth: [0, 1],
  smile: [-1, 1],
  antL: [-2.5, 2.5],
  antR: [-2.5, 2.5],
  antBend: [-1.5, 1.5],
  antDroop: [0, 1],
  antSpike: [0, 1],
  glow: [0, 1],
  armLa: [-3.4, 3.4],
  armLb: [-3.4, 3.4],
  armRa: [-3.4, 3.4],
  armRb: [-3.4, 3.4],
  legLa: [-3, 3],
  legLb: [-3, 3],
  legRa: [-3, 3],
  legRb: [-3, 3],
  shadow: [0, 1.5],
  armsBack: [0, 1],
  bob: [0, 6],
  bobHz: [0, 12],
  shim: [0, 1],
  alpha: [0, 1],
};

/** Replaces non-finite channels with the neutral value and clamps every channel to a sane range. */
export function sanitizePose(p: Pose, neutral: Pose): void {
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i]!;
    let v = p[k];
    if (!Number.isFinite(v)) v = neutral[k];
    const lim = LIMITS[k];
    if (lim) v = v < lim[0] ? lim[0] : v > lim[1] ? lim[1] : v;
    p[k] = v;
  }
}
