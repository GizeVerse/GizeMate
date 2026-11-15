// The alien's rig: turns a Pose into final character-local geometry (anchor at the ground below the
// body, x forward, y down). Everything the painter and the geometry pass need is solved here once per
// frame into preallocated arrays. The antennae are damped springs on a world angle, so they lag the
// head and stream behind a gliding body.
import { clamp, finiteOr } from '../../character/kit';
import type { Pose } from './pose';

export const HEAD_RX = 17;
export const HEAD_RY = 15;
export const HEAD_POINTS = 12;
export const TORSO_POINTS = 10;
export const HIP_Y = -13;
export const NECK_UY = -19;
export const HEAD_DY = -14;
export const SHOULDER_UX = 5.2;
export const SHOULDER_UY = -17;
export const ARM_L1 = 8.5;
export const ARM_L2 = 9;
export const LEG_L1 = 6.5;
export const LEG_L2 = 6.5;
export const LEG_HIP_X = 3.2;
export const ANT_BASE_X = 6;
export const ANT_BASE_Y = -13.6;
export const ANT_LEN = 15;
export const ANT_REST = 0.38;
export const GRIP_X = -8;
export const GRIP_Y = -58;

/** Unit head outline (x, y) per point: a broad cranium tapering to a small chin. */
const HEAD_UNIT = new Float64Array(HEAD_POINTS * 2);
for (let i = 0; i < HEAD_POINTS; i++) {
  const a = (i / HEAD_POINTS) * Math.PI * 2;
  const s = Math.sin(a);
  const taper = s > 0 ? 1 - 0.42 * Math.pow(s, 1.5) : 1 + 0.04 * -s;
  HEAD_UNIT[i * 2] = Math.cos(a) * taper;
  HEAD_UNIT[i * 2 + 1] = s;
}

/** Torso outline in upper-body coordinates (origin at the hips, y up negative). */
const TORSO_U = new Float64Array([0, -19.5, 6, -18, 6.6, -14, 5.2, -7, 3.8, 0, 0, 1.6, -3.8, 0, -5.2, -7, -6.6, -14, -6, -18]);

export interface AntennaState {
  /** World angle of the stalk (0 = straight up, + clockwise) and its angular velocity. */
  ang: number;
  vel: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  /** Glow 0..1 of this tip. */
  glow: number;
}

const newAntenna = (): AntennaState => ({ ang: 0, vel: 0, bx: 0, by: 0, tx: 0, ty: 0, cx: 0, cy: 0, glow: 0 });

export class AlienRig {
  readonly torso = new Float64Array(TORSO_POINTS * 2);
  readonly head = new Float64Array(HEAD_POINTS * 2);
  /** Head frame in final space: centre, and the images of the head-local unit x and y vectors. */
  hcx = 0;
  hcy = 0;
  exx = 1;
  exy = 0;
  eyx = 0;
  eyy = 1;
  /** Arms: shoulder, elbow, hand (x,y pairs). Index 0 = back arm (-x side), 1 = front arm. */
  readonly arm = [new Float64Array(6), new Float64Array(6)];
  /** Legs: hip, knee, foot. */
  readonly leg = [new Float64Array(6), new Float64Array(6)];
  readonly antenna = [newAntenna(), newAntenna()];
  /** Pendant anchors: collar ends and the unit hang direction. */
  collarAx = 0;
  collarAy = 0;
  collarBx = 0;
  collarBy = 0;
  hangX = 0;
  hangY = 1;
  /** Ground shadow: centre x, strength 0..1.2 and height of the feet above the ground. */
  shadowX = 0;
  shadowK = 1;
  height = 7;
  /** Mean scale of the body (for painters sizing details). */
  scale = 1;
  /** Total head angle in final space. */
  headAng = 0;

  // Root transform scratch.
  private cr = 1;
  private sr = 0;
  private pvx = 0;
  private pvy = 0;
  private hover = 7;
  private sxv = 1;
  private syv = 1;
  private ox = 0;
  private oy = 0;
  private fx = 0;
  private fy = 0;
  // Upper body (lean) scratch.
  private hipY = HIP_Y;
  private cl = 1;
  private sl = 0;
  private prevHx = 0;
  private prevHy = 0;
  private hasPrev = false;
  private velX = 0;
  private velY = 0;

  /** Body-local point -> final (into fx, fy). */
  private fin(px: number, py: number): void {
    const qx = px * this.sxv;
    const qy = (py - this.hover) * this.syv;
    const dx = qx - this.pvx;
    const dy = qy - this.pvy;
    this.fx = this.pvx + dx * this.cr - dy * this.sr + this.ox;
    this.fy = this.pvy + dx * this.sr + dy * this.cr + this.oy;
  }

