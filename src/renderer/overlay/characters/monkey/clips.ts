// Monkey clips: each one authors a Pose from a ClipContext (time, gait cycle, flight state, motion
// scale). Posture presets are shared; clips blend or modulate them. The animator adds breathing,
// blinks, look-at, idle episodes, mood and reactions on top.
import { HELD_SCRUFF } from '../../cat/clips';
import { clamp, clamp01, easeInOut, lerp, pulse, seg, smooth, sseg, TAU, wrap01 } from '../../character/kit';
import { blendPose, copyPose, createPose, GROUND, resetPose, type Pose } from './rig';

export interface ClipContext {
  /** Seconds since the clip started (animation speed applied). */
  t: number;
  /** Gait cycle phase, 0..1 (wrapped). */
  cyc: number;
  /** Anchor speed, DIP/s (size 1). */
  speed: number;
  /** Planted-limb stride for the gait clips, DIP. */
  stride: number;
  vy: number;
  impact: number;
  /** Motion scale: 1 normally, small under reduced motion. */
  k: number;
  lookX: number;
  lookY: number;
  hasLook: boolean;
  arousal: number;
  contentment: number;
  /** Seconds airborne (jump/fall). */
  airT: number;
  /** A big leap: the jump becomes a backflip. */
  flip: boolean;
  /** 0..1 how engaged with the wall a climb is; 0 holds still. */
  engage: number;
  /** Climb direction: 1 up, -1 down. */
  dir: number;
  /** Swing state of the dangling clips (held / swing), radians. */
  sway: number;
  sleepDepth: number;
}

export type ClipFn = (p: Pose, c: ClipContext) => void;

const sinT = (c: ClipContext, hz: number, ph = 0): number => Math.sin(TAU * hz * c.t + ph) * c.k;
const A = createPose();
const B = createPose();

// ---------------------------------------------------------------------------------------------
// Posture presets

export function standPose(p: Pose): void {
  resetPose(p);
}

export function sitPose(p: Pose): void {
  resetPose(p);
  p.hipX = -8;
  p.hipY = -10;
  p.lean = 0.2;
  p.neckBend = -0.1;
  p.headRot = 0.04;
  p.turn = 0.6;
  p.footNx = 8;
  p.footFx = 2;
  p.handNx = 14;
  p.handNy = GROUND;
  p.handFx = 5;
  p.handFy = GROUND;
  p.tailBase = -0.35;
  p.tailCurl = 2.6;
  p.tailBend = 0.4;
  p.tailStiff = 0.15;
}

function loafPose(p: Pose): void {
  sitPose(p);
  p.hipX = -10;
  p.hipY = -8;
  p.lean = 0.78;
  p.neckBend = 0.02;
  p.headRot = 0.34;
  p.eyeOpen = 0.55;
  p.smile = 0.25;
  p.handNx = 17;
  p.handFx = 9;
  p.footNx = 5;
  p.footFx = -1;
  p.tailBase = -0.6;
  p.tailCurl = 1.8;
}

function sleepPose(p: Pose): void {
  sitPose(p);
  p.hipX = -9;
  p.hipY = -8;
  p.lean = 0.66;
  p.neckBend = 0.36;
  p.headRot = 0.95;
  p.turn = 0.3;
  p.eyeOpen = 0;
  p.smile = 0.15;
  p.mouth = 0.12;
  p.handNx = 10;
  p.handNy = -9;
  p.handFx = 4;
  p.handFy = -7;
  p.footNx = 6;
  p.footFx = 0;
  p.bendN = 1;
  p.tailBase = -0.7;
  p.tailCurl = 2.2;
  p.tailStiff = 0.1;
  p.lookW = 0;
}

function crouchPose(p: Pose): void {
  resetPose(p);
  p.hipX = -10;
  p.hipY = -14;
  p.lean = 1.0;
  p.neckBend = -0.7;
  p.headRot = 0.05;
  p.turn = 0.7;
  p.smile = 0.2;
  p.handNx = 19;
  p.handNy = GROUND;
  p.handFx = 12;
  p.handFy = GROUND;
  p.bendN = 1;
  p.bendF = 1;
  p.footNx = 0;
  p.footFx = -6;
  p.tailBase = 0.55;
  p.tailCurl = 2.8;
  p.lookW = 0.8;
}

function hidePose(p: Pose): void {
  resetPose(p);
  p.hipX = -8;
  p.hipY = -10;
  p.lean = 1.0;
  p.neckBend = 0.05;
  p.headRot = 0.55;
  p.turn = 0.5;
  p.eyeOpen = 0.7;
  p.smile = -0.2;
  p.footNx = 4;
  p.footFx = -2;
  p.tailBase = -0.5;
  p.tailCurl = 3;
  p.tailBend = 0.6;
  p.tailStiff = 0.2;
  p.lookW = 0;
}

let HX = 0;
let HY = 0;
/** Head centre of a pose (pose space), into HX/HY. */
function headOf(p: Pose): void {
  const L = 26 * p.spineK;
  const ha = p.lean + p.neckBend;
  HX = p.hipX + Math.sin(p.lean) * L + Math.sin(ha) * 10.5 + p.headDX;
  HY = p.hipY - Math.cos(p.lean) * L - Math.cos(ha) * 10.5 + p.headDY;
}

