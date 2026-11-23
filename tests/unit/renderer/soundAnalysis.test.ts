// Objective bounds of every rendered cue (offline, scripts/audio-review.cjs). The WAV analysis needs a real
// OfflineAudioContext (Electron), so this test asserts (1) the DSP helpers on synthetic signals, (2) that the
// recipes' node graphs still match the fingerprints recorded with the committed analysis baseline
// (soundAnalysis.baseline.json, written by `audio-review.cjs --baseline=...`), and (3) that the baseline's
// measured numbers sit inside the bounds below. A recipe or gain change therefore fails (1)/(2) until the
// review is re-run and its numbers pass (3). Analysed objectively, not heard.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND_CUES } from '../../../src/shared/cat';
import { CHARACTERS } from '../../../src/shared/characters/registry';
import { cueOutputGain, renderCueOn, type AudioContextLike } from '../../../src/renderer/overlay/sound';

const require_ = createRequire(import.meta.url);
const dsp = require_('../../../scripts/audio-dsp.cjs') as {
  analyse(s: Float32Array, sr: number, t0: number, dur: number): Record<string, number | boolean | string | null>;
  encodeWav16(s: Float32Array, sr: number): Buffer;
};
const fpmod = require_('../../../scripts/audio-fingerprint.cjs') as {
  createRecorder(): { ctx: unknown; nodes: unknown[] };
  describeGraph(n: unknown[]): string;
};

interface Row {
  character: string;
  cue: string;
  fp: string;
  silent: boolean;
  nearSilent: boolean;
  peakDbfs: number;
  kRmsDbfs: number;
  clippedSamples: number;
  dcOffset: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  durationVsNominal: number;
  tailAmp5msDbfs: number;
  centroidHz: number;
  activeEndS: number;
}
const baseline = JSON.parse(readFileSync(join(__dirname, 'soundAnalysis.baseline.json'), 'utf8')) as { volume: number; results: Row[] };

/** The bounds. Loudness: K-weighted RMS over the active span at volume 1.0 (after the 0.35 master and the character gain). */
export const BOUNDS = {
  peakMaxDbfs: -3,
  /** Every cue of every voice sits in this K-weighted RMS band (about 3 dB either side of the group). */
  kRmsMinDbfs: -33,
  kRmsMaxDbfs: -18,
  dcMax: 0.005,
  /** The last 5 ms must be inaudible as a click: below -40 dBFS AND at least 20 dB under the cue's own peak (the original cat meow ends at -53 dBFS, 35 dB under its peak; the original squeak at 20-25 dB). */
  tailMaxDbfs: -40,
  tailBelowPeakDb: 20,
  durationVsNominalMax: 1.02,
  leadingSilenceMaxMs: 60,
} as const;

describe('audio-review DSP helpers', () => {
  const sr = 48000;
  const sine = (amp: number, hz: number, secs: number, dc = 0): Float32Array => Float32Array.from({ length: Math.round(sr * secs) }, (_, i) => dc + amp * Math.sin((2 * Math.PI * hz * i) / sr));

  it('measures a half-scale 1 kHz sine: peak -6 dB, RMS -9 dB, centroid near 1 kHz, no clipping, no DC', () => {
    const a = dsp.analyse(sine(0.5, 1000, 0.5), sr, 0, 0.5);
    expect(a.peakDbfs as number).toBeCloseTo(-6.02, 1);
    expect(a.rmsDbfs as number).toBeCloseTo(-9.03, 1);
    expect(Math.abs((a.centroidHz as number) - 1000)).toBeLessThan(40);
    expect(a.clippedSamples).toBe(0);
    expect(Math.abs(a.dcOffset as number)).toBeLessThan(0.001);
    expect(a.silent).toBe(false);
  });

  it('flags clipping, DC offset, silence and a hard cut at the end', () => {
    expect(dsp.analyse(sine(1.2, 440, 0.2).map((v) => Math.max(-1, Math.min(1, v))), sr, 0, 0.2).clippedSamples as number).toBeGreaterThan(0);
    expect(dsp.analyse(sine(0.1, 440, 0.5, 0.2), sr, 0, 0.5).dcOffset as number).toBeGreaterThan(0.15);
    const s = dsp.analyse(new Float32Array(sr / 2), sr, 0, 0.5);
    expect(s.silent).toBe(true);
    expect(s.nearSilent).toBe(true);
    expect(dsp.analyse(sine(0.5, 440, 0.5), sr, 0, 0.5).tailAmp5msDbfs as number).toBeGreaterThan(-20);
  });

  it('K-weighting is lower than flat RMS for a 60 Hz tone and about equal at 1 kHz', () => {
    const low = dsp.analyse(sine(0.5, 60, 1), sr, 0, 1);
    const mid = dsp.analyse(sine(0.5, 1000, 1), sr, 0, 1);
    expect((low.kRmsDbfs as number) - (low.rmsDbfs as number)).toBeLessThan(-2);
    expect(Math.abs((mid.kRmsDbfs as number) - (mid.rmsDbfs as number))).toBeLessThan(1.5);
  });

  it('writes a valid 16-bit mono PCM WAV', () => {
    const w = dsp.encodeWav16(sine(0.5, 440, 0.01), sr);
    expect(w.toString('ascii', 0, 4)).toBe('RIFF');
    expect(w.toString('ascii', 8, 12)).toBe('WAVE');
    expect(w.readUInt16LE(22)).toBe(1);
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.readUInt32LE(40)).toBe(w.length - 44);
  });
});

