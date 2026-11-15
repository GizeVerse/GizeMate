// Slime clips: pure functions that write the TARGET of a pose (stretch, lift, lean, face ...) for a clip
// at a time. The renderer eases the real pose towards the target (a spring for the stretch, so every
// squash overshoots and wobbles like jelly). Everything here is allocation-free.
import type { AnimClip } from '../../../../shared/cat';
import { clamp, clamp01, easeInOut, easeOutBack, pulse, smooth, sseg, TAU } from '../../character/kit';

/** The posed target. `s` is the log of the vertical stretch (volume-preserving: width goes the other way). */
export interface Tgt {
  s: number;
  /** Body lifted off the ground (local units). */
  lift: number;
  /** Top shifted sideways per unit of height (+ = towards the facing direction). */
  lean: number;
  /** Extra sideways spread of the base (puddling), 0..1. */
  flat: number;
  /** Top narrowing towards a teardrop, 0..1. */
  tear: number;
  /** Top stretched up into a tip, 0..1. */
  tip: number;
  /** Face height as a fraction of the body height, face slide as a fraction of the half width. */
  faceH: number;
  faceX: number;
  tilt: number;
  eyeOpen: number;
  eyeScale: number;
  /** Eyes drawn as happy arcs (0..1) or as sleepy closed lines (0..1). */
  happy: number;
  sleepEye: number;
  pupX: number;
  pupY: number;
  mouthOpen: number;
  smile: number;
  blush: number;
  /** Bubble: size 0..1 at the mouth, drift 0..1 once released, pop 0..1. */
  bubble: number;
  bubbleRise: number;
  bubblePop: number;
  /** Ripple amplitude of the surface (jelly shimmer). */
  jig: number;
  rot: number;
  ox: number;
  pivX: number;
  pivY: number;
  /** 0..1: the top of the body is pinned to the grip point (held). */
  hold: number;
  scl: number;
  alpha: number;
  /** Puddle lip under the body, 0..1.5. */
  puddle: number;
  /** Spring frequency (rad/s) of the stretch. */
  omega: number;
}

export function createTgt(): Tgt {
  const t = {} as Tgt;
  resetTgt(t);
  return t;
}

export function resetTgt(t: Tgt): void {
  t.s = 0;
  t.lift = 0;
  t.lean = 0;
  t.flat = 0;
  t.tear = 0;
  t.tip = 0;
  t.faceH = 0.58;
  t.faceX = 0;
  t.tilt = 0;
  t.eyeOpen = 1;
  t.eyeScale = 1;
  t.happy = 0;
  t.sleepEye = 0;
  t.pupX = 0;
  t.pupY = 0;
  t.mouthOpen = 0;
  t.smile = 0.55;
  t.blush = 0.12;
  t.bubble = 0;
  t.bubbleRise = 0;
  t.bubblePop = 0;
  t.jig = 0.014;
  t.rot = 0;
  t.ox = 0;
  t.pivX = 0;
  t.pivY = 0;
  t.hold = 0;
  t.scl = 1;
  t.alpha = 1;
  t.puddle = 1;
  t.omega = 26;
}

export interface ClipCtx {
  /** Seconds since the clip started, scaled by animation speed. */
  t: number;
  /** Looping time (slowed by reduced motion). */
  tl: number;
  /** Free-running clock (s). */
  clock: number;
  /** Gait phase 0..1 (bounce and hop). */
  phase: number;
  /** 0..1 speed class. */
  sp: number;
  vy: number;
  impact: number;
  lookX: number;
  lookY: number;
  hasLook: boolean;
  arousal: number;
  depth: number;
  rm: number;
  seed: number;
}

/** Slime-wide numbers shared with the renderer. */
export const H0 = 44;
export const W0 = 27;