/** Hands over the face (hide, peek): the hands cover the eyes and part (rise) as `open` grows. */
function handsOnFace(p: Pose, open: number): void {
  headOf(p);
  p.handNx = HX + 7;
  p.handNy = HY + 0.5 - open * 8;
  p.handFx = HX + 11;
  p.handFy = HY + 2 - open * 9;
  p.bendN = -1;
  p.bendF = -1;
  p.gripN = 0;
  p.gripF = 0;
}

/** Arms thrown straight up (stretch, wake, victory). */
function armsUp(p: Pose, k: number): void {
  p.handNx = lerp(p.handNx, p.hipX + 12, k);
  p.handNy = lerp(p.handNy, p.hipY - 70, k);
  p.handFx = lerp(p.handFx, p.hipX + 5, k);
  p.handFy = lerp(p.handFy, p.hipY - 72, k);
  p.bendN = lerp(p.bendN, -0.4, k);
  p.bendF = lerp(p.bendF, -0.4, k);
}

// ---------------------------------------------------------------------------------------------
// Rest clips

function clipStand(p: Pose, c: ClipContext): void {
  standPose(p);
  p.hipY += 0.35 * sinT(c, 0.21);
  p.lean += 0.02 * sinT(c, 0.17, 1);
  p.handNx += 0.8 * sinT(c, 0.3);
  p.handFx -= 0.8 * sinT(c, 0.3, 1);
  p.tailBase += 0.12 * sinT(c, 0.35);
  p.tailCurl += 0.35 * sinT(c, 0.28, 2);
}

function clipSit(p: Pose, c: ClipContext): void {
  sitPose(p);
  p.headDY += 0.25 * sinT(c, 0.18);
  p.tailCurl += 0.25 * sinT(c, 0.22);
}

function clipLoaf(p: Pose, c: ClipContext): void {
  loafPose(p);
  const ct = clamp01(c.contentment);
  p.eyeOpen = lerp(0.62, 0.35, ct);
  p.headRot += 0.04 * sinT(c, 0.12);
  p.tailCurl += 0.2 * sinT(c, 0.15);
}

function clipSleep(p: Pose, c: ClipContext): void {
  sleepPose(p);
  // The breathing layer is the only motion; a tiny settle in the head.
  p.headRot += 0.02 * sinT(c, 0.07 * (1 - 0.5 * c.sleepDepth));
  p.mouth = 0.1 + 0.05 * (0.5 + 0.5 * sinT(c, 0.1));
}

function clipWake(p: Pose, c: ClipContext): void {
  sleepPose(A);
  sitPose(B);
  const t = c.t;
  // 0..0.5 lifts out of the slump, 0.4..1.2 big yawning stretch, 1.2..1.6 settle with a scratch.
  const rise = sseg(t, 0.05, 0.55);
  blendPose(p, A, B, rise);
  const st = pulse(t, 0.4, 0.8, 1.1, 1.4);
  armsUp(p, st);
  p.lean = lerp(p.lean, -0.12, st);
  p.neckBend = lerp(p.neckBend, 0.15, st);
  p.headRot = lerp(p.headRot, -0.3, st);
  p.mouth = Math.max(p.mouth, st * 0.95);
  p.eyeOpen = lerp(0.1, 1, sseg(t, 0.15, 0.6)) * (1 - 0.85 * st) + 0.0;
  p.eyeOpen = clamp01(p.eyeOpen + sseg(t, 1.2, 1.4) * 0.9);
  p.footNx = lerp(p.footNx, 12, st * 0.5);
  p.handNx += 0;
  const sc = pulse(t, 1.15, 1.25, 1.5, 1.6);
  p.handNx = lerp(p.handNx, p.hipX + 20, sc);
  p.handNy = lerp(p.handNy, p.hipY - 52 + 3 * Math.sin(t * 38), sc);
  p.bendN = lerp(p.bendN, -1, sc);
  p.tailCurl += 0.5 * Math.sin(t * 3) * c.k;
}

function clipYawn(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  const w = pulse(t, 0.1, 0.45, 0.8, 1.15);
  p.mouth = w;
  p.headRot = lerp(p.headRot, -0.4, w);
  p.neckBend = lerp(p.neckBend, 0.05, w);
  p.eyeOpen = 1 - 0.95 * w;
  p.brow = 0.4 * w;
  p.handNx = lerp(p.handNx, p.hipX + 22, w * 0.6);
  p.handNy = lerp(p.handNy, p.hipY - 40, w * 0.6);
  p.bendN = lerp(p.bendN, -0.6, w * 0.6);
  p.lean -= 0.1 * w;
  p.lookW = 0;
}

// ---------------------------------------------------------------------------------------------
// Gaits

function stance(ph: number, duty: number, stride: number, lift: number, out: [number, number]): void {
  const f = wrap01(ph);
  if (f < duty) {
    out[0] = stride * (0.5 - f / duty);
    out[1] = 0;
  } else {
    const s = (f - duty) / (1 - duty);
    out[0] = stride * (-0.5 + easeInOut(s));
    out[1] = -lift * Math.sin(Math.PI * s);
  }
}
const SW: [number, number] = [0, 0];

