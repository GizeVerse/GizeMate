// Rabbit animator: the brain's clip choice -> a living pose. Clip sampling, cross-fades, and the
// procedural layers that make a rabbit look alive: breathing, blinks, a constantly twitching nose,
// ear flicks and ear lag (a spring chain driven by head motion), idle fidgets, look-at, mood on ears
// and eyes, one-off reactions, the held pendulum, deep sleep and reduced motion.
import type { AnimClip } from '../../../../shared/cat';
import { CLIP_FALLBACK, CLIP_META } from '../../../../shared/animationCatalog';
import { MOODS } from '../../../../shared/companion';
import { RABBIT_MODULE } from '../../../../shared/characters/rabbit';
import { clamp, clamp01, damp, finiteOr, lerp, pulse, smooth, TAU } from '../../character/kit';
import type { AnimInput } from '../../character/types';
import { NATIVE_CLIPS, sampleClip, type RClipCtx } from './clips';
import { blendPose, copyPose, createPose, sanitizePose, type RPose } from './pose';

/** Mood slots, resolved once (the animator reads moodW[slot] on every frame). */
const MOOD_CONFUSED = MOODS.indexOf('confused');
const MOOD_CURIOUS = MOODS.indexOf('curious');
const MOOD_EXCITED = MOODS.indexOf('excited');
const MOOD_HAPPY = MOODS.indexOf('happy');
const MOOD_RELAXED = MOODS.indexOf('relaxed');
const MOOD_SCARED = MOODS.indexOf('scared');
const MOOD_SLEEPY = MOODS.indexOf('sleepy');
const MOOD_STARTLED = MOODS.indexOf('startled');

const NATIVE: ReadonlySet<AnimClip> = new Set(NATIVE_CLIPS);

/** Every canonical clip -> the native clip the rabbit draws for it (alias, then shared fallbacks, then stand). */
const RESOLVED: Partial<Record<AnimClip, AnimClip>> = {};
export function resolveClip(clip: AnimClip): AnimClip {
  const known = RESOLVED[clip];
  if (known !== undefined) return known;
  let c: AnimClip | undefined = clip;
  let out: AnimClip = 'stand';
  for (let hops = 0; hops < 8 && c !== undefined; hops++) {
    if (NATIVE.has(c)) {
      out = c;
      break;
    }
    c = RABBIT_MODULE.clipAlias[c] ?? CLIP_FALLBACK[c];
  }
  RESOLVED[clip] = out;
  return out;
}

const BODY_LENGTH_DIP = 84;
const MAX_DT = 0.1;
const SPRING_STEP = 1 / 90;
/** Clips that rest or idle: the fidget layer, look-at and mood run on them. */
const AMBIENT: ReadonlySet<AnimClip> = new Set<AnimClip>(['stand', 'sit', 'loaf', 'scan', 'confused', 'crouch']);
const FIDGET_CLIPS: ReadonlySet<AnimClip> = new Set<AnimClip>(['stand', 'sit', 'loaf']);
const LOOK_CLIPS: ReadonlySet<AnimClip> = new Set<AnimClip>(['stand', 'sit', 'loaf', 'scan', 'confused', 'annoyed']);

const MOOD_RATE = { up: 3, down: 1.6 };
const REDUCE_RATE = 4;
const DEPTH_RATE = 1.2;

const IDLE_KINDS = ['earSwivel', 'sniff', 'lookAround', 'chew', 'noseWipe', 'earShake'] as const;
const IDLE_LEN = [1.4, 1.5, 2.8, 2.0, 1.7, 0.8] as const;

export class RabbitAnimator {
  /** Final pose (clip + cross-fade + procedural layers). */
  readonly pose: RPose = createPose();
  private readonly base: RPose = createPose();
  private readonly clipPose: RPose = createPose();
  private readonly fromPose: RPose = createPose();
  private readonly ctx: RClipCtx = { t: 0, cycle: 0, speed: 0, vy: 0, impact: 0.5, arousal: 0 };

  private clip: AnimClip | null = null;
  private clipStart = Number.NaN;
  private fadeElapsed = 0;
  private fadeDur = 0;
  private cycle = 0;
  private time = 0;
  private breathPhase = 0;
  private nosePhase = 0;
  private whiskPhase = 0;

