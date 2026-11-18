// Ghost: clip samplers. Each writes a pose (already reset to the defaults) as a pure function of the
// clip context. Procedural layers (breathing, blinks, look-at, idle fidgets, motion lean) are added by
// the animator. `amp` scales every oscillation and spike (1 normally, ~0.4 with reduced motion) and
// `fx` fades the showy effects (spins, sparkles, flares) out entirely under reduced motion.
import { CLIP_FALLBACK } from '../../../../shared/animationCatalog';
import type { AnimClip } from '../../../../shared/cat';
import { GHOST_MODULE } from '../../../../shared/characters/ghost';
import { clamp, easeIn, easeInOut, easeOut, easeOutBack, lerp, noise1, pulse, seg, sseg, TAU } from '../../character/kit';
import { HELD_SCRUFF } from '../../cat/clips';
import { HOVER, type GhostPose } from './pose';

export interface GhostClipCtx {
  /** Seconds since the clip started (animation speed applied). */
  t: number;
  /** Integrated drift phase (rad) for the float cycle. */
  cycle: number;
  /** Locomotion speed, body lengths per second. */
  speed: number;
  vy: number;
  impact: number;
  amp: number;
  fx: number;
}

type Sampler = (p: GhostPose, c: GhostClipCtx) => void;

const sin = Math.sin;

// Where an unlisted clip is drawn: the module's alias, then the shared fallbacks.

/** The clip this renderer draws for any canonical clip (always one of GHOST_MODULE.clips). */
export function resolveGhostClip(clip: AnimClip): AnimClip {
  if (GHOST_MODULE.clips.includes(clip)) return clip;
  let c: AnimClip | undefined = clip;
  for (let i = 0; i < 8 && c !== undefined; i++) {
    const next: AnimClip | undefined = GHOST_MODULE.clipAlias[c] ?? CLIP_FALLBACK[c];
    if (next === undefined) break;
    if (GHOST_MODULE.clips.includes(next)) return next;
    c = next;
  }
  return 'stand';
}

const stand: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -HOVER + sin(t * 2.0) * 2.2 * c.amp;
  p.rot = sin(t * 1.0) * 0.02 * c.amp;
  p.lean = sin(t * 0.8) * 1.2 * c.amp;
  p.armL = 0.4 + sin(t * 1.7) * 0.08 * c.amp;
  p.armR = 0.4 + sin(t * 1.7 + 1.3) * 0.08 * c.amp;
};

const sit: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -7 + sin(t * 1.6) * 1.1 * c.amp;
  p.sy = 0.94;
  p.sx = 1.05;
  p.hemWide = 1.12;
  p.hemAmp = 1.4;
  p.armL = 0.2 + sin(t * 1.3) * 0.04 * c.amp;
  p.armR = 0.2 + sin(t * 1.3 + 1) * 0.04 * c.amp;
  p.eyeOpen = 0.92;
  p.mouthSmile = 0.35;
  p.shadowK = 1.15;
};

const loaf: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -3 + sin(t * 1.2) * 0.7 * c.amp;
  p.sy = 0.8;
  p.sx = 1.14;
  p.hemWide = 1.2;
  p.hemAmp = 1;
  p.hemSway = 0.7;
  p.armL = 0.08;
  p.armR = 0.08;
  p.armLen = 0.8;
  p.eyeOpen = 0.55;
  p.cheek = 0.5;
  p.mouthSmile = 0.6;
  p.shadowK = 1.2;
};

const sleep: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -6 + sin(t * 0.9) * 0.7 * c.amp;
  p.sy = 0.86;
  p.sx = 1.06;
  p.rot = 0.1;
  p.lean = 3;
  p.hemWide = 1.2;
  p.hemAmp = 0.8;
  p.hemSway = 0.5;
  p.hemRate = 0.4;
  p.armL = 0.04;
  p.armR = 0.04;
  p.armLen = 0.85;
  p.eyeOpen = 0;
  p.mouthOpen = 0.16 + 0.08 * sin(t * 1.3);
  p.mouthSmile = 0;
  p.mouthW = 0.7;
  p.lookW = 0;
  p.dim = 0.32;
  p.alpha = 0.9;
  p.glow = 0.2 + 0.16 * sin(t * 1.4) * (0.4 + 0.6 * c.amp);
  p.shadowK = 1.1;
};

