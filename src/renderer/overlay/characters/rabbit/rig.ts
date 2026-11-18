// Rabbit rig: turns an RPose into concrete geometry (body and haunch ovals, head outline, ear
// polygons, two-bone front legs, hind feet, tail, face anchors and the global pose matrix). Pure
// math, no allocation per frame (every array is allocated once per rig).
import { clamp } from '../../character/kit';
import type { RPose } from './pose';

export type Mat = Float64Array;
export const applyX = (m: Mat, x: number, y: number): number => m[0]! * x + m[2]! * y + m[4]!;
export const applyY = (m: Mat, x: number, y: number): number => m[1]! * x + m[3]! * y + m[5]!;

/** Head outline in head-local DIP (facing right), closed Catmull-Rom. */
export const HEAD_SHAPE = new Float64Array([-12.8, -1, -10.8, -8.4, -4.2, -12, 4, -11.8, 10, -8.8, 14.6, -4, 16, 1.2, 13, 6.6, 7, 10.4, -0.5, 12, -7.5, 10.4, -11.8, 5.8]);
export const HEAD_N = HEAD_SHAPE.length / 2;
export const HEAD_RX = 14;
export const HEAD_RY = 12;

export const EAR_BASE_LEN = 27;
export const EAR_SAMPLES = 6;
export const EAR_POLY = EAR_SAMPLES * 4; // numbers per polygon (2 sides x samples x xy)
const EAR_W = [4.4, 5.7, 6.1, 5.7, 4.4, 0.9] as const;

export const FRONT_UPPER = 10;
export const FRONT_LOWER = 10;
export const FOOT_RX = 10.5;
export const FOOT_RY = 4.3;
export const PAW_RX = 4.8;
export const PAW_RY = 3.3;
export const TAIL_R = 5.4;

export interface LegGeom {
  rx: number;
  ry: number;
  kx: number;
  ky: number;
  fx: number;
  fy: number;
}

export class RabbitRig {
  readonly m: Mat = new Float64Array([1, 0, 0, 1, 0, 0]);
  // Body and haunch (pose-local, before the pose matrix).
  bx = 0;
  by = 0;
  brx = 20;
  bry = 15;
  bAng = 0; // canvas rotation of the body oval
  hx = 0;
  hy = 0;
  hrx = 14;
  hry = 14;
  // Neck capsule.
  nx0 = 0;
  ny0 = 0;
  nx1 = 0;
  ny1 = 0;
  // Head.
  headX = 0;
  headY = 0;
  headCos = 1;
  headSin = 0;
  readonly headPts = new Float64Array(HEAD_N * 2);
  // Face anchors (pose-local).
  eyeNX = 0;
  eyeNY = 0;
  eyeFX = 0;
  eyeFY = 0;
  eyeFVis = 1;
  noseX = 0;
  noseY = 0;
  muzzleX = 0;
  muzzleY = 0;
  cheekX = 0;
  cheekY = 0;
  whiskX = 0;
  whiskY = 0;
  // Ears: polygons (outer + inner) and tip points.
  readonly earN = new Float64Array(EAR_POLY);
  readonly earNIn = new Float64Array(EAR_POLY);
  readonly earF = new Float64Array(EAR_POLY);
  readonly earFIn = new Float64Array(EAR_POLY);
  earNTipX = 0;
  earNTipY = 0;
  earFTipX = 0;
  earFTipY = 0;
  earNFront = false;
  /** A forepaw raised to the face is painted over the head instead of behind it. */
  fnOver = false;
  ffOver = false;
  // Legs.
  readonly fn: LegGeom = { rx: 0, ry: 0, kx: 0, ky: 0, fx: 0, fy: 0 };
  readonly ff: LegGeom = { rx: 0, ry: 0, kx: 0, ky: 0, fx: 0, fy: 0 };
  hnX = 0;
  hnY = 0;
  hnA = 0;
  hfX = 0;
  hfY = 0;
  hfA = 0;
  // Tail.
  tailX = 0;
  tailY = 0;
  tailR = TAIL_R;
  // Collar anchors for the pendant (pose-local): chin points and the hang direction.
  collarAX = 0;
  collarAY = 0;
  collarBX = 0;
  collarBY = 0;
  hangX = 0;
  hangY = 1;
  // Body frame helpers.
  private bc = 1;
  private bs = 0;

  /** Body-oval point for (u, v) in oval units (u along the body, v towards the belly). */
  private bodyPX(u: number, v: number): number {
    return this.bx + u * this.brx * this.bc + v * this.bry * this.bs;
  }
  private bodyPY(u: number, v: number): number {
    return this.by - u * this.brx * this.bs + v * this.bry * this.bc;
  }