  /** Nose displacement (-1..1, scaled by the pose's noseAmp) and whisker sway (rad) for the painter. */
  noseWave = 0;
  whiskWave = 0;
  /** Lid factor of the last frame (0 shut .. 1 open): blink included, for the painter's eyelids. */
  lids = 1;

  private readonly moodW = new Float64Array(MOODS.length);
  private depthK = 0;
  private reduceK = 0;

  private blinkTimer: number;
  private blinkAge = -1;
  private blinkDouble = false;

  private earTimer: number;
  private earAge = -1;
  private earWhich = 0;

  private idleTimer: number;
  private idleAge = -1;
  private idleKind = 0;
  private idleSign = 1;

  private lookRot = 0;
  private lookTurn = 0;
  private lookPX = 0;
  private lookPY = 0;
  private lookAmt = 0;

  // Ear spring chain: [near, far] angle and velocity.
  private readonly earX = new Float64Array(2);
  private readonly earV = new Float64Array(2);
  private prevHeadX = Number.NaN;
  private prevHeadY = Number.NaN;
  private velX = 0;
  private velY = 0;

  private swing = 0;
  private swingVel = 0;

  private reactionSeen = Number.NaN;
  private reactionKind = '';
  private reactionStart = Number.NaN;
  private reactionSign = 1;
  private reactionActive = false;
  private fidgetActive = false;

  constructor(private readonly random: () => number) {
    this.blinkTimer = 1 + random() * 3;
    this.earTimer = 2 + random() * 4;
    this.idleTimer = 2.5 + random() * 4;
  }

  get currentClip(): AnimClip | null {
    return this.clip;
  }

  get blending(): boolean {
    return this.fadeElapsed < this.fadeDur;
  }

  get reacting(): boolean {
    return this.reactionActive || this.fidgetActive;
  }

  reset(): void {
    this.prevHeadX = Number.NaN;
    this.prevHeadY = Number.NaN;
    this.velX = 0;
    this.velY = 0;
    this.earX.fill(0);
    this.earV.fill(0);
    this.swing = 0;
    this.swingVel = 0;
  }

  update(input: AnimInput, simTimeMs: number, dtMs: number, motionX: number): RPose {
    const dt = clamp(finiteOr(dtMs, 0) / 1000, 0, MAX_DT);
    const animSpeed = clamp(finiteOr(input.animSpeed, 1), 0.1, 3);
    const reduced = input.reducedMotion === true;
    this.reduceK = damp(this.reduceK, reduced ? 1 : 0, REDUCE_RATE, dt);
    this.depthK = damp(this.depthK, clamp01(finiteOr(input.sleepDepth ?? 0, 0)), DEPTH_RATE, dt);
    this.time += dt * animSpeed * (1 - 0.4 * this.reduceK);
    const speed = Math.max(0, finiteOr(input.speed, 0));
    const clip = resolveClip(input.clip);

    if (clip !== this.clip || input.clipStartedAt !== this.clipStart) {
      const first = this.clip === null;
      if (!first) copyPose(this.fromPose, this.base);
      if (clip !== 'hop') this.cycle = 0;
      this.fadeDur = first ? 0 : this.fadeSeconds(this.clip, clip);
      this.fadeElapsed = 0;
      this.clip = clip;
      this.clipStart = input.clipStartedAt;
    }

    const c = this.ctx;
    c.t = (Math.max(0, finiteOr(simTimeMs - this.clipStart, 0)) * animSpeed) / 1000;
    if (clip === 'hop') {
      const v = speed * BODY_LENGTH_DIP;
      const stride = lerp(22, 40, clamp01((v - 30) / 220));
      const hz = clamp(v / stride, 1.6, 4.2) * (1 - 0.25 * this.reduceK);
      this.cycle += hz * dt * animSpeed;
      if (this.cycle > 1e6) this.cycle -= Math.trunc(this.cycle);
    }
    c.cycle = this.cycle;
    c.speed = speed;
    c.vy = finiteOr(input.vy, 0);
    c.impact = clamp01(finiteOr(input.impact ?? 0.5, 0.5));
    c.arousal = clamp01(finiteOr(input.arousal, 0));

    sampleClip(this.clipPose, clip, c);
    if (this.fadeElapsed < this.fadeDur) {
      this.fadeElapsed = Math.min(this.fadeDur, this.fadeElapsed + dt);
      blendPose(this.base, this.fromPose, this.clipPose, smooth(this.fadeElapsed / this.fadeDur));
    } else {
      copyPose(this.base, this.clipPose);
    }
    copyPose(this.pose, this.base);
    this.layers(input, clip, dt, animSpeed, finiteOr(motionX, 0));
    sanitizePose(this.pose);
    return this.pose;
  }

