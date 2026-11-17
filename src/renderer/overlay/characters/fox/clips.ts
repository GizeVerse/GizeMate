// The fox's authored clips: each one writes a Pose from the clip time, the gait cycle and a few hints
// (look, arousal, vy, jump kind). Poses are pure functions of their inputs (deterministic); the animator
// adds cross-fades and the procedural layers (breathing, blinks, ear/tail layers, mood, reduced motion).
import { HELD_SCRUFF_DIP } from '../../../../core/interaction/held';
import type { AnimClip } from '../../../../shared/cat';
import { clamp, clamp01, easeInOut, lerp, pulse, sseg, TAU, wrap01 } from '../../character/kit';
import { LEG_BF, LEG_BN, LEG_FF, LEG_FN, resetPose, setFoot, type Pose } from './pose';
import { torsoPointX, torsoPointY } from './rig';

/** Scruff of the held pose: shared with the mover so the cursor stays on the body. */
export const HELD_SCRUFF = HELD_SCRUFF_DIP;

export interface ClipContext {
  /** Seconds since the clip started (animation time). */
  t: number;
  /** Gait cycle (fractional part used). */
  cycle: number;
  /** Locomotion speed in body-lengths per second. */
  speed: number;
  vy: number;
  lookX: number;
  lookY: number;
  hasLook: boolean;
  arousal: number;
  contentment: number;
  jumpKind: string | null;
  impact: number | undefined;
  reducedMotion: boolean;
  engage?: number | undefined;
  descend?: number | undefined;
}

const BODY_LENGTH_DIP = 84;

// ---- gaits ------------------------------------------------------------------------------------

interface Gait {
  readonly duty: number;
  readonly minStride: number;
  readonly maxStride: number;
  readonly minHz: number;
  readonly maxHz: number;
}
const WALK: Gait = { duty: 0.6, minStride: 5, maxStride: 20, minHz: 1.4, maxHz: 4.6 };
const RUN: Gait = { duty: 0.34, minStride: 14, maxStride: 32, minHz: 2.4, maxHz: 5.6 };
const STALK: Gait = { duty: 0.74, minStride: 3, maxStride: 14, minHz: 0.8, maxHz: 3 };
const SLINK: Gait = { duty: 0.62, minStride: 4, maxStride: 20, minHz: 1.4, maxHz: 4.4 };
const CLIMB: Gait = { duty: 0.62, minStride: 0, maxStride: 15, minHz: 0.9, maxHz: 3.6 };

function gaitOf(clip: AnimClip): Gait | null {
  switch (clip) {
    case 'walk':
      return WALK;
    case 'run':
      return RUN;
    case 'stalk':
      return STALK;
    case 'slink':
      return SLINK;
    case 'climb':
      return CLIMB;
    default:
      return null;
  }
}

/** Whether a clip is a locomotion cycle driven by `speed`. */
export const isGait = (clip: AnimClip): boolean => gaitOf(clip) !== null;

/** Gait cycle rate (Hz at animation speed 1). */
export function gaitHz(clip: AnimClip, speed: number): number {
  const g = gaitOf(clip);
  if (!g) return 0;
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0) * BODY_LENGTH_DIP;
  const step = clip === 'climb' ? 10 : g.maxStride;
  return clamp((v * g.duty) / step, g.minHz, g.maxHz);
}

/** Fastest anchor speed (DIP/s at size 1) at which each gait's planted paws stay put. */
export const GAIT_CLEAN_LIMIT_DIP: Readonly<Record<'walk' | 'run' | 'stalk' | 'slink' | 'climb', number>> = {
  walk: (WALK.maxHz * WALK.maxStride) / WALK.duty,
  run: (RUN.maxHz * RUN.maxStride) / RUN.duty,
  stalk: (STALK.maxHz * STALK.maxStride) / STALK.duty,
  slink: (SLINK.maxHz * SLINK.maxStride) / SLINK.duty,
  climb: (CLIMB.maxHz * CLIMB.maxStride) / CLIMB.duty,
};

function strideFor(clip: AnimClip, speed: number): number {
  const g = gaitOf(clip);
  if (!g) return 0;
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0) * BODY_LENGTH_DIP;
  const hz = gaitHz(clip, speed);
  return clamp((v * g.duty) / hz, g.minStride, g.maxStride);
}

let fcX = 0;
let fcY = 0;
let fcS = 0;
/** Foot path of one leg: the stance moves the foot back along the ground, the swing lifts it forward. */
function footCycle(phase: number, duty: number, stride: number, lift: number): void {
  const ph = wrap01(phase);
  if (ph < duty) {
    fcX = stride * (0.5 - ph / duty);
    fcY = 0;
    fcS = 0;
  } else {
    const s = (ph - duty) / (1 - duty);
    fcX = stride * (-0.5 + easeInOut(s));
    fcY = -lift * Math.sin(Math.PI * s);
    fcS = Math.sin(Math.PI * s);
  }
}

// ---- shared poses -------------------------------------------------------------------------------

function ears(p: Pose, nr: number, fr: number, nf = 0, ff = 0): void {
  p.earNR = nr;
  p.earFR = fr;
  p.earNF = nf;
  p.earFF = ff;
}

function standPose(p: Pose): void {
  resetPose(p);
}

function sitPose(p: Pose): void {
  resetPose(p);
  p.tilt = 0.9;
  p.bodyX = -9;
  p.bodyY = -17;
  p.bodyLen = 0.9;
  p.bodyH = 1.05;
  p.haunch = 1;
  p.headX = 9;
  p.headY = -45;
  p.headRot = 0.22;
  p.pivX = -8;
  p.pivY = -4;
  setFoot(p, LEG_FN, 7, 0, 0);
  setFoot(p, LEG_FF, 3, 0, 0);
  setFoot(p, LEG_BN, -3, 0, 0);
  setFoot(p, LEG_BF, -7, 0, 0);
  p.tailBase = -3.0;
  p.tailCurl = -0.9;
  p.tailBend = 0.2;
  p.tailFront = 1;
  p.tailStiff = 0.75;
}

function loafPose(p: Pose): void {
  resetPose(p);
  p.bodyX = -3;
  p.bodyY = -9.5;
  p.bodyH = 1.02;
  p.bodyLen = 0.98;
  p.haunch = 0.7;
  p.headX = 25;
  p.headY = -19;
  p.headRot = 0.1;
  p.pivY = -6;
  setFoot(p, LEG_FN, 25, 0, 0);
  setFoot(p, LEG_FF, 20, 0, 0);
  setFoot(p, LEG_BN, -9, 0, 0);
  setFoot(p, LEG_BF, -12, 0, 0);
  p.tailBase = -0.4;
  p.tailCurl = 0.3;
  p.tailBend = 0.5;
  p.tailFront = 0;
  p.tailStiff = 0.7;
}

function crouchPose(p: Pose): void {
  resetPose(p);
  p.bodyX = -2;
  p.bodyY = -16;
  p.bodyH = 0.96;
  p.tilt = -0.07;
  p.haunch = 0.4;
  p.headX = 27;
  p.headY = -25;
  p.headRot = -0.05;
  p.pivY = -10;
  setFoot(p, LEG_FN, 14, 0, 0);
  setFoot(p, LEG_FF, 9, 0, 0);
  setFoot(p, LEG_BN, -14, 0, 0);
  setFoot(p, LEG_BF, -19, 0, 0);
  p.tailBase = 0.05;
  p.tailCurl = 0.2;
  p.tailStiff = 0.7;
}

function climbPose(p: Pose): void {
  resetPose(p);
  p.tilt = 1.4;
  p.bodyX = -14;
  p.bodyY = -28;
  p.bodyLen = 1.08;
  p.bodyH = 0.95;
  p.arch = 0.1;
  p.haunch = 0.3;
  p.pivX = -14;
  p.pivY = -30;
  p.headX = -17;
  p.headY = -64;
  p.headRot = 0.95;
  p.pupilX = 0.2;
  p.pupilY = -0.3;
  setFoot(p, LEG_FN, -1, -60, -1.25);
  setFoot(p, LEG_FF, -0.5, -52, -1.25);
  setFoot(p, LEG_BN, -2, -1, -1.35);
  setFoot(p, LEG_BF, -3, -7, -1.35);
  p.tailBase = -1.45;
  p.tailCurl = 0.7;
  p.tailBend = 0;
  p.tailStiff = 0.3;
  p.shadow = 0;
  p.lookW = 0.5;
}