const hash01 = (i: number, seed: number): number => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Idle variation layer: a sway, a look around, a wiggle of the top, a ripple, with calm slots in between. */
function idle(T: Tgt, c: ClipCtx, amp: number): void {
  const slotLen = 5.4;
  const pos = c.clock / slotLen + c.seed * 7;
  const slot = Math.floor(pos);
  const f = pos - slot;
  const h = hash01(slot, c.seed);
  const e = Math.sin(Math.PI * f);
  const env = e * e * amp;
  if (h < 0.25) return;
  if (h < 0.45) {
    T.lean += 0.1 * env * Math.sin(TAU * 0.7 * c.clock);
    T.faceX += 0.12 * env * Math.sin(TAU * 0.7 * c.clock + 0.9);
  } else if (h < 0.65) {
    T.faceX += 0.45 * env * Math.sin(TAU * 0.33 * c.clock);
    T.pupX += 0.9 * env * Math.sin(TAU * 0.33 * c.clock + 0.4);
  } else if (h < 0.82) {
    T.tear += 0.35 * env * (0.5 + 0.5 * Math.sin(TAU * 1.4 * c.clock));
    T.tip += 0.2 * env;
    T.s += 0.05 * env;
  } else {
    T.s -= 0.1 * env * Math.sin(TAU * 1.2 * c.clock);
    T.jig += 0.04 * env;
  }
}

function breathe(T: Tgt, c: ClipCtx, amp: number, hz: number): void {
  const k = 1 + 0.6 * c.arousal;
  T.s += amp * Math.sin(TAU * hz * k * c.tl);
  T.jig += 0.006 * (0.5 + 0.5 * Math.sin(TAU * hz * 2 * c.tl));
}

type Sampler = (T: Tgt, c: ClipCtx) => void;

const stand: Sampler = (T, c) => {
  breathe(T, c, 0.028, 0.55);
  idle(T, c, 1);
};

const sit: Sampler = (T, c) => {
  T.s = -0.17;
  T.flat = 0.12;
  T.faceH = 0.56;
  T.eyeOpen = 0.88;
  T.smile = 0.62;
  breathe(T, c, 0.02, 0.4);
  idle(T, c, 0.7);
};

const loaf: Sampler = (T, c) => {
  T.s = -0.4;
  T.flat = 0.22;
  T.faceH = 0.55;
  T.eyeOpen = 0.62;
  T.smile = 0.7;
  T.eyeScale = 0.92;
  breathe(T, c, 0.02, 0.33);
  idle(T, c, 0.3);
};

const sleep: Sampler = (T, c) => {
  const bp = TAU * (0.22 / (1 + c.depth * 0.9)) * c.tl;
  T.s = -0.45 + 0.045 * Math.sin(bp);
  T.flat = 0.08;
  T.faceH = 0.6;
  T.eyeOpen = 0;
  T.sleepEye = 1;
  T.smile = 0.15;
  T.blush = 0.18;
  T.jig = 0.004;
  T.bubble = 0.5 + 0.5 * Math.sin(bp - 0.6);
  T.eyeScale = 0.9;
};

const wake: Sampler = (T, c) => {
  const t = c.t;
  const inflate = sseg(t, 0.25, 1.0);
  T.s = -0.45 + 0.45 * easeOutBack(inflate);
  T.flat = 0.08 * (1 - inflate);
  T.faceH = 0.6 - 0.02 * inflate;
  T.sleepEye = 1 - sseg(t, 0.3, 0.5);
  T.eyeOpen = sseg(t, 0.42, 0.8);
  T.bubble = 0.9 * (1 - sseg(t, 0.1, 0.22)) * (t < 0.22 ? 1 : 0);
  T.bubblePop = sseg(t, 0.18, 0.22);
  T.mouthOpen = 0.5 * pulse(t, 0.3, 0.55, 0.8, 1.05);
  T.smile = 0.3 + 0.3 * sseg(t, 0.9, 1.3);
  T.jig = 0.02 + 0.05 * pulse(t, 0.8, 1.0, 1.1, 1.5);
};

const yawn: Sampler = (T, c) => {
  const t = c.t;
  const k = sseg(t, 0.1, 0.5) * (1 - sseg(t, 0.8, 1.1));
  T.mouthOpen = 1.25 * k;
  T.s = 0.08 * k;
  T.flat = 0.18 * k;
  T.eyeOpen = 1 - 0.85 * k;
  T.faceH = 0.58 + 0.04 * k;
  T.smile = 0.3;
  breathe(T, c, 0.012, 0.5);
};

