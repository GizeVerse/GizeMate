// Turns the sim's clip choice into the alien's living pose: clip sampling with cross-fades, plus the
// procedural layers (bob, breathing, blinks, idle fidgets, look-at, mood, reactions, held pendulum)
// and the reduced-motion calming. Allocation-free after construction.
import { ANIM_CLIPS, type AnimClip } from '../../../../shared/cat';
import { CLIP_META } from '../../../../shared/animationCatalog';
import { MOODS } from '../../../../shared/companion';
import { ALIEN_MODULE } from '../../../../shared/characters/alien';
import { resolveForCharacter } from '../../../../core/behavior/character';
import { clamp, clamp01, damp, finiteOr, sseg, TAU } from '../../character/kit';
import type { AnimInput } from '../../character/types';
import { sampleClip, type ClipCtx } from './clips';
import { blendPose, copyPose, createPose, sanitizePose, type Pose } from './pose';

const RESOLVED: ReadonlyMap<string, AnimClip> = new Map(ANIM_CLIPS.map((c) => [c, resolveForCharacter(ALIEN_MODULE, c)] as const));

const IDLE_WEIGHT: Readonly<Partial<Record<AnimClip, number>>> = { stand: 1, sit: 0.8, loaf: 0.3, float: 0 };
const FIDGET_KINDS = 6;
const MOOD_RATE_UP = 3;
const MOOD_RATE_DOWN = 2;

const REACTION_S: Readonly<Record<string, number>> = { earFlick: 0.35, tailFlick: 0.5, headTilt: 0.7 };

export class AlienAnimator {
  /** The final pose of this frame. */
  readonly pose = createPose();
  private readonly neutral = createPose();
  private readonly target = createPose();
  private readonly from = createPose();
  private readonly mixed = createPose();
  private readonly ctx: ClipCtx = { t: 0, speed: 0, n: 0, gait: 0, impact: 0, amp: 1 };
  private clip: AnimClip = 'stand';
  private started = false;
  private fade = 1;
  private fadeMs = 200;
  private loopClock = 0;
  private lastStart = 0;
  private speedSm = 0;
  private gait = 0;
  private bobPhase = 0;
  private breathPhase = 0;
  // Blink.
  private blinkIn = 2.5;
  private blinkT = -1;
  private blinkLen = 0.14;
  private blinkAgain = false;
  // Fidgets.
  private fidgetIn = 3;
  private fidgetKind = -1;
  private fidgetT = 0;
  private fidgetLen = 1.6;
  private fidgetDir = 1;
  private lastKind = -1;
  private fidgetW = 0;
  // Look-at.
  private lookX = 0;
  private lookY = 0;
  private lookW = 0;
  // Moods.
  private readonly mood = new Float64Array(MOODS.length);
  private contentment = 0.5;
  private arousal = 0;
  // Reaction layer.
  private reactAt = Number.NEGATIVE_INFINITY;
  private reactKind = '';
  private reactT = 1;
  private reactLen = 0.4;
  // Held pendulum.
  private pend = 0;
  private pendV = 0;
  private heldW = 0;
  private sleepD = 0;
  /** Reduced-motion weight 0..1 (eased). */
  calm = 0;
  private glowL = 0.55;
  private glowR = 0.55;
  private tuneBoost = 0;
  private lastMx = 0;
  /** Something other than a clip cross-fade moved the pose this frame. */
  reacting = false;
  blending = false;
  /** Seconds-based clock for effects (scan, shimmer sparks). */
  clock = 0;
  /** Smoothed motion for painters. */
  dtSec = 0;

  constructor(private readonly random: () => number) {
    this.blinkIn = 1.5 + this.rnd() * 3;
    this.fidgetIn = 2 + this.rnd() * 3;
  }

  private rnd(): number {
    const v = this.random();
    return Number.isFinite(v) ? clamp01(v) : 0.5;
  }

  /** The clip actually drawn for the current input. */
  get activeClip(): AnimClip {
    return this.clip;
  }

  reset(): void {
    this.pend = 0;
    this.pendV = 0;
    this.lastMx = 0;
  }