  private fadeSeconds(from: AnimClip | null, to: AnimClip): number {
    if (to === 'held') return 0.22;
    if (from === 'sleep' || to === 'sleep') return 0.45;
    if (to === 'startle') return 0.05;
    if (from === 'jump' || from === 'fall' || to === 'jump' || to === 'fall' || to === 'land') return 0.07;
    return clamp(CLIP_META[to].fadeInMs / 1000, 0.08, 0.3);
  }

  private layers(input: AnimInput, clip: AnimClip, dt: number, animSpeed: number, motionX: number): void {
    const p = this.pose;
    const sleeping = clip === 'sleep' || input.sleeping;
    const red = this.reduceK;
    const calm = 1 - 0.55 * red;
    const ambient = AMBIENT.has(clip);
    const lt = dt * animSpeed;

    // Mood.
    for (let i = 0; i < MOODS.length; i++) {
      const target = input.mood === MOODS[i] ? 1 : 0;
      const rate = target > this.moodW[i]! ? MOOD_RATE.up : MOOD_RATE.down;
      this.moodW[i] = damp(this.moodW[i]!, target, rate, dt);
      if (this.moodW[i]! < 1e-3) this.moodW[i] = 0;
    }
    const mw = this.moodW;
    const m = ambient ? 1 : 0.35;
    if (!sleeping) {
      const happy = mw[MOOD_HAPPY]! * m;
      const startled = mw[MOOD_STARTLED]! * m;
      const scared = mw[MOOD_SCARED]! * m;
      const excited = mw[MOOD_EXCITED]! * m;
      const sleepy = mw[MOOD_SLEEPY]! * m;
      const relaxed = mw[MOOD_RELAXED]! * m;
      const curious = mw[MOOD_CURIOUS]! * m;
      const confused = mw[MOOD_CONFUSED]! * m;
      p.blush = clamp01(p.blush + 0.3 * happy + 0.15 * excited);
      p.eNA += -0.16 * startled - 0.1 * curious - 0.06 * excited + 0.38 * scared + 0.16 * sleepy + 0.1 * relaxed - 0.04 * happy;
      p.eFA += -0.16 * startled - 0.1 * curious - 0.06 * excited + 0.38 * scared + 0.16 * sleepy + 0.1 * relaxed - 0.04 * happy + 0.3 * confused;
      p.eNB += 0.18 * scared + 0.1 * sleepy;
      p.eyeOpen = clamp01(p.eyeOpen * (1 - 0.4 * sleepy - 0.1 * relaxed));
      p.noseAmp = clamp01(p.noseAmp + 0.35 * excited + 0.3 * curious + 0.3 * scared - 0.2 * sleepy);
      p.headY += 1.5 * scared + 0.8 * sleepy;
      p.pupilX += 0.1 * curious;
      p.tailLift += 1.6 * excited;
    }

    // Idle fidgets (rest clips only).
    this.fidgetActive = false;
    const fidgetOk = !sleeping && FIDGET_CLIPS.has(clip) && !input.hasLook;
    if (!fidgetOk || this.idleAge >= 0) this.idleTimer = Math.max(this.idleTimer, 1);
    if (fidgetOk || this.idleAge >= 0) this.stepIdle(clip, lt, calm, fidgetOk);

    // Look-at.
    const lookOk = LOOK_CLIPS.has(clip) && input.hasLook && !sleeping;
    const lw = damp(this.lookAmt, lookOk ? 1 : 0, 5, dt);
    this.lookAmt = lw < 1e-3 ? 0 : lw;
    if (this.lookAmt > 0) {
      const dx = finiteOr(input.lookX, 0) - p.headX;
      const dy = finiteOr(input.lookY, 0) - p.headY;
      const ang = Math.atan2(-dy, Math.max(dx, 1e-3));
      const tr = lookOk ? clamp(ang * 0.34, -0.22, 0.34) : 0;
      const tt = lookOk ? (dx < -8 ? -0.7 : 0.25) : 0;
      this.lookRot = damp(this.lookRot, tr, 5, dt);
      this.lookTurn = damp(this.lookTurn, tt, 4, dt);
      this.lookPX = damp(this.lookPX, lookOk ? clamp(dx / 70, -1, 1) * 0.7 : 0, 7, dt);
      this.lookPY = damp(this.lookPY, lookOk ? clamp(dy / 70, -1, 1) * 0.6 : 0, 7, dt);
      const k = this.lookAmt;
      p.headRot += this.lookRot * k;
      p.turn += this.lookTurn * k;
      p.pupilX += this.lookPX * k;
      p.pupilY += this.lookPY * k;
      p.eNA += -0.12 * k * (dx > 0 ? 1 : 0);
      p.eFA += -0.1 * k * (dx > 0 ? 1 : 0);
    }

    // Breathing: slower and shallower in deep sleep, quicker when scared or after a startle.
    const scared = Math.max(mw[MOOD_SCARED]!, mw[MOOD_STARTLED]!);
    const rate = sleeping ? lerp(0.32, 0.18, this.depthK) : 0.62 + 0.9 * scared + (clip === 'hide' ? 0.6 : 0);
    this.breathPhase = (this.breathPhase + lt * rate * TAU) % (TAU * 1000);
    const b = Math.sin(this.breathPhase) * p.breath * (sleeping ? lerp(1, 0.65, this.depthK) : 1) * calm;
    p.bodyRY *= 1 + 0.026 * b;
    p.bodyRX *= 1 - 0.01 * b;
    p.bodyY -= 0.3 * b;
    p.headY -= 0.45 * b;

    // Nose and whiskers: always busy, slow and small asleep.
    const noseHz = sleeping ? lerp(1.3, 0.7, this.depthK) : 5.2 + 3.5 * p.noseAmp + (this.idleAge >= 0 && this.idleKind === 1 ? 4 : 0);
    this.nosePhase = (this.nosePhase + lt * noseHz * TAU) % (TAU * 1000);
    this.whiskPhase = (this.whiskPhase + lt * noseHz * 0.5 * TAU) % (TAU * 1000);
    // Twitches come in bursts: a slow envelope gates the fast wave.
    const gate = 0.45 + 0.55 * Math.sin(this.time * 1.7) * Math.sin(this.time * 0.63 + 1);
    this.noseWave = Math.sin(this.nosePhase) * clamp01(p.noseAmp * (sleeping ? 0.8 : 0.5 + 0.8 * Math.max(0, gate))) * calm;
    this.whiskWave = Math.sin(this.whiskPhase) * 0.1 * clamp01(p.noseAmp + 0.2) * calm;

    // Blinks (slower and heavier when sleepy).
    let lid = 1;
    if (!sleeping && p.eyeOpen > 0.3) {
      this.blinkTimer -= lt;
      if (this.blinkAge < 0 && this.blinkTimer <= 0) {
        this.blinkAge = 0;
        this.blinkDouble = this.random() < 0.18;
      }
      if (this.blinkAge >= 0) {
        const dur = 0.16 + 0.1 * mw[MOOD_SLEEPY]!;
        this.blinkAge += lt;
        const a = this.blinkAge / dur;
        lid = 1 - Math.sin(clamp01(a) * Math.PI);
        if (a >= 1) {
          this.blinkAge = -1;
          this.blinkTimer = this.blinkDouble ? 0.1 : 2 + this.random() * 4.5;
          this.blinkDouble = false;
        }
      }
    }
    this.lids = clamp01(lid * p.blinkOK);

    // Random ear flicks: a quick twitch of one or both ears.
    if (!sleeping && ambient) {
      this.earTimer -= lt;
      if (this.earAge < 0 && this.earTimer <= 0) {
        this.earAge = 0;
        this.earWhich = Math.floor(this.random() * 3);
      }
    }
    if (this.earAge >= 0) {
      this.earAge += lt;
      const a = this.earAge / 0.24;
      const e = Math.sin(clamp01(a) * Math.PI) * calm;
      if (this.earWhich !== 1) p.eNA += 0.34 * e;
      if (this.earWhich !== 0) p.eFA += 0.34 * e;
      if (a >= 1) {
        this.earAge = -1;
        this.earTimer = 2.5 + this.random() * 5.5;
      }
    }

    // One-off reactions from the snapshot (ear flick, tail flick, head tilt).
    this.stepReaction(input, lt, calm);

    // Held: the pendulum about the scruff, driven by how fast the grip moves.
    const heldNow = clip === 'held';
    if (heldNow && dt > 0) {
      const vx = clamp(motionX / dt, -3000, 3000);
      const target = clamp(vx / 1000, -0.55, 0.55) + 0.05 * Math.sin(this.time * 1.7);
      const om = 8.5;
      const z = 0.22;
      let rest = dt;
      while (rest > 1e-6) {
        const h = Math.min(rest, SPRING_STEP);
        this.swingVel += (-om * om * (this.swing - target) - 2 * z * om * this.swingVel) * h;
        this.swing += this.swingVel * h;
        rest -= h;
      }
      this.swing = clamp(this.swing, -0.8, 0.8);
    } else {
      this.swing = damp(this.swing, 0, 8, dt);
      this.swingVel = damp(this.swingVel, 0, 8, dt);
    }
    p.rot += this.swing * calm;
    p.eNA += 0.4 * this.swing;
    p.eFA += 0.4 * this.swing;

    // Ear lag: spring chain on the head's velocity (skipped asleep and with reduced motion at half strength).
    this.stepEars(p, dt, motionX, sleeping, calm);

    // Reduced motion: smaller leaps, squashes and swings, never a flash.
    if (red > 0) {
      const k = 0.5 * red;
      p.offY *= 1 - k;
      p.offX *= 1 - k;
      p.rot *= 1 - k;
      p.sqY = lerp(p.sqY, 1, k);
      p.sqX = lerp(p.sqX, 1, k);
      p.eyeHappy *= 1 - 0.3 * red;
    }
  }