// ---- clips: rest and idle ---------------------------------------------------------------------

function clipStand(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  p.bodyX += 0.3 * Math.sin(TAU * 0.2 * t);
  p.tailBase += 0.06 * Math.sin(TAU * 0.33 * t);
  p.tailCurl += 0.2 * Math.sin(TAU * 0.4 * t + 0.6);
  // A 16 s idle loop of four variations: a look around, a sniff, an ear swivel, a paw lift.
  const it = (t % 16 + 16) % 16;
  const look = pulse(it, 2.6, 3.4, 4.2, 5.2);
  const lookB = pulse(it, 5.2, 6, 6.8, 7.6);
  const sniff = pulse(it, 8.6, 9, 10.4, 10.9);
  const swivel = pulse(it, 11.4, 11.9, 13, 13.6);
  const lift = pulse(it, 14.2, 14.6, 15.1, 15.5);
  p.headRot += 0.1 * look - 0.06 * lookB;
  p.headX += 1.2 * look - 1.4 * lookB;
  p.pupilX += 0.5 * look - 0.5 * lookB;
  p.earNR -= 0.15 * look;
  p.headY += 3 * sniff;
  p.headRot += -0.3 * sniff + 0.07 * sniff * Math.sin(TAU * 5 * t);
  p.headX += 1.5 * sniff;
  p.earNR += 0.45 * swivel * Math.sin(TAU * 1.2 * t);
  p.earFR -= 0.4 * swivel * Math.sin(TAU * 1.2 * t + 0.8);
  p.fnY -= 4.5 * lift;
  p.fnX += 2.5 * lift;
  p.fnPaw += 0.5 * lift;
  p.bodyX -= 1 * lift;
  p.tailCurl += 0.35 * pulse(it, 6.9, 7.1, 7.5, 7.9);
}

function clipSit(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  const it = (t % 14 + 14) % 14;
  const look = pulse(it, 1.8, 2.6, 3.6, 4.4);
  const lookB = pulse(it, 4.6, 5.4, 6.4, 7.2);
  const swivel = pulse(it, 8, 8.5, 9.5, 10);
  const tip = pulse(it, 10.6, 10.8, 11.1, 11.4);
  const tilt = pulse(it, 12, 12.6, 13.2, 13.8);
  p.headRot += 0.08 * look - 0.1 * lookB + 0.2 * tilt;
  p.headX += 1.5 * look - 1.8 * lookB;
  p.pupilX += 0.5 * look - 0.5 * lookB;
  p.earNR += 0.4 * swivel * Math.sin(TAU * 1.1 * t);
  p.earFR -= 0.35 * swivel * Math.sin(TAU * 1.1 * t + 1);
  p.earFR -= 0.3 * tilt;
  p.tailCurl -= 0.15 * tip;
  p.bodyX += 0.25 * Math.sin(TAU * 0.18 * t);
}

function clipLoaf(p: Pose, c: ClipContext): void {
  loafPose(p);
  const t = c.t;
  const it = (t % 12 + 12) % 12;
  p.earNR += 0.3 * pulse(it, 3, 3.2, 3.4, 3.8);
  p.earFR -= 0.2 * pulse(it, 7, 7.2, 7.4, 7.9);
  const look = pulse(it, 5, 5.8, 6.6, 7.4);
  p.headRot += 0.1 * look;
  p.headX += 2 * look;
  p.pupilX += 0.5 * look;
  p.tailCurl += 0.1 * Math.sin(TAU * 0.22 * t);
}

function clipSleep(p: Pose, c: ClipContext): void {
  resetPose(p);
  const t = c.t;
  // Curled into a ball, the nose tucked in front of the chest and the brush wrapped over it.
  p.curl = 1;
  p.bodyX = -3;
  p.bodyY = -13.3;
  p.bodyLen = 1;
  p.haunch = 0.8;
  p.tilt = 0;
  p.headX = 12;
  p.headY = -11.5;
  p.headRot = -0.55;
  p.pivY = -8;
  p.eyeOpen = 0;
  ears(p, 0.55, 0.6, 0.75, 0.8);
  setFoot(p, LEG_FN, 18, 0, 0);
  setFoot(p, LEG_FF, 15, 0, 0);
  setFoot(p, LEG_BN, 6, 0, 0);
  setFoot(p, LEG_BF, 3, 0, 0);
  p.tailBase = -3.0;
  p.tailCurl = -1.5;
  p.tailBend = 0.1;
  p.tailFront = 2;
  p.tailStiff = 0.95;
  p.blinkOK = 0;
  // A rare ear twitch and a tiny paw jerk in a dream.
  const it = (t % 23 + 23) % 23;
  p.earNR += 0.25 * pulse(it, 6, 6.1, 6.3, 6.5);
  p.earFR += 0.2 * pulse(it, 15, 15.1, 15.3, 15.6);
  p.fnY -= 0.8 * pulse(it, 18, 18.1, 18.25, 18.5);
}

function clipWake(p: Pose, c: ClipContext): void {
  const t = c.t;
  standPose(p);
  // 0..0.5 head lifts and eyes open, 0.5..1.1 play-bow stretch, 1.1..1.6 stand and settle.
  const rise = sseg(t, 0, 0.5);
  const bow = pulse(t, 0.45, 0.8, 1.05, 1.35);
  p.bodyY += 4 * (1 - rise);
  p.headY += 6 * (1 - rise);
  p.eyeOpen = sseg(t, 0.05, 0.5);
  p.eyeHappy = 0.9 * (1 - sseg(t, 0.15, 0.5));
  p.mouthOpen = 0.45 * pulse(t, 0.3, 0.5, 0.8, 1);
  p.earNR = 0.5 * (1 - rise);
  p.earFR = 0.5 * (1 - rise);
  p.tilt -= 0.34 * bow;
  p.headY += 6 * bow;
  p.headX += 2 * bow;
  p.fnX += 12 * bow;
  p.ffX += 12 * bow;
  p.bodyY -= 1.5 * bow;
  p.tailBase += 0.9 * bow;
  p.tailCurl += 0.4 * bow;
}

function clipYawn(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  const open = pulse(t, 0.12, 0.45, 0.85, 1.15);
  p.mouthOpen = 1 * open;
  p.tongue = open;
  p.headRot += 0.4 * open;
  p.headY -= 1.5 * open;
  p.headX -= 1.5 * open;
  p.eyeOpen = 1 - 0.95 * open;
  p.eyeSquint = open;
  p.earNR += 0.45 * open;
  p.earFR += 0.45 * open;
  p.blinkOK = 0;
}

function clipStretch(p: Pose, c: ClipContext): void {
  const t = c.t;
  standPose(p);
  // Front stretch (play bow), then the hind legs: rump down, chest up, one leg reaching back.
  const front = pulse(t, 0.1, 0.45, 0.8, 1.0);
  const back = pulse(t, 0.9, 1.15, 1.35, 1.6);
  p.tilt -= 0.4 * front;
  p.bodyY += 0.5 * front;
  p.headY += 8 * front;
  p.headX += 4 * front;
  p.fnX += 14 * front;
  p.ffX += 14 * front;
  p.bodyX += 3 * front;
  p.tailBase += 1 * front;
  p.tailCurl += 0.3 * front;
  p.mouthOpen = 0.4 * pulse(t, 0.3, 0.45, 0.7, 0.9);
  p.eyeHappy = 0.8 * front;
  p.tilt += 0.18 * back;
  p.bodyX -= 3 * back;
  p.bnX -= 9 * back;
  p.bnY -= 2 * back;
  p.bnPaw += 0.5 * back;
  p.headRot += 0.2 * back;
  p.tailBase -= 0.3 * back;
}

// ---- locomotion --------------------------------------------------------------------------------

