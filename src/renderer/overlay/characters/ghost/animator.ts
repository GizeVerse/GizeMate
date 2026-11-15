// Ghost: the animator turns the sim's clip choice into a living pose: clip sampling, cross-fades on
// clip changes, and the procedural layers (breathing, blinks, look-at, idle fidgets, motion lean and
// stretch, the swing while held, mood, one-off reactions, deep sleep, reduced motion).
import { CLIP_META } from '../../../../shared/animationCatalog';
import type { AnimClip } from '../../../../shared/cat';
import { MOODS } from '../../../../shared/companion';
import { clamp, clamp01, damp, easeInOut, finiteOr, lerp, smooth, TAU } from '../../character/kit';
import type { AnimInput } from '../../cat/animator';
import { REACTION_DURATION_S } from '../../cat/animator';
import { resolveGhostClip, SAMPLERS, type GhostClipCtx } from './clips';
import { blendPose, copyPose, createPose, resetPose, sanitizePose, type GhostPose } from './pose';

const MAX_DT_S = 0.1;
const IDLE_KINDS = 4;
const IDLE_DUR_S = [0, 2.2, 1.7, 1.6, 1.8] as const;
const IDLE_CLIPS: ReadonlySet<AnimClip> = new Set<AnimClip>(['stand', 'sit', 'loaf']);

export class GhostAnimator {
  readonly pose = createPose();
  private readonly base = createPose();
  private readonly from = createPose();
  private readonly clipPose = createPose();
  private readonly ctx: GhostClipCtx = { t: 0, cycle: 0, speed: 0, vy: 0, impact: 0, amp: 1, fx: 1 };
  private clip: AnimClip | null = null;
  private clipStart = Number.NaN;
  private fadeElapsed = 0;
  private fadeDur = 0;
  hemPhase = 0;
  sparklePhase = 0;
  private cycle = 0;
  private breath = 0;
  private blinkIn = 2;
  private blinkT = 1;
  private idleKind = 0;
  private idleT = 0;
  private idleIn = 3;
  private lookSX = 0;
  private lookSY = 0;
  private vxs = 0;
  private vys = 0;
  private leanS = 0;
  private swing = 0;
  private swingV = 0;
  private sleepK = 0;
  private depthK = 0;
  private reduceK = 0;
  private readonly moodW = new Float64Array(MOODS.length);
  private reactAt = Number.NaN;
  private reactKind = '';
  private reactStart = -1e9;
  private isReacting = false;

  constructor(private readonly random: () => number) {
    this.blinkIn = 1.5 + random() * 2.5;
    this.idleIn = 3 + random() * 3;
  }

  get blending(): boolean {
    return this.fadeElapsed < this.fadeDur;
  }
  get reacting(): boolean {
    return this.isReacting;
  }
  /** Current amplitude factor (1 normally, ~0.38 with reduced motion). */
  get amp(): number {
    return this.ctx.amp;
  }

  resetMotion(): void {
    this.vxs = 0;
    this.vys = 0;
    this.leanS = 0;
    this.swing = 0;
    this.swingV = 0;
  }

