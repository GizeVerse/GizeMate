// The alien's native clips: each writes the pose channels for `t` seconds into the clip (looping clips
// use it as a phase, one-shots hold their last pose). Poses are authored from the neutral pose
// (resetPose); locomotion rate comes from the gait phase the animator accumulates from the speed.
import type { AnimClip } from '../../../../shared/cat';
import { clamp, clamp01, easeInOut, lerp, sseg, TAU } from '../../character/kit';
import { resetPose, type Pose } from './pose';

export interface ClipCtx {
  /** Seconds into the clip (animation speed applied). */
  t: number;
  /** Smoothed locomotion speed (body lengths per second) and its 0..1 normalisation (0 still, 1 a fast run). */
  speed: number;
  n: number;
  /** Gait phase (rad), advanced by the animator at a rate that follows the speed. */
  gait: number;
  /** Landing hardness 0..1. */
  impact: number;
  /** Reduced-motion amplitude factor 0.35..1 for oscillations. */
  amp: number;
}

const sin = Math.sin;
const cos = Math.cos;
const PI = Math.PI;
const fract = (x: number): number => x - Math.floor(x);

/** Resting values of the low sleeping/folded posture, shared by sleep, loaf, wake. */
const FOLD_HIP = 9;
const FOLD_HOVER = 3.5;

/** Lotus legs: thighs out to the sides, shins folded back under. */
function foldLegs(p: Pose, k: number): void {
  p.legLa = lerp(p.legLa, -1.45, k);
  p.legLb = lerp(p.legLb, -2.3, k);
  p.legRa = lerp(p.legRa, 1.45, k);
  p.legRb = lerp(p.legRb, 2.3, k);
}

/** Robot-dance beat table: armLa, armLb, armRa, armRb, headRot, lean, turn, offX, legLa, legRa per beat. */
const DANCE = new Float64Array([
  -1.57, 0, 2.05, 0, 0.16, 0.08, 0.5, 3, -0.08, 0.6,
  -2.05, 0, 1.57, 0, -0.16, -0.08, -0.3, -3, -0.6, 0.08,
  -1.57, -1.57, 1.57, 1.57, 0.16, 0, 0.5, 2, -0.08, 0.08,
  -1.57, 1.57, 1.57, -1.57, -0.16, 0, -0.3, -2, -0.08, 0.08,
  -2.05, 0, 2.05, 0, 0.12, 0.1, 0.4, 0, -0.5, 0.5,
  -1.57, 0, 1.57, 0, -0.12, -0.1, -0.2, 0, -0.5, 0.5,
  -0.9, 1.9, 2.0, 0, 0.16, 0.06, 0.5, 3, -0.08, 0.5,
  -2.0, 0, 0.9, -1.9, -0.16, -0.06, -0.3, -3, -0.5, 0.08,
]);
const DANCE_COLS = 10;
const DANCE_HZ = 2.2;