const crouch: Sampler = (T, c) => {
  T.s = -0.36;
  T.flat = 0.15;
  T.lean = 0.09 * Math.sin(TAU * 6 * c.tl);
  T.faceH = 0.56;
  T.eyeScale = 1.08;
  T.jig = 0.03;
  T.omega = 32;
};

const jump: Sampler = (T, c) => {
  const e = clamp(Math.abs(c.vy) / 700, 0, 1);
  const k = sseg(c.t, 0, 0.12);
  T.s = -0.22 + (0.34 + 0.3 * e) * k;
  T.tear = 0.3 * k;
  T.tip = 0.15 * e * k;
  T.lean = 0.1;
  T.eyeScale = 1.1;
  T.mouthOpen = 0.3 * k;
  T.faceH = 0.62;
  T.jig = 0.03;
  T.puddle = 0;
  T.omega = 36;
};

const fall: Sampler = (T, c) => {
  const e = clamp(Math.abs(c.vy) / 900, 0, 1);
  T.s = 0.18 + 0.4 * e;
  T.tear = 0.12 + 0.4 * e;
  T.tip = 0.2 * e;
  T.lean = 0.05;
  T.eyeScale = 1.2;
  T.mouthOpen = 0.6;
  T.faceH = 0.5;
  T.jig = 0.05;
  T.puddle = 0;
  T.omega = 34;
};

const land: Sampler = (T, c) => {
  const A = 0.35 + 0.35 * clamp01(c.impact);
  const u = clamp01(c.t / 0.25);
  T.s = -A * (1 - sseg(c.t, 0, 0.22));
  T.flat = 0.2 * A * (1 - u);
  T.eyeOpen = 0.35 + 0.65 * sseg(c.t, 0.05, 0.25);
  T.mouthOpen = 0.25 * (1 - u);
  T.jig = 0.02 + 0.05 * (1 - u);
  T.puddle = 1 + 0.5 * (1 - u);
  T.omega = 34;
};

const startle: Sampler = (T, c) => {
  const t = c.t;
  const spike = sseg(t, 0, 0.1) * (1 - sseg(t, 0.28, 0.38));
  const splat = pulse(t, 0.3, 0.4, 0.46, 0.7);
  const settle = 1 - sseg(t, 0.4, 0.8);
  T.s = 0.42 * spike - 0.45 * splat;
  T.tear = 0.5 * spike;
  T.tip = 0.3 * spike;
  T.lift = 9 * pulse(t, 0, 0.12, 0.26, 0.4);
  T.flat = 0.15 * splat;
  T.eyeScale = 1.12 + 0.3 * settle;
  T.mouthOpen = 0.8 * (1 - sseg(t, 0.15, 0.5));
  T.jig = 0.02 + 0.08 * settle;
  T.lean = 0.08 * Math.sin(TAU * 14 * t) * (1 - sseg(t, 0.3, 0.8));
  T.faceH = 0.6;
  T.smile = 0.2;
  T.omega = 38;
};

const annoyed: Sampler = (T, c) => {
  T.s = -0.15;
  T.flat = 0.2;
  T.eyeOpen = 0.5;
  T.smile = -0.6;
  T.blush = 0;
  T.faceH = 0.55;
  T.lean = 0.015 * Math.sin(TAU * 9 * c.tl);
  T.jig = 0.012;
  breathe(T, c, 0.03, 0.8);
};

const confused: Sampler = (T, c) => {
  T.s = 0.04;
  T.tilt = 0.4 * Math.sin(TAU * 0.6 * c.tl);
  T.tear = 0.2 + 0.15 * Math.sin(TAU * 0.6 * c.tl + 1);
  T.pupX = 0.8 * Math.sin(TAU * 0.9 * c.tl);
  T.smile = -0.15;
  T.lean = 0.06 * Math.sin(TAU * 0.5 * c.tl);
  T.faceX = 0.12 * Math.sin(TAU * 0.6 * c.tl + 0.5);
  T.eyeOpen = 0.95;
  breathe(T, c, 0.015, 0.5);
};