  update(input: AnimInput, simTimeMs: number, dtMs: number, motionX: number): Pose {
    const dt = clamp(finiteOr(dtMs, 0) / 1000, 0, 0.1);
    this.dtSec = dt;
    this.clock += dt;
    const sim = finiteOr(simTimeMs, 0);
    const rc = RESOLVED.get(input.clip) ?? 'stand';
    const start = finiteOr(input.clipStartedAt, 0);
    const meta = CLIP_META[rc];

    // ---- clip switching and cross-fade -------------------------------------------------------
    if (!this.started) {
      this.started = true;
      this.clip = rc;
      this.fade = 1;
      this.lastStart = start;
      this.loopClock = Math.max(0, (sim - start) / 1000);
      this.sleepD = input.sleeping ? 1 : 0;
    } else if (rc !== this.clip || (!meta.loop && Math.abs(start - this.lastStart) > 1)) {
      copyPose(this.from, this.mixed);
      this.clip = rc;
      this.lastStart = start;
      this.loopClock = 0;
      this.fade = 0;
      this.fadeMs = clamp(meta.fadeInMs, 90, 320);
    } else {
      this.lastStart = start;
    }

    // ---- inputs, smoothed ------------------------------------------------------------------
    const rmTarget = input.reducedMotion === true ? 1 : 0;
    this.calm = damp(this.calm, rmTarget, 4, dt);
    if (Math.abs(this.calm - rmTarget) < 0.01) this.calm = rmTarget;
    const amp = 1 - 0.65 * this.calm;
    const animSpeed = clamp(finiteOr(input.animSpeed, 1), 0.25, 3) * (1 - 0.4 * this.calm);
    const speedIn = Math.max(0, finiteOr(input.speed, 0));
    this.speedSm = damp(this.speedSm, speedIn, 6, dt);
    const n = clamp(this.speedSm / 4.5, 0, 1);
    this.gait += dt * TAU * (rc === 'hop' ? 1.3 + 0.5 * this.speedSm : 0.9 + 1.3 * this.speedSm) * animSpeed;
    if (this.gait > 1e6) this.gait = 0;
    this.loopClock += dt * animSpeed;
    this.arousal = damp(this.arousal, clamp01(finiteOr(input.arousal, 0)), 3, dt);
    this.contentment = damp(this.contentment, clamp01(finiteOr(input.contentment, 0.5)), 2, dt);
    const sleeping = input.sleeping === true;
    const depthTarget = sleeping ? clamp01(finiteOr(input.sleepDepth ?? 0.6, 0.6)) : 0;
    this.sleepD = damp(this.sleepD, depthTarget, 1.2, dt);
    for (let i = 0; i < MOODS.length; i++) {
      const tgt = input.mood === MOODS[i] ? 1 : 0;
      this.mood[i] = damp(this.mood[i]!, tgt, tgt > this.mood[i]! ? MOOD_RATE_UP : MOOD_RATE_DOWN, dt);
    }

    // ---- sample the clip --------------------------------------------------------------------
    const c = this.ctx;
    c.t = meta.loop ? this.loopClock : Math.max(0, (sim - start) / 1000) * animSpeed;
    c.speed = this.speedSm;
    c.n = n;
    c.gait = this.gait;
    c.impact = clamp01(finiteOr(input.impact ?? 0.5, 0.5));
    c.amp = amp;
    sampleClip(this.target, rc, c);
    let p = this.target;
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + (dt * 1000) / this.fadeMs);
      const w = this.fade * this.fade * (3 - 2 * this.fade);
      blendPose(this.mixed, this.from, this.target, w);
      p = this.mixed;
      this.blending = this.fade < 1;
    } else {
      this.blending = false;
    }
    if (p !== this.mixed) copyPose(this.mixed, p);
    const out = this.pose;
    copyPose(out, this.mixed);

    // ---- procedural layers ------------------------------------------------------------------
    let active = false;
    const deep = this.sleepD;
    // Bob and breathing.
    this.bobPhase += dt * out.bobHz * animSpeed;
    if (this.bobPhase > 1e5) this.bobPhase = 0;
    const bobAmp = out.bob * amp * (1 + 0.3 * this.arousal) * (1 - 0.45 * deep);
    out.offY += Math.sin(this.bobPhase) * bobAmp;
    out.headY += Math.sin(this.bobPhase - 0.7) * bobAmp * 0.18;
    this.breathPhase += dt * (1.7 - 0.9 * deep) * animSpeed;
    if (this.breathPhase > 1e5) this.breathPhase = 0;
    const breath = Math.sin(this.breathPhase);
    const breathAmp = rc === 'sleep' ? 0.022 : 0.012;
    out.sy *= 1 + breathAmp * breath * amp;
    out.sx *= 1 - breathAmp * 0.4 * breath * amp;

    // Blinks.
    this.blinkIn -= dt;
    if (this.blinkT < 0 && this.blinkIn <= 0 && out.eye > 0.3) {
      this.blinkT = 0;
      this.blinkLen = 0.14 + 0.1 * this.calm;
      this.blinkAgain = this.rnd() < 0.2;
      this.blinkIn = 2.2 + this.rnd() * 3.5;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const u = this.blinkT / this.blinkLen;
      if (u >= 1) {
        this.blinkT = -1;
        if (this.blinkAgain) {
          this.blinkAgain = false;
          this.blinkIn = 0.12;
        }
      } else {
        out.eye *= 1 - Math.sin(Math.PI * u) * 0.97;
      }
    }

    // Idle fidgets: tilt, antenna tuning, look around, inspect hand, drift, hum.
    const idleW = IDLE_WEIGHT[rc] ?? 0;
    this.fidgetW = damp(this.fidgetW, sleeping ? 0 : idleW, 3, dt);
    if (this.fidgetKind < 0) {
      if (idleW > 0 && !sleeping) this.fidgetIn -= dt;
      if (this.fidgetIn <= 0) {
        let k = Math.floor(this.rnd() * FIDGET_KINDS);
        if (k === this.lastKind) k = (k + 1) % FIDGET_KINDS;
        this.fidgetKind = k;
        this.lastKind = k;
        this.fidgetT = 0;
        this.fidgetLen = (1.3 + this.rnd() * 1.3) * (1 + 0.3 * this.calm);
        this.fidgetDir = this.rnd() < 0.5 ? -1 : 1;
      }
    }
    this.tuneBoost = 0;
    if (this.fidgetKind >= 0) {
      this.fidgetT += dt;
      const u = this.fidgetT / this.fidgetLen;
      if (u >= 1) {
        this.fidgetKind = -1;
        this.fidgetIn = 2.5 + this.rnd() * 4;
      } else if (this.fidgetW > 0.01) {
        this.applyFidget(out, u, this.fidgetW * amp);
        active = true;
      }
    }

    // Look-at.
    const hasLook = input.hasLook === true && Number.isFinite(input.lookX) && Number.isFinite(input.lookY);
    this.lookW = damp(this.lookW, hasLook ? out.lookW : 0, 4, dt);
    if (hasLook) {
      this.lookX = damp(this.lookX, clamp(input.lookX, -300, 300), 7, dt);
      this.lookY = damp(this.lookY, clamp(input.lookY, -300, 300), 7, dt);
    }
    const lw = this.lookW * (0.5 + 0.5 * amp);
    if (lw > 0.01) {
      out.turn += clamp(this.lookX / 60, -1.2, 1.2) * 0.9 * lw;
      out.headRot += clamp(this.lookX / 400, -0.1, 0.1) * lw;
      out.headY += clamp(this.lookY / 50, -1, 1) * 2 * lw;
      out.headRot += clamp(this.lookY / 500, -0.08, 0.08) * lw * (this.lookX >= 0 ? 1 : -1);
    }

    // Mood, contentment, arousal.
    for (let i = 0; i < MOODS.length; i++) {
      const w = this.mood[i]!;
      if (w < 1e-3) continue;
      switch (MOODS[i]) {
        case 'happy':
          out.smile += 0.5 * w;
          out.glow += 0.15 * w;
          break;
        case 'curious':
          out.headRot += 0.1 * w;
          out.antR += 0.15 * w;
          out.eyeSize += 0.05 * w;
          break;
        case 'sleepy':
          out.eye *= 1 - 0.35 * w;
          out.glow -= 0.15 * w;
          out.antDroop += 0.25 * w;
          break;
        case 'startled':
          out.eyeSize += 0.15 * w;
          out.antSpike = Math.max(out.antSpike, 0.5 * w);
          break;
        case 'scared':
          out.antDroop += 0.3 * w;
          out.eyeSize += 0.12 * w;
          out.offX += 0.3 * Math.sin(this.clock * 40) * w * amp;
          break;
        case 'excited':
          out.bob *= 1 + 0.5 * w;
          out.glow += 0.25 * w;
          break;
        case 'relaxed':
          out.antDroop += 0.12 * w;
          out.eye *= 1 - 0.1 * w;
          break;
        case 'confused':
          out.headRot += 0.1 * w * Math.sin(this.clock * 2);
          out.smile -= 0.3 * w;
          break;
        default:
          break;
      }
    }
    out.smile += (this.contentment - 0.5) * 0.4;
    out.glow += 0.2 * this.arousal * (1 - deep);
    out.glow -= 0.3 * deep;

    // Reaction layer (antenna flick, antenna wag, head tilt).
    const rx = input.reaction;
    if (rx && Number.isFinite(rx.at) && rx.at !== this.reactAt) {
      this.reactAt = rx.at;
      this.reactKind = rx.kind;
      this.reactT = 0;
      this.reactLen = (REACTION_S[rx.kind] ?? 0.4) * (1 + 0.5 * this.calm);
    }
    if (this.reactT < this.reactLen) {
      this.reactT += dt;
      const u = clamp01(this.reactT / this.reactLen);
      const b = Math.sin(Math.PI * u) * amp;
      if (this.reactKind === 'earFlick') {
        out.antL += -0.7 * b;
        out.antR += 0.7 * b;
        out.glow += 0.25 * b;
      } else if (this.reactKind === 'tailFlick') {
        out.antR += 0.6 * Math.sin(u * TAU * 2) * (1 - u) * amp;
        out.glow += 0.2 * b;
      } else {
        out.headRot += 0.21 * b;
        out.headX += 1.2 * b;
      }
      active = true;
    }

    // Held: a pendulum about the grip that follows the body's motion.
    const held = rc === 'held';
    this.heldW = damp(this.heldW, held ? 1 : 0, 8, dt);
    const mx = finiteOr(motionX, 0);
    if (dt > 0) {
      const vx = clamp(mx / Math.max(dt, 1 / 120), -2000, 2000);
      const acc = -36 * this.pend - 3.2 * this.pendV - vx * 0.0022 * (held ? 1 : 0);
      this.pendV = clamp(this.pendV + acc * dt, -8, 8);
      this.pend = clamp(this.pend + this.pendV * dt, -0.7, 0.7);
    }
    this.lastMx = mx;
    if (this.heldW > 0.01) {
      out.rot += this.pend * this.heldW * (1 - 0.5 * this.calm);
      out.legLa += -this.pend * 0.8 * this.heldW;
      out.legRa += -this.pend * 0.8 * this.heldW;
      active = true;
    } else if (Math.abs(this.pend) < 0.002 && Math.abs(this.pendV) < 0.01) {
      this.pend = 0;
      this.pendV = 0;
    }

    // Glow per tip (the tuning fidget alternates them).
    this.glowL = clamp01(out.glow + this.tuneBoost);
    this.glowR = clamp01(out.glow + this.tuneBoost * 0.6);

    // ---- reduced motion: small amplitudes, no big swings, no dissolve effects --------------------
    const cm = this.calm;
    if (cm > 0.001) {
      out.offX *= 1 - 0.6 * cm;
      out.rot *= 1 - 0.8 * cm;
      out.lean *= 1 - 0.4 * cm;
      out.sx = 1 + (out.sx - 1) * (1 - 0.6 * cm);
      out.sy = 1 + (out.sy - 1) * (1 - 0.6 * cm);
      if (rc === 'vanish' || rc === 'appear') {
        out.sx = 1;
        out.sy = 1;
        out.hover = this.neutral.hover;
        out.shim *= 1 - cm;
      }
      out.offY = out.offY * (1 - 0.5 * cm);
    }

    sanitizePose(out, this.neutral);
    this.reacting = active;
    return out;
  }

  /** Right-hand/antenna fidget deltas. `w` = layer weight. */
  private applyFidget(p: Pose, u: number, w: number): void {
    const env = sseg(u, 0, 0.2) * (1 - sseg(u, 0.78, 1)) * w;
    const ft = this.fidgetT;
    const d = this.fidgetDir;
    switch (this.fidgetKind) {
      case 0: // curious head tilt, one antenna perks
        p.headRot += 0.28 * env * d;
        p.headX += 1.5 * env * d;
        p.eye *= 1 - 0.15 * env;
        p.antL += 0.2 * env * d;
        p.antR += 0.2 * env * d;
        break;
      case 1: // antenna tuning: tips twitch in turns and pulse
        p.antL += 0.38 * env * Math.sin(ft * TAU * 3.1);
        p.antR += 0.38 * env * Math.sin(ft * TAU * 3.1 + Math.PI);
        this.tuneBoost = 0.4 * env * (0.5 + 0.5 * Math.sin(ft * TAU * 3.1));
        break;
      case 2: // look around
        p.turn += Math.sin(u * TAU) * 0.95 * w;
        p.headX += 1.2 * Math.sin(u * TAU) * w;
        p.headRot += 0.06 * Math.sin(u * TAU) * w;
        break;
      case 3: // inspect a hand
        p.armRa += (1.9 - p.armRa) * env;
        p.armRb += (0.9 + 0.2 * Math.sin(ft * TAU * 2.5) - p.armRb) * env;
        p.headRot += 0.12 * env;
        p.turn += 0.6 * env;
        p.eye *= 1 - 0.15 * env;
        break;
      case 4: // drift sideways
        p.offX += 5 * env * d;
        p.lean += 0.08 * env * d;
        p.legLa += -0.2 * env;
        p.legRa += -0.2 * env;
        break;
      default: // hum: glow pulse and a small smile
        p.glow += 0.35 * env * (0.5 + 0.5 * Math.sin(ft * TAU * 1.6));
        p.smile += 0.4 * env;
        p.antL += 0.15 * env;
        p.antR += -0.15 * env;
        break;
    }
  }

  get glowLeft(): number {
    return this.glowL;
  }

  get glowRight(): number {
    return this.glowR;
  }
}