function clipWalk(p: Pose, c: ClipContext): void {
  standPose(p);
  p.hipX = -6;
  p.hipY = -21;
  p.lean = 0.82;
  p.neckBend = -0.66;
  p.headRot = 0.06;
  p.turn = 0.65;
  const duty = 0.62;
  const ph = c.cyc;
  const st = c.stride;
  const bob = Math.abs(Math.sin(Math.PI * 2 * ph + 0.3));
  p.hipY += -1.6 * bob * Math.min(1, st / 8);
  p.lean += 0.035 * Math.sin(TAU * ph) * Math.min(1, st / 8);
  p.headDY += 0.8 * bob;
  stance(ph, duty, st, 5, SW);
  p.footNx = 0 + SW[0];
  p.footNy = GROUND + SW[1];
  stance(ph + 0.5, duty, st, 5, SW);
  p.footFx = -5 + SW[0];
  p.footFy = GROUND + SW[1];
  stance(ph + 0.58, duty, st, 7, SW);
  p.handNx = 17 + SW[0];
  p.handNy = GROUND + SW[1];
  stance(ph + 0.08, duty, st, 7, SW);
  p.handFx = 11 + SW[0];
  p.handFy = GROUND + SW[1];
  p.gripN = 1;
  p.gripF = 1;
  p.tailBase = 0.7;
  p.tailCurl = 3.4;
  p.tailStiff = 0.3;
  p.smile = 0.35;
  p.lookW = 0.6;
}

function clipRun(p: Pose, c: ClipContext): void {
  standPose(p);
  p.hipX = -9;
  p.hipY = -19;
  p.lean = 1.1;
  p.neckBend = -0.85;
  p.headRot = 0.02;
  p.turn = 0.75;
  p.mouth = 0.18;
  p.smile = 0.5;
  const duty = 0.4;
  const ph = c.cyc;
  const st = Math.max(c.stride, 12);
  // Bound: the body rises in the flight phases between hand and foot landings.
  const fl = Math.max(0, Math.sin(TAU * (ph - 0.22)));
  p.hipY += -4.5 * fl * Math.min(1, st / 20);
  p.lean += 0.08 * Math.sin(TAU * (ph + 0.1));
  stance(ph + 0.0, duty, st, 8, SW);
  p.handNx = 21 + SW[0];
  p.handNy = GROUND + SW[1];
  stance(ph + 0.07, duty, st, 8, SW);
  p.handFx = 17 + SW[0];
  p.handFy = GROUND + SW[1];
  stance(ph + 0.48, duty, st, 8, SW);
  p.footNx = 4 + SW[0];
  p.footNy = GROUND + SW[1];
  stance(ph + 0.54, duty, st, 8, SW);
  p.footFx = -2 + SW[0];
  p.footFy = GROUND + SW[1];
  p.gripN = 1;
  p.gripF = 1;
  p.tailBase = 0.4;
  p.tailCurl = 2.6;
  p.tailStiff = 0.55;
  p.lookW = 0.4;
}

function clipCrouch(p: Pose, c: ClipContext): void {
  crouchPose(p);
  const w = sinT(c, 2.4);
  p.hipX += 1.8 * w;
  p.tailBase += 0.25 * w;
  p.hipY += 0.5 * Math.abs(w);
  p.handNx += 0.5 * sinT(c, 0.5);
  p.smile = 0.5;
}

// ---------------------------------------------------------------------------------------------
// Physics clips

function clipJump(p: Pose, c: ClipContext): void {
  const rising = c.vy < 0;
  const arms = rising ? 1 : 0.6;
  standPose(p);
  p.hipX = -6;
  p.hipY = -26;
  p.lean = 0.2;
  p.spineK = 1.08;
  p.neckBend = -0.1;
  p.headRot = -0.1;
  p.turn = 0.7;
  p.mouth = 0.45;
  p.smile = 0.6;
  p.brow = 0.4;
  p.handNx = 18 + 4 * arms;
  p.handNy = -72;
  p.handFx = 9 + 3 * arms;
  p.handFy = -75;
  p.bendN = -0.5;
  p.bendF = -0.5;
  p.footNx = -13;
  p.footNy = -13;
  p.footFx = -5;
  p.footFy = -8;
  p.legBend = -1;
  p.tailBase = 0.25;
  p.tailCurl = 2.2;
  p.tailStiff = 0.5;
  p.shadow = 0.6;
  p.sy = 1.04;
  if (c.flip && c.k > 0.6) flipPose(p, c);
  else {
    p.lookW = 0.2;
    p.pivX = 0;
    p.pivY = -30;
  }
}

/** The acrobatic backflip: tuck, rotate once about the body centre, open for the landing. */
function flipPose(p: Pose, c: ClipContext): void {
  const s = clamp01(c.airT / 0.82);
  const tuck = pulse(s, 0.08, 0.3, 0.7, 0.92);
  p.pivX = p.hipX + 5;
  p.pivY = p.hipY - 10;
  p.rot = -TAU * easeInOut(s);
  p.handNx = lerp(p.handNx, p.hipX + 16, tuck);
  p.handNy = lerp(p.handNy, p.hipY - 2, tuck);
  p.handFx = lerp(p.handFx, p.hipX + 12, tuck);
  p.handFy = lerp(p.handFy, p.hipY + 4, tuck);
  p.footNx = lerp(p.footNx, p.hipX + 9, tuck);
  p.footNy = lerp(p.footNy, p.hipY + 7, tuck);
  p.footFx = lerp(p.footFx, p.hipX + 5, tuck);
  p.footFy = lerp(p.footFy, p.hipY + 9, tuck);
  p.lean = lerp(p.lean, 0.9, tuck);
  p.spineK = lerp(p.spineK, 0.92, tuck);
  p.neckBend = lerp(p.neckBend, 0.2, tuck);
  p.shadow = 0.5;
}