const wake: Sampler = (p, c) => {
  const u = clamp(c.t / 1.6, 0, 1);
  const k = 1 - sseg(u, 0.1, 0.6);
  p.dim = 0.32 * k;
  p.glow = 0.2 * k;
  p.alpha = lerp(0.9, 1, 1 - k);
  // Heavy lids: a flutter, a slow blink, then open.
  const open = sseg(u, 0.1, 0.3) * 0.7 * (1 - sseg(u, 0.32, 0.38)) + sseg(u, 0.38, 0.55) * 0.9 + sseg(u, 0.6, 0.75) * 0.1;
  p.eyeOpen = clamp(open, 0, 1);
  const rise = sseg(u, 0.3, 0.8);
  p.offY = lerp(-6, -HOVER, rise);
  p.sy = lerp(0.86, 1, rise) + 0.12 * pulse(u, 0.35, 0.55, 0.65, 0.85) * c.amp;
  p.sx = lerp(1.06, 1, rise);
  p.rot = lerp(0.1, 0, rise);
  p.lean = lerp(3, 0, rise);
  p.hemWide = lerp(1.2, 1, rise);
  p.armL = lerp(0.04, 0.32, sseg(u, 0.75, 1)) + 2.4 * pulse(u, 0.4, 0.55, 0.65, 0.8);
  p.armR = p.armL;
  p.mouthOpen = 0.5 * pulse(u, 0.4, 0.5, 0.6, 0.75);
  p.mouthSmile = lerp(0, 0.45, sseg(u, 0.6, 1));
};

const yawn: Sampler = (p, c) => {
  const u = clamp(c.t / 1.2, 0, 1);
  const m = pulse(u, 0.12, 0.4, 0.7, 0.9);
  p.offY = -9;
  p.sy = 0.94 + 0.1 * m * c.amp;
  p.sx = 1.04 - 0.03 * m;
  p.eyeOpen = 1 - 0.88 * m;
  p.mouthOpen = m;
  p.mouthSmile = 0;
  p.mouthW = 1.2;
  p.armL = 0.3 + 1.2 * m * c.amp;
  p.armR = p.armL;
  p.lookW = 0.3;
};

const float: Sampler = (p, c) => {
  const sp = clamp(c.speed, 0, 4);
  const amp = (2.4 + 0.6 * Math.min(sp, 2)) * c.amp;
  p.offY = -HOVER - 2 + sin(c.cycle) * amp;
  p.lean = clamp(sp * 3.2, 0, 10) + sin(c.t * 0.7) * 1.8 * c.amp * (1 - Math.min(sp, 1));
  p.rot = p.lean * 0.018;
  p.hemSway = 1.5 + sp * 1.4;
  p.hemAmp = 2.4 + sp * 0.5;
  p.hemDrop = sp * 1.5;
  p.hemRate = 1 + sp * 0.4;
  const flap = 0.4 * (0.4 + Math.min(sp, 2) * 0.3) * c.amp;
  p.armL = 0.55 + sin(c.cycle) * flap;
  p.armR = 0.55 + sin(c.cycle + 0.8) * flap;
  p.lookX = 0.5;
  p.faceX = 2.5;
  p.mouthSmile = 0.55;
};

const crouch: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -9;
  p.sy = 0.82;
  p.sx = 1.1;
  p.hemWide = 1.2;
  p.rot = sin(t * 14) * 0.05 * c.amp;
  p.eyeSize = 1.1;
  p.mouthSmile = 0.8;
  p.mouthOpen = 0.1;
  p.armL = 0.15;
  p.armR = 0.15;
  p.hemAmp = 3;
  p.hemRate = 1.6;
  p.cheek = 0.4;
};

