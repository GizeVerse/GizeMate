// Rabbit clips: authored motion for every clip the rabbit draws natively. Each sampler starts from the
// neutral pose and overrides what it needs, as a pure function of time (and, for gaits, the cycle).
// Secondary motion (breath, blink, ear lag, idle fidgets) is layered on top by the animator.
import type { AnimClip } from '../../../../shared/cat';
import { clamp, clamp01, lerp, pulse, smooth, sseg, TAU } from '../../character/kit';
import { createPose, resetPose, type RPose } from './pose';

export interface RClipCtx {
  /** Seconds since the clip started (animation speed applied). */
  t: number;
  /** Integrated hop cycles (fractional part used). */
  cycle: number;
  /** Body lengths per second. */
  speed: number;
  /** Local DIP/s, + = down. */
  vy: number;
  impact: number;
  arousal: number;
}

/** Piecewise smooth interpolation through [x0, v0, x1, v1, ...]. */
export function kf(x: number, k: readonly number[]): number {
  const n = k.length;
  if (x <= k[0]!) return k[1]!;
  if (x >= k[n - 2]!) return k[n - 1]!;
  for (let i = 2; i < n; i += 2) {
    if (x <= k[i]!) {
      const x0 = k[i - 2]!;
      const x1 = k[i]!;
      return lerp(k[i - 1]!, k[i + 1]!, smooth((x - x0) / (x1 - x0)));
    }
  }
  return k[n - 1]!;
}

const S = Math.sin;
const C = Math.cos;

// ---- resting postures (shared by several clips) --------------------------------------------------

export function sitPose(p: RPose): void {
  p.bodyX = -6;
  p.bodyY = -22;
  p.bodyRX = 18;
  p.bodyRY = 14;
  p.tilt = 0.75;
  p.haunch = 1;
  p.headX = 13;
  p.headY = -44;
  p.headRot = 0.1;
  p.eNA = 0.24;
  p.eNB = 0.16;
  p.eFA = 0.0;
  p.eFB = 0.1;
  p.fnX = 10.5;
  p.fnY = -2.5;
  p.ffX = 6.5;
  p.ffY = -2.5;
  p.hnX = -1;
  p.hnY = -3.8;
  p.hfX = -6.5;
  p.hfY = -3.8;
  p.pivY = -20;
}

export function loafPose(p: RPose): void {
  p.bodyX = -4;
  p.bodyY = -15;
  p.bodyRX = 22;
  p.bodyRY = 13.5;
  p.tilt = 0.08;
  p.haunch = 0.9;
  p.headX = 16;
  p.headY = -25;
  p.headRot = -0.04;
  p.eNA = 0.62;
  p.eNB = 0.55;
  p.eFA = 0.74;
  p.eFB = 0.5;
  p.fnX = 17.5;
  p.fnY = -1.5;
  p.ffX = 15;
  p.ffY = -1.5;
  p.hnX = -8;
  p.hnY = -3.6;
  p.hfX = -12;
  p.hfY = -3.6;
  p.tailLift = -1;
  p.noseAmp = 0.35;
}

export function sleepPose(p: RPose): void {
  p.bodyX = -3;
  p.bodyY = -14.5;
  p.bodyRX = 23;
  p.bodyRY = 12.5;
  p.tilt = 0.02;
  p.haunch = 0.92;
  p.headX = 17;
  p.headY = -19;
  p.headRot = -0.38;
  p.turn = 0.3;
  p.eNA = 1.62;
  p.eNB = 0.5;
  p.eNL = 0.95;
  p.eFA = 1.78;
  p.eFB = 0.4;
  p.eFL = 0.95;
  p.eyeOpen = 0;
  p.pupilX = 0;
  p.blush = 0.35;
  p.noseAmp = 0.22;
  p.fnX = 15.5;
  p.fnY = -1.5;
  p.ffX = 11.5;
  p.ffY = -1.5;
  p.hnX = -7;
  p.hnY = -3.4;
  p.hfX = -11;
  p.hfY = -3.4;
  p.tailLift = -2;
  p.breath = 1.5;
}

export function crouchPose(p: RPose, low: number): void {
  p.bodyX = -3;
  p.bodyY = lerp(-17.5, -12.5, low);
  p.bodyRX = 20.5;
  p.bodyRY = lerp(14, 12, low);
  p.tilt = lerp(-0.08, -0.04, low);
  p.haunch = 1.05;
  p.headX = lerp(18, 17, low);
  p.headY = lerp(-28, -18.5, low);
  p.headRot = lerp(0.02, -0.12, low);
  p.eNA = lerp(0.5, 1.3, low);
  p.eNB = lerp(0.3, 0.55, low);
  p.eFA = lerp(0.62, 1.45, low);
  p.eFB = lerp(0.3, 0.5, low);
  p.fnX = lerp(17, 19, low);
  p.fnY = -0.8;
  p.ffX = lerp(14.8, 16.8, low);
  p.ffY = -0.8;
  p.hnX = -3.5;
  p.hnY = -3.8;
  p.hfX = -9;
  p.hfY = -3.8;
}