  private stepIdle(clip: AnimClip, lt: number, calm: number, canStart: boolean): void {
    const p = this.pose;
    if (this.idleAge < 0) {
      this.idleTimer -= lt;
      if (!canStart || this.idleTimer > 0) return;
      // Pick a fidget the posture allows: no paw wipes while standing on all fours.
      let k = Math.floor(this.random() * IDLE_KINDS.length);
      if (clip === 'stand' && k === 4) k = 2;
      if (clip === 'loaf' && k === 2) k = 3;
      this.idleKind = k;
      this.idleSign = this.random() < 0.5 ? -1 : 1;
      this.idleAge = 0;
    }
    const len = IDLE_LEN[this.idleKind]!;
    this.idleAge += lt;
    const a = clamp01(this.idleAge / len);
    const e = pulse(a, 0, 0.18, 0.78, 1) * calm;
    this.fidgetActive = this.idleAge < len;
    switch (this.idleKind) {
      case 0: {
        // Ear swivel: one ear turns outward, the other cups back, then both return.
        p.eNA += -0.55 * e * this.idleSign + 0.12 * e;
        p.eNL *= 1 - 0.1 * e;
        p.eFA += 0.5 * e * this.idleSign;
        p.pupilX += 0.3 * e * this.idleSign;
        break;
      }
      case 1: {
        // Sniff: chin up, whole face working.
        p.headRot += 0.26 * e;
        p.headY -= 1.8 * e;
        p.headX += 1.2 * e;
        p.noseAmp = clamp01(p.noseAmp + e);
        p.eNA -= 0.06 * e;
        break;
      }
      case 2: {
        // Look around: the head sweeps one way, comes back and checks the other.
        const sw = Math.sin(a * Math.PI * 2) * e;
        p.headX += 2.2 * sw * this.idleSign;
        p.turn += 0.8 * sw * this.idleSign;
        p.pupilX += 0.6 * sw * this.idleSign;
        p.headRot += 0.07 * Math.abs(sw);
        p.eNA += 0.14 * sw * this.idleSign;
        p.eFA -= 0.14 * sw * this.idleSign;
        break;
      }
      case 3: {
        // Chew: a small, quick working of the jaw.
        const j = Math.max(0, Math.sin(this.idleAge * TAU * 4.6)) * e;
        p.mouth = Math.max(p.mouth, 0.34 * j);
        p.headY += 0.4 * j;
        p.eyeOpen = clamp01(p.eyeOpen * (1 - 0.25 * e));
        break;
      }
      case 4: {
        // Nose wipe: a forepaw rubs the nose, ears dip.
        const r = Math.sin(this.idleAge * TAU * 3.6);
        p.fnX = lerp(p.fnX, p.headX + 12 + 2.5 * r, e);
        p.fnY = lerp(p.fnY, p.headY + 6 + 1.5 * r, e);
        p.headRot -= 0.1 * e;
        p.eNA += 0.2 * e;
        p.eyeOpen = clamp01(p.eyeOpen * (1 - 0.5 * e));
        break;
      }
      default: {
        // Ear shake: a quick flap of both ears.
        const f = Math.sin(this.idleAge * TAU * 9) * e;
        p.eNA += 0.4 * f;
        p.eFA -= 0.4 * f;
        p.headRot += 0.04 * f;
        break;
      }
    }
    if (a >= 1) {
      this.idleAge = -1;
      this.idleTimer = 4 + this.random() * 7;
    }
  }