  update(input: AnimInput, simTimeMs: number, dtMs: number, motionX: number, motionY: number): GhostPose {
    this.isReacting = false;
    const dt = clamp(finiteOr(dtMs, 0) / 1000, 0, MAX_DT_S);
    const animSpeed = clamp(finiteOr(input.animSpeed, 1), 0.1, 3);
    const simT = finiteOr(simTimeMs, 0);
    const reduced = input.reducedMotion === true;
    this.reduceK = damp(this.reduceK, reduced ? 1 : 0, 4, dt);
    if (this.reduceK < 1e-3) this.reduceK = 0;
    const rk = this.reduceK;
    const amp = lerp(1, 0.38, rk);
    const fx = 1 - rk;

    const clip = resolveGhostClip(input.clip);
    const startedAt = finiteOr(input.clipStartedAt, 0);
    if (clip !== this.clip || startedAt !== this.clipStart) {
      if (this.clip !== null) {
        copyPose(this.from, this.base);
        this.fadeDur = fadeMs(clip) * (1 + 0.5 * rk);
        this.fadeElapsed = 0;
      }
      this.clip = clip;
      this.clipStart = startedAt;
    }

    const speed = Math.max(0, finiteOr(input.speed, 0));
    const c = this.ctx;
    c.t = (Math.max(0, simT - startedAt) * animSpeed) / 1000;
    this.cycle += dt * animSpeed * (2.2 + 1.2 * Math.min(speed, 3)) * (1 - 0.4 * rk);
    c.cycle = this.cycle;
    c.speed = speed;
    c.vy = finiteOr(input.vy, 0);
    c.impact = clamp01(finiteOr(input.impact ?? 0, 0));
    c.amp = amp;
    c.fx = fx;
    resetPose(this.clipPose);
    (SAMPLERS[clip] ?? SAMPLERS.stand!)(this.clipPose, c);
    sanitizePose(this.clipPose);
    if (this.fadeElapsed < this.fadeDur) {
      this.fadeElapsed += dt * 1000;
      blendPose(this.base, this.from, this.clipPose, smooth(this.fadeElapsed / this.fadeDur));
    } else {
      copyPose(this.base, this.clipPose);
    }

    const p = copyPose(this.pose, this.base);
    const sleeping = input.sleeping === true;
    this.motionLayer(p, clip, dt, finiteOr(motionX, 0), finiteOr(motionY, 0), amp);
    // Held: the top of the sheet is pinned to the cursor's scruff point (offX/offY/lean of the clip), so the
    // generic layers may scale and tilt about it but must not move the grip itself.
    const pinY = p.offY;
    const pinLean = p.lean;
    this.breathing(p, sleeping, dt, rk);
    this.idleLayer(p, clip, sleeping, dt, amp, fx);
    this.lookLayer(p, input, dt);
    this.blink(p, dt);
    this.moodLayer(p, input, dt);
    this.reactionLayer(p, input, simT, animSpeed, amp);
    if (clip === 'held') {
      p.offY = pinY;
      p.lean = pinLean;
    }
    const depth = sleeping && Number.isFinite(input.sleepDepth) ? clamp01(input.sleepDepth as number) : 0;
    this.depthK = damp(this.depthK, depth, 1.2, dt);
    const deep = this.depthK * this.sleepK;
    p.glow *= 1 - 0.4 * deep;
    p.dim += 0.1 * deep;
    if (rk > 0) {
      p.hemAmp *= lerp(1, 0.5, rk);
      p.hemSway *= lerp(1, 0.5, rk);
      p.sparkle *= fx;
    }
    this.hemPhase = (this.hemPhase + dt * animSpeed * 2.6 * clamp(p.hemRate, 0.1, 4) * (1 - 0.55 * rk)) % (TAU * 1000);
    this.sparklePhase = (this.sparklePhase + dt * 5) % (TAU * 1000);
    sanitizePose(p);
    clampPose(p);
    return p;
  }

  private motionLayer(p: GhostPose, clip: AnimClip, dt: number, mx: number, my: number, amp: number): void {
    const inv = dt > 1e-4 ? 1 / dt : 0;
    this.vxs = damp(this.vxs, mx * inv, 10, dt);
    this.vys = damp(this.vys, my * inv, 8, dt);
    if (clip === 'held') {
      const target = clamp(this.vxs * 0.0035, -0.55, 0.55);
      this.swingV += ((target - this.swing) * 55 - this.swingV * 4.5) * dt;
      this.swing = clamp(this.swing + this.swingV * dt, -0.7, 0.7);
      p.rot += this.swing * amp;
      return;
    }
    this.swing = damp(this.swing, 0, 8, dt);
    this.swingV = 0;
    this.leanS = damp(this.leanS, clamp(this.vxs * 0.05, -9, 9), 7, dt);
    if (clip !== 'float' && clip !== 'sleep') p.lean += this.leanS * amp;
    const stretch = clamp(Math.abs(this.vys) * 0.0005, 0, 0.12) * amp;
    p.sy *= 1 + stretch;
    p.sx /= 1 + stretch * 0.6;
  }

