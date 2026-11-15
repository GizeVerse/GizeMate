// Monkey skeleton: a numeric Pose (what a clip authors), blending between poses, and the Rig that
// solves it into concrete geometry (spine, head frame, two-bone arms and legs, tail root, pose matrix).
// Pure maths, allocation-free after construction. Coordinates are character-local, facing right,
// ground at y = 0, up is negative y.
import { clamp, lerp } from '../../character/kit';

export const SPINE = 26;
export const NECK = 10.5;
export const UPPER_ARM = 15.5;
export const FORE_ARM = 16.5;
export const THIGH = 10.5;
export const SHIN = 10.5;
/** Centre height of a planted hand or foot above the ground line (y of its centre). */
export const GROUND = -3.4;
export const HEAD_RX = 14;
export const HEAD_RY = 13;

export const POSE_KEYS = [
  'hipX', 'hipY', 'lean', 'spineK', 'neckBend', 'headDX', 'headDY', 'headRot', 'turn',
  'eyeOpen', 'brow', 'mouth', 'smile', 'pupilX', 'pupilY', 'earPerk', 'chest',
  'handNx', 'handNy', 'handFx', 'handFy', 'gripN', 'gripF', 'bendN', 'bendF',
  'footNx', 'footNy', 'footFx', 'footFy', 'legBend',
  'tailBase', 'tailCurl', 'tailBend', 'tailStiff', 'tailPuff',
  'rot', 'pivX', 'pivY', 'sx', 'sy', 'offX', 'offY', 'shadow', 'lookW',
] as const;
export type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;

export function createPose(): Pose {
  const p = {} as Pose;
  for (const k of POSE_KEYS) p[k] = 0;
  resetPose(p);
  return p;
}

export function resetPose(p: Pose): void {
  for (const k of POSE_KEYS) p[k] = 0;
  p.hipX = -5;
  p.hipY = -22;
  p.lean = 0.42;
  p.spineK = 1;
  p.neckBend = -0.32;
  p.headRot = 0.05;
  p.turn = 0.55;
  p.eyeOpen = 1;
  p.smile = 0.3;
  p.chest = 1;
  p.handNx = 9;
  p.handNy = -14;
  p.handFx = -3;
  p.handFy = -15;
  p.bendN = 1;
  p.bendF = 1;
  p.footNx = 2;
  p.footNy = GROUND;
  p.footFx = -9;
  p.footFy = GROUND;
  p.legBend = -1;
  p.tailBase = 0.35;
  p.tailCurl = 3.2;
  p.tailBend = 0;
  p.tailStiff = 0.35;
  p.sx = 1;
  p.sy = 1;
  p.shadow = 1;
  p.lookW = 0.5;
}

export function copyPose(to: Pose, from: Pose): void {
  for (const k of POSE_KEYS) to[k] = from[k];
}

const wrapPi = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** out = a + (b - a) * t (the body rotation takes the short way round). */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  for (const key of POSE_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  out.rot = a.rot + wrapPi(b.rot - a.rot) * k;
}

