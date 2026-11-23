// The fox skeleton solver: turns a Pose into concrete geometry (torso outline, two-bone leg IK, haunch,
// neck, head frame, tail root and the global pose matrix). Pure maths, no per-frame allocation.
import { clamp, lerp, type Mat } from '../../character/kit';
import { LEG_COUNT, LEG_POSE_KEYS, type Pose } from './pose';

export const TORSO_L = 21.5;
export const TORSO_T = 7.8;
export const MAX_LEG_STRETCH = 1.14;

export interface LegSpec {
  /** Root position in torso units (u along the body, v towards the belly). */
  u: number;
  v: number;
  upper: number;
  lower: number;
  /** Stroke widths of the upper and lower segment. */
  w1: number;
  w2: number;
  front: boolean;
  far: boolean;
}

export const LEG_SPECS: readonly LegSpec[] = [
  { u: 0.62, v: 0.42, upper: 12, lower: 13, w1: 5.8, w2: 4.5, front: true, far: false },
  { u: 0.5, v: 0.36, upper: 12, lower: 13, w1: 5.4, w2: 4.3, front: true, far: true },
  { u: -0.6, v: 0.42, upper: 12, lower: 13, w1: 6.6, w2: 4.6, front: false, far: false },
  { u: -0.72, v: 0.34, upper: 12, lower: 13, w1: 6, w2: 4.4, front: false, far: true },
];

/** Paw ellipse radii. */
export const PAW_RX = 4.4;
export const PAW_RY = 2.6;

// Torso outline control points: [u, v, archDv, curlDu, curlDv] in torso units.
const TORSO_SHAPE: readonly (readonly [number, number, number, number, number])[] = [
  [-1.04, -0.3, 0, 0.12, -0.1], // rump
  [-0.78, -0.9, -0.2, 0.08, -0.14], // rump top
  [-0.3, -0.84, -0.7, 0.04, -0.14], // loin
  [0.2, -0.92, -0.9, 0, -0.1], // withers
  [0.74, -0.98, -0.45, -0.06, -0.04], // shoulder top
  [1.04, -0.45, 0, -0.1, 0.04], // chest upper
  [1.06, 0.3, 0, -0.12, 0.1], // chest front
  [0.7, 0.98, -0.1, -0.06, 0.14], // chest bottom
  [0.15, 0.74, -0.55, -0.02, 0.1], // belly (tucked up)
  [-0.4, 0.66, -0.45, 0.04, 0.1], // belly rear
  [-0.88, 0.62, -0.1, 0.08, 0.14], // thigh bottom
  [-1.08, 0.12, 0, 0.12, 0.04], // rear
];
export const TORSO_POINTS = TORSO_SHAPE.length;

export interface LegGeom {
  rx: number;
  ry: number;
  kx: number;
  ky: number;
  fx: number;
  fy: number;
  paw: number;
  a: number;
  b: number;
}

export class Rig {
  readonly torso = new Float64Array(TORSO_POINTS * 2);
  readonly legs: LegGeom[] = [];
  /** Global pose matrix (character-local -> posed space). */
  readonly m: Mat = new Float64Array([1, 0, 0, 1, 0, 0]);

  cos = 1;
  sin = 0;
  L = TORSO_L;
  T = TORSO_T;
  bodyX = 0;
  bodyY = 0;

  hx = 0;
  hy = 0;
  hrx = 0;
  hry = 0;
  hrot = 0;

  nx0 = 0;
  ny0 = 0;
  nx1 = 0;
  ny1 = 0;
  neckW = 10;

  headX = 0;
  headY = 0;
  headRot = 0;
  headFlip = 1;

  tailRootX = 0;
  tailRootY = 0;

  constructor() {
    for (let i = 0; i < LEG_COUNT; i++) this.legs.push({ rx: 0, ry: 0, kx: 0, ky: 0, fx: 0, fy: 0, paw: 0, a: 0, b: 0 });
  }

  tx(u: number, v: number): number {
    return this.bodyX + u * this.L * this.cos + v * this.T * this.sin;
  }
  ty(u: number, v: number): number {
    return this.bodyY - u * this.L * this.sin + v * this.T * this.cos;
  }