  /** Upper-body point (hip origin) -> final (into fx, fy). */
  private upFin(ux: number, uy: number): void {
    this.fin(ux * this.cl - uy * this.sl, this.hipY + ux * this.sl + uy * this.cl);
  }

  /** Solves the pose into geometry; `dtSec` advances the antenna springs. */
  solve(p: Pose, dtSec: number, motionX: number, motionY: number, antGlowL: number, antGlowR: number): void {
    const dt = clamp(finiteOr(dtSec, 0), 0, 0.1);
    this.hover = p.hover;
    this.sxv = p.sx;
    this.syv = p.sy;
    this.scale = (p.sx + p.sy) / 2;
    this.cr = Math.cos(p.rot);
    this.sr = Math.sin(p.rot);
    this.ox = p.offX;
    this.oy = p.offY;
    const cyc = -p.hover * p.sy - 28 * p.sy;
    this.pvx = GRIP_X * p.pivScruff;
    this.pvy = cyc + (GRIP_Y - cyc) * p.pivScruff;
    this.hipY = HIP_Y + p.hipDrop;
    this.cl = Math.cos(p.lean);
    this.sl = Math.sin(p.lean);

    for (let i = 0; i < TORSO_POINTS; i++) {
      this.upFin(TORSO_U[i * 2]!, TORSO_U[i * 2 + 1]!);
      this.torso[i * 2] = this.fx;
      this.torso[i * 2 + 1] = this.fy;
    }

    // Head frame.
    const hr = Math.cos(p.headRot);
    const hs = Math.sin(p.headRot);
    const hux = p.headX * hr - (HEAD_DY + p.headY) * hs;
    const huy = NECK_UY + p.headX * hs + (HEAD_DY + p.headY) * hr;
    this.upFin(hux, huy);
    this.hcx = this.fx;
    this.hcy = this.fy;
    this.upFin(hux + hr, huy + hs);
    this.exx = this.fx - this.hcx;
    this.exy = this.fy - this.hcy;
    this.upFin(hux - hs, huy + hr);
    this.eyx = this.fx - this.hcx;
    this.eyy = this.fy - this.hcy;
    this.headAng = p.rot + p.lean + p.headRot;
    for (let i = 0; i < HEAD_POINTS; i++) {
      const u = HEAD_UNIT[i * 2]! * HEAD_RX;
      const v = HEAD_UNIT[i * 2 + 1]! * HEAD_RY;
      this.head[i * 2] = this.hcx + this.exx * u + this.eyx * v;
      this.head[i * 2 + 1] = this.hcy + this.exy * u + this.eyy * v;
    }

    // Arms (angles in the upper-body frame) and legs (hanging from the hips).
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const a = s === 0 ? p.armLa : p.armRa;
      const b = s === 0 ? p.armLb : p.armRb;
      const sux = side * SHOULDER_UX;
      const ex = sux + ARM_L1 * Math.sin(a);
      const ey = SHOULDER_UY + ARM_L1 * Math.cos(a);
      const hx = ex + ARM_L2 * Math.sin(a + b);
      const hy = ey + ARM_L2 * Math.cos(a + b);
      const arm = this.arm[s]!;
      this.upFin(sux, SHOULDER_UY);
      arm[0] = this.fx;
      arm[1] = this.fy;
      this.upFin(ex, ey);
      arm[2] = this.fx;
      arm[3] = this.fy;
      this.upFin(hx, hy);
      arm[4] = this.fx;
      arm[5] = this.fy;

      const la = s === 0 ? p.legLa : p.legRa;
      const lb = s === 0 ? p.legLb : p.legRb;
      const hipx = side * LEG_HIP_X;
      const hipy = this.hipY + 1;
      const kx = hipx + LEG_L1 * Math.sin(la);
      const ky = hipy + LEG_L1 * Math.cos(la);
      const fx = kx + LEG_L2 * Math.sin(la + lb);
      const fy = ky + LEG_L2 * Math.cos(la + lb);
      const leg = this.leg[s]!;
      this.fin(hipx, hipy);
      leg[0] = this.fx;
      leg[1] = this.fy;
      this.fin(kx, ky);
      leg[2] = this.fx;
      leg[3] = this.fy;
      this.fin(fx, fy);
      leg[4] = this.fx;
      leg[5] = this.fy;
    }