/** Tall periscope stance on the hind feet. */
export function uprightPose(p: RPose): void {
  p.bodyX = -7;
  p.bodyY = -24.5;
  p.bodyRX = 17;
  p.bodyRY = 14.5;
  p.tilt = 1.3;
  p.haunch = 1;
  p.headX = 3;
  p.headY = -50.5;
  p.headRot = 0.14;
  p.eNA = 0.02;
  p.eNB = 0.06;
  p.eFA = 0.1;
  p.eFB = 0.08;
  p.fnX = 8.5;
  p.fnY = -29.5;
  p.ffX = 5.5;
  p.ffY = -28.5;
  p.hnX = 3.5;
  p.hnY = -3.8;
  p.hfX = -3;
  p.hfY = -3.8;
  p.pivY = -26;
}

// ---- helpers ---------------------------------------------------------------------------------------

/** Rises over [a, b] and falls over [c, d]. */
const env = pulse;

/** Foot thump envelope: lifts then slams, twice per cycle of `period` seconds. Returns lift 0..1 and slam 0..1. */
function thump(t: number, period: number, out: { lift: number; slam: number }): void {
  const ph = ((t % period) + period) % period;
  let lift = 0;
  let slam = 0;
  for (let i = 0; i < 2; i++) {
    const s = i * 0.26;
    lift = Math.max(lift, sseg(ph, s, s + 0.1) * (1 - sseg(ph, s + 0.1, s + 0.135)));
    slam = Math.max(slam, sseg(ph, s + 0.125, s + 0.145) * (1 - sseg(ph, s + 0.145, s + 0.24)));
  }
  out.lift = lift;
  out.slam = slam;
}
const thumpOut = { lift: 0, slam: 0 };

// ---- clips ---------------------------------------------------------------------------------------

type ClipFn = (p: RPose, c: RClipCtx) => void;

const stand: ClipFn = (p, c) => {
  // Upright alert, weight shifting slowly from side to side, ears gently searching.
  const w = S(TAU * 0.11 * c.t);
  p.bodyX += 0.6 * w;
  p.headX += 0.5 * w;
  p.eNA += 0.05 * S(TAU * 0.17 * c.t + 1);
  p.eFA += 0.05 * S(TAU * 0.14 * c.t);
};

const sit: ClipFn = (p, c) => {
  sitPose(p);
  p.eNA += 0.04 * S(TAU * 0.13 * c.t + 0.6);
  p.eFA += 0.04 * S(TAU * 0.11 * c.t);
};

const loaf: ClipFn = (p, c) => {
  loafPose(p);
  p.eNA += 0.05 * S(TAU * 0.1 * c.t);
};

const sleep: ClipFn = (p) => {
  sleepPose(p);
};

const WAKE_SIT = createPose();

const wake: ClipFn = (p, c) => {
  // Lying -> head lifts -> big stretch (front down and forward, rump up, yawn) -> sits up, ears perk.
  const t = c.t;
  sleepPose(p);
  const up = sseg(t, 0.05, 0.45);
  const stretch = env(t, 0.4, 0.7, 1.1, 1.4);
  const sitK = sseg(t, 1.05, 1.5);
  const a = WAKE_SIT;
  resetPose(a);
  sitPose(a);
  // Head up first, body follows into the stretch, then the sit.
  p.headY = lerp(p.headY, -28, up);
  p.headRot = lerp(p.headRot, 0.05, up);
  p.headX = lerp(p.headX, 19, up);
  p.eyeOpen = sseg(t, 0.18, 0.5) * (1 - 0.85 * env(t, 0.55, 0.7, 0.95, 1.1));
  p.eNA = lerp(p.eNA, 0.25, sseg(t, 0.3, 0.7));
  p.eFA = lerp(p.eFA, 0.3, sseg(t, 0.3, 0.7));
  p.eNB = lerp(p.eNB, 0.3, up);
  p.eFB = lerp(p.eFB, 0.3, up);
  p.bodyY = lerp(p.bodyY, -20, up);
  p.bodyRY = lerp(p.bodyRY, 14.5, up);
  p.tilt = lerp(p.tilt, 0.1, up) - 0.34 * stretch;
  p.fnX = lerp(p.fnX, 26, stretch * up);
  p.ffX = lerp(p.ffX, 22, stretch * up);
  p.fnY = -0.5;
  p.ffY = -0.5;
  p.headX += 6 * stretch;
  p.headY += 4 * stretch;
  p.mouth = 0.9 * env(t, 0.62, 0.78, 1.0, 1.15);
  p.hnX = lerp(p.hnX, -9, stretch);
  p.hfX = lerp(p.hfX, -13, stretch);
  p.bodyX -= 2 * stretch;
  // Settle into a sit.
  const k = sitK;
  for (const key of ['bodyX', 'bodyY', 'bodyRX', 'bodyRY', 'tilt', 'headX', 'headY', 'headRot', 'fnX', 'fnY', 'ffX', 'ffY', 'hnX', 'hfX', 'eNA', 'eFA', 'eNB', 'eFB'] as const) p[key] = lerp(p[key], a[key], k);
  p.eNA += 0.35 * env(t, 1.2, 1.28, 1.34, 1.5) * -1;
  p.noseAmp = 0.7;
};