const petted: Sampler = (T, c) => {
  const burst = 0.5 + 0.5 * Math.sin(TAU * 0.9 * c.tl);
  const a = 0.45 + 0.55 * burst;
  T.s = -0.08 + 0.06 * a * Math.sin(TAU * 5 * c.tl);
  T.lean = 0.06 * a * Math.sin(TAU * 3 * c.tl);
  T.flat = 0.08;
  T.happy = 1;
  T.eyeOpen = 0;
  T.blush = 1;
  T.mouthOpen = 0.3 + 0.25 * burst;
  T.smile = 1;
  T.jig = 0.045 * a;
  T.tilt = 0.12 * Math.sin(TAU * 1.5 * c.tl);
  T.faceH = 0.56;
  T.omega = 30;
};

const held: Sampler = (T, c) => {
  const sw = Math.sin(TAU * 0.9 * c.tl);
  T.s = 0.24 + 0.02 * Math.sin(TAU * 1.8 * c.tl);
  T.tear = 0.9;
  T.tip = 0.15;
  T.hold = 1;
  T.ox = -8;
  T.pivX = -8;
  T.pivY = -58;
  T.rot = 0.1 * sw;
  T.lean = -0.14 * Math.sin(TAU * 0.9 * c.tl - 0.8);
  T.eyeScale = 1.12;
  T.mouthOpen = 0.45;
  T.smile = 0.3;
  T.faceH = 0.46;
  T.jig = 0.035;
  T.puddle = 0;
  T.omega = 20;
};

const hide: Sampler = (T, c) => {
  T.s = -0.7;
  T.flat = 0.1;
  T.faceH = 0.62;
  T.eyeOpen = 0.85;
  T.eyeScale = 0.9;
  T.smile = 0.3;
  T.pupX = 0.7 * Math.sin(TAU * 0.25 * c.tl);
  T.jig = 0.02;
  breathe(T, c, 0.02, 0.45);
};

const peek: Sampler = (T, c) => {
  const cyc = c.tl % 3.6;
  const up = pulse(cyc, 0.6, 1.1, 2.3, 2.7);
  T.s = -0.7 + 0.62 * up;
  T.flat = 0.1 * (1 - up);
  T.faceH = 0.62 - 0.04 * up;
  T.faceX = 0.4 * up * Math.sin(TAU * 0.45 * c.tl);
  T.pupX = 1.2 * Math.sin(TAU * 0.45 * c.tl);
  T.eyeOpen = 0.85 + 0.2 * up;
  T.tear = 0.15 * up;
  T.smile = 0.3 + 0.4 * up;
  T.jig = 0.02;
};

const squish: Sampler = (T, c) => {
  const t = c.t;
  const press = pulse(t, 0, 0.12, 0.2, 0.36);
  T.s = -0.58 * press + 0.25 * pulse(t, 0.3, 0.4, 0.5, 0.62);
  T.flat = 0.15 * press;
  T.happy = 0.8 * pulse(t, 0.05, 0.15, 0.3, 0.45);
  T.eyeOpen = 1 - 0.8 * pulse(t, 0.05, 0.15, 0.3, 0.45);
  T.mouthOpen = 0.3 * press;
  T.jig = 0.02 + 0.06 * sseg(t, 0.35, 0.5) * (1 - sseg(t, 0.5, 0.6));
  T.blush = 0.6 * press + 0.12;
  T.omega = 36;
};

const stretch: Sampler = (T, c) => {
  const t = c.t;
  const crouchK = pulse(t, 0, 0.25, 0.3, 0.4);
  const up = pulse(t, 0.35, 0.7, 1.15, 1.55);
  const dirX = c.hasLook ? clamp(c.lookX / Math.max(40, Math.abs(c.lookY) + 20), -1.2, 1.2) : 0.4;
  T.s = -0.28 * crouchK + 0.62 * up + 0.04 * Math.sin(TAU * 5 * t) * up;
  T.tear = 0.35 * up;
  T.tip = 0.2 * up;
  T.lean = 0.28 * dirX * up;
  T.eyeScale = 1 + 0.12 * up;
  T.smile = 0.5;
  T.mouthOpen = 0.2 * up;
  T.faceX = 0.2 * dirX * up;
  T.pupX = 1.4 * dirX * up;
  T.faceH = 0.6;
  T.jig = 0.02 + 0.04 * up;
  T.omega = 24;
};