function clipWalk(p: Pose, c: ClipContext): void {
  standPose(p);
  const cy = c.cycle;
  const stride = strideFor('walk', c.speed);
  const lift = 5 + 0.1 * stride;
  // Trot: diagonal pairs move together (near front with far hind, far front with near hind).
  footCycle(cy, WALK.duty, stride, lift);
  setFoot(p, LEG_FN, 11 + fcX, fcY, -0.25 * fcS);
  setFoot(p, LEG_BF, -23 + fcX, fcY, 0.25 * fcS);
  footCycle(cy + 0.5, WALK.duty, stride, lift);
  setFoot(p, LEG_FF, 6.5 + fcX, fcY, -0.25 * fcS);
  setFoot(p, LEG_BN, -18.5 + fcX, fcY, 0.25 * fcS);
  const bob = Math.sin(TAU * 2 * cy + 0.5);
  p.bodyY += -0.6 * bob;
  p.tilt += 0.025 * Math.sin(TAU * cy);
  p.headY += -0.9 * Math.sin(TAU * 2 * cy + 1.1);
  p.headX += 0.8 * Math.sin(TAU * cy + 0.4);
  p.headRot += 0.03 * Math.sin(TAU * 2 * cy);
  p.tailBase += 0.07 * Math.sin(TAU * cy + 1.3);
  p.tailCurl += 0.3 * Math.sin(TAU * cy + 0.8);
  p.tailStiff = 0.55;
  p.earNR -= 0.12;
}

function clipRun(p: Pose, c: ClipContext): void {
  standPose(p);
  const cy = c.cycle;
  const stride = strideFor('run', c.speed);
  const lift = 10;
  // Bound: the front pair and the hind pair each land together, half a cycle apart.
  footCycle(cy, RUN.duty, stride, lift);
  setFoot(p, LEG_FN, 12 + fcX, fcY, -0.45 * fcS);
  footCycle(cy + 0.07, RUN.duty, stride, lift);
  setFoot(p, LEG_FF, 7.5 + fcX, fcY, -0.45 * fcS);
  footCycle(cy + 0.5, RUN.duty, stride, lift);
  setFoot(p, LEG_BN, -16 + fcX, fcY, 0.5 * fcS);
  footCycle(cy + 0.57, RUN.duty, stride, lift);
  setFoot(p, LEG_BF, -20.5 + fcX, fcY, 0.5 * fcS);
  const g = Math.sin(TAU * (cy + 0.25));
  p.arch = 0.35 - 0.55 * g;
  p.bodyY += 2.4 * Math.cos(TAU * cy + 0.2) - 1.5;
  p.tilt += 0.1 * g;
  p.headX += 3;
  p.headY += 1.5 + 1.8 * Math.cos(TAU * cy + 0.5);
  p.headRot += -0.1 + 0.07 * g;
  p.mouthOpen = 0.3 + 0.15 * Math.sin(TAU * cy);
  ears(p, 0.55, 0.6, 0.35, 0.35);
  p.tailBase = 0.02 + 0.06 * Math.sin(TAU * cy + 0.5);
  p.tailCurl = -0.18 + 0.2 * Math.sin(TAU * cy);
  p.tailBend = 0.4;
  p.tailStiff = 0.85;
  p.eyeSquint = 0.3;
}

function clipStalk(p: Pose, c: ClipContext): void {
  crouchPose(p);
  const cy = c.cycle;
  const stride = strideFor('stalk', c.speed);
  const lift = 3.4;
  // Slow, high-stepping creep: each paw is placed, one at a time (four-beat walk).
  footCycle(cy, STALK.duty, stride, lift);
  setFoot(p, LEG_FN, 14 + fcX, fcY, -0.2 * fcS);
  footCycle(cy + 0.25, STALK.duty, stride, lift);
  setFoot(p, LEG_BN, -14 + fcX, fcY, 0.2 * fcS);
  footCycle(cy + 0.5, STALK.duty, stride, lift);
  setFoot(p, LEG_FF, 9 + fcX, fcY, -0.2 * fcS);
  footCycle(cy + 0.75, STALK.duty, stride, lift);
  setFoot(p, LEG_BF, -19 + fcX, fcY, 0.2 * fcS);
  const sw = Math.sin(TAU * cy);
  p.bodyY += 0.6 * Math.sin(TAU * 2 * cy);
  p.bodyX += 1.2 * sw;
  p.headX += 1.5 * Math.sin(TAU * cy + 1.2);
  p.headRot += -0.04 + 0.03 * sw;
  ears(p, -0.45, -0.4);
  p.eyeSquint = 0.25;
  p.tailBase = 0.05 + 0.05 * Math.sin(TAU * cy + 1);
  p.tailCurl = 0.1 + 0.12 * Math.sin(TAU * cy);
  p.tailStiff = 0.85;
}

function clipSlink(p: Pose, c: ClipContext): void {
  standPose(p);
  const cy = c.cycle;
  const stride = strideFor('slink', c.speed);
  footCycle(cy, SLINK.duty, stride, 3.6);
  setFoot(p, LEG_FN, 11 + fcX, fcY, 0);
  setFoot(p, LEG_BF, -21 + fcX, fcY, 0);
  footCycle(cy + 0.5, SLINK.duty, stride, 3.6);
  setFoot(p, LEG_FF, 6.5 + fcX, fcY, 0);
  setFoot(p, LEG_BN, -16.5 + fcX, fcY, 0);
  p.bodyY = -22 + 0.5 * Math.sin(TAU * 2 * cy);
  p.tilt = -0.06;
  p.headX = 24;
  p.headY = -31 + 0.8 * Math.sin(TAU * 2 * cy + 1);
  p.headRot = -0.18;
  ears(p, 0.55, 0.6, 0.55, 0.6);
  p.eyeSquint = 0.2;
  p.pupilX = -0.3;
  p.tailBase = -1.25;
  p.tailCurl = -0.45;
  p.tailStiff = 0.6;
  p.bodyX += 0.5 * Math.sin(TAU * cy);
}

function clipClimb(p: Pose, c: ClipContext): void {
  climbPose(p);
  const cy = c.cycle;
  const move = c.engage !== undefined && Number.isFinite(c.engage) ? clamp01(c.engage) : clamp01(c.speed / 0.14);
  const still = 1 - move;
  const stride = strideFor('climb', c.speed) * move;
  const lift = 2 + 3 * move;
  footCycle(cy, CLIMB.duty, stride, lift);
  setFoot(p, LEG_FN, -1 + fcY * 0.2, lerp(-60, -58, move) + fcX * 0.9, -1.25);
  footCycle(cy + 0.5, CLIMB.duty, stride, lift);
  setFoot(p, LEG_FF, -0.5 + fcY * 0.2, lerp(-52, -58, move) + fcX * 0.9, -1.25);
  footCycle(cy + 0.08, CLIMB.duty, stride, 2.5);
  setFoot(p, LEG_BF, -3 + fcY * 0.2, lerp(-7, -3.5, move) + fcX * 0.9, -1.35);
  footCycle(cy + 0.58, CLIMB.duty, stride, 2.5);
  setFoot(p, LEG_BN, -2 + fcY * 0.2, lerp(-1, -1.5, move) + fcX * 0.9, -1.35);
  const pull = Math.cos(TAU * 2 * cy);
  p.bodyY += -1 * pull * move;
  p.tilt += 0.03 * Math.sin(TAU * cy) * move;
  p.bodyX += -0.6 * Math.sin(TAU * cy + 0.4) * move;
  p.headY += -0.8 * Math.cos(TAU * 2 * cy + 0.6) * move;
  const it = (c.t % 7.2 + 7.2) % 7.2;
  const down = pulse(it, 1.6, 2.1, 3, 3.5) * still;
  const up = pulse(it, 4.7, 5.2, 5.9, 6.4) * still;
  p.headRot += -0.5 * down + 0.2 * up;
  p.headX += 1.5 * down;
  p.pupilY += 0.7 * down - 0.5 * up;
  p.tailBase += 0.1 * Math.sin(TAU * 2 * c.t / 7.2) * still + 0.12 * Math.sin(TAU * cy + 1) * move;
  p.tailCurl += 0.25 * Math.sin(TAU * 2 * c.t / 7.2 - 1.1) * still + 0.3 * Math.sin(TAU * cy) * move;
  p.bodyX += 0.5 * Math.sin(TAU * 2 * cy + 0.9) * move;
  p.headRot += 0.07 * Math.sin(TAU * cy + 1.4) * move;
  p.earNR += 0.18 * Math.sin(TAU * 2 * cy) * move;
  p.mouthOpen = 0.12 * move;
  const dn = c.descend !== undefined && Number.isFinite(c.descend) ? clamp01(c.descend) : 0;
  p.tailBase += 0.6 * dn;
  p.tailCurl += 0.5 * dn;
  p.tailStiff += 0.25 * dn;
  p.headRot -= 0.2 * dn;
  p.pupilY += 0.45 * dn;
  p.blinkOK = down > 0.2 || up > 0.2 ? 0 : 1;
}