const yawn: ClipFn = (p, c) => {
  sitPose(p);
  const t = c.t;
  const o = env(t, 0.1, 0.42, 0.74, 1.05);
  p.mouth = o;
  p.headRot += 0.42 * o;
  p.headY -= 1.5 * o;
  p.eyeOpen = 1 - 0.95 * o;
  p.eNA += 0.5 * o;
  p.eFA += 0.55 * o;
  p.eNB += 0.2 * o;
  p.noseAmp = 0.2;
  p.breath = 1 + 0.8 * o;
};

const crouch: ClipFn = (p, c) => {
  crouchPose(p, 0.45);
  // Anticipation wiggle.
  const w = S(TAU * 3.4 * c.t);
  p.bodyX += 0.9 * w;
  p.hnX += 0.8 * w;
  p.tailLift = 1.2 * Math.abs(w);
  p.headY += 0.5 * S(TAU * 1.7 * c.t);
  p.noseAmp = 0.85;
};

const jump: ClipFn = (p, c) => {
  const up = clamp01(-c.vy / 420);
  p.sqY = 1.07 + 0.11 * up;
  p.sqX = 1 / Math.pow(p.sqY, 0.6);
  p.tilt = 0.32 + 0.36 * up;
  p.bodyY = -23;
  p.headX = 21;
  p.headY = -36 - 3 * up;
  p.headRot = 0.22 + 0.12 * up;
  p.fnX = 21;
  p.fnY = -21 - 3 * up;
  p.ffX = 19;
  p.ffY = -19 - 3 * up;
  p.hnX = -17;
  p.hnY = -10 - 3 * up;
  p.hnA = 0.8;
  p.hfX = -21.5;
  p.hfY = -7 - 3 * up;
  p.hfA = 0.95;
  p.eNA = 0.7 + 0.35 * up;
  p.eNB = 0.55;
  p.eFA = 0.8 + 0.35 * up;
  p.eFB = 0.55;
  p.tailLift = 3;
  p.noseAmp = 0.2;
  p.shadow = 1;
};

const fall: ClipFn = (p, c) => {
  const f = clamp01(c.vy / 520);
  p.sqY = 1.03 + 0.06 * f;
  p.sqX = 1 / Math.pow(p.sqY, 0.6);
  p.tilt = -0.12 - 0.12 * f;
  p.bodyY = -23;
  p.headX = 21;
  p.headY = -31;
  p.headRot = -0.12;
  p.fnX = 15;
  p.fnY = -5 - 3 * (1 - f);
  p.ffX = 11;
  p.ffY = -4 - 3 * (1 - f);
  p.hnX = -5;
  p.hnY = -9;
  p.hnA = 0.45;
  p.hfX = -10;
  p.hfY = -8;
  p.hfA = 0.5;
  p.eNA = -0.05 + 0.1 * S(TAU * 3.2 * c.t);
  p.eNB = -0.2;
  p.eFA = 0.02 + 0.1 * S(TAU * 3.2 * c.t + 1);
  p.eFB = -0.15;
  p.pupilY = 0.2;
  p.tailLift = 4;
  p.noseAmp = 0.15;
};

const land: ClipFn = (p, c) => {
  const t = c.t;
  const impact = clamp(c.impact, 0, 1);
  const amp = 0.1 + 0.16 * impact;
  const back = 1 - smooth(t / 0.25);
  p.sqY = 1 - amp * back + 0.03 * S(TAU * 3 * t) * (1 - back);
  p.sqX = 1 + 0.6 * (1 - p.sqY);
  p.tilt = -0.05 * back;
  p.headY += 2 * back;
  p.fnX = 16.5;
  p.ffX = 12;
  p.hnX = -7;
  p.hfX = -12;
  p.eNA = 0.12 - 0.5 * back;
  p.eFA = 0.22 - 0.5 * back;
  p.eNB = -0.15 * back;
  p.eFB = -0.1 * back;
  p.mouth = 0.18 * back;
};