  private breathing(p: GhostPose, sleeping: boolean, dt: number, rk: number): void {
    this.sleepK = damp(this.sleepK, sleeping ? 1 : 0, 2, dt);
    const deep = this.depthK * this.sleepK;
    const period = lerp(3.6, 6, this.sleepK) * (1 + 0.5 * deep);
    this.breath = (this.breath + (dt * TAU) / period) % TAU;
    const amp = lerp(0.02, 0.025, this.sleepK) * (1 - 0.4 * deep) * lerp(1, 0.5, rk);
    const b = amp * Math.sin(this.breath);
    p.sy *= 1 + b;
    p.offY -= b * 12;
  }

  private idleLayer(p: GhostPose, clip: AnimClip, sleeping: boolean, dt: number, amp: number, fx: number): void {
    const eligible = IDLE_CLIPS.has(clip) && !sleeping && !this.blending;
    if (this.idleKind === 0) {
      if (!eligible) return;
      this.idleIn -= dt;
      if (this.idleIn > 0) return;
      this.idleKind = 1 + Math.min(IDLE_KINDS - 1, Math.floor(this.random() * IDLE_KINDS));
      this.idleT = 0;
    }
    const kind = this.idleKind;
    this.idleT += dt;
    const u = this.idleT / IDLE_DUR_S[kind]!;
    if (u >= 1 || !eligible) {
      this.idleKind = 0;
      this.idleIn = 4 + this.random() * 4.5;
      return;
    }
    this.isReacting = true;
    const e = Math.sin(Math.PI * u);
    if (kind === 1) {
      const look = Math.sin(u * TAU * 1.5) * 0.9 * e;
      p.lookX += look;
      p.faceX += look * 4 * amp;
      p.lean += look * 2 * amp;
    } else if (kind === 2) {
      p.armR = lerp(p.armR, 1.9 + Math.sin(this.idleT * 14) * 0.35 * amp, e);
      p.eyeSmile += 0.5 * e;
      p.mouthSmile = lerp(p.mouthSmile, 0.9, e);
    } else if (kind === 3) {
      p.spin += easeInOut(u) * TAU * fx + (1 - fx) * Math.sin(Math.PI * u) * 0.5;
      p.eyeSmile += 0.6 * e;
      p.cheek += 0.5 * e;
    } else {
      p.sy *= 1 + 0.1 * e * amp;
      p.armL += 2 * e * amp;
      p.armR += 2 * e * amp;
      p.mouthOpen += 0.4 * e;
      p.eyeOpen *= 1 - 0.5 * e;
      p.offY -= 3 * e * amp;
    }
  }

  private lookLayer(p: GhostPose, input: AnimInput, dt: number): void {
    const has = input.hasLook === true && Number.isFinite(input.lookX) && Number.isFinite(input.lookY);
    const tx = has ? clamp(input.lookX / 70, -1, 1) : 0;
    const ty = has ? clamp(input.lookY / 60, -1, 1) : 0;
    this.lookSX = damp(this.lookSX, tx, 8, dt);
    this.lookSY = damp(this.lookSY, ty, 8, dt);
    const w = clamp01(p.lookW);
    p.lookX += this.lookSX * w;
    p.lookY += this.lookSY * w * 0.7;
    p.faceX += this.lookSX * w * 2.5;
  }