// ---- physics -------------------------------------------------------------------------------------

function clipCrouch(p: Pose, c: ClipContext): void {
  crouchPose(p);
  const t = c.t;
  // Butt wiggle: the hind end sways side to side before a spring.
  const w = Math.sin(TAU * 3.4 * t);
  p.bodyX += 0.8 * w;
  p.bnX += 1.8 * w;
  p.bfX += 1.8 * w;
  p.tilt += 0.02 * w;
  p.tailBase += 0.18 * Math.sin(TAU * 3.4 * t + 0.5);
  p.tailCurl += 0.5 * Math.sin(TAU * 3.4 * t + 1.2);
  ears(p, -0.45, -0.4);
  p.pupilX = 0.4;
  p.eyeSquint = 0.15;
}

function flightPose(p: Pose, c: ClipContext, nose: number): void {
  // nose: -1 diving .. +1 rising.
  standPose(p);
  p.tilt = 0.32 * nose;
  p.bodyY = -29;
  p.headX = 27 + 1.5 * nose;
  p.headY = -40 - 4 * nose;
  p.headRot = 0.1 * nose - 0.05;
  const rise = clamp01(nose * 0.5 + 0.5);
  setFoot(p, LEG_FN, 22, -22 - 6 * rise, -0.9);
  setFoot(p, LEG_FF, 17, -24 - 5 * rise, -0.9);
  setFoot(p, LEG_BN, -30 - 3 * rise, -8 - 7 * rise, 0.8);
  setFoot(p, LEG_BF, -34, -11 - 6 * rise, 0.8);
  ears(p, 0.6, 0.65, 0.3, 0.3);
  p.tailBase = 0.25 - 0.25 * nose;
  p.tailCurl = -0.2;
  p.tailStiff = 0.9;
  p.mouthOpen = 0.2;
  p.pupilY = -0.2 * nose;
  p.shadow = 0.6;
  p.eyeSquint = 0.1;
  void c;
}

function clipJump(p: Pose, c: ClipContext): void {
  const nose = clamp(-c.vy / 600, -1, 1);
  flightPose(p, c, nose);
  const t = c.t;
  // Anticipation: a brief crouch before the push-off, then the stretch.
  const pre = 1 - sseg(t, 0, 0.12);
  p.bodyY += 4 * pre;
  p.headY += 4 * pre;
  p.sqY = 1 - 0.1 * pre;
  p.sqX = 1 + 0.05 * pre;
}

function clipFall(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  const flail = Math.sin(TAU * 2.4 * t);
  p.tilt = -0.1;
  p.bodyY = -28;
  p.headX = 27;
  p.headY = -39;
  p.headRot = 0.18;
  setFoot(p, LEG_FN, 16 + 2 * flail, -9, 0.5);
  setFoot(p, LEG_FF, 12 - 2 * flail, -10, 0.5);
  setFoot(p, LEG_BN, -17 + 2 * flail, -8, 0.4);
  setFoot(p, LEG_BF, -22 - 2 * flail, -9, 0.4);
  ears(p, 0.7, 0.75, 0.2, 0.2);
  p.tailBase = 1.0;
  p.tailCurl = 0.4 + 0.3 * flail;
  p.tailPuff = 0.5;
  p.tailStiff = 0.3;
  p.mouthOpen = 0.35;
  p.pupilY = -0.3;
  p.shadow = 0.5;
}

function clipLand(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  const hard = clamp01(c.impact ?? 0.5);
  const d = (0.7 + 0.5 * hard) * (1 - sseg(t, 0.06, 0.28)) * clamp01(0.4 + t / 0.06);
  p.sqY = 1 - 0.14 * d;
  p.sqX = 1 + 0.08 * d;
  p.bodyY += 5 * d;
  p.headY += 5 * d;
  p.tilt -= 0.06 * d;
  setFoot(p, LEG_FN, 11 + 3 * d, 0, 0);
  setFoot(p, LEG_FF, 6.5 + 2 * d, 0, 0);
  setFoot(p, LEG_BN, -18.5 - 3 * d, 0, 0);
  setFoot(p, LEG_BF, -23 - 3 * d, 0, 0);
  p.tailBase += 0.4 * (1 - d);
  p.earNR += 0.35 * d;
  p.earFR += 0.35 * d;
}

function clipStartle(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  // A flinch up and back: the back arches, the brush puffs, the ears pin, the eyes go wide.
  const hop = Math.max(0, Math.sin(Math.PI * clamp01(t / 0.32)));
  const settle = sseg(t, 0.35, 0.8);
  const k = 1 - settle;
  p.offY = -9 * hop;
  p.offX = -3 * hop;
  p.arch = 0.9 * k;
  p.bodyY += 1.5 * k;
  p.headX -= 4 * k;
  p.headY += 3 * k;
  p.headRot += 0.25 * k;
  p.tilt += 0.1 * k;
  setFoot(p, LEG_FN, 11 - 2 * k, -3 * hop, 0);
  setFoot(p, LEG_FF, 6.5 - 2 * k, -3 * hop, 0);
  setFoot(p, LEG_BN, -18.5 + 2 * k, -2 * hop, 0);
  setFoot(p, LEG_BF, -23 + 2 * k, -2 * hop, 0);
  ears(p, 0.7 * k, 0.75 * k, 0.8 * k, 0.8 * k);
  p.tailPuff = k;
  p.tailBase = 0.4 * k + 0.12;
  p.tailCurl = -0.45 + 0.9 * k;
  p.tailStiff = 0.9;
  p.eyeOpen = 1;
  p.mouthOpen = 0.35 * k;
  p.blinkOK = 0;
  p.shadow = 1 - 0.4 * hop;
}

function clipAnnoyed(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  p.eyeSquint = 0.75;
  ears(p, 0.45, 0.5, 0.85, 0.85);
  p.headY += 2;
  p.headRot -= 0.12;
  p.headX -= 1;
  p.tailCurl = -2.1 + 0.4 * Math.sin(TAU * 1.3 * t);
  p.tailBase = -1.15 + 0.2 * Math.sin(TAU * 1.3 * t + 0.4);
  p.pupilX = -0.3;
  p.mouthOpen = 0;
}

function clipPetted(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  const k = clamp01(t / 0.35);
  const lean = Math.sin(TAU * 0.7 * t);
  p.eyeHappy = k;
  p.eyeOpen = 1 - 0.3 * k;
  p.headRot += 0.2 * k + 0.05 * lean;
  p.headY += 2.5 * k;
  p.headX += 2 * k;
  p.bodyX += 0.5 * lean * k;
  ears(p, 0.35 * k, 0.4 * k, 0.1, 0.1);
  p.blush = k;
  p.tailBase = -1.15 + 0.15 * Math.sin(TAU * 0.9 * t);
  p.tailCurl = -2.1 + 0.5 * Math.sin(TAU * 1.1 * t + 0.4);
  p.mouthOpen = 0;
  p.blinkOK = 0;
}