  private stepReaction(input: AnimInput, lt: number, calm: number): void {
    const p = this.pose;
    const r = input.reaction;
    if (r && Number.isFinite(r.at) && r.at !== this.reactionSeen) {
      this.reactionSeen = r.at;
      this.reactionKind = r.kind;
      this.reactionStart = 0;
      this.reactionSign = this.random() < 0.5 ? -1 : 1;
    }
    this.reactionActive = false;
    if (this.reactionStart >= 0 && this.reactionKind !== '') {
      this.reactionStart += lt;
      const len = this.reactionKind === 'headTilt' ? 0.6 : this.reactionKind === 'tailFlick' ? 0.4 : 0.3;
      const a = this.reactionStart / len;
      if (a >= 1) {
        this.reactionStart = Number.NaN;
        this.reactionKind = '';
        return;
      }
      const e = Math.sin(a * Math.PI) * calm;
      this.reactionActive = true;
      if (this.reactionKind === 'earFlick') {
        p.eNA += 0.5 * e;
        p.eFA += 0.45 * e;
      } else if (this.reactionKind === 'tailFlick') {
        p.tailLift += 3.5 * e;
      } else {
        p.headRot += 0.21 * e * this.reactionSign;
        p.eNA += 0.12 * e * this.reactionSign;
        p.eFA -= 0.12 * e * this.reactionSign;
      }
    }
  }