function clipFall(p: Pose, c: ClipContext): void {
  const v = clamp01(Math.abs(c.vy) / 700);
  standPose(p);
  p.hipX = -6;
  p.hipY = -27;
  p.lean = 0.28;
  p.spineK = 1.05;
  p.neckBend = -0.2;
  p.headRot = -0.15;
  p.turn = 0.7;
  p.mouth = 0.5 + 0.3 * v;
  p.eyeOpen = 1;
  p.brow = 0.7;
  p.smile = -0.1;
  const fl = sinT(c, 3.2);
  // Hands reach up and ahead to grab something; legs paddle.
  p.handNx = 17 + 3 * fl;
  p.handNy = -70 - 3 * v;
  p.handFx = 7 - 3 * fl;
  p.handFy = -72 - 3 * v;
  p.bendN = -0.6;
  p.bendF = -0.6;
  p.footNx = -4 + 4 * fl;
  p.footNy = -4 - 2 * fl;
  p.footFx = -10 - 4 * fl;
  p.footFy = -3 + 2 * fl;
  p.gripN = 0;
  p.gripF = 0;
  p.tailBase = 0.9;
  p.tailCurl = 2.0;
  p.tailStiff = 0.7;
  p.shadow = 0.55;
  p.sy = 1.03;
  if (c.flip && c.k > 0.6) flipPose(p, c);
  else {
    p.pivX = 0;
    p.pivY = -30;
  }
}

function clipLand(p: Pose, c: ClipContext): void {
  const hard = clamp(c.impact, 0, 1);
  crouchPose(p);
  const t = c.t;
  const w = t < 0.07 ? t / 0.07 : 1 - sseg(t, 0.07, 0.26);
  standPose(A);
  copyPose(B, p);
  B.hipY = lerp(-14, -9, hard);
  B.lean = 0.8;
  B.handNx = 17 + 4 * hard;
  B.handFx = 7 - 3 * hard;
  B.footNx = 6;
  B.footFx = -4;
  B.eyeOpen = 0.6;
  B.mouth = 0.1;
  blendPose(p, A, B, w * (0.65 + 0.35 * hard));
  p.pivX = 0;
  p.pivY = 0;
  p.sy = 1 - (0.1 + 0.08 * hard) * w;
  p.sx = 1 + (0.07 + 0.06 * hard) * w;
  p.tailBase += 0.5 * w;
  p.lookW = 0.2;
}

function clipStartle(p: Pose, c: ClipContext): void {
  const t = c.t;
  standPose(A);
  A.lean = 0.2;
  A.hipY = -27;
  A.handNx = 27;
  A.handNy = -76;
  A.handFx = -12;
  A.handFy = -80;
  A.bendN = -0.5;
  A.bendF = -0.5;
  A.eyeOpen = 1;
  A.brow = 1;
  A.mouth = 0.85;
  A.smile = -0.4;
  A.neckBend = -0.1;
  A.headRot = -0.2;
  A.footNx = -2;
  A.footFx = -9;
  A.tailPuff = 1;
  A.tailBase = 1.1;
  A.tailCurl = 2.6;
  crouchPose(B);
  B.lean = 0.7;
  B.hipY = -16;
  B.neckBend = -0.5;
  B.handNx = 14;
  B.handNy = -26;
  B.handFx = 6;
  B.handFy = -28;
  B.bendN = 1;
  B.bendF = 1;
  B.brow = 0.8;
  B.eyeOpen = 1;
  B.mouth = 0.2;
  B.smile = -0.3;
  B.tailPuff = 0.6;
  const w = pulse(t, 0.0, 0.07, 0.3, 0.55);
  blendPose(p, B, A, w);
  const air = pulse(t, 0.0, 0.1, 0.22, 0.34);
  p.offY = -16 * air * c.k;
  p.shadow = 1 - 0.5 * air;
  p.pivX = 0;
  p.pivY = -30;
  p.rot = -0.1 * air * c.k;
  p.hipX += 1.2 * Math.sin(t * 45) * (1 - sseg(t, 0.5, 0.8)) * c.k;
  p.lookW = 0.5;
}

function clipAnnoyed(p: Pose, c: ClipContext): void {
  standPose(p);
  p.lean = 0.3;
  p.neckBend = -0.2;
  p.headRot = 0.1;
  p.brow = -1;
  p.smile = -0.8;
  p.eyeOpen = 0.7;
  p.turn = 0.7;
  // Hands on hips, foot tapping.
  p.handNx = p.hipX + 12;
  p.handNy = p.hipY - 2;
  p.handFx = p.hipX - 4;
  p.handFy = p.hipY - 4;
  p.bendN = -1;
  p.bendF = -1;
  const tap = Math.max(0, Math.sin(TAU * 2.2 * c.t)) * c.k;
  p.footNx = 5;
  p.footNy = GROUND - 3 * tap;
  p.tailBase = 0.6 + 0.4 * sinT(c, 1.3);
  p.tailCurl = 2 + 0.6 * sinT(c, 1.3, 1);
  p.tailStiff = 0.6;
  p.hipY += 0.3 * sinT(c, 2.2);
}

function clipPetted(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  p.lean = 0.12;
  p.headRot = -0.18 + 0.1 * sinT(c, 0.9);
  p.neckBend = -0.1;
  p.eyeOpen = 0.04;
  p.smile = 1;
  p.brow = 0.3;
  p.earPerk = 0.2;
  p.hipX += 1.5 * sinT(c, 0.9, 1);
  p.lean += 0.04 * sinT(c, 0.9, 0.6);
  p.handNx = 6;
  p.handNy = -22 + 1.5 * sinT(c, 0.9);
  p.handFx = 1;
  p.handFy = -24;
  p.bendN = 1;
  p.bendF = 1;
  p.gripN = 1;
  p.gripF = 1;
  p.tailBase = 0.2 + 0.3 * sinT(c, 1.1);
  p.tailCurl = 2.4 + 0.5 * sinT(c, 1.1, 1);
  p.tailStiff = 0.3;
  p.mouth = 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(t * 5)) * c.k;
  p.lookW = 0;
}