const startle: ClipFn = (p, c) => {
  // Jolt up, freeze with ears erect, thump a hind foot, then drop low into the bolt.
  const t = c.t;
  const jolt = env(t, 0, 0.07, 0.16, 0.34);
  const freeze = env(t, 0.06, 0.14, 0.42, 0.52);
  const bolt = sseg(t, 0.42, 0.6);
  thump(0, 1, thumpOut);
  const th = env(t, 0.26, 0.33, 0.35, 0.4);
  const slam = env(t, 0.34, 0.37, 0.4, 0.5);
  p.offY = -7.5 * jolt + 1.2 * slam;
  p.sqY = 1 + 0.12 * jolt - 0.07 * slam - 0.1 * bolt;
  p.sqX = 1 / Math.pow(p.sqY, 0.55);
  p.tilt = lerp(0.14, 0.34, freeze) - 0.34 * bolt;
  p.headY = -34 - 3 * freeze + 5 * bolt;
  p.headX = 19 + 5 * bolt;
  p.headRot = 0.18 * freeze - 0.15 * bolt;
  p.eyeOpen = 1;
  p.pupilX = 0.3;
  p.eNA = lerp(lerp(0.12, -0.04, freeze), 1.2, bolt);
  p.eFA = lerp(lerp(0.22, 0.02, freeze), 1.35, bolt);
  p.eNB = lerp(0.1, 0.5, bolt);
  p.eFB = lerp(0.16, 0.5, bolt);
  p.noseAmp = 0.9;
  p.fnX = lerp(13, 21, bolt);
  p.ffX = lerp(8.5, 16, bolt);
  p.hnY = -3.8 - 9 * th;
  p.hnA = 0.5 * th;
  p.hnX = lerp(-3, -10, bolt) - 1.5 * th;
  p.hfX = lerp(-8, -15, bolt);
  p.tailLift = 5 * freeze;
  p.blush = 0;
};

const annoyed: ClipFn = (p, c) => {
  // Upright, ears swept sideways, narrowed stare, a hind foot thumping in pairs.
  sitPose(p);
  p.tilt = 0.55;
  p.headX = 15;
  p.headY = -43;
  p.eNA = 0.5;
  p.eFA = 0.58;
  p.eNB = 0.22;
  p.eFB = 0.2;
  p.eNL = 0.92;
  p.eyeOpen = 0.66;
  p.pupilX = 0.35;
  p.blush = 0;
  thump(c.t, 1.5, thumpOut);
  const lift = thumpOut.lift;
  const slam = thumpOut.slam;
  p.hnY = -3.8 - 8 * lift;
  p.hnA = 0.55 * lift;
  p.hnX = -1 - 2.5 * lift;
  p.offY = 0.9 * slam;
  p.sqY = 1 - 0.025 * slam;
  p.ffY = -2.5;
  p.tailLift = 1.5 * lift;
  p.noseAmp = 0.9;
  p.headRot += 0.04 * S(TAU * 6 * c.t) * (lift > 0.05 ? 1 : 0);
};

const petted: ClipFn = (p, c) => {
  // Eyes shut, ears laid back, head pressed into the hand, a faint contented tremble.
  sitPose(p);
  const t = c.t;
  p.tilt = 0.7;
  p.headX = 14.5 + 1.2 * S(TAU * 0.7 * t);
  p.headY = -41 + 1.4 * S(TAU * 0.7 * t + 1.2);
  p.headRot = -0.3 + 0.07 * S(TAU * 0.7 * t);
  p.turn = 0.25;
  p.eyeOpen = 0;
  p.eNA = 1.08;
  p.eNB = 0.55;
  p.eFA = 1.2;
  p.eFB = 0.5;
  p.eNL = 0.94;
  p.blush = 1;
  p.noseAmp = 0.35;
  p.mouth = 0.05 + 0.05 * S(TAU * 7.5 * t);
  p.bodyX += 1.3 * S(TAU * 0.7 * t);
  p.tailLift = 1;
  p.breath = 1.35;
};

const groom: ClipFn = (p, c) => {
  // Ear-wash: one ear pulled down over the face, both forepaws stroking it, eyes shut.
  sitPose(p);
  const t = c.t;
  const w = TAU * 2.1 * t;
  p.tilt = 0.7;
  p.headX = 14;
  p.headY = -40;
  p.headRot = -0.3;
  p.turn = -0.15;
  p.eyeOpen = 0.04;
  p.eNA = -0.95 + 0.07 * S(w);
  p.eNB = -0.62;
  p.eNL = 0.98;
  p.eFA = 0.86;
  p.eFB = 0.45;
  const cx = p.headX + 8;
  const cy = p.headY + 1;
  p.fnX = cx + 4 * C(w);
  p.fnY = cy - 5 + 8 * S(w);
  p.ffX = cx + 2 + 4 * C(w + 2.4);
  p.ffY = cy - 3 + 8 * S(w + 2.4);
  p.noseAmp = 0.7;
  p.blush = 0.5;
};