  solve(p: RPose): void {
    this.bc = Math.cos(p.tilt);
    this.bs = Math.sin(p.tilt);
    this.bx = p.bodyX;
    this.by = p.bodyY;
    this.brx = clamp(p.bodyRX, 8, 40);
    this.bry = clamp(p.bodyRY, 6, 30);
    this.bAng = -p.tilt;

    const hs = clamp(p.haunch, 0.5, 1.5);
    this.hx = this.bodyPX(-0.5, 0.3);
    this.hy = this.bodyPY(-0.5, 0.3);
    this.hry = this.bry * 0.9 * hs;
    this.hrx = this.hry * 1.08;

    this.nx0 = this.bodyPX(0.55, -0.3);
    this.ny0 = this.bodyPY(0.55, -0.3);
    const dx = p.headX - this.nx0;
    const dy = p.headY - this.ny0;
    const len = Math.hypot(dx, dy);
    const k = len > 1e-6 ? Math.max(0, len - 5) / len : 0;
    this.nx1 = this.nx0 + dx * k;
    this.ny1 = this.ny0 + dy * k;

    this.headX = p.headX;
    this.headY = p.headY;
    this.headCos = Math.cos(p.headRot);
    this.headSin = Math.sin(p.headRot);
    for (let i = 0; i < HEAD_N; i++) {
      const lx = HEAD_SHAPE[i * 2]!;
      const ly = HEAD_SHAPE[i * 2 + 1]!;
      this.headPts[i * 2] = this.hX(lx, ly);
      this.headPts[i * 2 + 1] = this.hY(lx, ly);
    }
    const turn = clamp(p.turn, -1, 1);
    const shift = turn * 2.4;
    this.eyeNX = this.hX(3.6 + shift, -3.1);
    this.eyeNY = this.hY(3.6 + shift, -3.1);
    this.eyeFX = this.hX(11.4 + shift * 1.2, -4.5);
    this.eyeFY = this.hY(11.4 + shift * 1.2, -4.5);
    this.eyeFVis = clamp((turn + 0.7) / 0.7, 0, 1);
    this.noseX = this.hX(15.4 + shift * 0.5, -0.7);
    this.noseY = this.hY(15.4 + shift * 0.5, -0.7);
    this.muzzleX = this.hX(9.8 + shift * 0.6, 3.9);
    this.muzzleY = this.hY(9.8 + shift * 0.6, 3.9);
    this.cheekX = this.hX(2.4 + shift * 0.6, 5.8);
    this.cheekY = this.hY(2.4 + shift * 0.6, 5.8);
    this.whiskX = this.hX(11.5, 3.2);
    this.whiskY = this.hY(11.5, 3.2);

    // Ears.
    earShape(this, this.earF, this.earFIn, 3.6, -10.8, p.eFA, p.eFB, p.eFL, true);
    earShape(this, this.earN, this.earNIn, -5.2, -9.4, p.eNA, p.eNB, p.eNL, false);
    this.earNFront = Math.abs(p.eNA) > 1.05;

    // Front legs.
    solveLeg(this.fn, this.bodyPX(0.6, 0.55), this.bodyPY(0.6, 0.55), p.fnX, p.fnY);
    solveLeg(this.ff, this.bodyPX(0.42, 0.5), this.bodyPY(0.42, 0.5), p.ffX, p.ffY);

    this.fnOver = Math.hypot(this.fn.fx - p.headX, this.fn.fy - p.headY) < 19;
    this.ffOver = Math.hypot(this.ff.fx - p.headX, this.ff.fy - p.headY) < 19;
    this.hnX = p.hnX;
    this.hnY = p.hnY;
    this.hnA = p.hnA;
    this.hfX = p.hfX;
    this.hfY = p.hfY;
    this.hfA = p.hfA;

    this.tailR = TAIL_R * clamp(p.tailS, 0.4, 1.8);
    this.tailX = this.hx - this.hrx * 0.88;
    this.tailY = this.hy - this.hry * 0.38 - p.tailLift;

    // Collar under the chin and the way a pendant hangs (gravity mixed with the body's belly side).
    this.collarAX = this.hX(-6.4, 8.2);
    this.collarAY = this.hY(-6.4, 8.2);
    this.collarBX = this.hX(3.4, 10.4);
    this.collarBY = this.hY(3.4, 10.4);
    const gx = Math.sin(p.rot);
    const gy = Math.cos(p.rot);
    const bdx = this.bs;
    const bdy = this.bc;
    const mx = gx * 0.75 + bdx * 0.25;
    const my = gy * 0.75 + bdy * 0.25;
    const ml = Math.hypot(mx, my);
    this.hangX = ml > 1e-6 ? mx / ml : 0;
    this.hangY = ml > 1e-6 ? my / ml : 1;

    computeMatrix(this.m, p);
  }