const jump: Sampler = (p, c) => {
  const t = c.t;
  const k = clamp(-c.vy / 300, 0, 1);
  const wind = 1 - sseg(t, 0, 0.14);
  p.offY = -HOVER - 3 + 5 * wind;
  p.sy = lerp(1.04 + 0.1 * k, 0.84, wind);
  p.sx = lerp(0.96 - 0.04 * k, 1.1, wind);
  p.armL = 2.3;
  p.armR = 2.3;
  p.hemDrop = 5;
  p.hemWide = lerp(0.8, 1.15, wind);
  p.hemSway = 2;
  p.hemRate = 1.6;
  p.eyeSize = 1.1;
  p.mouthOpen = 0.3;
  p.mouthSmile = 0.8;
};

const fall: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -HOVER + sin(t * 3) * 1.5 * c.amp;
  p.rot = sin(t * 3) * 0.06 * c.amp;
  p.sy = 0.96;
  p.sx = 1.06;
  p.armL = 1.9 + sin(t * 6) * 0.15 * c.amp;
  p.armR = 1.9 + sin(t * 6 + 1) * 0.15 * c.amp;
  p.hemFlare = 1;
  p.hemWide = 1.25;
  p.hemAmp = 3;
  p.hemRate = 2;
  p.eyeSize = 1.12;
  p.mouthOpen = 0.2;
  p.mouthSmile = 0.5;
};

const land: Sampler = (p, c) => {
  const t = c.t;
  const s = Math.exp(-4.5 * t) * Math.cos(t * 16);
  const hard = 0.7 + 0.6 * c.impact;
  p.sy = 1 - 0.16 * s * hard;
  p.sx = 1 + 0.12 * s * hard;
  p.hemWide = 1 + 0.22 * Math.max(0, s);
  p.offY = -HOVER + 5 * Math.max(s, 0) * c.amp;
  p.armL = 0.32 + 0.3 * s;
  p.armR = p.armL;
  p.eyeOpen = 1 - 0.5 * Math.max(s, 0);
};

const startle: Sampler = (p, c) => {
  const t = c.t;
  const e = 1 - sseg(t, 0.35, 0.8);
  p.offY = -HOVER - 15 * sseg(t, 0, 0.08) * (1 - sseg(t, 0.12, 0.7)) * c.amp;
  p.offX = sin(t * 70) * 1.2 * (1 - sseg(t, 0, 0.35)) * c.amp;
  p.sy = 1 + 0.14 * (1 - sseg(t, 0.1, 0.6)) * c.amp;
  p.sx = 1 - 0.05 * (1 - sseg(t, 0.1, 0.6)) * c.amp;
  p.armL = lerp(0.5, 2.7, 1 - sseg(t, 0.25, 0.8));
  p.armR = p.armL;
  p.glow = (1 - sseg(t, 0.1, 0.7)) * c.fx;
  p.flare = 0.7 * (1 - sseg(t, 0.05, 0.5)) * c.fx;
  p.eyeSize = lerp(1, 1.28, e);
  p.mouthOpen = 0.2 + 0.7 * e;
  p.mouthSmile = 0;
  p.hemFlare = (1 - sseg(t, 0.1, 0.7)) * c.amp;
  p.hemWide = 1 + 0.15 * (1 - sseg(t, 0.1, 0.7));
  p.hemRate = 2;
  p.lookW = 0.3;
};

const petted: Sampler = (p, c) => {
  const t = c.t;
  p.rot = sin(t * 9) * 0.07 * c.amp;
  p.lean = sin(t * 9 + 0.5) * 2.5 * c.amp;
  p.sy = 1 + sin(t * 18) * 0.025 * c.amp;
  p.offY = -HOVER - 1 + sin(t * 9) * 1.8 * c.amp;
  p.eyeSmile = 1;
  p.mouthOpen = 0.35 + 0.15 * sin(t * 18) * c.amp;
  p.mouthSmile = 1;
  p.cheek = 1;
  p.armL = 0.8 + sin(t * 9) * 0.4 * c.amp;
  p.armR = 0.8 + sin(t * 9 + 3.14) * 0.4 * c.amp;
  p.hemSway = 2.4;
  p.hemRate = 1.8;
  p.lookW = 0;
};