const pawAt: ClipFn = (p, c) => {
  // Nibbling: sitting up, both forepaws holding a morsel at the mouth, jaw working, nose busy.
  sitPose(p);
  const t = c.t;
  const chew = Math.max(0, S(TAU * 4.8 * t));
  p.tilt = 0.7;
  p.headX = 15;
  p.headY = -41;
  p.headRot = -0.2 + 0.03 * S(TAU * 4.8 * t);
  p.mouth = 0.4 * chew;
  p.fnX = p.headX + 11;
  p.fnY = p.headY + 11 - 0.6 * chew;
  p.ffX = p.headX + 7.5;
  p.ffY = p.headY + 12 - 0.6 * chew;
  p.eNA = 0.22 + 0.1 * S(TAU * 0.33 * t);
  p.eFA = 0.34;
  p.noseAmp = 1;
  p.blush = 0.5;
  p.eyeOpen = 0.9;
  p.tailLift = 0.8 * Math.abs(S(TAU * 0.4 * t));
};

const held: ClipFn = (p) => {
  // Hanging from the scruff (HELD_SCRUFF), body below it, limbs dangling; the animator adds the swing.
  p.pivX = -8;
  p.pivY = -58;
  p.bodyX = -9;
  p.bodyY = -35;
  p.bodyRX = 17;
  p.bodyRY = 14;
  p.tilt = 1.5;
  p.haunch = 0.95;
  p.headX = -2;
  p.headY = -60;
  p.headRot = -0.12;
  p.turn = -0.2;
  p.eNA = 0.75;
  p.eNB = 0.5;
  p.eFA = 0.85;
  p.eFB = 0.5;
  p.eyeOpen = 1;
  p.pupilY = -0.15;
  p.fnX = 3;
  p.fnY = -30;
  p.ffX = -1;
  p.ffY = -29;
  p.hnX = -5.5;
  p.hnY = -10.5;
  p.hnA = 1.38;
  p.hfX = -10.5;
  p.hfY = -10;
  p.hfA = 1.42;
  p.tailLift = -3;
  p.blush = 0.5;
  p.noseAmp = 0.7;
  p.shadow = 0.3;
};

const hide: ClipFn = (p, c) => {
  crouchPose(p, 1);
  const tr = S(TAU * 7 * c.t) * 0.35;
  p.bodyX += 0.25 * tr;
  p.headY -= 0.2 * tr;
  p.eyeOpen = 1;
  p.pupilX = 0.2;
  p.noseAmp = 0.8;
  p.blush = 0;
  p.tailS = 0.9;
};

const peek: ClipFn = (p, c) => {
  // Peeking out from cover: low, then the head and ears rise to look around, then duck back down.
  crouchPose(p, 1);
  const cyc = 4.2;
  const ph = (((c.t % cyc) + cyc) % cyc) / cyc;
  const rise = env(ph, 0.1, 0.28, 0.68, 0.86);
  const look = S(TAU * ph * 2.2) * rise;
  p.headY = lerp(p.headY, -31, rise);
  p.headX = lerp(p.headX, 15, rise) + 1.5 * look;
  p.headRot = lerp(p.headRot, 0.08, rise);
  p.turn = 0.5 * look;
  p.bodyY = lerp(p.bodyY, -15, rise);
  p.bodyRY = lerp(p.bodyRY, 13.5, rise);
  p.eNA = lerp(p.eNA, 0.0, rise) + 0.06 * look;
  p.eNB = lerp(p.eNB, 0.05, rise);
  p.eFA = lerp(p.eFA, 0.1, rise) - 0.05 * look;
  p.eFB = lerp(p.eFB, 0.05, rise);
  p.pupilX = 0.55 * look + 0.1;
  p.noseAmp = 0.9;
  p.blush = 0.1;
};

const scratch: ClipFn = (p, c) => {
  // Sitting, one hind leg raised and scratching behind the ear, head cocked into it, eyes squeezed.
  sitPose(p);
  const t = c.t;
  const rub = S(TAU * 7.2 * t);
  const on = sseg(t % 3.2, 0, 0.25) * (1 - sseg(t % 3.2, 2.7, 3.1));
  p.tilt = 0.82;
  p.headX = 12.5;
  p.headRot = 0.1 + 0.14 * on;
  p.turn = 0.2;
  p.hnX = lerp(-1, 4.5, on) + 2.3 * rub * on;
  p.hnY = lerp(-3.8, -31, on) + 1.1 * rub * on;
  p.hnA = lerp(0, -0.55, on);
  p.eNA = lerp(0.08, 1.45, on);
  p.eNB = lerp(0.12, 0.5, on);
  p.eNL = lerp(1, 0.9, on);
  p.eyeOpen = 1 - 0.85 * on;
  p.eFA = 0.4;
  p.mouth = 0.05 * on;
  p.bodyX -= 1.5 * on;
  p.noseAmp = 0.6;
};