  solve(p: Pose): void {
    const curl = clamp(p.curl, 0, 1);
    const arch = clamp(p.arch, -0.6, 1.3);
    this.cos = Math.cos(p.tilt);
    this.sin = Math.sin(p.tilt);
    this.L = TORSO_L * clamp(p.bodyLen, 0.5, 1.6) * (1 - 0.2 * curl);
    this.T = TORSO_T * clamp(p.bodyH, 0.5, 1.9) * (1 + 0.62 * curl);
    this.bodyX = p.bodyX;
    this.bodyY = p.bodyY;

    for (let i = 0; i < TORSO_POINTS; i++) {
      const s = TORSO_SHAPE[i]!;
      const u = s[0] + s[3] * curl;
      let v = s[1] + s[2] * arch * 0.9 + s[4] * curl;
      if (v > 0) v *= 1 - 0.2 * curl;
      this.torso[i * 2] = this.tx(u, v);
      this.torso[i * 2 + 1] = this.ty(u, v);
    }

    const h = clamp(p.haunch, 0, 1);
    this.hx = this.tx(lerp(-0.52, -0.48, h), lerp(0.2, 0.22, h));
    this.hy = this.ty(lerp(-0.52, -0.48, h), lerp(0.2, 0.22, h));
    this.hrx = this.L * lerp(0.4, 0.48, h);
    this.hry = this.T * lerp(0.78, 1.04, h);
    this.hrot = -p.tilt * lerp(1, 0.3, h) - lerp(0.2, 0.1, h);

    for (let i = 0; i < LEG_COUNT; i++) {
      const spec = LEG_SPECS[i]!;
      const keys = LEG_POSE_KEYS[i]!;
      const g = this.legs[i]!;
      let ru = spec.u;
      let rv = spec.v;
      if (!spec.front) {
        ru = lerp(spec.u, spec.u + 0.1, h);
        rv = lerp(spec.v, spec.v + 0.12, h);
      }
      solveLeg(g, this.tx(ru, rv), this.ty(ru, rv), p[keys[0]], p[keys[1]], spec.upper, spec.lower);
      g.paw = p[keys[2]];
    }

    this.headX = p.headX;
    this.headY = p.headY;
    this.headRot = p.headRot;
    this.headFlip = p.headFlip;

    // Neck: from the shoulder top towards the head so head and body never detach.
    this.nx0 = this.tx(0.66, -0.3);
    this.ny0 = this.ty(0.66, -0.3);
    const dx = p.headX - this.nx0;
    const dy = p.headY - this.ny0;
    const len = Math.hypot(dx, dy);
    const k = len > 1e-6 ? Math.max(0, len - 4) / len : 0;
    this.nx1 = this.nx0 + dx * k;
    this.ny1 = this.ny0 + dy * k;
    this.neckW = 10.5 + 3 * curl;

    const tv = lerp(-0.25, 0.35, clamp(p.tailFront, 0, 1));
    this.tailRootX = this.tx(-0.98, tv);
    this.tailRootY = this.ty(-0.98, tv);

    computePoseMatrix(this.m, p);
  }
}

/** Two-bone IK. The middle joint bends towards the back (-x) for downward legs. */
export function solveLeg(g: LegGeom, rx: number, ry: number, tx: number, ty: number, upper: number, lower: number): void {
  g.rx = rx;
  g.ry = ry;
  let dx = tx - rx;
  let dy = ty - ry;
  let d = Math.hypot(dx, dy);
  if (!(d > 1e-6) || !Number.isFinite(d)) {
    dx = 0;
    dy = 1;
    d = 1e-6;
  }
  const reach = upper + lower;
  const stretch = d > reach * 0.995 ? Math.min(d / (reach * 0.995), MAX_LEG_STRETCH) : 1;
  const a = upper * stretch;
  const b = lower * stretch;
  const dc = clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.995);
  const base = Math.atan2(dy, dx);
  const cosA = clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1);
  const ka = base + Math.acos(cosA);
  g.kx = rx + a * Math.cos(ka);
  g.ky = ry + a * Math.sin(ka);
  const fa = Math.atan2(ty - g.ky, tx - g.kx);
  g.fx = g.kx + b * Math.cos(fa);
  g.fy = g.ky + b * Math.sin(fa);
  g.a = a;
  g.b = b;
}

/** Global pose matrix: turn, roll and rotation about the pivot, then squash about the ground anchor, then offset. */
export function computePoseMatrix(m: Mat, p: Pose): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const ry = clamp(p.rollY, -1, 1);
  const rx = clamp(p.turnX, -1, 1);
  const sx = clamp(p.sqX, 0.3, 2);
  const sy = clamp(p.sqY, 0.3, 2);
  const px = p.pivX;
  const py = p.pivY;
  m[0] = sx * c * rx;
  m[1] = -sy * s * rx;
  m[2] = sx * s * ry;
  m[3] = sy * c * ry;
  m[4] = sx * (px - c * rx * px - s * ry * py) + p.offX;
  m[5] = sy * (py + s * rx * px - c * ry * py) + p.offY;
}

/** Torso point for clip authoring (same frame as Rig.solve), without a Rig instance. */
export function torsoPointX(p: Pose, u: number, v: number): number {
  const L = TORSO_L * clamp(p.bodyLen, 0.5, 1.6) * (1 - 0.2 * clamp(p.curl, 0, 1));
  const T = TORSO_T * clamp(p.bodyH, 0.5, 1.9) * (1 + 0.62 * clamp(p.curl, 0, 1));
  return p.bodyX + u * L * Math.cos(p.tilt) + v * T * Math.sin(p.tilt);
}
export function torsoPointY(p: Pose, u: number, v: number): number {
  const L = TORSO_L * clamp(p.bodyLen, 0.5, 1.6) * (1 - 0.2 * clamp(p.curl, 0, 1));
  const T = TORSO_T * clamp(p.bodyH, 0.5, 1.9) * (1 + 0.62 * clamp(p.curl, 0, 1));
  return p.bodyY - u * L * Math.sin(p.tilt) + v * T * Math.cos(p.tilt);
}