const dance: Sampler = (T, c) => {
  const b = TAU * 2.1 * c.tl;
  const half = Math.sin(b / 2);
  T.s = -0.16 * Math.cos(b);
  T.lift = 3.5 * Math.max(0, Math.sin(b + 1.2));
  T.lean = 0.2 * half;
  T.faceX = 0.15 * Math.sin(b / 2 + 1);
  T.happy = smooth(half * 2);
  T.eyeOpen = 1 - T.happy;
  T.blush = 0.55;
  T.mouthOpen = 0.35;
  T.smile = 0.9;
  T.jig = 0.05;
  T.tear = 0.15 * (0.5 + 0.5 * Math.sin(b + 0.5));
  T.tilt = 0.25 * half;
  T.omega = 30;
};

// Shapes the scan clip tries on: tall, flat, ball. [s, flat, tear, faceH]
const SHAPES = [
  [0.46, 0, 0.25, 0.62],
  [-0.5, 0.12, 0, 0.58],
  [0.18, 0, 0, 0.55],
] as const;

const scan: Sampler = (T, c) => {
  const pos = c.tl / 1.7;
  const i = Math.floor(pos);
  const f = sseg(pos - i, 0, 0.35);
  const a = SHAPES[(i + 2) % 3]!;
  const b = SHAPES[i % 3]!;
  T.s = a[0] + (b[0] - a[0]) * f;
  T.flat = a[1] + (b[1] - a[1]) * f;
  T.tear = a[2] + (b[2] - a[2]) * f;
  T.faceH = a[3] + (b[3] - a[3]) * f;
  T.faceX = 0.35 * Math.sin(TAU * 0.4 * c.tl);
  T.pupX = 1.3 * Math.sin(TAU * 0.4 * c.tl + 0.3);
  T.eyeScale = 1.08;
  T.smile = 0.6;
  T.jig = 0.025;
  T.omega = 22;
};

const beam: Sampler = (T, c) => {
  const t = c.t;
  const inhale = pulse(t, 0, 0.25, 0.3, 0.4);
  const blow = sseg(t, 0.3, 0.95);
  const pop = sseg(t, 1.28, 1.4);
  T.s = 0.1 * inhale - 0.06 * blow;
  T.lean = -0.05 * inhale;
  T.mouthOpen = 0.35 * sseg(t, 0.28, 0.4) * (1 - sseg(t, 0.95, 1.1));
  T.eyeOpen = 0.85;
  T.blush = 0.4;
  T.bubble = blow * (1 - pop);
  T.bubbleRise = sseg(t, 0.95, 1.4);
  T.bubblePop = pop;
  T.smile = 0.6;
  T.jig = 0.02;
  if (t >= 1.4) T.bubble = 0;
};

const shake: Sampler = (T, c) => {
  const t = c.t;
  const decay = 1 - sseg(t, 0.1, 1.0);
  T.lean = 0.28 * Math.sin(TAU * 8.5 * t) * decay;
  T.s = 0.07 * Math.sin(TAU * 17 * t) * decay;
  T.jig = 0.02 + 0.08 * decay;
  T.eyeOpen = 1 - 0.45 * decay;
  T.mouthOpen = 0.3 * decay;
  T.flat = 0.1 * decay;
  T.omega = 34;
};

const vanish: Sampler = (T, c) => {
  const u = clamp01(c.t / 0.9);
  const k = 1 - c.rm;
  T.s = -0.75 * easeInOut(u) * k;
  T.flat = 0.15 * easeInOut(u) * k;
  T.alpha = 1 - smooth((u - 0.2) / 0.8);
  T.eyeOpen = 1 - 0.5 * u;
  T.smile = 0.4;
  T.jig = 0.02;
};

const appear: Sampler = (T, c) => {
  const u = clamp01(c.t / 0.9);
  const k = 1 - c.rm;
  T.s = (-0.75 + 0.75 * easeOutBack(u)) * k;
  T.flat = 0.15 * (1 - easeInOut(u)) * k;
  T.alpha = smooth(u / 0.7);
  T.eyeOpen = 0.5 + 0.5 * sseg(c.t, 0.3, 0.8);
  T.smile = 0.6;
  T.jig = 0.02 + 0.05 * pulse(c.t, 0.5, 0.7, 0.8, 1.2);
};