const shake: ClipFn = (p, c) => {
  const t = c.t;
  const e = sseg(t, 0, 0.08) * (1 - sseg(t, 0.72, 1.08));
  const w = TAU * 13 * t;
  p.rot = 0.17 * e * S(w);
  p.pivY = -18;
  p.headRot = -0.26 * e * S(w + 0.6);
  p.sqX = 1 + 0.05 * e * S(2 * w);
  p.eNA = 0.12 + 0.95 * e * S(w + 1.4);
  p.eFA = 0.22 + 0.95 * e * S(w + 2.3);
  p.eNB = 0.1 + 0.3 * e * S(w + 0.5);
  p.eFB = 0.16 + 0.3 * e * S(w + 1.1);
  p.eyeOpen = 1 - 0.8 * e;
  p.tailLift = 4 * e * Math.abs(S(w));
  p.mouth = 0.05 * e;
};

const confused: ClipFn = (p, c) => {
  // Sitting, head tilting from side to side, one ear up and one flopped, nose working.
  sitPose(p);
  const t = c.t;
  const sw = S(TAU * 0.42 * t);
  p.headRot = 0.1 + 0.2 * sw;
  p.headX = 13 + 1.4 * sw;
  p.turn = 0.4 * sw;
  p.eNA = lerp(0.0, 1.0, smooth(0.5 - 0.5 * sw));
  p.eNB = lerp(0.04, 0.55, smooth(0.5 - 0.5 * sw));
  p.eFA = lerp(0.9, 0.0, smooth(0.5 - 0.5 * sw));
  p.eFB = lerp(0.4, 0.04, smooth(0.5 - 0.5 * sw));
  p.pupilX = 0.5 * sw;
  p.pupilY = -0.2;
  p.noseAmp = 1;
  p.eyeOpen = 1;
};

const hop: ClipFn = (p, c) => {
  // Hop cycle: gather, spring, glide, land (ear lag comes from the animator's spring).
  const ph = c.cycle - Math.floor(c.cycle);
  const v = Math.max(0, c.speed) * 84;
  const k = clamp01((v - 30) / 260);
  const H = lerp(7, 15, k);
  const air = clamp01((ph - 0.4) / 0.4);
  p.offY = -H * 4 * air * (1 - air);
  const sy = kf(ph, [0, 0.92, 0.3, 0.84, 0.42, 1.1, 0.58, 1.07, 0.78, 1.02, 0.82, 0.82, 0.93, 0.92, 1, 0.92]);
  p.sqY = sy;
  p.sqX = 1 + (1 - sy) * 0.75;
  p.tilt = 0.14 + kf(ph, [0, -0.08, 0.3, -0.14, 0.42, 0.4, 0.6, 0.18, 0.78, -0.2, 0.86, -0.12, 1, -0.08]) * lerp(1, 1.4, k);
  p.bodyX = -3 + kf(ph, [0, 1, 0.3, 2.5, 0.42, -1, 0.6, -1.5, 0.82, 1.5, 1, 1]);
  p.headX = 19 + kf(ph, [0, 0, 0.3, 1, 0.44, 3, 0.62, 3, 0.8, 2, 1, 0]) + 2 * k;
  p.headY = -34 + kf(ph, [0, 2, 0.3, 3, 0.42, -3, 0.6, -1, 0.8, 2, 0.86, 3, 1, 2]);
  p.headRot = kf(ph, [0, 0, 0.3, -0.05, 0.44, 0.22, 0.62, 0.1, 0.8, -0.16, 1, 0]);
  p.fnX = 13 + kf(ph, [0, 0, 0.3, 0, 0.4, 3, 0.55, 6, 0.78, 8, 0.86, 3, 1, 0]);
  p.fnY = -0.5 + kf(ph, [0, 0, 0.32, 0, 0.42, -12, 0.6, -15, 0.78, -9, 0.84, 0, 1, 0]);
  p.ffX = 8.5 + kf(ph, [0, 0, 0.3, 0, 0.4, 3, 0.55, 6, 0.78, 8, 0.86, 3, 1, 0]);
  p.ffY = -0.5 + kf(ph, [0, 0, 0.32, 0, 0.42, -11, 0.6, -13, 0.78, -8, 0.84, 0, 1, 0]);
  p.hnX = -3 + kf(ph, [0, 0, 0.3, 1, 0.42, -11, 0.6, -15, 0.78, -9, 0.84, -2, 1, 0]);
  p.hnY = -3.8 + kf(ph, [0, 0, 0.32, 0, 0.42, -2, 0.6, -9, 0.76, -8, 0.84, 0, 1, 0]);
  p.hnA = kf(ph, [0, 0, 0.3, 0.1, 0.42, 0.55, 0.6, 0.85, 0.8, 0.5, 0.86, 0, 1, 0]);
  p.hfX = -8 + kf(ph, [0, 0, 0.3, 1, 0.42, -13, 0.6, -18, 0.78, -10, 0.84, -2, 1, 0]);
  p.hfY = -3.8 + kf(ph, [0, 0, 0.32, 0, 0.42, -1, 0.6, -6, 0.76, -6, 0.84, 0, 1, 0]);
  p.hfA = kf(ph, [0, 0, 0.3, 0.1, 0.42, 0.6, 0.6, 0.9, 0.8, 0.55, 0.86, 0, 1, 0]);
  const earBack = kf(ph, [0, 0.28, 0.3, 0.46, 0.42, 0.85, 0.6, 0.72, 0.78, 0.4, 0.84, 0.12, 1, 0.28]);
  p.eNA = earBack * lerp(1, 1.25, k);
  p.eFA = earBack * lerp(1, 1.25, k) - 0.2;
  p.eNB = 0.1 + 0.4 * kf(ph, [0, 0, 0.42, 0.6, 0.7, 1, 0.84, 0, 1, 0]);
  p.eFB = 0.16 + 0.4 * kf(ph, [0, 0, 0.42, 0.6, 0.7, 1, 0.84, 0, 1, 0]);
  p.tailLift = 2.5 * kf(ph, [0, 0, 0.42, 1, 0.8, 0.4, 1, 0]);
  p.noseAmp = 0.6;
  p.shadow = 1;
};