  private blink(p: GhostPose, dt: number): void {
    if (this.blinkT >= 1) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkT = 0;
        this.blinkIn = this.random() < 0.15 ? 0.25 : 2.2 + this.random() * 3.3;
      }
    }
    if (this.blinkT < 1) {
      this.blinkT += dt / 0.16;
      p.eyeOpen *= 1 - Math.sin(Math.PI * clamp01(this.blinkT));
    }
  }

  private moodLayer(p: GhostPose, input: AnimInput, dt: number): void {
    const idx = typeof input.mood === 'string' ? (MOODS as readonly string[]).indexOf(input.mood) : -1;
    for (let i = 0; i < MOODS.length; i++) {
      const w = damp(this.moodW[i]!, i === idx ? 1 : 0, 2.5, dt);
      this.moodW[i] = w < 1e-3 ? 0 : w;
      if (w < 1e-3) continue;
      switch (MOODS[i]) {
        case 'happy':
          p.cheek += 0.5 * w;
          p.mouthSmile += 0.3 * w;
          break;
        case 'curious':
          p.eyeSize *= 1 + 0.08 * w;
          break;
        case 'sleepy':
          p.eyeOpen *= 1 - 0.25 * w;
          p.offY += 1.5 * w;
          break;
        case 'startled':
        case 'scared':
          p.eyeSize *= 1 + 0.15 * w;
          p.mouthOpen += 0.2 * w;
          p.brow -= 0.4 * w;
          break;
        case 'excited':
          p.armL += 0.35 * w;
          p.armR += 0.35 * w;
          p.hemRate *= 1 + 0.3 * w;
          break;
        case 'relaxed':
          p.eyeOpen *= 1 - 0.12 * w;
          break;
        case 'confused':
          p.brow -= 0.5 * w;
          break;
        default:
          break;
      }
    }
  }

  private reactionLayer(p: GhostPose, input: AnimInput, simT: number, animSpeed: number, amp: number): void {
    const r = input.reaction;
    if (r && (r.at !== this.reactAt || r.kind !== this.reactKind)) {
      this.reactAt = r.at;
      this.reactKind = r.kind;
      this.reactStart = finiteOr(r.at, simT);
    }
    const kind = this.reactKind;
    if (kind === '') return;
    const dur = REACTION_DURATION_S[kind as keyof typeof REACTION_DURATION_S] ?? 0.4;
    const age = ((simT - this.reactStart) * animSpeed) / 1000;
    if (!(age >= 0 && age < dur)) return;
    this.isReacting = true;
    const ph = Math.sin((Math.PI * age) / dur) * amp;
    if (kind === 'earFlick') p.armR += 1.0 * ph * Math.sin(age * 30);
    else if (kind === 'tailFlick') {
      p.hemAmp += 3 * ph;
      p.hemSway += 2 * ph;
    } else {
      p.rot += 0.15 * ph;
      p.lean += 2 * ph;
    }
  }
}

function fadeMs(to: AnimClip): number {
  if (to === 'held') return 60;
  if (to === 'startle' || to === 'land' || to === 'jump' || to === 'shake') return 150;
  if (to === 'fall') return 170;
  if (to === 'sleep' || to === 'loaf' || to === 'sit') return 250;
  const meta = CLIP_META[to];
  return meta ? Math.min(300, meta.fadeInMs) : 200;
}

function clampPose(p: GhostPose): void {
  p.sx = clamp(p.sx, 0.05, 2);
  p.sy = clamp(p.sy, 0.05, 2);
  p.hemWide = clamp(p.hemWide, 0.3, 2);
  p.armLen = clamp(p.armLen, 0, 1.4);
  p.eyeOpen = clamp01(p.eyeOpen);
  p.eyeSmile = clamp01(p.eyeSmile);
  p.eyeSize = clamp(p.eyeSize, 0.4, 1.6);
  p.mouthOpen = clamp01(p.mouthOpen);
  p.mouthSmile = clamp(p.mouthSmile, -1, 1.2);
  p.cheek = clamp01(p.cheek);
  p.brow = clamp(p.brow, -1, 1);
  p.alpha = clamp01(p.alpha);
  p.glow = clamp01(p.glow);
  p.flare = clamp01(p.flare);
  p.dim = clamp01(p.dim);
  p.vis = clamp01(p.vis);
  p.faceVis = clamp01(p.faceVis);
  p.sparkle = clamp01(p.sparkle);
  p.lean = clamp(p.lean, -14, 14);
  p.rot = clamp(p.rot, -1.2, 1.2);
  p.offX = clamp(p.offX, -40, 40);
}