function clipGroom(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  p.lean = 0.3;
  p.neckBend = 0.1;
  p.headRot = 0.35;
  p.turn = 0.4;
  p.smile = 0.2;
  // The far arm is held up in front; the near hand picks along it, the head follows.
  const sweep = 0.5 + 0.5 * sinT(c, 0.7);
  p.handFx = 14;
  p.handFy = -34;
  p.bendF = 1;
  p.handNx = lerp(8, 20, sweep);
  p.handNy = lerp(-28, -38, sweep) + 1.2 * sinT(c, 4.5);
  p.bendN = -1;
  p.gripN = 0.7;
  p.headRot += 0.1 * sinT(c, 0.7);
  p.mouth = 0.05 + 0.1 * Math.max(0, sinT(c, 2.1));
  p.eyeOpen = 0.8;
  p.lookW = 0.1;
  p.tailCurl += 0.3 * sinT(c, 0.3);
  void t;
}

function clipPawAt(p: Pose, c: ClipContext): void {
  crouchPose(p);
  p.lean = 0.62;
  p.hipY = -16;
  p.neckBend = -0.45;
  p.smile = 0.5;
  p.eyeOpen = 1;
  p.mouth = 0.1;
  // The near hand follows the look target, reaching and grabbing in a rhythm (the animator damps lookX/Y).
  let dx = c.hasLook ? c.lookX - 16 : 28;
  let dy = c.hasLook ? c.lookY + 40 : 0;
  const d = Math.hypot(dx, dy);
  const reach = clamp(d, 14, 29);
  if (d > 1e-3) {
    dx = (dx / d) * reach;
    dy = (dy / d) * reach;
  }
  const grab = 0.5 + 0.5 * sinT(c, 1.1);
  const ext = 0.8 + 0.2 * grab;
  p.handNx = 16 + dx * ext;
  p.handNy = clamp(-40 + dy * ext, -66, GROUND);
  p.bendN = 0.5;
  p.gripN = grab > 0.6 ? 1 : 0;
  p.handFx = 8;
  p.handFy = GROUND;
  p.footNx = 0;
  p.footFx = -6;
  p.hipX = -9 + 1.5 * sinT(c, 1.1);
  p.tailBase = 0.6 + 0.3 * sinT(c, 1.1, 1);
  p.lookW = 0.8;
}

function clipMeow(p: Pose, c: ClipContext): void {
  // Hoot with a chest beat: four quick drums, mouth round, chest puffed.
  standPose(p);
  const t = c.t;
  p.lean = 0.12;
  p.hipY = -23;
  p.neckBend = -0.1;
  p.headRot = -0.2;
  const beat = Math.sin(TAU * 4.4 * t);
  const on = pulse(t, 0.05, 0.15, 0.7, 0.85);
  p.mouth = on * (0.55 + 0.35 * Math.max(0, beat));
  p.chest = 1 + 0.12 * on;
  p.brow = 0.4 * on;
  const hit = Math.max(0, beat) * on;
  const hitF = Math.max(0, -beat) * on;
  p.handNx = lerp(8, 10, hit);
  p.handNy = lerp(-34, -42, on) + 4 * (1 - hit) * on;
  p.handFx = lerp(0, 6, hitF);
  p.handFy = lerp(-30, -41, on) + 4 * (1 - hitF) * on;
  p.bendN = -1;
  p.bendF = -1;
  p.gripN = 1;
  p.gripF = 1;
  p.headDY += -1.4 * Math.abs(beat) * on * c.k;
  p.tailBase += 0.3 * on;
  p.lookW = 0.2;
}

function clipHide(p: Pose, c: ClipContext): void {
  hidePose(p);
  p.hipX += 0.4 * sinT(c, 7);
  p.headRot += 0.03 * sinT(c, 0.4);
  handsOnFace(p, 0);
  p.eyeOpen = 0.85;
  p.mouth = 0;
}

function clipPeek(p: Pose, c: ClipContext): void {
  hidePose(p);
  const t = (c.t % 2.6) / 2.6;
  const up = pulse(t, 0.25, 0.4, 0.68, 0.8);
  const grin = pulse(t, 0.4, 0.5, 0.64, 0.75);
  p.lean = lerp(1.0, 0.55, up);
  p.neckBend = lerp(0.05, -0.55, up);
  p.headRot = lerp(0.55, 0.0, up);
  p.eyeOpen = lerp(0.5, 1, up);
  p.brow = 0.5 * up;
  p.smile = lerp(-0.2, 0.9, grin);
  p.mouth = 0.3 * grin;
  // Hands cover the face, then part (fingers apart) as the head rises.
  handsOnFace(p, up);
  p.hipY = lerp(-10, -14, up);
  p.lookW = 0.3 * up;
}

// ---------------------------------------------------------------------------------------------
// Wall, ledge, held

const CLIMB_DUTY = 0.5;

/** One climbing limb's vertical position at a cycle phase (module level: no closure per frame). */
function climbHand(phase: number, st: number, top: number): number {
  const f = wrap01(phase);
  if (f < CLIMB_DUTY) return top + st * (f / CLIMB_DUTY - 0.5);
  const s = (f - CLIMB_DUTY) / (1 - CLIMB_DUTY);
  return top + st * (0.5 - easeInOut(s));
}