const bounce: ClipFn = (p, c) => {
  // The binky: crouch, a big joyful leap with a mid-air twist and a kick, ears flapping, soft landing.
  const T = 1.5;
  const ph = (((c.t % T) + T) % T) / T;
  const air = clamp01((ph - 0.3) / 0.46);
  const lift = 4 * air * (1 - air);
  const sy = kf(ph, [0, 0.95, 0.2, 0.8, 0.3, 1.14, 0.5, 1.04, 0.74, 1.02, 0.79, 0.78, 0.9, 0.95, 1, 0.95]);
  const twist = S(Math.PI * air);
  p.offY = -27 * lift;
  p.sqY = sy;
  p.sqX = (1 + (1 - sy) * 0.7) * (1 - 0.34 * twist * twist);
  p.rot = 0.5 * S(TAU * air) * (air > 0 && air < 1 ? 1 : 0);
  p.pivY = -22;
  p.tilt = 0.14 + kf(ph, [0, -0.1, 0.2, -0.16, 0.34, 0.45, 0.55, 0.1, 0.74, -0.25, 0.88, -0.1, 1, -0.1]);
  p.headX = 19 + 2 * twist;
  p.headY = -34 + kf(ph, [0, 3, 0.2, 5, 0.32, -3, 0.74, 1, 0.82, 4, 1, 3]);
  p.headRot = kf(ph, [0, 0, 0.2, -0.06, 0.34, 0.25, 0.55, -0.15, 0.7, 0.2, 0.8, -0.15, 1, 0]);
  p.turn = 0.7 * twist;
  p.eyeOpen = 1 - 0.95 * twist;
  p.eyeHappy = twist;
  p.mouth = 0.35 * twist;
  p.fnX = 13 + 8 * lift;
  p.fnY = -0.5 - 16 * lift;
  p.ffX = 8.5 + 8 * lift;
  p.ffY = -0.5 - 14 * lift;
  p.hnX = -3 - 16 * lift * twist;
  p.hnY = -3.8 - 24 * lift * twist;
  p.hnA = -0.7 * twist;
  p.hfX = -8 - 10 * lift * twist;
  p.hfY = -3.8 - 20 * lift * twist;
  p.hfA = -0.55 * twist;
  const flap = S(TAU * 2.5 * air);
  const e = air > 0 && air < 1 ? 1 : 0;
  p.eNA = 0.45 + (0.35 - 0.8 * flap) * lift * e + 0.5 * (1 - sseg(ph, 0, 0.2));
  p.eFA = 0.15 + (0.35 + 0.8 * flap) * lift * e + 0.5 * (1 - sseg(ph, 0, 0.2));
  p.eNB = 0.2 + 0.5 * lift;
  p.eFB = 0.2 + 0.5 * lift;
  p.tailLift = 4 * lift + 1;
  p.blush = 0.8;
  p.noseAmp = 0.7;
};