/** Bounce cycle (phase 0..1): squash, push-off, stretch in the air, round apex, falling stretch, splat, rebound. */
const bounce: Sampler = (T, c) => {
  const p = c.phase;
  const amp = 8 + 22 * c.sp;
  const g = 0.42 + 0.2 * c.sp;
  let s: number;
  let lift = 0;
  let air = 0;
  if (p < 0.18) {
    s = -0.05 - 0.27 * smooth(p / 0.18);
  } else if (p < 0.24) {
    s = -0.32 + 0.64 * smooth((p - 0.18) / 0.06);
  } else if (p < 0.78) {
    const q = (p - 0.24) / 0.54;
    lift = amp * 4 * q * (1 - q);
    const vel = Math.abs(1 - 2 * q);
    s = 0.04 + 0.3 * vel * (q < 0.5 ? 1 : 0.8) - 0.1 * (1 - vel) * (1 - vel);
    air = 1;
  } else if (p < 0.9) {
    const u = (p - 0.78) / 0.12;
    s = 0.3 * (1 - smooth(u * 2)) * (u < 0.5 ? 1 : 0) - g * Math.sin(Math.PI * Math.min(1, u));
  } else {
    s = -0.1 * (1 - smooth((p - 0.9) / 0.1)) - 0.05;
  }
  T.s = s;
  T.lift = lift;
  T.flat = s < -0.2 ? 0.25 * clamp01((-s - 0.2) / 0.3) : 0;
  T.tear = 0.35 * Math.max(0, s) * 2.2;
  T.tip = 0.2 * Math.max(0, s - 0.1) * 3;
  T.lean = 0.08 * air * (0.5 + c.sp);
  T.eyeScale = 1 + 0.06 * air;
  T.mouthOpen = 0.35 * air;
  T.eyeOpen = s < -0.3 ? 0.7 : 1;
  T.faceH = 0.58 + 0.04 * air;
  T.jig = 0.025 + 0.03 * c.sp;
  T.puddle = air ? 0 : 1;
  T.omega = 38;
};

const hop: Sampler = (T, c) => {
  const p = c.phase;
  const amp = 5 + 7 * c.sp;
  let s: number;
  let lift = 0;
  if (p < 0.25) s = -0.04 - 0.2 * smooth(p / 0.25);
  else if (p < 0.34) s = -0.24 + 0.46 * smooth((p - 0.25) / 0.09);
  else if (p < 0.8) {
    const q = (p - 0.34) / 0.46;
    lift = amp * 4 * q * (1 - q);
    s = 0.2 * Math.abs(1 - 2 * q) * (1 - 0.5 * (1 - Math.abs(1 - 2 * q))) - 0.02;
  } else if (p < 0.9) s = -0.3 * Math.sin((Math.PI * (p - 0.8)) / 0.1);
  else s = -0.05;
  T.s = s;
  T.lift = lift;
  T.flat = s < -0.15 ? 0.12 : 0;
  T.tear = 0.2 * Math.max(0, s) * 2;
  T.lean = 0.05 * (lift > 0.5 ? 1 : 0);
  T.mouthOpen = lift > 0.5 ? 0.2 : 0;
  T.jig = 0.022;
  T.puddle = lift > 0.5 ? 0 : 1;
  T.omega = 36;
};

const TABLE: Partial<Record<AnimClip, Sampler>> = {
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
  confused,
  petted,
  held,
  shake,
  hide,
  bounce,
  hop,
  vanish,
  appear,
  squish,
  stretch,
  scan,
  beam,
  peek,
  dance,
};

/** Writes the target of a native clip (anything else is a stand: the renderer resolves aliases first). */
export function sampleClip(clip: AnimClip, T: Tgt, c: ClipCtx): void {
  (TABLE[clip] ?? stand)(T, c);
}

export const isNativeClip = (clip: AnimClip): boolean => TABLE[clip] !== undefined;