function clipClimb(p: Pose, c: ClipContext): void {
  // Wall on the right at x = 0; grip point at hind-foot height; the body extends upwards.
  standPose(p);
  p.hipX = -13;
  p.hipY = -15;
  p.lean = 0.18;
  p.neckBend = -0.06;
  p.headRot = 0.1;
  p.turn = 0.9;
  p.smile = 0.2;
  p.mouth = 0.05;
  const st = c.stride * c.engage;
  const ph = c.cyc;
  p.handNx = -1;
  p.handNy = climbHand(ph, st, -62);
  p.handFx = -3;
  p.handFy = climbHand(ph + 0.5, st, -52);
  p.gripN = 1;
  p.gripF = 1;
  p.bendN = 1;
  p.bendF = 1;
  p.footNx = -1;
  p.footNy = climbHand(ph + 0.25, st, -4);
  p.footFx = -4;
  p.footFy = climbHand(ph + 0.75, st, -11);
  p.legBend = -1;
  p.tailBase = -1.5;
  p.tailCurl = 1.2;
  p.tailStiff = 0.25;
  p.shadow = 0;
  p.hipX += 0.5 * Math.sin(TAU * ph) * c.engage;
  p.lookW = 0.3;
}

/** The held clip: hangs from the scruff, which sits exactly on HELD_SCRUFF; limbs dangle and trail the sway. */
function clipHeld(p: Pose, c: ClipContext): void {
  standPose(p);
  const sway = c.sway;
  p.lean = 0.06;
  p.neckBend = -0.04;
  p.headRot = 0.1 - 0.5 * sway;
  p.turn = 0.7;
  p.eyeOpen = 0.95;
  p.mouth = 0.18 + 0.1 * Math.abs(sway);
  p.smile = -0.1;
  p.brow = 0.5;
  // The scruff is the back of the neck: chest top, slightly behind the spine line.
  p.hipX = HELD_SCRUFF.x + 4 - 0.0;
  p.hipY = HELD_SCRUFF.y + 27;
  p.spineK = 1;
  const lag = -sway * 12;
  p.handNx = p.hipX + 12 + lag * 0.6;
  p.handNy = p.hipY + 4;
  p.handFx = p.hipX - 1 + lag * 0.4;
  p.handFy = p.hipY + 5;
  p.bendN = 1;
  p.bendF = 1;
  p.footNx = p.hipX + 5 + lag;
  p.footNy = p.hipY + 21;
  p.footFx = p.hipX - 2 + lag * 1.2;
  p.footFy = p.hipY + 20;
  p.legBend = -0.8;
  p.tailBase = -1.3 + 0.6 * sway;
  p.tailCurl = 1.4;
  p.tailStiff = 0.12;
  p.pivX = HELD_SCRUFF.x;
  p.pivY = HELD_SCRUFF.y;
  p.rot = sway;
  p.shadow = 0.25;
  p.lookW = 0;
  void c.k;
}

/** Hanging by the hands from a ledge: the anchor is the grip point; the body swings about it. */
function clipSwing(p: Pose, c: ClipContext): void {
  standPose(p);
  const sway = c.sway;
  p.hipX = 0;
  p.hipY = 57;
  p.lean = 0;
  p.spineK = 1;
  p.neckBend = -0.1;
  p.headRot = 0.1;
  p.turn = 0.6;
  p.smile = 0.8;
  p.mouth = 0.15 + 0.1 * Math.max(0, sinT(c, 0.55, 1.2));
  p.eyeOpen = 1;
  p.brow = 0.3;
  p.handNx = 4;
  p.handNy = 1.5;
  p.handFx = -3;
  p.handFy = 1.5;
  p.bendN = 0.6;
  p.bendF = 0.6;
  p.gripN = 1;
  p.gripF = 1;
  // Legs trail the swing with a lag; knees loose.
  const lag = -sway * 14;
  p.footNx = 4 + lag;
  p.footNy = 77 - Math.abs(sway) * 6;
  p.footFx = -3 + lag * 1.3;
  p.footFy = 76 - Math.abs(sway) * 5;
  p.legBend = -0.7;
  p.tailBase = -1.45 + 0.5 * sway;
  p.tailCurl = -2 - sway;
  p.tailStiff = 0.1;
  p.pivX = 0;
  p.pivY = 0;
  p.rot = sway;
  p.shadow = 0;
  p.lookW = 0.2;
}

// ---------------------------------------------------------------------------------------------
// Expressive clips