    // Pendant anchors (collar across the upper chest, hanging along the torso axis).
    this.upFin(-4.6, -16.2);
    this.collarAx = this.fx;
    this.collarAy = this.fy;
    this.upFin(4.6, -16.2);
    this.collarBx = this.fx;
    this.collarBy = this.fy;
    this.upFin(0, -6);
    const cx = this.fx;
    const cy = this.fy;
    this.upFin(0, 6);
    const dx = this.fx - cx;
    const dy = this.fy - cy;
    const dl = Math.hypot(dx, dy);
    this.hangX = dl > 1e-6 ? dx / dl : 0;
    this.hangY = dl > 1e-6 ? dy / dl : 1;

    // Shadow.
    this.height = Math.max(0, p.hover - p.offY);
    this.shadowX = p.offX;
    this.shadowK = clamp(p.shadow * (1 - this.height / 80), 0, 1.2);

    // Head motion for the antenna springs (a lag with a streaming bias).
    if (this.hasPrev && dt > 0) {
      const vx = clamp((this.hcx - this.prevHx) / dt, -400, 400);
      const vy = clamp((this.hcy - this.prevHy) / dt, -400, 400);
      const ax = clamp((vx - this.velX) / dt, -6000, 6000);
      const ay = clamp((vy - this.velY) / dt, -6000, 6000);
      this.velX = vx;
      this.velY = vy;
      this.stepAntennae(p, dt, vx, ax, ay);
    } else {
      // First solve or after reset(): start at rest. A dt = 0 call mid-motion (a paused or repeated frame)
      // only re-poses the stalks from their held angles, so the lag survives it.
      if (!this.hasPrev) {
        this.velX = 0;
        this.velY = 0;
      }
      this.stepAntennae(p, 0, 0, 0, 0, !this.hasPrev);
    }
    this.prevHx = this.hcx;
    this.prevHy = this.hcy;
    this.hasPrev = true;
    void motionX;
    void motionY;
    this.antenna[0]!.glow = antGlowL;
    this.antenna[1]!.glow = antGlowR;
  }

  private stepAntennae(p: Pose, dt: number, vx: number, ax: number, ay: number, snap = false): void {
    const drop = p.antDroop;
    const len = ANT_LEN - 3 * drop;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const st = this.antenna[s]!;
      // Target relative to the head: rest splay, pose offset, spike (narrow, upright), droop (hanging outward).
      let rel = side * ANT_REST + (s === 0 ? p.antL : p.antR);
      rel += (side * 0.1 - rel) * p.antSpike;
      rel += (side * 1.85 - rel) * drop;
      // Streaming bias: a gliding body trails its antennae behind it.
      const stream = -clamp(vx * 0.004, -0.7, 0.7) * (1 - drop);
      const target = this.headAng + rel + stream;
      if (dt > 0) {
        // Angular acceleration from the head's linear motion (inertia), clamped.
        const push = (-ax * Math.cos(this.headAng) + ay * Math.sin(this.headAng)) * 0.0009 * (1 - drop * 0.8);
        st.vel += (push + (target - st.ang) * 64 - st.vel * 8.5) * dt;
        st.vel = clamp(st.vel, -25, 25);
        st.ang += st.vel * dt;
        st.ang = clamp(st.ang, target - 1.4, target + 1.4);
      } else if (snap) {
        st.ang = target;
        st.vel = 0;
      }
      const u = side * ANT_BASE_X;
      const base = ANT_BASE_Y;
      const bx = this.hcx + this.exx * u + this.eyx * base;
      const by = this.hcy + this.exy * u + this.eyy * base;
      const sc = this.scale;
      const dx = Math.sin(st.ang);
      const dy = -Math.cos(st.ang);
      st.bx = bx;
      st.by = by;
      st.tx = bx + dx * len * sc;
      st.ty = by + dy * len * sc;
      // Curl inward (petted/confused), droop sag and the lag of a moving stalk.
      const bend = (-side * p.antBend * 0.9 + side * drop * 0.6 - st.vel * 0.02) * len * 0.35 * sc;
      st.cx = bx + dx * len * 0.5 * sc - dy * bend;
      st.cy = by + dy * len * 0.5 * sc + dx * bend;
    }
  }

  /** Forgets motion-derived state (after a position snap). */
  reset(p: Pose): void {
    this.hasPrev = false;
    this.velX = this.velY = 0;
    this.solve(p, 0, 0, 0, this.antenna[0]!.glow, this.antenna[1]!.glow);
  }
}
