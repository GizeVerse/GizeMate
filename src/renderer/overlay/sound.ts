// Optional procedural cat sounds for the overlay renderer (ADR 0003 §10). Synthesized with Web
// Audio from oscillators, a noise buffer and filters: no assets, no microphone, no network.
// Main only puts a cue on a snapshot while settings.sound is on, and only on the overlay holding
// the cat's anchor (overlayManager); this player is the second line of defence: it plays each cue
// once (per `at`), never one that is stale against the snapshot (a recreated overlay must not
// replay it), at most one per MIN_GAP_MS, and closes its AudioContext after IDLE_CLOSE_MS of
// silence (a suspended context can hold a Windows audio power request). Nothing here can throw
// into the frame loop.
import { SOUND_CUES, type CatSoundCue, type SoundCue } from '../../shared/cat';
import { seededRandom } from './cat/math';
import { CHARACTERS, DEFAULT_CHARACTER, type CharacterId } from '../../shared/characters/registry';
import type { SoundProfile } from '../../shared/characters/types';

/** Cues older than this (ms of sim time) against the snapshot that carries them are dropped. */
export const STALE_CUE_MS = 500;
/** At most one cue per this many ms (sim time and wall time both). */
export const MIN_GAP_MS = 1500;
/** The AudioContext is closed after this long (ms, wall time) without sound. */
export const IDLE_CLOSE_MS = 10_000;
/** Volume when the cue carries none (settings.sound.volume default). */
export const DEFAULT_VOLUME = 0.4;
/** Overall level: synthesized cues are loud at full scale, so 1.0 volume maps to this peak gain. */
const MASTER = 0.35;
/** After a failed AudioContext creation, wait this long (ms) before trying again. */
const RETRY_MS = 30_000;

/** Length (s) of each cue as synthesized (purr: only while petted, ADR 0003 §10, <= 8 s). */
export const CUE_DURATION_S: Readonly<Record<SoundCue, number>> = {
  meow: 0.62,
  chirp: 0.3,
  trill: 0.48,
  purr: 2.4,
  hiss: 0.9,
  growl: 0.95,
  thud: 0.2,
  // Living Companion: the world's cues (a mouse, a rumble of thunder, a sparkle, a splash).
  squeak: 0.2,
  rumble: 0.85,
  chime: 1,
  splash: 0.6,
  // GizeMate: the other characters' voices (synthesized by the sound layer; lengths here).
  chatter: 0.5,
  yip: 0.28,
  boing: 0.45,
  whoo: 0.9,
  bleep: 0.35,
  squelch: 0.5,
};

// The slice of Web Audio this player uses (the real AudioContext satisfies it; tests use a fake).
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface AudioNodeLike {
  /** To a node (audio path) or a param (modulation: an LFO into a gain). */
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  disconnect(): void;
}
export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}
export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}
export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  resume(): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface SoundPlayerContext {
  /** Wall clock (ms), e.g. performance.now. */
  now: () => number;
  /** Creates the AudioContext on the first cue; absent = the browser's AudioContext (none: silent). */
  audio?: () => AudioContextLike;
  /** Timers for the idle close; absent = globalThis setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SoundPlayer {
  /** Plays `cue` (from a snapshot whose sim time is `snapshotT`) unless it is a repeat, stale, too soon or sound is unavailable. */
  play(cue: CatSoundCue, snapshotT: number, character?: CharacterId): void;
  /** Stops any sound and closes the AudioContext now; a later cue opens a new one. */
  close(): void;
  /** close(), and never play again (the overlay is going away). */
  dispose(): void;
}

const CUES: ReadonlySet<string> = new Set(SOUND_CUES);