const dance: ClipFn = (p, c) => {
  // Happy zoomie dance: quick alternating hops with a side-to-side sway, ears bobbing out of phase.
  const t = c.t;
  const w = TAU * 2.4 * t;
  const hopK = Math.abs(S(w * 0.5 + 0.0));
  const sw = S(w * 0.5 + Math.PI / 2);
  p.offY = -9 * hopK;
  p.sqY = 1 - 0.09 * (1 - hopK) * (1 - hopK) + 0.05 * hopK;
  p.sqX = 1 + (1 - p.sqY) * 0.7;
  p.rot = 0.18 * sw;
  p.pivY = -22;
  p.tilt = 0.14 + 0.1 * sw;
  p.headX = 19 + 2 * sw;
  p.headY = -34 - 1.5 * hopK;
  p.headRot = -0.18 * sw;
  p.turn = 0.4 * sw;
  p.eyeHappy = 0.9;
  p.eyeOpen = 0.15;
  p.mouth = 0.22 + 0.1 * S(w);
  p.eNA = 0.5 + 0.55 * S(w + 0.4);
  p.eFA = 0.1 + 0.55 * S(w + 2.2);
  p.eNB = 0.35;
  p.eFB = 0.35;
  p.fnX = 15 + 5 * hopK;
  p.fnY = -0.5 - 9 * hopK;
  p.ffX = 10 + 5 * hopK;
  p.ffY = -0.5 - 7 * hopK;
  p.hnX = -3 - 3 * hopK;
  p.hnY = -3.8 - 6 * hopK;
  p.hnA = 0.5 * hopK;
  p.hfX = -8 - 4 * hopK;
  p.hfY = -3.8 - 6 * hopK;
  p.hfA = 0.5 * hopK;
  p.tailLift = 3 * hopK;
  p.blush = 0.8;
  p.noseAmp = 0.6;
};

const scan: ClipFn = (p, c) => {
  // Periscope: tall on the hind feet, ears like antennae swivelling, head sweeping side to side.
  uprightPose(p);
  const t = c.t;
  const sweep = S(TAU * 0.24 * t) + 0.35 * S(TAU * 0.61 * t + 1);
  const rise = sseg(t, 0, 0.45);
  const d = 1 - rise;
  p.bodyY += 3 * d;
  p.headY += 7 * d;
  p.tilt -= 0.3 * d;
  p.headX += 2.5 * sweep;
  p.headRot += 0.04 * sweep;
  p.turn = clamp(0.55 * sweep, -1, 1);
  p.pupilX = 0.5 * sweep;
  p.eNA += 0.12 * S(TAU * 0.4 * t) + 0.18 * sweep;
  p.eFA += 0.12 * S(TAU * 0.33 * t + 2) - 0.14 * sweep;
  p.eNB += 0.06 * sweep;
  p.noseAmp = 1;
  p.bodyX += 0.8 * sweep;
  p.fnY += 0.8 * S(TAU * 0.3 * t);
  p.tailLift = 0;
};

const squish: ClipFn = (p, c) => {
  // Compress flat, then spring back past rest.
  const t = c.t;
  const down = sseg(t, 0, 0.16);
  const up = sseg(t, 0.16, 0.42);
  const settle = S(TAU * 4 * Math.max(0, t - 0.4)) * Math.exp(-6 * Math.max(0, t - 0.4));
  const f = down * (1 - up);
  p.sqY = 1 - 0.42 * f + 0.1 * up * (1 - sseg(t, 0.42, 0.6)) + 0.04 * settle;
  p.sqX = 1 + 0.5 * f - 0.06 * up * (1 - sseg(t, 0.42, 0.6));
  p.eNA = 0.12 + 0.6 * f;
  p.eFA = 0.22 + 0.6 * f;
  p.eyeOpen = 1 - 0.8 * f;
  p.eNB = 0.4 * f;
  p.eFB = 0.4 * f;
  p.mouth = 0.2 * f;
};

const stretchClip: ClipFn = (p, c) => {
  // Standing stretch: front down and forward, rump up, then pulled back.
  const t = c.t;
  const e = env(t, 0.1, 0.55, 1.0, 1.5);
  p.tilt = 0.14 - 0.4 * e;
  p.bodyX -= 1.5 * e;
  p.headX += 6 * e;
  p.headY += 7 * e;
  p.headRot += -0.1 * e;
  p.fnX = 13 + 11 * e;
  p.ffX = 8.5 + 11 * e;
  p.hnX = -3 - 5 * e;
  p.hfX = -8 - 6 * e;
  p.eyeOpen = 1 - 0.8 * e;
  p.eNA += 0.5 * e;
  p.eFA += 0.5 * e;
  p.mouth = 0.6 * env(t, 0.5, 0.65, 0.85, 1.0);
  p.tailLift = 3 * e;
};

const REGISTRY: Partial<Record<AnimClip, ClipFn>> = {
  stand,
  sit,
  loaf,
  sleep,
  wake,
  yawn,
  crouch,
  jump,
  fall,
  land,
  startle,
  annoyed,
  petted,
  groom,
  pawAt,
  held,
  hide,
  peek,
  scratch,
  shake,
  confused,
  hop,
  bounce,
  dance,
  scan,
  squish,
  stretch: stretchClip,
};

/** The clips the rabbit draws natively (the module lists exactly these). */
export const NATIVE_CLIPS: readonly AnimClip[] = Object.keys(REGISTRY) as AnimClip[];

/** Samples `clip` (already resolved to a native one) into `p`, starting from the neutral pose. */
export function sampleClip(p: RPose, clip: AnimClip, c: RClipCtx): void {
  resetPose(p);
  const f = REGISTRY[clip] ?? stand;
  f(p, c);
}