function clipScratch(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t % 5;
  const head = pulse(t, 0.2, 0.5, 2.2, 2.6);
  const pit = pulse(t, 2.6, 2.9, 4.6, 4.9);
  const rate = TAU * 5.2 * c.t;
  const wig = Math.sin(rate) * c.k;
  p.lean = 0.3 + 0.1 * pit;
  p.eyeOpen = 1 - 0.55 * head - 0.2 * pit;
  p.mouth = 0.18 * head;
  p.brow = 0.5 * head + 0.3 * pit;
  p.smile = lerp(0.1, -0.2, head);
  p.headRot += 0.28 * head * 0.5 + 0.08 * sinT(c, 0.8) * head;
  p.lookW = 0.1;
  p.turn = lerp(0.55, 0.3, head);
  // Head scratch: the near hand on top of the head, fingers raking.
  const hx = p.hipX + 22;
  const hy = p.hipY - 50;
  p.handNx = lerp(p.handNx, hx + 4 * wig, head);
  p.handNy = lerp(p.handNy, hy + 2.2 * Math.sin(rate + 1.2) * c.k, head);
  p.bendN = lerp(p.bendN, -1, head);
  p.gripN = Math.max(head, 0) * (0.5 + 0.5 * wig);
  // Armpit scratch: the near arm raised high, the far hand rubbing the armpit.
  p.handNx = lerp(p.handNx, p.hipX + 15, pit);
  p.handNy = lerp(p.handNy, p.hipY - 62, pit);
  p.bendN = lerp(p.bendN, -0.3, pit);
  p.handFx = lerp(p.handFx, p.hipX + 15 + 3 * wig, pit);
  p.handFy = lerp(p.handFy, p.hipY - 33 + 3 * Math.sin(rate + 2) * c.k, pit);
  p.bendF = lerp(p.bendF, -1, pit);
  p.gripF = pit * 0.6;
  p.lean += -0.12 * pit;
  p.hipX += 1.2 * wig * pit;
}

function clipShake(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  const env = 1 - sseg(t, 0.15, 1.05);
  const w = Math.sin(t * 50) * env * c.k;
  p.pivX = p.hipX;
  p.pivY = -4;
  p.rot = 0.16 * w;
  p.hipX += 2.2 * Math.sin(t * 50 + 1) * env * c.k;
  p.handNx += 6 * w;
  p.handFx -= 6 * w;
  p.handNy -= 4 * Math.abs(w);
  p.headRot = 0.4 * w;
  p.eyeOpen = 1 - 0.6 * env;
  p.mouth = 0.15 * env;
  p.brow = -0.5 * env;
  p.tailBase += 0.6 * w;
  p.tailPuff = 0.5 * env;
  p.lookW = 0;
}

function clipStretch(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  const up = pulse(t, 0.1, 0.6, 1.1, 1.55);
  armsUp(p, up);
  p.lean = lerp(0.42, -0.2, up);
  p.neckBend = lerp(p.neckBend, 0.25, up);
  p.headRot = lerp(p.headRot, -0.35, up);
  p.spineK = 1 + 0.08 * up;
  p.hipY -= 3 * up;
  p.footNx = lerp(p.footNx, -1, up);
  p.mouth = pulse(t, 0.4, 0.6, 0.95, 1.2) * 0.9;
  p.eyeOpen = 1 - 0.9 * pulse(t, 0.4, 0.6, 0.95, 1.2);
  p.tailBase = lerp(p.tailBase, 0.2, up);
  p.tailCurl = lerp(p.tailCurl, 1.2, up);
  p.handNx += 2 * Math.sin(t * 9) * up * c.k;
}

function clipScan(p: Pose, c: ClipContext): void {
  standPose(p);
  p.lean = 0.12;
  p.hipY = -23;
  p.neckBend = -0.08;
  p.eyeOpen = 0.85;
  p.brow = 0.2;
  p.smile = 0.1;
  // Hand over the brow, head sweeping slowly side to side.
  const sweep = Math.sin(TAU * 0.33 * c.t) * c.k;
  p.turn = 0.35 + 0.65 * sweep;
  p.headRot = 0.04 + 0.1 * sweep;
  p.pupilX = 0.6 * sweep;
  headOf(p);
  p.handNx = HX + 12 + 1.5 * sweep;
  p.handNy = HY - 7;
  p.bendN = -1;
  p.gripN = 0;
  p.handFx = p.hipX - 1;
  p.handFy = p.hipY - 2;
  p.bendF = 1;
  p.tailBase = 0.5 + 0.2 * sinT(c, 0.5);
  p.lookW = 0.15;
  p.hipX += 1 * sweep;
}

function clipDance(p: Pose, c: ClipContext): void {
  standPose(p);
  const beat = TAU * 1.15 * c.t;
  const s = Math.sin(beat);
  const s2 = Math.sin(beat * 2);
  const k = c.k;
  p.lean = 0.22 + 0.08 * s * k;
  p.hipY = -19 + 3 * Math.abs(s) * k;
  p.hipX = -5 + 2.5 * s * k;
  p.headRot = 0.25 * s * k;
  p.headDY = 1.6 * s2 * k;
  p.turn = 0.7 + 0.2 * s * k;
  p.mouth = 0.3 + 0.2 * Math.max(0, s2) * k;
  p.smile = 1;
  p.brow = 0.5;
  // Arms pump alternately overhead; knees bend with the beat; feet step.
  const a = Math.sin(beat);
  p.handNx = p.hipX + 13 + 5 * a * k;
  p.handNy = p.hipY - 52 - 18 * Math.max(0, a) * k + 6 * Math.min(0, a) * k;
  p.handFx = p.hipX + 4 - 5 * a * k;
  p.handFy = p.hipY - 52 + 18 * Math.min(0, a) * k - 6 * Math.max(0, a) * k;
  p.bendN = -0.6;
  p.bendF = -0.6;
  p.gripN = 0;
  p.gripF = 0;
  p.footNx = 4 + 3 * Math.max(0, s) * k;
  p.footNy = GROUND - 4 * Math.max(0, s) * k;
  p.footFx = -8 - 3 * Math.max(0, -s) * k;
  p.footFy = GROUND - 4 * Math.max(0, -s) * k;
  p.tailBase = 0.5 + 0.5 * s * k;
  p.tailCurl = 2.8 + 0.8 * s2 * k;
  p.tailStiff = 0.5;
  p.pivX = p.hipX;
  p.pivY = -4;
  p.rot = 0.06 * s * k;
  p.lookW = 0.1;
}