  /** Head-local to pose-local. */
  hX(lx: number, ly: number): number {
    return this.headX + lx * this.headCos + ly * this.headSin;
  }
  hY(lx: number, ly: number): number {
    return this.headY - lx * this.headSin + ly * this.headCos;
  }
}

/** Fills the outer and inner polygon of one ear and records its tip. */
function earShape(r: RabbitRig, out: Float64Array, inner: Float64Array, bx: number, by: number, ang: number, bend: number, lenScale: number, far: boolean): void {
  const L = EAR_BASE_LEN * clamp(lenScale, 0.25, 1.4);
  const wScale = 1 + (1 - clamp(lenScale, 0.25, 1)) * 0.9;
  const step = L / (EAR_SAMPLES - 1);
  let px = bx;
  let py = by;
  for (let i = 0; i < EAR_SAMPLES; i++) {
    const t = i / (EAR_SAMPLES - 1);
    const a = ang + bend * t * t * 1.4;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    // Direction (-sin a, -cos a) in head-local space; the perpendicular is (cos a, -sin a).
    const nx = ca;
    const ny = -sa;
    const w = EAR_W[i]! * wScale;
    const wi = w * 0.56 * (i === 0 ? 0.6 : 1);
    const gx = r.hX(px + nx * w, py + ny * w);
    const gy = r.hY(px + nx * w, py + ny * w);
    const hx = r.hX(px - nx * w, py - ny * w);
    const hy = r.hY(px - nx * w, py - ny * w);
    const o = i * 2;
    out[o] = gx;
    out[o + 1] = gy;
    const q = (EAR_SAMPLES * 2 - 1 - i) * 2;
    out[q] = hx;
    out[q + 1] = hy;
    inner[o] = r.hX(px + nx * wi, py + ny * wi);
    inner[o + 1] = r.hY(px + nx * wi, py + ny * wi);
    inner[q] = r.hX(px - nx * wi, py - ny * wi);
    inner[q + 1] = r.hY(px - nx * wi, py - ny * wi);
    if (i === EAR_SAMPLES - 1) {
      if (far) {
        r.earFTipX = r.hX(px, py);
        r.earFTipY = r.hY(px, py);
      } else {
        r.earNTipX = r.hX(px, py);
        r.earNTipY = r.hY(px, py);
      }
    }
    px += -sa * step;
    py += -ca * step;
  }
}

/** Two-bone IK; the elbow bends towards the back (-x) for downward legs. */
export function solveLeg(g: LegGeom, rx: number, ry: number, tx: number, ty: number): void {
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
  const reach = FRONT_UPPER + FRONT_LOWER;
  // A tucked leg shortens into a gentle knee instead of folding into a sharp V.
  const stretch = d > reach * 0.995 ? Math.min(d / (reach * 0.995), 1.18) : 1;
  let sa = FRONT_UPPER * stretch;
  let sb = FRONT_LOWER * stretch;
  if (d < reach * 0.88) {
    sa = Math.max(d * 0.56, 4);
    sb = sa;
  }
  const dc = clamp(d, Math.abs(sa - sb) + 1e-3, (sa + sb) * 0.995);
  const base = Math.atan2(dy, dx);
  const cosA = clamp((sa * sa + dc * dc - sb * sb) / (2 * sa * dc), -1, 1);
  const ka = base + Math.acos(cosA);
  g.kx = rx + sa * Math.cos(ka);
  g.ky = ry + sa * Math.sin(ka);
  const fa = Math.atan2(ty - g.ky, tx - g.kx);
  g.fx = g.kx + sb * Math.cos(fa);
  g.fy = g.ky + sb * Math.sin(fa);
}

/** Squash about the ground anchor after rotating about the pivot, then offset. */
export function computeMatrix(m: Mat, p: RPose): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const sx = clamp(p.sqX, 0.3, 2);
  const sy = clamp(p.sqY, 0.3, 2);
  const px = p.pivX;
  const py = p.pivY;
  m[0] = sx * c;
  m[1] = sy * s;
  m[2] = -sx * s;
  m[3] = sy * c;
  m[4] = sx * (px - c * px + s * py) + p.offX;
  m[5] = sy * (py - s * px - c * py) + p.offY;
}