const held: Sampler = (p, c) => {
  const t = c.t;
  // The grip is the top of the sheet: scaling and tilting keep it exactly on the cursor point.
  p.offX = HELD_SCRUFF.x;
  p.offY = HELD_SCRUFF.y + 60;
  p.pivX = 0;
  p.pivY = -60;
  p.scaleCY = -60;
  p.sy = 1.1;
  p.sx = 0.94;
  p.rot = sin(t * 2.3) * 0.07 * c.amp;
  p.hemDrop = 4;
  p.hemAmp = 3.2;
  p.hemSway = 2.5;
  p.hemRate = 1.4;
  p.armL = 0.12 + sin(t * 2.3 + 1) * 0.1 * c.amp;
  p.armR = 0.12 + sin(t * 2.3 + 2) * 0.1 * c.amp;
  p.eyeSize = 1.1;
  p.mouthOpen = 0.35;
  p.mouthSmile = 0.1;
  p.lookW = 0.4;
  p.shadowK = 0.6;
};

const hide: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -3;
  p.sy = 0.5 + sin(t * 7) * 0.02 * c.amp;
  p.sx = 1.18;
  p.hemWide = 1.25;
  p.rot = sin(t * 11) * 0.02 * c.amp;
  p.faceVis = 0;
  p.armLen = 0.4;
  p.armL = 0.1;
  p.armR = 0.1;
  p.hemAmp = 1.2;
  p.shadowK = 1.2;
  p.lookW = 0;
};

const peek: Sampler = (p, c) => {
  const t = c.t;
  const u = (t % 3.4) / 3.4;
  const rise = pulse(u, 0.1, 0.3, 0.72, 0.9);
  const look = sin(u * TAU * 1.5) * sseg(rise, 0.3, 1);
  p.offY = -4;
  p.sy = lerp(0.5, 0.74, rise);
  p.sx = lerp(1.18, 1.08, rise);
  p.hemWide = 1.25;
  p.faceVis = sseg(rise, 0.05, 0.5);
  p.eyeSize = 1.12;
  p.lookX = look;
  p.lookW = 0;
  p.lean = look * 4 * c.amp;
  p.rot = look * 0.1 * c.amp;
  p.armL = 2.5;
  p.armR = 2.5;
  p.armLen = lerp(0.3, 0.6, rise);
  p.mouthSmile = 0.7;
  p.cheek = 0.5;
  p.shadowK = 1.2;
};

const vanish: Sampler = (p, c) => {
  const u = clamp(c.t / 0.9, 0, 1);
  const fade = 1 - easeIn(seg(u, 0.12, 1));
  const reduced = 1 - c.fx;
  p.vis = reduced > 0 ? lerp(fade, 1 - sseg(u, 0, 1), reduced) : fade;
  const shrink = lerp(1, 0.12, easeIn(seg(u, 0.2, 1)) * c.fx);
  p.spin = easeIn(u) * TAU * 1.5 * c.fx;
  p.sx = shrink;
  p.sy = shrink * (1 + 0.5 * seg(u, 0.3, 1) * c.fx);
  p.offY = -HOVER - 10 * easeOut(u) * c.fx;
  p.sparkle = pulse(u, 0.1, 0.35, 0.7, 1) * c.fx;
  p.eyeSmile = 1 - sseg(u, 0.35, 0.5);
  p.armL = 1.2 + sin(c.t * 20) * 0.5 * c.fx;
  p.armR = 2.2;
  p.mouthOpen = 0.3;
  p.mouthSmile = 1;
  p.lookW = 0;
  p.shadowK = shrink;
};

const appear: Sampler = (p, c) => {
  const u = clamp(c.t / 0.9, 0, 1);
  const grow = easeOut(seg(u, 0, 0.85));
  const reduced = 1 - c.fx;
  p.vis = lerp(grow, sseg(u, 0, 1), reduced);
  const s = lerp(1, lerp(0.12, 1, easeOutBack(seg(u, 0, 0.8))), c.fx);
  p.spin = -(1 - easeOut(u)) * TAU * 1.25 * c.fx;
  p.sx = s;
  p.sy = s;
  p.offY = -HOVER + 8 * (1 - easeOut(u)) * c.fx;
  p.sparkle = pulse(u, 0, 0.3, 0.6, 0.9) * c.fx;
  p.glow = 0.6 * (1 - u) * c.fx;
  const up = 1 - sseg(u, 0.6, 1);
  p.armL = lerp(0.32, 2.4, up);
  p.armR = p.armL;
  p.eyeSmile = 0.8 * up;
  p.mouthOpen = 0.25 * up;
  p.mouthSmile = lerp(0.45, 1, up);
  p.lookW = 0.3;
  p.shadowK = s;
};