function clipGroom(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  // Loop of 3.6 s: lick the front paw (paw raised to the muzzle), then wipe over the face.
  const it = (t % 3.6 + 3.6) % 3.6;
  const raise = pulse(it, 0.15, 0.55, 2.6, 3.1);
  const lick = Math.sin(TAU * 3.2 * it);
  const wipe = pulse(it, 2.2, 2.45, 2.8, 3.05);
  p.headRot += -0.5 * raise;
  p.headY += 5 * raise;
  p.headX += 4 * raise;
  p.fnX = lerp(5, 22 - 4 * wipe, raise);
  p.fnY = lerp(0, -28 + 4 * lick * (1 - wipe) - 3 * wipe, raise);
  p.fnPaw = -0.9 * raise;
  p.mouthOpen = (0.3 + 0.22 * lick) * raise * (1 - wipe);
  p.tongue = raise * (1 - wipe) * clamp01(0.5 + lick);
  p.eyeSquint = 0.5 * raise;
  p.eyeHappy = 0.5 * raise * (1 - wipe);
  p.earNR += 0.3 * raise;
  p.blinkOK = 0;
}

function clipHeld(p: Pose, c: ClipContext): void {
  resetPose(p);
  const t = c.t;
  p.pivX = HELD_SCRUFF.x;
  p.pivY = HELD_SCRUFF.y;
  p.tilt = 1.5;
  p.arch = -0.25;
  p.bodyX = -1.1;
  p.bodyY = -41.5;
  p.bodyLen = 0.98;
  p.bodyH = 0.92;
  p.headX = 4;
  p.headY = -64;
  p.headRot = -0.15;
  ears(p, 0.35, 0.4, 0.3, 0.3);
  p.eyeOpen = 1;
  // 7.5 s loop: hangs limp and resigned (head low, eyes half shut), then two wriggles: the front paws paddle, the
  // hind legs kick out of phase, the brush whips, the fox yips. The scruff stays where the mover keeps the cursor.
  const it = (t % 7.5 + 7.5) % 7.5;
  const wig = pulse(it, 0.9, 1.3, 2.7, 3.2) + 0.7 * pulse(it, 4.6, 4.9, 5.7, 6.1);
  const sag = pulse(it, 3.4, 3.9, 4.4, 4.7) + pulse(it, 6.3, 6.8, 7.2, 7.5);
  const k = c.reducedMotion ? 0.4 : 1;
  const w = wig * k;
  const kick = Math.sin(TAU * 0.55 * t) * (1 - wig) + Math.sin(TAU * 3.1 * t) * w;
  const paddle = Math.sin(TAU * 3.1 * t);
  p.headY += 2 * sag - 1.2 * w * Math.abs(paddle);
  p.headRot += -0.12 * sag + 0.1 * w * Math.sin(TAU * 1.55 * t);
  p.eyeSquint = 0.5 * sag;
  p.mouthOpen = 0.12 + 0.3 * w * Math.max(0, Math.sin(TAU * 1.55 * t + 0.6));
  ears(p, 0.35 + 0.35 * w + 0.15 * sag, 0.4 + 0.35 * w + 0.15 * sag, 0.3 + 0.3 * w, 0.3 + 0.3 * w);
  p.tailBase += 0.35 * w * Math.sin(TAU * 1.55 * t + 1);
  p.tailCurl += 0.5 * w * Math.sin(TAU * 1.55 * t);
  p.arch += 0.1 * w * paddle;
  const fnRx = torsoPointX(p, 0.62, 0.42);
  const fnRy = torsoPointY(p, 0.62, 0.42);
  const bnRx = torsoPointX(p, -0.6, 0.42);
  const bnRy = torsoPointY(p, -0.6, 0.42);
  setFoot(p, LEG_FN, fnRx + 4 + 0.6 * kick + 2.5 * w * paddle, fnRy + 19 - 2.5 * w * Math.max(0, paddle), 1.6 - 0.5 * w * paddle);
  setFoot(p, LEG_FF, fnRx + 1.5 - 2.5 * w * paddle, fnRy + 18.5 - 2.5 * w * Math.max(0, -paddle), 1.6 + 0.5 * w * paddle);
  setFoot(p, LEG_BN, bnRx + 3 - 4 * w * paddle, bnRy + 21 + 0.8 * kick - 3 * w * Math.max(0, -paddle), 1.45 + 0.4 * w * paddle);
  setFoot(p, LEG_BF, bnRx - 1.5 + 4 * w * paddle, bnRy + 20.5 - 0.8 * kick - 3 * w * Math.max(0, paddle), 1.45 - 0.4 * w * paddle);
  p.tailBase += -1.5 - 0.12;
  p.tailCurl += 0.5 + 0.45;
  p.tailStiff = 0.12;
  p.shadow = 0;
  p.lookW = 0.5;
}

// ---- hide, peek, scan ------------------------------------------------------------------------------

function hidePose(p: Pose): void {
  resetPose(p);
  p.bodyX = -3;
  p.bodyY = -11.5;
  p.bodyH = 0.9;
  p.tilt = -0.04;
  p.haunch = 0.5;
  p.headX = 26;
  p.headY = -17;
  p.headRot = -0.02;
  p.pivY = -8;
  setFoot(p, LEG_FN, 16, 0, 0);
  setFoot(p, LEG_FF, 11, 0, 0);
  setFoot(p, LEG_BN, -12, 0, 0);
  setFoot(p, LEG_BF, -17, 0, 0);
  ears(p, 0.55, 0.6, 0.6, 0.6);
  p.tailBase = -0.2;
  p.tailCurl = -0.3;
  p.tailStiff = 0.8;
}

function clipHide(p: Pose, c: ClipContext): void {
  hidePose(p);
  const t = c.t;
  p.bodyY += 0.3 * Math.sin(TAU * 0.5 * t);
  p.earNR += 0.12 * Math.sin(TAU * 0.9 * t);
  p.pupilX = 0.1 + 0.3 * Math.sin(TAU * 0.25 * t);
  p.eyeSquint = 0.1;
  p.tailCurl += 0.1 * Math.sin(TAU * 0.6 * t);
}

function clipPeek(p: Pose, c: ClipContext): void {
  hidePose(p);
  const t = c.t;
  // 3.6 s loop: low, the head rises with the ears forward, a long look, then ducks back.
  const it = (t % 3.6 + 3.6) % 3.6;
  const up = pulse(it, 0.7, 1.1, 2.2, 2.6);
  const look = Math.sin(TAU * 0.55 * it);
  p.headY -= 11 * up;
  p.headX += 1.5 * up;
  p.headRot += 0.14 * up;
  p.bodyY -= 2 * up;
  p.tilt += 0.1 * up;
  p.earNR = lerp(0.55, -0.35, up);
  p.earFR = lerp(0.6, -0.3, up);
  p.earNF = lerp(0.6, 0, up);
  p.earFF = lerp(0.6, 0, up);
  p.pupilX = 0.5 * look * up + 0.2;
  p.eyeSquint = 0.1 * (1 - up);
  p.fnX += 2 * up;
}

function clipScan(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  // Head high, a slow methodical sweep, each ear swivelling on its own.
  const sweep = Math.sin(TAU * 0.28 * t);
  const sweepB = Math.sin(TAU * 0.28 * t + 1.5);
  p.headY -= 3.5;
  p.headX += 0.5 + 3 * sweep;
  p.headRot += 0.12 + 0.09 * sweepB;
  p.bodyY -= 0.4;
  p.tilt += 0.05;
  p.pupilX = 0.5 * sweep;
  p.earNR = -0.3 + 0.4 * Math.sin(TAU * 0.55 * t);
  p.earFR = -0.25 - 0.4 * Math.sin(TAU * 0.55 * t + 1.7);
  p.tailBase += 0.05 * Math.sin(TAU * 0.3 * t);
  p.tailCurl += 0.1 * Math.sin(TAU * 0.4 * t + 0.4);
  p.fnY -= 3 * pulse((t % 6 + 6) % 6, 4.2, 4.5, 5, 5.4);
  p.fnX += 2 * pulse((t % 6 + 6) % 6, 4.2, 4.5, 5, 5.4);
}

// ---- play ------------------------------------------------------------------------------------------