describe('every cue under every voice: recipes match the analysed baseline', () => {
  it('has one baseline row per character and cue, rendered at volume 1.0', () => {
    expect(baseline.volume).toBe(1);
    for (const c of CHARACTERS) for (const cue of SOUND_CUES) expect(baseline.results.some((r) => r.character === c.id && r.cue === cue), `${c.id}/${cue}`).toBe(true);
    expect(baseline.results.length).toBe(CHARACTERS.length * SOUND_CUES.length);
  });

  it('the node graph of each recipe still hashes to the analysed one (re-run scripts/audio-review.cjs after any recipe or gain change)', () => {
    for (const r of baseline.results) {
      const rec = fpmod.createRecorder();
      const ctx = rec.ctx as AudioContextLike;
      const out = ctx.createGain();
      out.gain.value = cueOutputGain(1, r.character as never);
      out.connect(ctx.destination);
      renderCueOn(ctx, r.cue as never, out, 0.01, r.character as never);
      const fp = createHash('sha256').update(fpmod.describeGraph(rec.nodes)).digest('hex').slice(0, 16);
      expect(fp, `${r.character}/${r.cue}`).toBe(r.fp);
    }
  });
});

/** The cues a character actually plays: its profile cues plus the cues of its reactions and signature actions. */
function usedCues(c: (typeof CHARACTERS)[number]): Set<string> {
  const s = new Set<string>(Object.values(c.sound.cues));
  for (const r of Object.values(c.reactions)) if (r?.sound) s.add(r.sound);
  for (const sg of c.behavior.signatures) if (sg.sound) s.add(sg.sound);
  return s;
}

describe('objective bounds of the analysed renders', () => {
  for (const c of CHARACTERS) {
    it(`${c.id}: no cue is silent, clipped, clicky, DC-offset, overlong, late or outside the loudness band`, () => {
      for (const r of baseline.results.filter((x) => x.character === c.id)) {
        const id = `${r.character}/${r.cue}`;
        expect(r.silent, `${id} silent`).toBe(false);
        expect(r.nearSilent, `${id} near-silent`).toBe(false);
        expect(r.clippedSamples, `${id} clipping`).toBe(0);
        // Headroom: the cues a character plays keep 3 dB; every cue under every voice must at least never reach full scale.
        expect(r.peakDbfs, `${id} peak`).toBeLessThanOrEqual(c.id !== 'cat' && usedCues(c).has(r.cue) ? BOUNDS.peakMaxDbfs : -0.3);
        // The loudness band covers the cues a NEW character plays. The cat's own recipes are v1.5.0's and stay byte-identical (its purr is quiet by design); cues rendered under a voice nobody uses for them are not played.
        if (c.id !== 'cat' && usedCues(c).has(r.cue)) {
          expect(r.kRmsDbfs, `${id} loudness`).toBeGreaterThanOrEqual(BOUNDS.kRmsMinDbfs);
          expect(r.kRmsDbfs, `${id} loudness`).toBeLessThanOrEqual(BOUNDS.kRmsMaxDbfs);
        }
        expect(Math.abs(r.dcOffset), `${id} DC`).toBeLessThanOrEqual(BOUNDS.dcMax);
        // The absolute end-of-cue level binds the cues a character plays; every cue under every voice is also held to the relative rule below.
        if (usedCues(c).has(r.cue)) expect(r.tailAmp5msDbfs, `${id} tail click`).toBeLessThanOrEqual(BOUNDS.tailMaxDbfs);
        expect(r.tailAmp5msDbfs, `${id} tail click against its own peak`).toBeLessThanOrEqual(r.peakDbfs - BOUNDS.tailBelowPeakDb);
        expect(r.durationVsNominal, `${id} duration`).toBeLessThanOrEqual(BOUNDS.durationVsNominalMax);
        expect(r.leadingSilenceMs, `${id} leading silence`).toBeLessThanOrEqual(BOUNDS.leadingSilenceMaxMs);
      }
    });
  }

  it('the cues of the new characters sit within 3 dB of each other (per-character median of K-weighted loudness)', () => {
    const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const per = CHARACTERS.filter((c) => c.id !== 'cat').map((c) => med(baseline.results.filter((r) => r.character === c.id && usedCues(c).has(r.cue)).map((r) => r.kRmsDbfs)));
    expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(3);
  });
});