const dance: Sampler = (p, c) => {
  const t = c.t;
  const q = (t / 2.8) % 1;
  const turn = easeInOut(seg(q, 0.62, 1));
  p.spin = turn * TAU * c.fx + (1 - c.fx) * sin(t * 2.2) * 0.4;
  p.offX = sin(t * 2.5) * 5 * c.amp;
  p.rot = sin(t * 5) * 0.14 * c.amp;
  p.lean = sin(t * 5 + 1) * 4 * c.amp;
  p.offY = -HOVER - 2 + sin(t * 10) * 2 * c.amp;
  p.armL = 0.9 + sin(t * 5) * 0.7 * c.amp;
  p.armR = 0.9 + sin(t * 5 + Math.PI) * 0.7 * c.amp;
  p.eyeSmile = 0.8;
  p.mouthOpen = 0.3;
  p.mouthSmile = 1;
  p.cheek = 0.7;
  p.hemSway = 3;
  p.hemAmp = 3.3;
  p.hemRate = 1.8;
  p.lookW = 0;
};

const scan: Sampler = (p, c) => {
  const t = c.t;
  const lx = clamp(noise1(t * 0.5, 3) * 1.4, -1, 1);
  const ly = noise1(t * 0.4, 7) * 0.5;
  p.offY = -HOVER + sin(t * 2) * 1.6 * c.amp;
  p.lookX = lx;
  p.lookY = ly;
  p.lookW = 0;
  p.faceX = lx * 5;
  p.lean = lx * 5 * c.amp;
  p.rot = lx * 0.06 * c.amp;
  p.offX = lx * 3 * c.amp;
  p.eyeSize = 1.1;
  p.armR = 0.32 + 0.9 * sseg(lx, 0.4, 0.9);
};

const squish: Sampler = (p, c) => {
  const t = c.t;
  const u = clamp(t / 0.65, 0, 1);
  const q = pulse(u, 0, 0.3, 0.45, 0.65);
  const w = t > 0.4 ? Math.exp(-6 * (t - 0.4)) * sin((t - 0.4) * 22) : 0;
  p.sx = 1 - 0.68 * q + 0.12 * w * c.amp;
  p.sy = 1 + 0.22 * q - 0.08 * w * c.amp;
  p.alpha = 1 - 0.35 * q;
  p.eyeOpen = 1 - 0.5 * q;
  p.armL = lerp(0.32, 0.05, q);
  p.armR = p.armL;
  p.sparkle = 0.5 * pulse(u, 0.2, 0.4, 0.6, 0.9) * c.fx;
  p.hemAmp = 2.2 + 2 * q;
};

const beam: Sampler = (p, c) => {
  const t = c.t;
  const u = clamp(t / 1.5, 0, 1);
  const wind = pulse(u, 0, 0.18, 0.22, 0.3);
  const swell = pulse(u, 0.25, 0.32, 0.62, 0.8);
  const giggle = pulse(u, 0.78, 0.82, 0.93, 0.98);
  p.sy = 1 - 0.14 * wind + 0.3 * swell * c.amp;
  p.sx = 1 + 0.08 * wind + 0.3 * swell * c.amp;
  p.hemWide = 1 + 0.1 * wind + 0.15 * swell;
  p.offY = -HOVER - 6 * swell * c.amp;
  p.armL = lerp(0.32, 0.2, wind) + 2.6 * swell + 0.6 * giggle;
  p.armR = p.armL;
  p.eyeSize = 1 + 0.25 * swell;
  p.eyeOpen = 1 - 0.45 * wind;
  p.eyeSmile = giggle;
  p.mouthOpen = 0.95 * swell + 0.3 * giggle;
  p.mouthSmile = giggle;
  p.cheek = giggle;
  p.glow = swell * c.fx;
  p.flare = 0.4 * swell * c.fx;
  p.rot = sin(t * 18) * 0.08 * giggle * c.amp;
  p.hemAmp = 2.2 + 2 * swell;
  p.lookW = 0;
};