function clipRollOver(p: Pose, c: ClipContext): void {
  loafPose(p);
  const t = c.t;
  // 3.2 s loop: roll onto the back, wiggle with the paws in the air, roll back.
  const it = (t % 3.2 + 3.2) % 3.2;
  const onBack = pulse(it, 0.4, 0.85, 2.2, 2.65);
  p.rollY = 1 - 2 * onBack;
  p.headFlip = p.rollY < 0 ? -1 : 1;
  p.pivY = -9.5;
  p.bodyY = -9.5;
  const wig = Math.sin(TAU * 2.2 * it) * onBack;
  setFoot(p, LEG_FN, 12 + 5 * wig, -1 - 3 * onBack, 0.7);
  setFoot(p, LEG_FF, 18 - 4 * wig, 0 - 2 * onBack, 0.7);
  setFoot(p, LEG_BN, -9 + 4 * wig, 0, 0.5);
  setFoot(p, LEG_BF, -14 - 4 * wig, 0, 0.5);
  p.bodyX += 1.5 * wig;
  p.headX = 24 + 2 * wig;
  p.headY = -18 + 11 * onBack;
  p.headRot = 0.25 * onBack;
  p.eyeHappy = onBack;
  p.mouthOpen = 0.35 * onBack;
  p.tongue = 0.5 * onBack;
  p.tailBase = -0.5 + 0.3 * wig;
  p.tailCurl = -0.6 + 0.5 * Math.sin(TAU * 1.1 * it) * onBack;
  // Rocks side to side on its back, one hind leg kicking, the head tossing back.
  p.rot = 0.08 * Math.sin(TAU * 1.1 * it) * onBack;
  p.headRot += 0.14 * Math.sin(TAU * 1.1 * it + 1) * onBack;
  p.bnY -= 2.5 * Math.max(0, wig) * onBack;
  p.earNR = 0.35 * onBack;
  p.earFR = 0.4 * onBack;
  p.shadow = 1;
}

function clipSwat(p: Pose, c: ClipContext): void {
  crouchPose(p);
  const t = c.t;
  // One quick strike (0.45 s): wind up, snap the paw forward and down, recover.
  const wind = pulse(t, 0, 0.12, 0.14, 0.2);
  const hit = pulse(t, 0.12, 0.2, 0.26, 0.45);
  p.bodyY = -19;
  p.headY = -30;
  p.headX = 29;
  p.fnX = 14 + 6 * wind + 18 * hit;
  p.fnY = -10 * wind - 4 * hit;
  p.fnPaw = -0.4 * wind + 0.2 * hit;
  p.tilt += -0.08 * hit + 0.05 * wind;
  p.headRot += 0.06 * wind - 0.1 * hit;
  ears(p, -0.4, -0.35);
  p.eyeSquint = 0.2;
  p.tailBase += 0.3 * hit;
}

function clipTailChase(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  // The whole fox spins about the vertical axis chasing the brush; the head dips towards the tail.
  const s = TAU * 1.05 * t;
  p.turnX = Math.cos(s);
  p.headRot -= 0.3;
  p.headY += 5;
  p.headX -= 3;
  p.tailFront = 0;
  p.tailBase = 0.4;
  p.tailCurl = 1 + 0.4 * Math.sin(s);
  p.tailStiff = 0.2;
  p.mouthOpen = 0.35;
  p.eyeHappy = 0.3;
  p.eyeSquint = 0.2;
  p.pivX = -8;
  p.sqX = 1;
  p.bodyX += 0.5;
  const hop = Math.max(0, Math.sin(TAU * 2.1 * t));
  p.offY = -2 * hop;
}

function clipConfused(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  const tilt = Math.sin(TAU * 0.32 * t);
  p.headRot += 0.28 * tilt;
  p.headX += 1.2 * tilt;
  p.earNR = -0.35 * Math.max(0, tilt) + 0.2 * Math.max(0, -tilt);
  p.earFR = 0.4 * Math.max(0, tilt) - 0.4 * Math.max(0, -tilt);
  p.pupilX = 0.4 * Math.sin(TAU * 0.32 * t + 1);
  p.eyeSquint = 0.1;
  p.tailCurl = -2.1 + 0.2 * Math.sin(TAU * 0.5 * t);
}

function clipDance(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  // Play bow: chest on the ground, front paws stretched forward, rump high, the brush wagging; it
  // springs up between the bows.
  const beat = Math.sin(TAU * 1.5 * t);
  const bow = 0.5 + 0.5 * beat;
  const wag = Math.sin(TAU * 4.2 * t);
  p.tilt = -0.52 * bow;
  p.bodyX = -4 + 2 * bow;
  p.bodyY = -28.5 - 1.2 * bow + 2.2 * (1 - bow);
  p.headX = 26 + 5 * bow;
  p.headY = -40.5 + 8 * bow - 3 * (1 - bow);
  p.headRot = 0.1 + 0.1 * (1 - bow);
  setFoot(p, LEG_FN, 11 + 13 * bow, 0, 0);
  setFoot(p, LEG_FF, 6.5 + 14 * bow, 0, 0);
  setFoot(p, LEG_BN, -18.5, -3 * (1 - bow), 0);
  setFoot(p, LEG_BF, -23, -3 * (1 - bow), 0);
  p.mouthOpen = 0.5;
  p.tongue = 0.6;
  p.eyeHappy = 0.6;
  ears(p, -0.15, -0.1);
  p.tailBase = 0.9 + 0.2 * wag;
  p.tailCurl = 0.5 + 0.9 * wag;
  p.tailStiff = 0.4;
  p.pupilX = 0.3;
}

function clipShake(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  // Full-body shake-off (1.1 s): the head leads, the body follows, the ears flap.
  const env = pulse(t, 0.05, 0.2, 0.8, 1.05);
  const a = Math.sin(TAU * 9 * t);
  const b = Math.sin(TAU * 9 * t - 1.1);
  p.headRot += 0.4 * a * env;
  p.headX += 2 * a * env;
  p.rot = 0.045 * b * env;
  p.offX = 1.6 * b * env;
  p.tailCurl += 1.0 * b * env;
  p.earNR += 0.5 * a * env;
  p.earFR -= 0.5 * a * env;
  p.eyeSquint = 0.6 * env;
  p.tilt += 0.03 * env;
  p.pivY = -22;
}

/** The pounce clip: a mouse-pounce routine when played on the ground, a flight pose when the sim jumps. */
function clipPounce(p: Pose, c: ClipContext): void {
  if (c.jumpKind === 'pounce') {
    const nose = clamp(-c.vy / 500, -1, 1);
    flightPose(p, c, nose);
    p.tilt = clamp(0.3 * nose - 0.1, -0.55, 0.4);
    p.headRot = -0.15 - 0.2 * (1 - nose);
    return;
  }
  const t = c.t;
  const it = (t % 3.4 + 3.4) % 3.4;
  standPose(p);
  // 0..0.55 alert, stock still, ears forward; 0.55..1.2 crouch and wiggle; 1.2..1.5 the leap;
  // 1.5..1.7 the nose-first dive; 1.7..2.4 pinned, nose in the grass; 2.4..2.9 pop up and look; then settle.
  const alert = pulse(it, 0.05, 0.3, 0.5, 0.6);
  const crouch = pulse(it, 0.55, 0.85, 1.15, 1.25);
  const wig = Math.sin(TAU * 5 * it) * crouch;
  const leap = pulse(it, 1.2, 1.32, 1.45, 1.55);
  const dive = pulse(it, 1.45, 1.6, 2.3, 2.5);
  const pop = pulse(it, 2.35, 2.55, 2.85, 3.1);
  // alert
  p.headY -= 4 * alert;
  p.headRot += 0.1 * alert;
  p.tilt += 0.04 * alert;
  // crouch: low, the rump up a little, the haunches wiggling
  p.bodyY += 8 * crouch;
  p.headY += 12 * crouch;
  p.headX += 2 * crouch;
  p.tilt -= 0.1 * crouch;
  p.bodyX += 1.2 * wig;
  p.bnX += 1.5 * wig;
  p.bfX += 1.5 * wig;
  p.tailBase -= 0.0;
  p.tailCurl += 0.5 * wig;
  // leap
  p.offY -= 15 * leap;
  p.offX += 5 * leap + 9 * dive;
  p.tilt -= 0.5 * leap;
  // dive: nose to the ground, forelegs reaching forward, the rump high
  p.tilt -= 0.38 * dive;
  p.bodyY += 3 * dive;
  p.headX += 8 * dive;
  p.headY += 14 * dive;
  p.headRot -= 0.8 * dive;
  p.fnX += 14 * dive;
  p.ffX += 15 * dive;
  p.fnY -= 1 * dive;
  p.mouthOpen = 0.1 * dive;
  p.tailBase += 0.8 * dive + 0.2 * Math.sin(TAU * 6 * it) * dive;
  p.tailCurl += 0.3 * dive;
  // pop up and look around, proud
  p.headY -= 10 * pop;
  p.headRot += 0.8 * pop * dive + 0.3 * pop;
  p.fnY -= 0;
  ears(p, -0.45 * (alert + crouch) - 0.2 * pop, -0.4 * (alert + crouch) - 0.2 * pop, 0.5 * dive, 0.5 * dive);
  p.eyeSquint = 0.3 * crouch + 0.2 * dive;
  p.pupilX = 0.5;
  p.eyeHappy = 0.8 * pop;
  p.tailStiff = 0.7;
  p.blinkOK = dive > 0.3 ? 0 : 1;
  p.shadow = 1 - 0.5 * leap;
}

