// Page entry of the offline audio review (bundled by esbuild): renders the REAL recipes of
// src/renderer/overlay/sound.ts through an OfflineAudioContext, one cue + character at a time.
'use strict';
const { SOUND_CUES } = require('../src/shared/cat');
const { CHARACTERS } = require('../src/shared/characters/registry');
const { renderCueOn, cueOutputGain, CUE_DURATION_S } = require('../src/renderer/overlay/sound');
const { createRecorder, describeGraph } = require('./audio-fingerprint.cjs');

const SR = 48000;
const T0 = 0.01; // the player schedules at currentTime + 0.01
const TAIL = 0.4;

function b64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

window.__au = {
  info: () => ({
    sr: SR,
    t0: T0,
    cues: SOUND_CUES.slice(),
    durations: CUE_DURATION_S,
    characters: CHARACTERS.map((c) => ({ id: c.id, sound: c.sound })),
  }),
  async render(character, cue, volume) {
    const dur = CUE_DURATION_S[cue];
    const off = new OfflineAudioContext(1, Math.ceil((T0 + dur + TAIL) * SR), SR);
    const out = off.createGain();
    out.gain.value = cueOutputGain(volume, character);
    out.connect(off.destination);
    renderCueOn(off, cue, out, T0, character);
    const buf = await off.startRendering();
    return b64(buf.getChannelData(0));
  },
  fingerprint(character, cue) {
    const rec = createRecorder();
    const out = rec.ctx.createGain();
    out.gain.value = cueOutputGain(1, character);
    out.connect(rec.ctx.destination);
    renderCueOn(rec.ctx, cue, out, T0, character);
    return describeGraph(rec.nodes);
  },
};