const annoyed: Sampler = (p, c) => {
  const t = c.t;
  p.sx = 1.08;
  p.sy = 0.94;
  p.offY = -HOVER + 1 + sin(t * 3) * 0.8 * c.amp;
  p.rot = sin(t * 3) * 0.02 * c.amp;
  p.eyeOpen = 0.5;
  p.brow = 0.9;
  p.mouthSmile = -0.6;
  p.mouthW = 0.8;
  p.armL = 0.2;
  p.armR = 0.2;
  p.hemSway = 2.8;
  p.hemAmp = 3;
  p.hemRate = 1.7;
};

const confused: Sampler = (p, c) => {
  const t = c.t;
  p.rot = sin(t * 1.6) * 0.12 * c.amp;
  p.lean = sin(t * 1.6) * 3.5 * c.amp;
  p.offY = -HOVER + sin(t * 2) * 1.4 * c.amp;
  p.brow = -0.8;
  p.mouthSmile = 0.1;
  p.mouthW = 0.7;
  p.lookX = sin(t * 1.1);
  p.lookW = 0;
  p.armR = 2.4 + sin(t * 5) * 0.2 * c.amp;
  p.armLen = 0.8;
};

const shake: Sampler = (p, c) => {
  const t = c.t;
  const u = clamp(t / 1.1, 0, 1);
  const env = 1 - sseg(u, 0.5, 1);
  p.rot = sin(t * 34) * 0.12 * env * c.amp;
  p.offX = sin(t * 34 + 1) * 3 * env * c.amp;
  p.hemAmp = 2.2 + 2 * env;
  p.hemRate = 1 + 2 * env;
  p.armL = 0.6;
  p.armR = 0.6;
  p.eyeOpen = 0.2 + 0.8 * (1 - env);
  p.mouthSmile = 0.8;
  p.sparkle = 0.6 * env * c.fx;
  p.lookW = 0;
};

// ---- clips that used to be aliases (stretch -> wake, groom -> sit, scratch -> confused, meow -> yawn, pawAt -> scan,
// swat -> startle, rollOver/tailChase -> petted, impact -> land): a legless sheet has its own way of doing each. ------

/** Rises tall with arms overhead and the hem trailing, a little shiver at the top (one-shot, 1.6 s). */
const stretch: Sampler = (p, c) => {
  const u = clamp(c.t / 1.6, 0, 1);
  const dip = pulse(u, 0, 0.12, 0.2, 0.3);
  const up = pulse(u, 0.22, 0.5, 0.72, 0.95);
  const shiver = pulse(u, 0.5, 0.56, 0.68, 0.74) * sin(c.t * 40) * c.amp;
  p.offY = -HOVER + 3 * dip - 7 * up * c.amp;
  p.sy = 1 - 0.1 * dip + 0.16 * up * c.amp;
  p.sx = 1 + 0.06 * dip - 0.08 * up * c.amp;
  p.hemDrop = 5 * up * c.amp;
  p.hemWide = 1 - 0.1 * up;
  p.armL = lerp(0.4, 2.85, up);
  p.armR = p.armL;
  p.armLen = 1 + 0.2 * up;
  p.rot = shiver * 0.03;
  p.eyeSmile = 0.75 * up;
  p.mouthOpen = 0.55 * pulse(u, 0.4, 0.5, 0.6, 0.7);
  p.mouthSmile = 0.5;
  p.lookW = 0.3 * (1 - up);
};

/** Polishing the sheet: one hand rubs the dome's side, the other tidies the hem (loop). */
const groom: Sampler = (p, c) => {
  const t = c.t;
  const rub = sin(t * 8);
  p.offY = -7 + sin(t * 1.6) * 1.1 * c.amp;
  p.sy = 0.95;
  p.sx = 1.04;
  p.hemWide = 1.1;
  p.armR = 1.75 + 0.5 * rub * c.amp;
  p.armL = 0.25 + 0.12 * sin(t * 4 + 1) * c.amp;
  p.lean = 2.2 + 0.8 * rub * c.amp;
  p.rot = 0.05 + 0.02 * rub * c.amp;
  p.eyeSmile = 0.7;
  p.cheek = 0.6;
  p.mouthSmile = 0.7;
  p.hemAmp = 1.6;
  p.hemSway = 1.8 + 0.6 * sin(t * 4) * c.amp;
  p.lookW = 0;
  p.shadowK = 1.1;
};