// ---- scratch, yip, hop, squish ---------------------------------------------------------------------

function clipScratch(p: Pose, c: ClipContext): void {
  sitPose(p);
  // 3.4 s loop: the near hind leg comes up behind the head, scratches the ear and cheek fast, goes back down.
  const it = (c.t % 3.4 + 3.4) % 3.4;
  const raise = pulse(it, 0.15, 0.55, 2.75, 3.2);
  const scr = Math.sin(TAU * 7.2 * it) * raise;
  const settle = 1 - raise;
  p.headX = lerp(9, 3, raise) + 0.7 * scr;
  p.headY = lerp(-45, -34, raise) + 0.5 * scr;
  p.headRot = lerp(0.22, -0.3, raise) + 0.05 * scr;
  p.bodyX += 0.4 * scr - 1.2 * raise;
  p.tilt -= 0.12 * raise;
  setFoot(p, LEG_BN, lerp(-3, -3 + 2.4 * scr, raise), lerp(0, -31 + 3.4 * scr, raise), lerp(0, -0.7, raise));
  p.eyeHappy = 0.85 * raise;
  p.eyeSquint = 0.4 * raise;
  p.mouthOpen = 0.12 * raise * (0.5 + 0.5 * Math.sin(TAU * 1.4 * it));
  p.earNR = 0.95 * raise + 0.1 * scr * raise;
  p.earNF = 0.35 * raise;
  p.earFR = 0.25 * raise;
  p.tailCurl += 0.2 * Math.sin(TAU * 1.1 * c.t) * settle;
  p.blinkOK = raise > 0.3 ? 0 : 1;
  p.lookW = settle;
}

/** The yip: a sharp bark. A quick dip, the head snaps up with the mouth wide, then a smaller second one. */
function clipMeow(p: Pose, c: ClipContext): void {
  sitPose(p);
  const t = c.t;
  const dip = pulse(t, 0, 0.07, 0.1, 0.16);
  const y1 = pulse(t, 0.1, 0.15, 0.27, 0.36);
  const y2 = 0.65 * pulse(t, 0.42, 0.47, 0.56, 0.66);
  const y = Math.max(y1, y2);
  const k = c.reducedMotion ? 0.5 : 1;
  p.headY += 3 * dip - 4.5 * y * k;
  p.headX += -1 * dip - 1.4 * y * k;
  p.headRot += -0.1 * dip + 0.5 * y * k;
  p.mouthOpen = 0.92 * y;
  p.tongue = 0.35 * y;
  p.offY = -1.6 * y * k;
  p.sqY = 1 - 0.03 * dip;
  p.bodyY += 1 * dip;
  p.eyeSquint = 0.35 * y;
  p.earNR -= 0.6 * y;
  p.earFR -= 0.55 * y;
  p.tailCurl += 0.6 * y * k;
  p.tailBase += 0.3 * y * k;
  p.blinkOK = 0;
  p.shadow = 1 - 0.3 * y * k;
}

/** A springy pronk in place: stiff legs, all four paws leave the ground, the brush bounces. */
function clipHop(p: Pose, c: ClipContext): void {
  standPose(p);
  const cy = (c.t / 0.64) % 1;
  const crouch = 1 - sseg(cy, 0, 0.2);
  const air = Math.sin(Math.PI * clamp01((cy - 0.2) / 0.62));
  const k = c.reducedMotion ? 0.5 : 1;
  p.offY = -13 * air * k;
  p.sqY = 1 - 0.1 * crouch * k;
  p.sqX = 1 + 0.05 * crouch * k;
  p.bodyY += 3 * crouch;
  p.headY += 3 * crouch - 2 * air;
  p.arch = 0.45 * air;
  p.tilt += 0.08 * air - 0.05 * crouch;
  setFoot(p, LEG_FN, 11 + 3 * air, -7 * air, 0.5 * air);
  setFoot(p, LEG_FF, 6.5 + 2 * air, -8 * air, 0.5 * air);
  setFoot(p, LEG_BN, -18.5 - 2 * air, -7 * air, -0.4 * air);
  setFoot(p, LEG_BF, -23 - 3 * air, -8 * air, -0.4 * air);
  ears(p, -0.15 - 0.3 * air, -0.1 - 0.3 * air);
  p.eyeHappy = 0.5;
  p.mouthOpen = 0.3 * air;
  p.tailBase += 0.5 * air - 0.2 * crouch;
  p.tailCurl += 0.5 * Math.sin(TAU * cy);
  p.shadow = 1 - 0.5 * air;
}

/** The pounce-landing squish: flat on the belly with the legs splayed, then a springy settle. */
function clipSquish(p: Pose, c: ClipContext): void {
  standPose(p);
  const t = c.t;
  const k = c.reducedMotion ? 0.5 : 1;
  const d = (1 - sseg(t, 0.1, 0.34)) * clamp01(0.3 + t / 0.05);
  const over = pulse(t, 0.3, 0.42, 0.46, 0.7);
  p.sqY = 1 - 0.3 * d * k + 0.06 * over * k;
  p.sqX = 1 + 0.22 * d * k - 0.04 * over * k;
  p.bodyY += 4 * d;
  p.headY += 5 * d;
  p.headX += 3 * d;
  p.headRot -= 0.15 * d;
  p.tilt -= 0.08 * d;
  setFoot(p, LEG_FN, 11 + 9 * d, 0, 0);
  setFoot(p, LEG_FF, 6.5 + 8 * d, 0, 0);
  setFoot(p, LEG_BN, -18.5 - 7 * d, 0, 0);
  setFoot(p, LEG_BF, -23 - 8 * d, 0, 0);
  ears(p, 0.9 * d, 0.9 * d, 0.5 * d, 0.5 * d);
  p.eyeSquint = 0.8 * d;
  p.mouthOpen = 0.3 * d;
  p.tailBase += 0.5 * d;
  p.tailPuff = 0.5 * d;
  p.blinkOK = d > 0.3 ? 0 : 1;
}

// ---- vanish and appear ------------------------------------------------------------------------------

/** Lowest, smallest and most hidden state: where a vanish ends and an appear begins. */
function slippedPose(p: Pose): void {
  standPose(p);
  p.bodyY = -15;
  p.headY = -25;
  p.headX = 27;
  p.tilt = -0.07;
  p.haunch = 0.3;
  p.sqY = 0.42;
  p.sqX = 0.78;
  setFoot(p, LEG_FN, 14, 0, 0);
  setFoot(p, LEG_FF, 9, 0, 0);
  setFoot(p, LEG_BN, -14, 0, 0);
  setFoot(p, LEG_BF, -19, 0, 0);
  ears(p, 0.6, 0.65, 0.5, 0.5);
  p.eyeHappy = 0.6;
  p.tailBase = 0.5;
  p.tailCurl = -0.1;
  p.tailStiff = 0.4;
  p.alpha = 0;
  p.tailAlpha = 0;
  p.blinkOK = 0;
  p.lookW = 0;
}

