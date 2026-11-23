// Pure DSP for the offline audio review (no Electron, no Web Audio): 16-bit mono WAV encoding and the
// objective per-cue analysis. Unit-tested in tests/unit/renderer/soundAnalysis.test.ts.
'use strict';

/** Samples below this absolute level (-60 dBFS) count as silence for the active span. */
const SILENCE = 0.001;
const CLIP = 0.999;

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const dbPower = (p) => (p > 0 ? 10 * Math.log10(p) : -Infinity);

function encodeWav16(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2);
  }
  return buf;
}

function biquad(x, b, a) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    y[i] = v;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
  }
  return y;
}

/** ITU-R BS.1770 K-weighting (48 kHz coefficients: high shelf then RLB high-pass). Only valid at 48000 Hz. */
function kWeight(x) {
  const s1 = biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  return biquad(s1, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const BANDS = [
  ['<200 Hz', 0, 200],
  ['200-800 Hz', 200, 800],
  ['0.8-2 kHz', 800, 2000],
  ['2-5 kHz', 2000, 5000],
  ['5-10 kHz', 5000, 10000],
  ['>10 kHz', 10000, Infinity],
];

function spectrum(x, sr) {
  let n = 1024;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, x.length - 1)));
  fft(re, im);
  const half = n / 2;
  const bandE = BANDS.map(() => 0);
  let sumP = 0;
  let sumFP = 0;
  let peakP = 0;
  let peakF = 0;
  for (let k = 1; k < half; k++) {
    const f = (k * sr) / n;
    const p = re[k] * re[k] + im[k] * im[k];
    sumP += p;
    sumFP += f * p;
    if (p > peakP) {
      peakP = p;
      peakF = f;
    }
    for (let b = 0; b < BANDS.length; b++) {
      if (f >= BANDS[b][1] && f < BANDS[b][2]) {
        bandE[b] += p;
        break;
      }
    }
  }
  let best = 0;
  for (let b = 1; b < bandE.length; b++) if (bandE[b] > bandE[best]) best = b;
  return { centroidHz: sumP > 0 ? sumFP / sumP : 0, peakHz: peakF, dominantBand: sumP > 0 ? BANDS[best][0] : 'none' };
}

/**
 * Objective numbers for one rendered cue. `samples` start at the render origin; the cue was scheduled at
 * `t0` (s) for `dur` (s, CUE_DURATION_S). Loudness figures are over the active span (first to last sample above
 * -60 dBFS) so a long silent tail does not flatter a cue.
 */
function analyse(samples, sr, t0, dur) {
  const n = samples.length;
  let peak = 0;
  let first = -1;
  let last = -1;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= CLIP) clipped++;
    if (a > SILENCE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) {
    return {
      silent: true,
      nearSilent: true,
      peakDbfs: db(peak),
      rmsDbfs: -Infinity,
      kRmsDbfs: -Infinity,
      clippedSamples: clipped,
      dcOffset: 0,
      activeStartS: null,
      activeEndS: null,
      leadingSilenceMs: null,
      trailingSilenceMs: null,
      durationVsNominal: null,
      tailAmp5msDbfs: -Infinity,
      centroidHz: 0,
      peakHz: 0,
      dominantBand: 'none',
    };
  }
  const act = Float64Array.from(samples.subarray(first, last + 1));
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < act.length; i++) {
    sum += act[i];
    sq += act[i] * act[i];
  }
  const k = kWeight(act);
  let ksq = 0;
  for (let i = 0; i < k.length; i++) ksq += k[i] * k[i];
  const endIdx = Math.round((t0 + dur) * sr);
  let tail = 0;
  for (let i = Math.max(0, endIdx - Math.round(0.005 * sr)); i < Math.min(n, endIdx); i++) tail = Math.max(tail, Math.abs(samples[i]));
  const sp = spectrum(act, sr);
  const kRms = dbPower(ksq / act.length);
  return {
    silent: false,
    nearSilent: kRms < -60,
    peakDbfs: db(peak),
    rmsDbfs: dbPower(sq / act.length),
    kRmsDbfs: kRms,
    clippedSamples: clipped,
    dcOffset: sum / act.length,
    activeStartS: first / sr,
    activeEndS: (last + 1) / sr,
    leadingSilenceMs: (first / sr - t0) * 1000,
    trailingSilenceMs: Math.max(0, t0 + dur - (last + 1) / sr) * 1000,
    /** Audible length divided by the nominal CUE_DURATION_S (about <= 1: nothing outlasts its slot). */
    durationVsNominal: ((last + 1) / sr - first / sr) / dur,
    /** Peak |sample| in the last 5 ms before the cue's scheduled end (a click would show here). */
    tailAmp5msDbfs: db(tail),
    centroidHz: sp.centroidHz,
    peakHz: sp.peakHz,
    dominantBand: sp.dominantBand,
  };
}

module.exports = { encodeWav16, kWeight, analyse, spectrum, BANDS, SILENCE, CLIP };