/** A hand scratches the top of the dome, head tilted into it (loop). */
const scratch: Sampler = (p, c) => {
  const t = c.t;
  p.offY = -7 + sin(t * 1.6) * 1.1 * c.amp;
  p.sy = 0.95;
  p.sx = 1.04;
  p.hemWide = 1.1;
  p.armR = 2.7 + 0.28 * sin(t * 16) * c.amp;
  p.armLen = 1.05;
  p.armL = 0.25;
  p.rot = 0.07 + 0.012 * sin(t * 16) * c.amp;
  p.lean = 1.5 + 0.7 * sin(t * 16 + 1) * c.amp;
  p.eyeSmile = 0.85;
  p.mouthOpen = 0.12;
  p.mouthSmile = 0.8;
  p.cheek = 0.4;
  p.lookW = 0;
  p.shadowK = 1.1;
};

/** A hollow "whoo" call: the sheet lifts, stretches tall and the round mouth opens twice (one-shot, 0.9 s). */
const meow: Sampler = (p, c) => {
  const u = clamp(c.t / 0.9, 0, 1);
  const a = pulse(u, 0.08, 0.2, 0.42, 0.52);
  const b = pulse(u, 0.5, 0.6, 0.78, 0.9);
  const k = Math.max(a, 0.8 * b);
  p.offY = -HOVER - 4 * k * c.amp;
  p.sy = 1 + 0.1 * k * c.amp;
  p.sx = 1 - 0.04 * k * c.amp;
  p.hemDrop = 3 * k * c.amp;
  p.hemAmp = 2.2 + 1.5 * k;
  p.armL = 0.4 + 0.7 * k;
  p.armR = p.armL;
  p.eyeSize = 1 + 0.12 * k;
  p.mouthOpen = 0.95 * k;
  p.mouthW = 0.8;
  p.mouthSmile = 0;
  p.glow = 0.3 * k * c.fx;
  p.lookW = 0.4;
};

/** Batting at the look target with one sheet-arm, the body leaning into it (loop). */
const pawAt: Sampler = (p, c) => {
  const t = c.t;
  const bat = sin(t * 9);
  const lunge = 0.5 + 0.5 * sin(t * 2.3);
  p.offY = -HOVER + sin(t * 2) * 1.5 * c.amp;
  p.armR = 1.35 + 0.5 * bat * c.amp;
  p.armL = 0.3;
  p.lean = 4 + 2 * lunge;
  p.rot = 0.07 + 0.02 * bat * c.amp;
  p.eyeSize = 1.12;
  p.mouthSmile = 0.9;
  p.hemSway = 2.4;
  p.hemAmp = 2.6;
  p.lookW = 0.8;
  p.faceX = 2;
  p.cheek = 0.3;
};

/** One quick swipe: the arm winds up, slashes across, the sheet snaps after it (one-shot, 0.45 s). */
const swat: Sampler = (p, c) => {
  const u = clamp(c.t / 0.45, 0, 1);
  const wind = pulse(u, 0, 0.25, 0.3, 0.4);
  const hit = pulse(u, 0.3, 0.42, 0.52, 0.85);
  p.armR = lerp(0.4, 2.5, wind) - 1.75 * hit + 0.35 * sseg(u, 0.4, 1);
  p.armL = 0.35;
  p.lean = -2 * wind + 6 * hit;
  p.rot = -0.05 * wind + 0.12 * hit * c.amp;
  p.sy = 1 + 0.06 * wind;
  p.offY = -HOVER - 3 * wind * c.amp;
  p.hemSway = 2 + 3 * hit;
  p.hemAmp = 2.4 + 1.5 * hit;
  p.eyeOpen = 0.85;
  p.brow = 0.5 * hit;
  p.mouthOpen = 0.35 * hit;
  p.mouthSmile = 0.6;
  p.lookW = 0.7;
};