/**
 * The fox slips away: a sly smirk and a low crouch, then it sinks and shrinks to nothing while the body fades first;
 * the brush lingers last, and a little dust puff marks the spot. Reduced motion: a slow, gentle fade in place.
 */
function clipVanish(p: Pose, c: ClipContext): void {
  const t = c.t;
  standPose(p);
  if (c.reducedMotion) {
    p.alpha = 1 - sseg(t, 0, 0.9);
    p.eyeHappy = 0.4 * sseg(t, 0, 0.4);
    p.blinkOK = 0;
    return;
  }
  const lo = sseg(t, 0, 0.3);
  const shrink = sseg(t, 0.2, 0.62);
  p.bodyY = lerp(-28.5, -15, lo);
  p.headY = lerp(-40.5, -25, lo);
  p.headX = lerp(26, 27, lo);
  p.tilt = -0.07 * lo;
  p.haunch = 0.3 * lo;
  p.sqY = lerp(1, 0.42, shrink);
  p.sqX = lerp(1, 0.78, shrink);
  setFoot(p, LEG_FN, lerp(11, 14, lo), 0, 0);
  setFoot(p, LEG_FF, lerp(6.5, 9, lo), 0, 0);
  setFoot(p, LEG_BN, lerp(-18.5, -14, lo), 0, 0);
  setFoot(p, LEG_BF, lerp(-23, -19, lo), 0, 0);
  ears(p, 0.6 * lo, 0.65 * lo, 0.5 * lo, 0.5 * lo);
  p.eyeHappy = 0.6 * lo;
  p.eyeSquint = 0.3 * lo;
  const wave = Math.sin(TAU * 2.4 * t) * (1 - shrink * 0.4);
  p.tailBase = lerp(0.12, 0.5, lo);
  p.tailCurl = lerp(-0.45, -0.1, lo) + 0.6 * wave * lo;
  p.tailStiff = 0.4;
  p.alpha = 1 - sseg(t, 0.22, 0.62);
  p.tailAlpha = 1 - sseg(t, 0.52, 0.9);
  p.dust = pulse(t, 0.4, 0.5, 0.58, 0.9);
  p.dustT = sseg(t, 0.4, 0.9);
  p.blinkOK = 0;
  p.lookW = 1 - lo;
}

/** The reverse: the brush returns first, the body grows out of a puff of dust, the ears pop up last. */
function clipAppear(p: Pose, c: ClipContext): void {
  const t = c.t;
  standPose(p);
  if (c.reducedMotion) {
    p.alpha = sseg(t, 0, 0.9);
    p.eyeHappy = 0.4 * (1 - sseg(t, 0.4, 0.9));
    p.blinkOK = 0;
    return;
  }
  slippedPose(p);
  const grow = sseg(t, 0.12, 0.62);
  const settle = sseg(t, 0.6, 0.9);
  const over = pulse(t, 0.5, 0.62, 0.66, 0.84);
  p.alpha = sseg(t, 0.18, 0.55);
  p.tailAlpha = sseg(t, 0, 0.28);
  p.sqY = lerp(0.42, 1, grow) + 0.06 * over;
  p.sqX = lerp(0.78, 1, grow) - 0.03 * over;
  p.bodyY = lerp(-15, -28.5, settle);
  p.headY = lerp(-25, -40.5, settle);
  p.headX = lerp(27, 26, settle);
  p.tilt = lerp(-0.07, 0, settle);
  p.haunch = lerp(0.3, 0, settle);
  setFoot(p, LEG_FN, lerp(14, 11, settle), 0, 0);
  setFoot(p, LEG_FF, lerp(9, 6.5, settle), 0, 0);
  setFoot(p, LEG_BN, lerp(-14, -18.5, settle), 0, 0);
  setFoot(p, LEG_BF, lerp(-19, -23, settle), 0, 0);
  const ear = sseg(t, 0.56, 0.86);
  ears(p, lerp(0.6, -0.25, ear), lerp(0.65, -0.2, ear), lerp(0.5, 0, ear), lerp(0.5, 0, ear));
  p.eyeHappy = lerp(0.6, 0.3, settle);
  p.eyeSquint = 0.2 * (1 - settle);
  p.tailBase = lerp(0.5, 0.22, settle);
  p.tailCurl = lerp(-0.1, -0.45, settle) + 0.4 * Math.sin(TAU * 2.4 * t) * (1 - settle);
  p.dust = pulse(t, 0.1, 0.22, 0.32, 0.75);
  p.dustT = sseg(t, 0.1, 0.75);
  p.pupilX = 0.5 * Math.sin(TAU * 0.9 * t);
  p.lookW = settle;
  p.blinkOK = settle > 0.9 ? 1 : 0;
}

// ---- sampling ---------------------------------------------------------------------------------------

/** Writes the pose of `clip` for the context. Unknown clips draw as a stand (the renderer resolves aliases first). */
export function sampleClip(clip: AnimClip, c: ClipContext, p: Pose): void {
  switch (clip) {
    case 'sit':
      return clipSit(p, c);
    case 'loaf':
      return clipLoaf(p, c);
    case 'sleep':
      return clipSleep(p, c);
    case 'wake':
      return clipWake(p, c);
    case 'yawn':
      return clipYawn(p, c);
    case 'stretch':
      return clipStretch(p, c);
    case 'walk':
      return clipWalk(p, c);
    case 'run':
      return clipRun(p, c);
    case 'stalk':
      return clipStalk(p, c);
    case 'slink':
      return clipSlink(p, c);
    case 'climb':
      return clipClimb(p, c);
    case 'crouch':
      return clipCrouch(p, c);
    case 'jump':
      return clipJump(p, c);
    case 'fall':
      return clipFall(p, c);
    case 'land':
      return clipLand(p, c);
    case 'startle':
      return clipStartle(p, c);
    case 'annoyed':
      return clipAnnoyed(p, c);
    case 'petted':
      return clipPetted(p, c);
    case 'groom':
      return clipGroom(p, c);
    case 'held':
      return clipHeld(p, c);
    case 'hide':
      return clipHide(p, c);
    case 'peek':
      return clipPeek(p, c);
    case 'scan':
      return clipScan(p, c);
    case 'rollOver':
      return clipRollOver(p, c);
    case 'swat':
      return clipSwat(p, c);
    case 'tailChase':
      return clipTailChase(p, c);
    case 'confused':
      return clipConfused(p, c);
    case 'dance':
      return clipDance(p, c);
    case 'shake':
      return clipShake(p, c);
    case 'pounce':
      return clipPounce(p, c);
    case 'scratch':
      return clipScratch(p, c);
    case 'meow':
      return clipMeow(p, c);
    case 'hop':
      return clipHop(p, c);
    case 'squish':
      return clipSquish(p, c);
    case 'vanish':
      return clipVanish(p, c);
    case 'appear':
      return clipAppear(p, c);
    default:
      return clipStand(p, c);
  }
}

/** Cross-fade time (ms) into a clip. */
export function crossFadeMs(from: AnimClip | null, to: AnimClip): number {
  if (from === null) return 0;
  if (to === 'startle' || to === 'land' || to === 'jump' || to === 'shake') return 140;
  if (to === 'pounce' || to === 'swat' || to === 'squish' || to === 'meow') return 130;
  if (to === 'vanish' || to === 'appear' || from === 'vanish') return 100;
  if (to === 'fall' || from === 'land') return 160;
  if (to === 'sleep' || from === 'sleep' || to === 'loaf' || to === 'rollOver' || from === 'rollOver' || to === 'tailChase' || from === 'tailChase') return 260;
  if (from === 'climb' || to === 'climb') return 340;
  if (to === 'sit' || from === 'sit' || to === 'held' || from === 'held') return 220;
  return 200;
}