/** Standing backflip loop: crouch, spring, one rotation in the air, land, victory pose. */
function clipHop(p: Pose, c: ClipContext): void {
  const period = 1.7;
  const u = (c.t % period) / period;
  const t = u * period;
  crouchPose(A);
  A.hipY = -12;
  A.handNx = 4;
  A.handNy = -22;
  A.handFx = -2;
  A.handFy = -24;
  A.lean = 0.95;
  standPose(B);
  B.lean = 0.2;
  B.hipY = -26;
  B.spineK = 1.08;
  B.handNx = 20;
  B.handNy = -72;
  B.handFx = 11;
  B.handFy = -75;
  B.bendN = -0.5;
  B.bendF = -0.5;
  B.footNx = -14;
  B.footNy = -8;
  B.footFx = -8;
  B.footFy = -3;
  B.mouth = 0.4;
  B.smile = 0.8;
  const crouch = pulse(t, 0.0, 0.3, 0.3, 0.32) + 0;
  void crouch;
  if (t < 0.32) {
    blendPose(p, B, A, 1);
    standPose(B);
    blendPose(p, B, A, sseg(t, 0.0, 0.3));
    p.pivX = 0;
    p.pivY = 0;
    p.sy = 1 - 0.05 * sseg(t, 0.0, 0.3);
    p.smile = 0.7;
  } else if (t < 1.05) {
    const s = seg(t, 0.32, 1.05);
    blendPose(p, A, B, sseg(s, 0, 0.25));
    const h = 4 * s * (1 - s);
    p.offY = -34 * h * c.k;
    p.shadow = 1 - 0.5 * h;
    // The flip itself, with the same tuck as the big leap.
    const tuck = pulse(s, 0.12, 0.3, 0.7, 0.9);
    p.pivX = p.hipX + 5;
    p.pivY = p.hipY - 10;
    p.rot = c.k > 0.6 ? -TAU * easeInOut(clamp01((s - 0.1) / 0.8)) : 0;
    p.handNx = lerp(p.handNx, p.hipX + 16, tuck);
    p.handNy = lerp(p.handNy, p.hipY - 2, tuck);
    p.handFx = lerp(p.handFx, p.hipX + 12, tuck);
    p.handFy = lerp(p.handFy, p.hipY + 4, tuck);
    p.footNx = lerp(p.footNx, p.hipX + 9, tuck);
    p.footNy = lerp(p.footNy, p.hipY + 7, tuck);
    p.footFx = lerp(p.footFx, p.hipX + 5, tuck);
    p.footFy = lerp(p.footFy, p.hipY + 9, tuck);
    p.lean = lerp(p.lean, 0.9, tuck);
    p.spineK = lerp(p.spineK, 0.92, tuck);
  } else {
    // Landing squash, then a victory pose with raised fist and a grin.
    const s = sseg(t, 1.05, 1.22);
    const w = 1 - s;
    A.hipY = -10;
    standPose(B);
    blendPose(p, B, A, 0.9 * w);
    p.sy = 1 - 0.1 * w;
    p.sx = 1 + 0.07 * w;
    const vic = pulse(t, 1.22, 1.35, 1.6, 1.7);
    p.handNx = lerp(p.handNx, p.hipX + 18, vic);
    p.handNy = lerp(p.handNy, p.hipY - 62, vic);
    p.bendN = lerp(p.bendN, -0.3, vic);
    p.gripN = vic;
    p.smile = 1;
    p.mouth = 0.4 * vic;
    p.pivX = 0;
    p.pivY = 0;
  }
  p.lookW = 0.1;
}

// ---------------------------------------------------------------------------------------------

export const CLIP_FNS: Readonly<Record<string, ClipFn>> = {
  stand: clipStand,
  sit: clipSit,
  loaf: clipLoaf,
  sleep: clipSleep,
  wake: clipWake,
  yawn: clipYawn,
  walk: clipWalk,
  run: clipRun,
  crouch: clipCrouch,
  jump: clipJump,
  fall: clipFall,
  land: clipLand,
  startle: clipStartle,
  annoyed: clipAnnoyed,
  petted: clipPetted,
  groom: clipGroom,
  pawAt: clipPawAt,
  held: clipHeld,
  meow: clipMeow,
  hide: clipHide,
  climb: clipClimb,
  scratch: clipScratch,
  shake: clipShake,
  stretch: clipStretch,
  swing: clipSwing,
  scan: clipScan,
  peek: clipPeek,
  dance: clipDance,
  hop: clipHop,
};

/** Walk, run and climb advance a gait cycle; the rest do not. */
export const GAIT_CLIPS: ReadonlySet<string> = new Set(['walk', 'run', 'climb']);

export const GAIT_CFG = {
  walk: { duty: 0.62, maxStride: 24, minStride: 3, minHz: 1.2, maxHz: 3.2 },
  run: { duty: 0.4, maxStride: 36, minStride: 12, minHz: 1.8, maxHz: 4.8 },
  climb: { duty: 0.5, maxStride: 16, minStride: 0, minHz: 0.9, maxHz: 2.4 },
} as const;

/** Ground-speed limits (DIP/s at size 1) at which the planted limbs of each gait stay put. */
export function gaitCleanLimit(clip: 'walk' | 'run' | 'climb'): number {
  const g = GAIT_CFG[clip];
  return (g.maxHz * g.maxStride) / g.duty;
}

export { smooth };