  private stepEars(p: RPose, dt: number, motionX: number, sleeping: boolean, calm: number): void {
    const hx = p.headX + p.offX;
    const hy = p.headY + p.offY;
    if (!Number.isFinite(this.prevHeadX) || dt <= 0) {
      this.prevHeadX = hx;
      this.prevHeadY = hy;
    } else {
      const ivx = (hx - this.prevHeadX) / dt + motionX / dt;
      const ivy = (hy - this.prevHeadY) / dt;
      this.velX = damp(this.velX, clamp(ivx, -900, 900), 22, dt);
      this.velY = damp(this.velY, clamp(ivy, -900, 900), 22, dt);
      this.prevHeadX = hx;
      this.prevHeadY = hy;
    }
    const gain = sleeping ? 0 : calm;
    const tN = clamp(0.0036 * this.velX - 0.0034 * this.velY, -0.7, 0.7) * gain;
    const tF = tN * 0.9;
    let rest = dt;
    while (rest > 1e-6) {
      const h = Math.min(rest, SPRING_STEP);
      this.earV[0] = this.earV[0]! + (-22 * 22 * (this.earX[0]! - tN) - 2 * 0.34 * 22 * this.earV[0]!) * h;
      this.earX[0] = this.earX[0]! + this.earV[0] * h;
      this.earV[1] = this.earV[1]! + (-18 * 18 * (this.earX[1]! - tF) - 2 * 0.3 * 18 * this.earV[1]!) * h;
      this.earX[1] = this.earX[1]! + this.earV[1] * h;
      rest -= h;
    }
    this.earX[0] = clamp(this.earX[0]!, -0.8, 0.8);
    this.earX[1] = clamp(this.earX[1]!, -0.8, 0.8);
    p.eNA += this.earX[0];
    p.eFA += this.earX[1];
    p.eNB += 0.6 * this.earX[0];
    p.eFB += 0.6 * this.earX[1];
    if (Math.abs(this.earV[0]!) + Math.abs(this.earV[1]!) > 0.4) this.fidgetActive = true;
  }
}