/** A character's profile, sanitised; null for the cat (and anything unknown), which plays unshaped. */
interface Prof {
  readonly id: CharacterId;
  readonly pitch: number;
  readonly voice: SoundProfile['voice'];
  readonly gain: number;
  readonly cooldownMs: number;
}
const VOICES: ReadonlySet<string> = new Set(['soft', 'bright', 'hollow', 'squelchy', 'synthetic']);
function profileOf(id: unknown): Prof | null {
  if (id === DEFAULT_CHARACTER) return null;
  const m = CHARACTERS.find((c) => c.id === id);
  if (!m) return null;
  const s = m.sound;
  const num = (v: number, lo: number, hi: number, d: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    id: m.id,
    pitch: num(s.pitch, 0.5, 2, 1),
    voice: VOICES.has(s.voice) ? s.voice : 'soft',
    gain: num(s.gain, 0.2, 1, 0.8),
    cooldownMs: num(s.cooldownMs, 0, 60_000, 2500),
  };
}

function defaultAudio(): AudioContextLike {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
  if (!Ctor) throw new Error('no AudioContext');
  return new Ctor();
}

export function createSoundPlayer(ctx: SoundPlayerContext): SoundPlayer {
  const makeAudio = ctx.audio ?? defaultAudio;
  const setTimer = ctx.setTimer ?? ((fn: () => void, ms: number): unknown => globalThis.setTimeout(fn, ms));
  const clearTimer = ctx.clearTimer ?? ((h: unknown): void => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  let ac: AudioContextLike | null = null;
  let noise: AudioBufferLike | null = null;
  let disposed = false;
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastWall = Number.NEGATIVE_INFINITY;
  let retryAt = Number.NEGATIVE_INFINITY;
  let idleTimer: unknown = null;
  const lastByChar = new Map<string, { at: number; wall: number }>();
  /** The playing cue's output gain and when (context time) it ends; a new cue fades it out. */
  let voice: { out: GainNodeLike; end: number } | null = null;

  const safeNow = (): number => {
    try {
      const t = ctx.now();
      return Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  };

  const cancelIdle = (): void => {
    if (idleTimer === null) return;
    try {
      clearTimer(idleTimer);
    } catch {
      // ignore
    }
    idleTimer = null;
  };

  const shut = (): void => {
    cancelIdle();
    const a = ac;
    ac = null;
    noise = null;
    voice = null;
    if (!a) return;
    try {
      void a.close().catch(() => undefined);
    } catch {
      // A context that cannot close is dropped anyway.
    }
  };

  const scheduleIdle = (ms: number): void => {
    cancelIdle();
    try {
      idleTimer = setTimer(() => {
        idleTimer = null;
        shut();
      }, ms);
    } catch {
      idleTimer = null;
    }
  };

  const context = (): AudioContextLike | null => {
    if (ac) return ac;
    const now = safeNow();
    if (now < retryAt) return null;
    try {
      ac = makeAudio();
    } catch {
      ac = null;
      retryAt = now + RETRY_MS;
      return null;
    }
    return ac;
  };

  const noiseBuffer = (a: AudioContextLike): AudioBufferLike => {
    if (noise) return noise;
    const len = Math.max(1, Math.round(a.sampleRate * 1));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    const rnd = seededRandom(0x5eed);
    for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
    noise = buf;
    return buf;
  };

  return {
    play(cue: CatSoundCue, snapshotT: number, character?: CharacterId): void {
      if (disposed || !cue || typeof cue.kind !== 'string' || !CUES.has(cue.kind)) return;
      const at = cue.at;
      if (!Number.isFinite(at) || !Number.isFinite(snapshotT)) return;
      // Once per `at`, oldest first; never a cue from long ago or from the future.
      if (at <= lastAt) return;
      if (snapshotT - at > STALE_CUE_MS || at - snapshotT > STALE_CUE_MS) return;
      const wall = safeNow();
      if (at - lastAt < MIN_GAP_MS || wall - lastWall < MIN_GAP_MS) return;
      // The character's voice (absent or unknown = the cat: its recipes play exactly as they always did).
      const prof = character === undefined ? null : profileOf(character);
      if (prof) {
        // Never repetitive: a minimum interval per character on top of the shared gap (sim and wall time).
        const prev = lastByChar.get(prof.id);
        if (prev && (at - prev.at < prof.cooldownMs || wall - prev.wall < prof.cooldownMs)) {
          lastAt = at;
          return;
        }
        lastByChar.set(prof.id, { at, wall });
      }
      const vol = cue.volume === undefined ? DEFAULT_VOLUME : Number.isFinite(cue.volume) ? Math.min(1, Math.max(0, cue.volume)) : 0;
      lastAt = at;
      lastWall = wall;
      if (vol <= 0) return;
      const a = context();
      if (!a) return;
      try {
        if (a.state === 'suspended') void a.resume().catch(() => undefined);
        const t0 = a.currentTime + 0.01;
        if (voice && voice.end > t0) {
          // One cue at a time: the previous one fades out quickly.
          voice.out.gain.setValueAtTime(voice.out.gain.value, t0);
          voice.out.gain.linearRampToValueAtTime(0, t0 + 0.06);
        }
        const out = a.createGain();
        out.gain.value = vol * MASTER * (prof ? prof.gain : 1);
        out.connect(a.destination);
        const dur = CUE_DURATION_S[cue.kind];
        renderCue(a, cue.kind, out, t0, dur, () => noiseBuffer(a), prof);
        voice = { out, end: t0 + dur };
        scheduleIdle(dur * 1000 + IDLE_CLOSE_MS);
      } catch {
        // A failing graph must never reach the frame loop; drop the context and start fresh next time.
        shut();
      }
    },
    close(): void {
      shut();
    },
    dispose(): void {
      disposed = true;
      shut();
    },
  };
}

// ---------------------------------------------------------------------------
// Synthesis. Every source is started at t0 and stopped by t0 + dur, so nothing keeps playing.

function envelope(g: GainNodeLike, t0: number, attack: number, hold: number, release: number, peak = 1): void {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.linearRampToValueAtTime(0, t0 + attack + hold + release);
}

function osc(a: AudioContextLike, type: string, freq: number, t0: number, dur: number): OscillatorNodeLike {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t0 + dur);
  return o;
}

function noiseSource(a: AudioContextLike, buf: AudioBufferLike, t0: number, dur: number): AudioBufferSourceNodeLike {
  const n = a.createBufferSource();
  n.buffer = buf;
  n.loop = true;
  n.start(t0);
  n.stop(t0 + dur);
  return n;
}

function filter(a: AudioContextLike, type: string, freq: number, q: number, t0: number): BiquadFilterNodeLike {
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  f.Q.setValueAtTime(q, t0);
  return f;
}

/** How a layer of a cue is voiced: a pitch multiplier, a waveform map and whether pitch moves in steps. */
interface Shape {
  readonly p: number;
  readonly wave: (type: string) => string;
  readonly quant: boolean;
}
const IDENTITY: Shape = { p: 1, wave: (t) => t, quant: false };

interface Pitched {
  readonly o: OscillatorNodeLike;
  /** Moves the frequency to `f` (before the pitch multiplier) at `t`: a ramp, or a jump for 'set'. */
  to(kind: 'lin' | 'exp' | 'set', f: number, t: number): void;
}

/** A pitched oscillator: frequencies scale by the voice's pitch; with `quant` ramps become a staircase (bit-crush-like). */
function pv(a: AudioContextLike, sh: Shape, type: string, freq: number, t0: number, dur: number): Pitched {
  const o = osc(a, sh.wave(type), freq * sh.p, t0, dur);
  let lastF = freq * sh.p;
  let lastT = t0;
  return {
    o,
    to(kind, f, t): void {
      const F = f * sh.p;
      if (kind === 'set') o.frequency.setValueAtTime(F, t);
      else if (sh.quant && t > lastT) {
        const n = Math.max(1, Math.round((t - lastT) / 0.035));
        for (let i = 1; i < n; i++) {
          const frac = i / n;
          o.frequency.setValueAtTime(kind === 'exp' ? lastF * (F / lastF) ** frac : lastF + (F - lastF) * frac, lastT + (t - lastT) * frac);
        }
        o.frequency.setValueAtTime(F, t);
      } else if (kind === 'lin') o.frequency.linearRampToValueAtTime(F, t);
      else o.frequency.exponentialRampToValueAtTime(F, t);
      lastF = F;
      lastT = t;
    },
  };
}

/** A low-frequency modulator (not pitch-scaled) feeding `target` through a depth gain. */
function lfoInto(a: AudioContextLike, rate: number, depth: number, target: AudioParamLike, t0: number, dur: number): void {
  const lfo = osc(a, 'sine', rate, t0, dur);
  const d = a.createGain();
  d.gain.value = depth;
  lfo.connect(d);
  d.connect(target);
}

const asTriangle = (t: string): string => (t === 'square' ? 'square' : 'triangle');
const asSquare = (): string => 'square';

interface Layer {
  readonly shape: Shape;
  readonly gain: number;
}

function layersOf(pr: Prof): readonly Layer[] {
  const p = pr.pitch;
  switch (pr.voice) {
    case 'hollow':
      // Two copies a few cents apart: a slow, airy beat.
      return [
        { shape: { p, wave: IDENTITY.wave, quant: false }, gain: 0.7 },
        { shape: { p: p * 1.007, wave: IDENTITY.wave, quant: false }, gain: 0.35 },
      ];
    case 'synthetic':
      // Triangle with a square on top, pitch moving in steps.
      return [
        { shape: { p, wave: asTriangle, quant: true }, gain: 0.6 },
        { shape: { p, wave: asSquare, quant: true }, gain: 0.25 },
      ];
    default:
      return [{ shape: { p, wave: IDENTITY.wave, quant: false }, gain: 1 }];
  }
}

/** The voice's timbre stage between the summed layers and the output gain. */
function voiceChain(a: AudioContextLike, voice: SoundProfile['voice'], bus: GainNodeLike, out: GainNodeLike, t0: number, dur: number): void {
  switch (voice) {
    case 'bright': {
      // Dry plus a high-passed copy: a high shelf's worth of air.
      const dry = a.createGain();
      dry.gain.value = 0.8;
      bus.connect(dry);
      dry.connect(out);
      const hp = filter(a, 'highpass', 3200, 0.7, t0);
      const air = a.createGain();
      air.gain.value = 0.5;
      bus.connect(hp);
      hp.connect(air);
      air.connect(out);
      break;
    }
    case 'hollow': {
      const lp = filter(a, 'lowpass', 1900, 0.9, t0);
      bus.connect(lp);
      lp.connect(out);
      break;
    }
    case 'squelchy': {
      // A resonant band-pass sweeping up then settling, plus a little dry body.
      const bp = filter(a, 'bandpass', 450, 4.5, t0);
      bp.frequency.linearRampToValueAtTime(1300, t0 + dur * 0.4);
      bp.frequency.linearRampToValueAtTime(600, t0 + dur);
      const wet = a.createGain();
      wet.gain.value = 1.1;
      const dry = a.createGain();
      dry.gain.value = 0.25;
      bus.connect(bp);
      bp.connect(wet);
      wet.connect(out);
      bus.connect(dry);
      dry.connect(out);
      break;
    }
    case 'synthetic': {
      const lp = filter(a, 'lowpass', 5200, 0.5, t0);
      bus.connect(lp);
      lp.connect(out);
      break;
    }
    default: {
      // 'soft': warm.
      const lp = filter(a, 'lowpass', 3400, 0.7, t0);
      bus.connect(lp);
      lp.connect(out);
    }
  }
}

/** The cat (`prof` null) goes straight to the output unshaped; a character's layers go through its timbre stage. */
function renderCue(a: AudioContextLike, kind: SoundCue, out: GainNodeLike, t0: number, dur: number, noise: () => AudioBufferLike, prof: Prof | null): void {
  if (!prof) {
    synth(a, kind, out, t0, dur, noise, IDENTITY);
    return;
  }
  const bus = a.createGain();
  voiceChain(a, prof.voice, bus, out, t0, dur);
  for (const layer of layersOf(prof)) {
    const lg = a.createGain();
    lg.gain.value = layer.gain;
    lg.connect(bus);
    synth(a, kind, lg, t0, dur, noise, layer.shape);
  }
}

function synth(a: AudioContextLike, kind: SoundCue, out: GainNodeLike, t0: number, dur: number, noise: () => AudioBufferLike, sh: Shape): void {
  const env = a.createGain();
  env.connect(out);
  switch (kind) {
    case 'meow': {
      // "mi-a-ow": a sawtooth through a sweeping formant, pitch up then down.
      const o = pv(a, sh, 'sawtooth', 520, t0, dur);
      o.to('lin', 760, t0 + 0.18);
      o.to('lin', 430, t0 + dur);
      const f = filter(a, 'bandpass', 900, 4, t0);
      f.frequency.linearRampToValueAtTime(1700, t0 + 0.2);
      f.frequency.linearRampToValueAtTime(800, t0 + dur);
      o.o.connect(f);
      f.connect(env);
      envelope(env, t0, 0.04, dur - 0.24, 0.2, 0.9);
      break;
    }
    case 'chirp': {
      // Two quick rising chirps.
      const o = pv(a, sh, 'triangle', 1100, t0, dur);
      o.to('exp', 2300, t0 + 0.11);
      o.to('set', 1200, t0 + 0.15);
      o.to('exp', 2500, t0 + 0.27);
      o.o.connect(env);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.7, t0 + 0.02);
      env.gain.linearRampToValueAtTime(0, t0 + 0.12);
      env.gain.linearRampToValueAtTime(0.7, t0 + 0.17);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      break;
    }
    case 'trill': {
      // A rolling, rising coo: a tone amplitude-modulated at ~28 Hz.
      const o = pv(a, sh, 'triangle', 560, t0, dur);
      o.to('lin', 720, t0 + dur);
      const am = a.createGain();
      am.gain.value = 0.5;
      const lfo = osc(a, 'sine', 28, t0, dur);
      const depth = a.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(am.gain);
      o.o.connect(am);
      am.connect(env);
      envelope(env, t0, 0.05, dur - 0.17, 0.12, 0.8);
      break;
    }
    case 'purr': {
      // Low, rumbling noise pulsed at ~25 Hz.
      const n = noiseSource(a, noise(), t0, dur);
      const lp = filter(a, 'lowpass', 180, 1, t0);
      const am = a.createGain();
      am.gain.value = 0.5;
      const lfo = osc(a, 'sine', 25, t0, dur);
      const depth = a.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(am.gain);
      n.connect(lp);
      lp.connect(am);
      am.connect(env);
      envelope(env, t0, 0.3, dur - 0.8, 0.5, 0.9);
      break;
    }
    case 'hiss': {
      // Breathy high noise.
      const n = noiseSource(a, noise(), t0, dur);
      const hp = filter(a, 'highpass', 2600, 0.7, t0);
      const bp = filter(a, 'bandpass', 5200, 0.8, t0);
      n.connect(hp);
      hp.connect(bp);
      bp.connect(env);
      envelope(env, t0, 0.03, dur - 0.33, 0.3, 1);
      break;
    }
    case 'growl': {
      // A low sawtooth roughened at ~18 Hz, dull through a low-pass.
      const o = pv(a, sh, 'sawtooth', 95, t0, dur);
      o.to('lin', 80, t0 + dur);
      const lp = filter(a, 'lowpass', 600, 1, t0);
      const am = a.createGain();
      am.gain.value = 0.6;
      const lfo = osc(a, 'sine', 18, t0, dur);
      const depth = a.createGain();
      depth.gain.value = 0.4;
      lfo.connect(depth);
      depth.connect(am.gain);
      o.o.connect(lp);
      lp.connect(am);
      am.connect(env);
      envelope(env, t0, 0.08, dur - 0.33, 0.25, 0.9);
      break;
    }
    case 'thud': {
      // A soft landing: a falling sine and a dull click.
      const o = pv(a, sh, 'sine', 95, t0, dur);
      o.to('exp', 45, t0 + dur);
      o.o.connect(env);
      const n = noiseSource(a, noise(), t0, 0.05);
      const lp = filter(a, 'lowpass', 400, 0.7, t0);
      n.connect(lp);
      lp.connect(env);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(1, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      break;
    }
    // The world's cues. All are quieter than the cat's own loudest (peak envelope <= 0.55, against 1),
    // with a soft attack, so none of them can startle.
    case 'squeak': {
      // A tiny mouse squeak: two quick rising peeps.
      const o = pv(a, sh, 'sine', 1900, t0, dur);
      o.to('exp', 2700, t0 + 0.07);
      o.to('set', 2100, t0 + 0.11);
      o.to('exp', 2900, t0 + 0.18);
      o.o.connect(env);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.4, t0 + 0.015);
      env.gain.linearRampToValueAtTime(0, t0 + 0.08);
      env.gain.linearRampToValueAtTime(0.35, t0 + 0.125);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      break;
    }
    case 'rumble': {
      // Distant thunder: low-passed noise under a deep sine, swelling and fading slowly.
      const n = noiseSource(a, noise(), t0, dur);
      const lp = filter(a, 'lowpass', 140, 0.8, t0);
      lp.frequency.linearRampToValueAtTime(80, t0 + dur);
      n.connect(lp);
      lp.connect(env);
      const o = pv(a, sh, 'sine', 62, t0, dur);
      o.to('lin', 48, t0 + dur);
      const tone = a.createGain();
      tone.gain.value = 0.5;
      o.o.connect(tone);
      tone.connect(env);
      envelope(env, t0, 0.25, dur - 0.65, 0.4, 0.55);
      break;
    }
    case 'chime': {
      // Two soft bell notes, a fifth apart, each with its own quick decay.
      const notes: ReadonlyArray<readonly [number, number]> = [
        [880, 0],
        [1320, 0.14],
      ];
      for (const [freq, at] of notes) {
        const o = pv(a, sh, 'sine', freq, t0 + at, dur - at);
        const g = a.createGain();
        g.gain.setValueAtTime(0, t0 + at);
        g.gain.linearRampToValueAtTime(0.45, t0 + at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.o.connect(g);
        g.connect(env);
      }
      break;
    }
    case 'splash': {
      // A small splash: a burst of band-passed noise sweeping down, then two bubbles blooping up.
      const n = noiseSource(a, noise(), t0, dur);
      const bp = filter(a, 'bandpass', 1800, 0.9, t0);
      bp.frequency.exponentialRampToValueAtTime(600, t0 + dur);
      n.connect(bp);
      bp.connect(env);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      env.gain.linearRampToValueAtTime(0, t0 + dur);
      const bubbles: ReadonlyArray<readonly [number, number]> = [
        [320, 0.18],
        [420, 0.3],
      ];
      for (const [freq, at] of bubbles) {
        const o = pv(a, sh, 'sine', freq, t0 + at, 0.14);
        o.to('exp', freq * 2, t0 + at + 0.12);
        const g = a.createGain();
        g.gain.setValueAtTime(0, t0 + at);
        g.gain.linearRampToValueAtTime(0.3, t0 + at + 0.02);
        g.gain.linearRampToValueAtTime(0, t0 + at + 0.14);
        o.o.connect(g);
        g.connect(out);
      }
      break;
    }
    // GizeMate: the other characters' voices. Peak envelopes <= 0.6, soft attacks, short.
    case 'chatter': {
      // A monkey's quick chatter: five rapid gated chirps, each rising a little.
      const o = pv(a, sh, 'triangle', 1500, t0, dur);
      o.o.connect(env);
      env.gain.setValueAtTime(0, t0);
      for (let i = 0; i < 5; i++) {
        const s0 = t0 + i * 0.09;
        const base = i % 2 === 0 ? 1500 : 1750;
        o.to('set', base, s0);
        o.to('exp', base * 1.55, s0 + 0.07);
        env.gain.linearRampToValueAtTime(0.45, s0 + 0.012);
        env.gain.linearRampToValueAtTime(0, s0 + 0.07);
      }
      break;
    }
    case 'yip': {
      // A short fox yip: a rising bend then a quick fall, through a rounding low-pass.
      const o = pv(a, sh, 'sawtooth', 700, t0, dur);
      o.to('exp', 1350, t0 + 0.08);
      o.to('exp', 900, t0 + dur);
      const lp = filter(a, 'lowpass', 2600, 1, t0);
      o.o.connect(lp);
      lp.connect(env);
      envelope(env, t0, 0.02, dur - 0.1, 0.08, 0.5);
      break;
    }
    case 'boing': {
      // A springy bounce: a sine that bends up then settles, wobbling at ~16 Hz, with a quiet octave and a quick decay.
      const o = pv(a, sh, 'sine', 160, t0, dur);
      o.to('exp', 430, t0 + 0.09);
      o.to('exp', 170, t0 + dur);
      lfoInto(a, 16, 30 * sh.p, o.o.frequency, t0, dur);
      o.o.connect(env);
      const top = pv(a, sh, 'triangle', 320, t0, dur);
      top.to('exp', 860, t0 + 0.09);
      top.to('exp', 340, t0 + dur);
      const tg = a.createGain();
      tg.gain.value = 0.25;
      top.o.connect(tg);
      tg.connect(env);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.55, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      break;
    }
    case 'whoo': {
      // A soft, hollow, ghostly "ooo": a sine drifting down slowly, with a slow vibrato and a gentle swell. Never scary.
      const o = pv(a, sh, 'sine', 360, t0, dur);
      o.to('lin', 300, t0 + dur);
      lfoInto(a, 5, 9 * sh.p, o.o.frequency, t0, dur);
      const lp = filter(a, 'lowpass', 900, 0.5, t0);
      o.o.connect(lp);
      const sub = pv(a, sh, 'sine', 180, t0, dur);
      sub.to('lin', 150, t0 + dur);
      const sg = a.createGain();
      sg.gain.value = 0.5;
      sub.o.connect(sg);
      sg.connect(lp);
      lp.connect(env);
      envelope(env, t0, 0.35, 0.2, dur - 0.55, 0.4);
      break;
    }
    case 'bleep': {
      // A playful alien bleep: a four-note stepped arpeggio, the last note sliding up.
      const o = pv(a, sh, 'triangle', 660, t0, dur);
      o.o.connect(env);
      env.gain.setValueAtTime(0, t0);
      const notes = [660, 990, 780, 1320];
      for (let i = 0; i < notes.length; i++) {
        const s0 = t0 + i * 0.075;
        o.to('set', notes[i] as number, s0);
        if (i === notes.length - 1) o.to('exp', 1760, s0 + 0.1);
        env.gain.linearRampToValueAtTime(0.4, s0 + 0.012);
        env.gain.linearRampToValueAtTime(0.25, s0 + 0.06);
        env.gain.linearRampToValueAtTime(0, s0 + (i === notes.length - 1 ? 0.12 : 0.072));
      }
      break;
    }
    case 'squelch': {
      // A wet low blip: a falling saw through a resonant band-pass that sweeps up, plus a tiny noise smack.
      const o = pv(a, sh, 'sawtooth', 150, t0, dur);
      o.to('exp', 90, t0 + 0.25);
      o.to('exp', 70, t0 + dur);
      const bp = filter(a, 'bandpass', 400, 6, t0);
      bp.frequency.linearRampToValueAtTime(1100, t0 + 0.15);
      bp.frequency.linearRampToValueAtTime(500, t0 + dur);
      o.o.connect(bp);
      bp.connect(env);
      const n = noiseSource(a, noise(), t0, 0.1);
      const ng = a.createGain();
      ng.gain.value = 0.12;
      n.connect(ng);
      ng.connect(bp);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.6, t0 + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      break;
    }
  }
}