/** Floating on its back: the sheet tips over to lie flat, arms and hem waving, then rights itself (loop). */
const rollOver: Sampler = (p, c) => {
  const t = c.t;
  const u = (t % 3.6) / 3.6;
  const lie = pulse(u, 0.1, 0.28, 0.76, 0.92);
  const wave = sin(t * 5);
  // Reduced motion tips the sheet only a little (a gentle lean) instead of laying it flat.
  const tip = lerp(0.3, 1.48, clamp((c.amp - 0.38) / 0.62, 0, 1));
  p.rot = tip * lie + 0.1 * lie * sin(t * 2.6) * c.amp;
  p.offY = -HOVER - 6 * lie + sin(t * 2) * 1.6 * c.amp * lie;
  p.armL = 0.4 + 1.5 * lie + 0.55 * wave * lie * c.amp;
  p.armR = 0.4 + 1.5 * lie - 0.55 * wave * lie * c.amp;
  p.hemAmp = 2.2 + 1.8 * lie;
  p.hemSway = 1.3 + 2 * lie;
  p.hemRate = 1 + 0.8 * lie;
  p.eyeSmile = 0.9 * lie;
  p.cheek = 0.7 * lie;
  p.mouthOpen = 0.25 * lie;
  p.mouthSmile = 1;
  p.lookW = 0;
  p.shadowK = 1 - 0.3 * lie;
};

/** Chasing its own hem: a quick continuous twirl with the hem flung out (loop). Reduced motion: a slow sway instead. */
const tailChase: Sampler = (p, c) => {
  const t = c.t;
  p.spin = t * TAU * 1.15 * c.fx + (1 - c.fx) * sin(t * 2.4) * 0.45;
  p.offY = -HOVER - 3 + sin(t * 6) * 1.6 * c.amp;
  p.hemFlare = 1.1 * c.fx;
  p.hemWide = 1 + 0.2 * c.fx;
  p.hemSway = 3.2;
  p.hemAmp = 3.2;
  p.hemRate = 2.2;
  p.lean = 3.5 * c.fx;
  p.rot = 0.1 * c.fx;
  p.armL = 1.25 + 0.2 * sin(t * 9) * c.amp;
  p.armR = 1.25 + 0.2 * sin(t * 9 + 2) * c.amp;
  p.eyeSmile = 0.7;
  p.mouthOpen = 0.35;
  p.mouthSmile = 1;
  p.cheek = 0.7;
  p.lookW = 0;
};

/** A hard landing: the sheet splats flat and wide with dizzy stars, then slowly puffs back up (one-shot, 0.45 s). */
const impact: Sampler = (p, c) => {
  const t = c.t;
  const hard = 0.75 + 0.25 * c.impact;
  const k = Math.exp(-5 * t) * Math.cos(t * 14);
  const sq = 1 - sseg(t, 0.05, 0.45);
  p.sy = 1 - 0.38 * hard * Math.max(k, 0) * (0.6 + 0.4 * sq) - 0.05 * Math.min(k, 0);
  p.sx = 1 + 0.3 * hard * Math.max(k, 0);
  p.hemWide = 1 + 0.45 * hard * Math.max(k, 0);
  p.hemAmp = 3.2;
  p.offY = -HOVER + 11 * Math.max(k, 0) * c.amp;
  p.armL = 0.9 + 0.5 * k;
  p.armR = p.armL;
  p.eyeOpen = 0.35 + 0.65 * sseg(t, 0.15, 0.45);
  p.mouthOpen = 0.45 * (1 - sseg(t, 0, 0.35));
  p.mouthSmile = 0;
  p.sparkle = 0.55 * pulse(t, 0.05, 0.12, 0.3, 0.45) * c.fx;
  p.lookW = 0;
};

export const SAMPLERS: Readonly<Record<string, Sampler>> = {
  stand,
  sit,
  loaf,
  sleep,
  wake,
  yawn,
  float,
  crouch,
  jump,
  fall,
  land,
  startle,
  petted,
  held,
  hide,
  peek,
  vanish,
  appear,
  dance,
  scan,
  squish,
  beam,
  annoyed,
  confused,
  shake,
  stretch,
  groom,
  scratch,
  meow,
  pawAt,
  swat,
  rollOver,
  tailChase,
  impact,
};