export function sampleClip(p: Pose, clip: AnimClip, c: ClipCtx): void {
  resetPose(p);
  const t = c.t;
  const A = c.amp;
  switch (clip) {
    case 'sit': {
      p.hover = 2.5;
      p.hipDrop = 7;
      foldLegs(p, 1);
      p.legLb += 0.05 * sin(TAU * 0.3 * t) * A;
      p.armLa = -0.45;
      p.armLb = 0.9;
      p.armRa = 0.45;
      p.armRb = -0.9;
      p.antL = 0.07 * sin(TAU * 0.4 * t) * A;
      p.antR = 0.07 * sin(TAU * 0.4 * t + 1.6) * A;
      p.headRot = 0.03 * sin(TAU * 0.27 * t + 0.4) * A;
      p.bob = 1.1;
      p.bobHz = 2.6;
      p.glow = 0.5;
      break;
    }
    case 'loaf': {
      // A cosy hovering pod: folded low, hugging its knees, lids half down.
      p.hover = FOLD_HOVER - 0.5;
      p.hipDrop = FOLD_HIP;
      foldLegs(p, 1);
      p.armLa = -0.5;
      p.armLb = 2.1;
      p.armRa = 0.5;
      p.armRb = -2.1;
      p.sy = 0.96;
      p.headY = 2.5;
      p.headRot = 0.1;
      p.eye = 0.5;
      p.antDroop = 0.3;
      p.smile = 0.3;
      p.glow = 0.4;
      p.bob = 0.9;
      p.bobHz = 2.1;
      p.antL = 0.04 * sin(TAU * 0.25 * t) * A;
      p.antR = 0.04 * sin(TAU * 0.25 * t + 1) * A;
      break;
    }
    case 'sleep': {
      p.hover = FOLD_HOVER;
      p.hipDrop = FOLD_HIP;
      foldLegs(p, 1);
      p.armLa = -0.4;
      p.armLb = 1.9;
      p.armRa = 0.4;
      p.armRb = -1.9;
      p.sy = 0.96;
      p.headRot = 0.3;
      p.headY = 4;
      p.headX = 2;
      p.lean = 0.12;
      p.eye = 0;
      p.smile = 0.25;
      p.antDroop = 0.85;
      p.glow = 0.28 + 0.2 * sin(TAU * 0.22 * t);
      p.lookW = 0;
      p.shadow = 0.7;
      p.bob = 0.8;
      p.bobHz = 1.3;
      break;
    }
    case 'wake': {
      const k = sseg(t, 0.1, 0.9);
      p.hover = lerp(FOLD_HOVER, 7, k);
      p.hipDrop = lerp(FOLD_HIP, 0, sseg(t, 0.1, 0.8));
      foldLegs(p, 1 - sseg(t, 0.1, 0.8));
      const up = sseg(t, 0.3, 0.8) * (1 - sseg(t, 1.05, 1.5));
      p.armLa = lerp(-0.4, -2.05, up);
      p.armRa = lerp(0.4, 2.05, up);
      p.armsBack = up > 0.4 ? 1 : 0;
      p.armLb = lerp(1.9, 0, sseg(t, 0.2, 0.7));
      p.armRb = lerp(-1.9, 0, sseg(t, 0.2, 0.7));
      p.sy = 0.96 + 0.1 * up;
      p.headRot = lerp(0.3, 0, k);
      p.headY = lerp(4, 0, k);
      p.eye = sseg(t, 0.15, 0.55);
      p.antDroop = 0.85 * (1 - sseg(t, 0.2, 0.8));
      p.antSpike = sseg(t, 0.85, 1.0) * (1 - sseg(t, 1.1, 1.5));
      p.glow = lerp(0.3, 0.55, k) + 0.4 * sseg(t, 0.85, 1.0) * (1 - sseg(t, 1.1, 1.5));
      p.mouth = 0.3 * sseg(t, 0.4, 0.6) * (1 - sseg(t, 0.9, 1.1));
      break;
    }
    case 'yawn': {
      // The "recharge" stretch: arms overhead, tall, the tips dim, then flare back.
      const u = t / 1.2;
      const stretch = sseg(u, 0.05, 0.4) * (1 - sseg(u, 0.75, 1));
      p.armLa = lerp(-0.2, -2.05, stretch);
      p.armRa = lerp(0.2, 2.05, stretch);
      p.armLb = p.armRb = 0;
      p.armsBack = stretch > 0.4 ? 1 : 0;
      p.sy = 1 + 0.07 * stretch;
      p.sx = 1 - 0.03 * stretch;
      p.hover = 7 + 3 * stretch;
      p.mouth = 0.95 * sseg(u, 0.15, 0.4) * (1 - sseg(u, 0.65, 0.85));
      p.eye = 1 - 0.85 * sseg(u, 0.15, 0.4) * (1 - sseg(u, 0.7, 0.9));
      p.lean = -0.1 * stretch;
      p.glow = 0.55 - 0.35 * sseg(u, 0.1, 0.5) * (1 - sseg(u, 0.6, 0.8)) + 0.45 * sseg(u, 0.8, 0.9) * (1 - sseg(u, 0.9, 1));
      p.antDroop = 0.4 * sseg(u, 0.2, 0.5) * (1 - sseg(u, 0.6, 0.85));
      p.antSpike = sseg(u, 0.82, 0.92) * (1 - sseg(u, 0.92, 1));
      break;
    }
    case 'float': {
      const n = c.n;
      p.hover = 9 + 3 * n;
      p.lean = 0.05 + 0.4 * n;
      p.turn = 0.3;
      const g = sin(c.gait);
      p.legLa = -0.45 - 0.55 * n + 0.18 * g * A;
      p.legLb = -0.3 - 0.2 * n;
      p.legRa = -0.3 - 0.55 * n + 0.18 * -g * A;
      p.legRb = -0.25 - 0.2 * n;
      p.armLa = -0.35 - 0.7 * n;
      p.armLb = -0.2;
      p.armRa = -0.15 - 0.75 * n;
      p.armRb = 0.3;
      p.antL = -0.35 * n;
      p.antR = -0.2 - 0.6 * n;
      p.eye = 1 - 0.2 * n;
      p.smile = 0.3;
      p.shadow = 0.9;
      p.bob = (1.8 + 1.4 * n) * A;
      p.bobHz = 3.4 + 3 * n;
      break;
    }
    case 'hop': {
      const f = fract(c.gait / TAU);
      const air = sin(PI * clamp01(f / 0.8));
      const sq = f > 0.8 ? sin(PI * (f - 0.8) / 0.2) : 0;
      p.hover = 7 + 9 * air * A;
      p.sy = 1 - 0.1 * sq + 0.05 * air;
      p.sx = 1 + 0.1 * sq - 0.03 * air;
      p.armLa = -0.2 - 1.1 * air;
      p.armRa = 0.2 + 1.1 * air;
      p.legLa = -0.3 * air;
      p.legRa = 0.3 * air;
      p.lean = 0.12;
      p.antL = -0.4 * air;
      p.antR = 0.1 - 0.4 * air;
      p.smile = 0.5;
      p.shadow = 1 - 0.3 * air;
      p.bob = 0;
      break;
    }
    case 'crouch': {
      p.hover = 3;
      p.hipDrop = 6;
      p.sy = 0.95;
      p.lean = 0.14;
      p.legLa = -1.0;
      p.legLb = -1.7;
      p.legRa = 1.0;
      p.legRb = 1.7;
      p.armLa = -0.7;
      p.armLb = 0.6;
      p.armRa = -0.2;
      p.armRb = 0.6;
      p.antL = -0.3;
      p.antR = -0.4;
      p.eye = 0.8;
      p.glow = 0.7;
      p.bob = 0.6 * A;
      break;
    }
    case 'jump': {
      p.hover = 10;
      p.sx = 0.93;
      p.sy = 1.09;
      p.armsBack = 1;
      p.armLa = -2.0;
      p.armLb = -0.2;
      p.armRa = 2.0;
      p.armRb = 0.2;
      p.legLa = -0.25 + 0.1 * sin(TAU * 2 * t) * A;
      p.legLb = 0.3;
      p.legRa = 0.2;
      p.legRb = -0.3;
      p.antL = -0.9;
      p.antR = 0.9;
      p.eye = 1.1;
      p.eyeSize = 1.1;
      p.mouth = 0.25;
      p.smile = 0.4;
      p.shadow = 0.5;
      p.bob = 0;
      break;
    }
    case 'fall': {
      const fl = sin(TAU * 2.6 * t) * A;
      p.hover = 12;
      p.sy = 1.05;
      p.sx = 0.97;
      p.armsBack = 1;
      p.armLa = -2.1 - 0.3 * fl;
      p.armLb = -0.3;
      p.armRa = 2.1 + 0.3 * fl;
      p.armRb = 0.3;
      p.legLa = -0.3 + 0.25 * fl;
      p.legRa = 0.3 - 0.25 * fl;
      p.antSpike = 0.8;
      p.antL = -0.2;
      p.antR = 0.2;
      p.eyeSize = 1.18;
      p.mouth = 0.6;
      p.smile = -0.2;
      p.glow = 0.9;
      p.shadow = 0.5;
      p.bob = 0;
      break;
    }
    case 'land': {
      const k = Math.exp(-6.5 * t) * cos(15 * t);
      const d = 0.18 + 0.22 * clamp01(c.impact);
      p.sy = 1 - d * k;
      p.sx = 1 + 0.7 * d * k;
      p.hover = clamp(7 - 6 * k, 0.5, 14);
      p.hipDrop = 3 * Math.max(0, k);
      p.armLa = -0.2 - 0.9 * k;
      p.armRa = 0.2 + 0.9 * k;
      p.legLa = -0.5 * Math.max(0, k);
      p.legRa = 0.5 * Math.max(0, k);
      p.legLb = -0.9 * Math.max(0, k);
      p.legRb = 0.9 * Math.max(0, k);
      p.antL = 0.5 * k;
      p.antR = -0.5 * k;
      p.eye = 1 - 0.7 * Math.max(0, k) * (1 - sseg(t, 0.12, 0.3));
      p.bob = 0.8;
      break;
    }
    case 'startle': {
      const spike = sseg(t, 0, 0.06) * (1 - sseg(t, 0.5, 0.8));
      const hopT = clamp01(t / 0.42);
      p.offY = -7 * sin(PI * hopT) * A;
      p.antSpike = spike;
      p.glow = 0.55 + 0.45 * spike;
      p.eyeSize = 1 + 0.3 * spike;
      p.armLa = -0.2 - 1.1 * spike;
      p.armRa = 0.2 + 1.1 * spike;
      p.armLb = -0.3 * spike;
      p.armRb = 0.3 * spike;
      p.legLa = -0.35 * spike;
      p.legRa = 0.35 * spike;
      p.lean = -0.16 * spike;
      p.mouth = 0.55 * spike;
      p.smile = -0.3 * spike;
      p.sy = 1 + 0.05 * spike;
      p.sx = 1 - 0.03 * spike;
      p.shadow = 1 - 0.3 * sin(PI * hopT);
      break;
    }
    case 'annoyed': {
      p.eye = 0.55;
      p.slant = 0.35;
      p.smile = -0.6;
      p.antDroop = 0.55;
      p.antBend = 0.3;
      p.glow = 0.3;
      p.armLa = -0.3;
      p.armLb = 2.3;
      p.armRa = 0.3;
      p.armRb = -2.3;
      p.headRot = 0.08;
      p.lean = -0.05;
      p.legRa = 0.08 + 0.3 * Math.max(0, sin(TAU * 1.6 * t)) * A;
      p.legRb = -0.1 - 0.3 * Math.max(0, sin(TAU * 1.6 * t)) * A;
      p.bob = 1.0;
      break;
    }
    case 'petted': {
      p.eye = 0.2;
      p.happy = 1;
      p.smile = 0.8;
      p.headRot = 0.16 + 0.03 * sin(TAU * 0.9 * t) * A;
      p.headX = 2;
      p.antBend = 1;
      p.antL = 0.2 * sin(TAU * 0.8 * t) * A;
      p.antR = 0.2 * sin(TAU * 0.8 * t + 1.2) * A;
      p.glow = 0.8 + 0.2 * sin(TAU * 1.1 * t) * A;
      p.armLa = -0.5;
      p.armLb = 1.9;
      p.armRa = 0.5;
      p.armRb = -1.9;
      p.lean = 0.07;
      p.hover = 6.5;
      p.bob = 1.4 * A;
      p.bobHz = 4.2;
      p.offX = 1.2 * sin(TAU * 0.9 * t) * A;
      p.lookW = 0.2;
      break;
    }
    case 'groom': {
      // Antenna tuning: one hand strokes the right antenna, the other wiggles on its own.
      p.armRa = 2.4;
      p.armRb = 0.4 + 0.35 * sin(TAU * 1.4 * t) * A;
      p.antR = 2.3;
      p.antBend = 0.2;
      p.antL = 0.25 * sin(TAU * 2.2 * t) * A;
      p.headRot = 0.18;
      p.turn = 0.6;
      p.eye = 0.8;
      p.glow = 0.55 + 0.45 * sin(TAU * 1.4 * t) * A;
      p.lookW = 0;
      p.smile = 0.3;
      p.bob = 1.2;
      break;
    }
    case 'held': {
      const sw = sin(TAU * 1.3 * t) * A;
      p.hover = 3;
      p.pivScruff = 1;
      p.armLa = -0.5 + 0.2 * sw;
      p.armLb = -0.15;
      p.armRa = 0.5 - 0.2 * sw;
      p.armRb = 0.15;
      p.legLa = -0.1 + 0.18 * sw;
      p.legLb = 0.12;
      p.legRa = 0.1 - 0.18 * sw;
      p.legRb = -0.12;
      p.eyeSize = 1.1;
      p.mouth = 0.3;
      p.smile = -0.3;
      p.antL = -0.15 + 0.15 * sw;
      p.antR = 0.15 + 0.15 * sw;
      p.lookW = 0.3;
      p.shadow = 0.2;
      p.bob = 0.8;
      break;
    }
    case 'hide': {
      p.hover = 2;
      p.hipDrop = 8;
      foldLegs(p, 1);
      p.lean = 0.18;
      p.headY = 2;
      p.headRot = 0.12;
      p.armLa = -2.6;
      p.armLb = -1.08;
      p.armRa = 2.6;
      p.armRb = 1.08;
      p.antDroop = 0.6;
      p.eye = 0.6;
      p.glow = 0.4;
      p.lookW = 0;
      p.offX = 0.4 * sin(TAU * 7 * t) * A;
      p.bob = 0.6;
      break;
    }
    case 'peek': {
      // Hands on an invisible ledge, head rising and ducking, eyes darting.
      const T = 3.2;
      const f = fract(t / T);
      const up = sseg(f, 0.05, 0.3) * (1 - sseg(f, 0.72, 0.85));
      p.hover = 2;
      p.hipDrop = 8;
      foldLegs(p, 1);
      p.headY = lerp(5, -3, up);
      p.headX = 1.5 * sin(TAU * 0.5 * t) * A;
      p.lean = lerp(0.3, 0.05, up);
      p.armLa = -2.0;
      p.armLb = 0.5;
      p.armRa = 2.0;
      p.armRb = -0.5;
      p.turn = sin(TAU * 0.6 * t) * 0.9;
      p.lookW = 0;
      p.eye = lerp(0.35, 1, up);
      p.antDroop = lerp(0.6, 0, up);
      p.antL = 0.25 * sin(TAU * 1.7 * t) * A;
      p.glow = lerp(0.4, 0.8, up);
      p.bob = 0.6;
      break;
    }
    case 'scan': {
      const ph = fract(t / 1.9);
      const sc = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      p.scan = easeInOut(sc);
      p.turn = 0.9 * sin(TAU * 0.38 * t);
      p.headY = (p.scan - 0.5) * 2.4;
      p.headRot = 0.06 * sin(TAU * 0.38 * t + 1) * A;
      p.lookW = 0;
      p.eye = 0.75;
      p.antR = 0.5;
      p.antL = 0.3 * sin(TAU * 1.1 * t) * A;
      p.glow = 0.9;
      p.armRa = 0.6;
      p.armRb = 0.5;
      p.lean = 0.06;
      p.hover = 8;
      break;
    }
    case 'beam': {
      const u = t / 1.4;
      const ch = sseg(u, 0, 0.3) * (1 - sseg(u, 0.88, 1));
      p.beam = u > 0.28 && u < 1 ? (u - 0.28) / 0.72 : -1;
      p.antSpike = ch;
      p.glow = 0.55 + 0.45 * ch;
      p.armLa = lerp(-0.2, -2.2, ch);
      p.armRa = lerp(0.2, 2.2, ch);
      p.armLb = p.armRb = 0;
      p.armsBack = ch > 0.4 ? 1 : 0;
      p.sy = 1 + 0.04 * ch;
      p.hover = 7 + 3 * ch;
      p.eye = 1 - 0.3 * ch;
      p.mouth = 0.35 * sseg(u, 0.3, 0.45) * (1 - sseg(u, 0.8, 0.95));
      p.lookW = 0.3 * (1 - ch);
      break;
    }
    case 'vanish': {
      const u = clamp01(t / 0.9);
      const s = easeInOut(u);
      p.shim = s;
      p.shimDir = 1;
      p.alpha = 1 - Math.pow(s, 1.4);
      p.sx = 1 - 0.55 * s;
      p.sy = 1 + 0.2 * s;
      p.hover = 7 + 8 * s;
      p.glow = 1;
      p.eyeSize = 1.1;
      p.shadow = 1 - s;
      p.lookW = 0;
      break;
    }
    case 'appear': {
      const u = clamp01(t / 0.9);
      const s = 1 - easeInOut(u);
      p.shim = s;
      p.shimDir = -1;
      p.alpha = 1 - Math.pow(s, 1.4);
      p.sx = 1 - 0.55 * s;
      p.sy = 1 + 0.2 * s;
      p.hover = 7 + 8 * s;
      p.glow = 0.55 + 0.45 * s;
      p.shadow = 1 - s;
      p.lookW = 0;
      p.armLa = -0.2 - 0.6 * (1 - u) * sin(PI * u);
      p.armRa = 0.2 + 0.6 * (1 - u) * sin(PI * u);
      break;
    }
    case 'dance': {
      const bt = t * DANCE_HZ;
      const k = Math.floor(bt);
      const u = bt - k;
      const snap = sseg(u, 0, 0.22);
      const r1 = (k & 7) * DANCE_COLS;
      const r0 = ((k + 7) & 7) * DANCE_COLS;
      const m = (i: number): number => lerp(DANCE[r0 + i]!, DANCE[r1 + i]!, snap);
      p.armLa = m(0);
      p.armLb = m(1);
      p.armRa = m(2);
      p.armRb = m(3);
      p.armsBack = Math.abs(p.armLa) > 1.9 || Math.abs(p.armRa) > 1.9 ? 1 : 0;
      p.headRot = m(4) * A;
      p.lean = m(5) * A;
      p.turn = m(6);
      p.offX = m(7) * A;
      p.legLa = m(8);
      p.legRa = m(9);
      p.offY = -2.2 * (1 - snap) * A;
      p.antL = (k & 1 ? 0.35 : -0.15) * A;
      p.antR = (k & 1 ? 0.15 : -0.35) * A;
      p.glow = 0.45 + 0.55 * (1 - u);
      p.smile = 0.5;
      p.lookW = 0;
      p.bob = 0;
      break;
    }
    case 'squish': {
      const u = t / 0.6;
      const k = u < 0.25 ? sseg(u, 0, 0.25) : Math.exp(-9 * (u - 0.25)) * cos(18 * (u - 0.25));
      p.sy = 1 - 0.5 * k;
      p.sx = 1 + 0.35 * k;
      p.hover = Math.max(0, 7 * (1 - Math.max(0, k)));
      p.eye = 1 - 0.8 * Math.max(0, k);
      p.mouth = 0.5 * Math.max(0, -k);
      p.antL = -0.9 * Math.max(0, k);
      p.antR = 0.9 * Math.max(0, k);
      p.armLa = -0.2 - 0.9 * k;
      p.armRa = 0.2 + 0.9 * k;
      p.bob = 0;
      break;
    }
    case 'confused': {
      const w = sin(TAU * 0.6 * t) * A;
      p.headRot = 0.25 * w;
      p.headX = 1.2 * w;
      p.antBend = 0.9;
      p.antL = 0.3;
      p.antR = -0.2 + 0.12 * sin(TAU * 1.3 * t) * A;
      p.armRa = 2.2;
      p.armRb = 1.3;
      p.eyeSize = 1.05;
      p.eye = 0.85;
      p.smile = -0.45;
      p.turn = 0.4 * sin(TAU * 0.6 * t + 1);
      p.lookW = 0;
      p.glow = 0.5;
      break;
    }
    case 'shake': {
      const d = Math.exp(-3 * t);
      const w = sin(TAU * 7 * t);
      p.rot = 0.18 * w * d * A;
      p.offX = 3 * sin(TAU * 7 * t + 1) * d * A;
      p.antL = -0.7 * sin(TAU * 9 * t) * d * A;
      p.antR = 0.7 * sin(TAU * 9 * t + 0.8) * d * A;
      p.armLa = -0.9 * d;
      p.armRa = 0.9 * d;
      p.eye = 1 - 0.65 * d;
      p.glow = 0.55 + 0.3 * d;
      p.bob = 0.8;
      break;
    }
    case 'rollOver': {
      // Levitating barrel roll: wind up, spin once with the legs tucked, settle with a wobble.
      const T = 2.6;
      const tt = t % T;
      const wind = sseg(tt, 0, 0.3) * (1 - sseg(tt, 0.3, 0.4));
      const s = easeInOut(clamp01((tt - 0.3) / 1.5));
      const set = Math.max(0, tt - 1.8);
      p.rot = TAU * s + 0.12 * Math.exp(-5 * set) * sin(14 * set) * A;
      p.hover = 7 + 11 * sin(PI * s) - 4 * wind;
      p.sy = 1 - 0.07 * wind;
      p.sx = 1 + 0.05 * wind;
      const tuck = sin(PI * s);
      p.armLa = -0.2 - 1.4 * tuck;
      p.armRa = 0.2 + 1.4 * tuck;
      foldLegs(p, tuck * 0.9);
      p.eyeSize = 1.1;
      p.smile = 0.6;
      p.antL = -0.5 * tuck;
      p.antR = 0.5 * tuck;
      p.glow = 0.6 + 0.4 * tuck;
      p.lookW = 0;
      p.bob = 0;
      p.shadow = 1 - 0.4 * tuck;
      break;
    }
    case 'stand':
    default: {
      const sw = TAU * 0.45 * t;
      p.antL = 0.07 * sin(sw) * A;
      p.antR = 0.07 * sin(sw + 1.7) * A;
      p.headRot = 0.03 * sin(TAU * 0.3 * t + 0.5) * A;
      p.legLa = -0.08 + 0.05 * sin(TAU * 0.4 * t) * A;
      p.legRa = 0.08 + 0.05 * sin(TAU * 0.4 * t + 2) * A;
      p.armLa = -0.2 + 0.04 * sin(TAU * 0.35 * t) * A;
      p.armRa = 0.2 + 0.04 * sin(TAU * 0.35 * t + 1) * A;
      break;
    }
  }
}