/** Index of the pose keys used by tests and the animator for finiteness checks. */
export function poseFinite(p: Pose): boolean {
  for (const k of POSE_KEYS) if (!Number.isFinite(p[k])) return false;
  return true;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

const newEllipse = (): Ellipse => ({ cx: 0, cy: 0, rx: 1, ry: 1, rot: 0 });

export class Rig {
  /** Pose matrix [a b c d e f]: pose space -> character-local view space. */
  readonly m = new Float64Array([1, 0, 0, 1, 0, 0]);
  hipX = 0;
  hipY = 0;
  chestX = 0;
  chestY = 0;
  /** Spine direction (towards the head) and belly direction. */
  ux = 0;
  uy = -1;
  fx = 1;
  fy = 0;
  readonly pelvis = newEllipse();
  readonly chestE = newEllipse();
  readonly belly = newEllipse();
  headX = 0;
  headY = 0;
  headRot = 0;
  /** Arm joints: shoulder, elbow, hand (near = 0, far = 1). */
  readonly sh = new Float64Array(4);
  readonly el = new Float64Array(4);
  readonly hand = new Float64Array(4);
  readonly hip = new Float64Array(4);
  readonly knee = new Float64Array(4);
  readonly foot = new Float64Array(4);
  tailRootX = 0;
  tailRootY = 0;
  /** Neck base (collar) for the pendant. */
  neckX = 0;
  neckY = 0;
  /** Where the body's centre sits on the ground (shadow). */
  bodyX = 0;

  solve(p: Pose): void {
    const L = SPINE * clamp(p.spineK, 0.6, 1.4);
    const lean = p.lean;
    const ux = Math.sin(lean);
    const uy = -Math.cos(lean);
    const fx = Math.cos(lean);
    const fy = Math.sin(lean);
    this.ux = ux;
    this.uy = uy;
    this.fx = fx;
    this.fy = fy;
    this.hipX = p.hipX;
    this.hipY = p.hipY;
    this.chestX = p.hipX + ux * L;
    this.chestY = p.hipY + uy * L;
    const ang = lean - Math.PI / 2;
    const ck = clamp(p.chest, 0.7, 1.5);
    const pe = this.pelvis;
    pe.cx = p.hipX + ux * 2.5;
    pe.cy = p.hipY + uy * 2.5;
    pe.rx = 11;
    pe.ry = 10.2;
    pe.rot = ang;
    const ce = this.chestE;
    ce.cx = this.chestX - ux * 4.5 + fx * 0.8;
    ce.cy = this.chestY - uy * 4.5 + fy * 0.8;
    ce.rx = 13 * ck;
    ce.ry = 11.4 * ck;
    ce.rot = ang;
    const be = this.belly;
    be.cx = (p.hipX + this.chestX) / 2 + fx * 4.4;
    be.cy = (p.hipY + this.chestY) / 2 + fy * 4.4;
    be.rx = L / 2 + 4;
    be.ry = 6.4 * ck;
    be.rot = ang;

    // Head.
    const ha = lean + p.neckBend;
    this.headX = this.chestX + Math.sin(ha) * NECK + p.headDX;
    this.headY = this.chestY - Math.cos(ha) * NECK + p.headDY;
    this.headRot = p.headRot;
    this.neckX = this.chestX + ux * 1.5;
    this.neckY = this.chestY + uy * 1.5;

    // Shoulders and hips.
    this.sh[0] = this.chestX - ux * 4 + fx * 1.8;
    this.sh[1] = this.chestY - uy * 4 + fy * 1.8;
    this.sh[2] = this.chestX - ux * 4.5 - fx * 3;
    this.sh[3] = this.chestY - uy * 4.5 - fy * 3;
    this.hip[0] = p.hipX + fx * 2.5 + ux * 1.5;
    this.hip[1] = p.hipY + fy * 2.5 + uy * 1.5;
    this.hip[2] = p.hipX - fx * 2.5 + ux * 2;
    this.hip[3] = p.hipY - fy * 2.5 + uy * 2;

    ik(this.sh[0], this.sh[1], p.handNx, p.handNy, UPPER_ARM, FORE_ARM, p.bendN, this.el, this.hand, 0);
    ik(this.sh[2], this.sh[3], p.handFx, p.handFy, UPPER_ARM, FORE_ARM, p.bendF, this.el, this.hand, 2);
    ik(this.hip[0], this.hip[1], p.footNx, p.footNy, THIGH, SHIN, p.legBend, this.knee, this.foot, 0);
    ik(this.hip[2], this.hip[3], p.footFx, p.footFy, THIGH, SHIN, p.legBend, this.knee, this.foot, 2);

    this.tailRootX = p.hipX - fx * 8.5 + ux * 1;
    this.tailRootY = p.hipY - fy * 8.5 + uy * 1;
    this.bodyX = (p.hipX + this.chestX) / 2;

    // Pose matrix: scale then rotate about the pivot.
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const sx = clamp(p.sx, 0.3, 2);
    const sy = clamp(p.sy, 0.3, 2);
    const m = this.m;
    m[0] = c * sx;
    m[1] = s * sx;
    m[2] = -s * sy;
    m[3] = c * sy;
    m[4] = p.pivX - (m[0] * p.pivX + m[2] * p.pivY) + p.offX;
    m[5] = p.pivY - (m[1] * p.pivX + m[3] * p.pivY) + p.offY;
  }
}

/** Two-bone IK with a rubber-hose stretch; writes the middle joint and the end into the arrays at `o`. */
function ik(sx: number, sy: number, tx: number, ty: number, a: number, b: number, bend: number, mid: Float64Array, end: Float64Array, o: number): void {
  let dx = tx - sx;
  let dy = ty - sy;
  let d = Math.hypot(dx, dy);
  if (!(d > 1e-6)) {
    dx = 0;
    dy = 1;
    d = 1e-6;
  }
  const reach = a + b;
  const stretch = d > reach ? Math.min(d / reach, 1.14) : 1;
  const A = a * stretch;
  const B = b * stretch;
  const dd = Math.min(d, A + B - 1e-6);
  const nx = dx / d;
  const ny = dy / d;
  const along = (dd * dd + A * A - B * B) / (2 * dd);
  const h = Math.sqrt(Math.max(0, A * A - along * along));
  const sgn = bend < 0 ? -1 : 1;
  const k = Math.min(1, Math.abs(bend));
  mid[o] = sx + nx * along - ny * h * sgn * Math.max(0.35, k);
  mid[o + 1] = sy + ny * along + nx * h * sgn * Math.max(0.35, k);
  end[o] = sx + nx * dd;
  end[o + 1] = sy + ny * dd;
}

export { lerp };
