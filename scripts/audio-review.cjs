// Offline audio review: renders every cue under every character voice through the REAL recipes of
// src/renderer/overlay/sound.ts (OfflineAudioContext, no sound card, no OS input), writes 16-bit mono WAVs for
// the owner to audition and an objective analysis. Nothing here is a listening test.
//
//   node scripts/with-lock.mjs audio-review -- npx electron scripts/audio-review.cjs [--out=<dir>] [--volume=1]
//        [--baseline=<json path>  write the compact baseline the unit test asserts against]
//
// Output: <out>/<character>/<cue>.wav, <out>/index.html (audio controls), <out>/analysis.json.
// Default out: out/audio-review. A temp userData dir and software rendering are used; hard timeout.
'use strict';
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeWav16, analyse } = require('./audio-dsp.cjs');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const outBase = arg('out') ? path.resolve(arg('out')) : path.join(root, 'out', 'audio-review');
const volume = Number(arg('volume') || '1');
/** JSON cannot hold -Infinity (a perfectly silent tail in dBFS): write it as the -200 dBFS floor instead of null. */
const FLOOR = (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (v < 0 ? -200 : 200) : v);
const baselinePath = arg('baseline') ? path.resolve(arg('baseline')) : null;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcat-audio-review-'));
app.setPath('userData', tmp);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const killer = setTimeout(() => {
  console.error('audio-review: timed out');
  app.exit(2);
}, 300000);

async function bundle(pageDir) {
  const esbuild = require('esbuild');
  fs.mkdirSync(pageDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'audio-page.cjs')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome150',
    outfile: path.join(pageDir, 'audio-page.js'),
    define: { __DEV__: 'true', __APP_VERSION__: '"audio-review"' },
    logLevel: 'warning',
  });
  fs.writeFileSync(path.join(pageDir, 'audio-page.html'), '<!doctype html><meta charset="utf-8"><script src="audio-page.js"></script>');
}

const f = (v, d = 1) => (v === null || v === undefined ? '-' : Number.isFinite(v) ? v.toFixed(d) : String(v));

async function main() {
  await app.whenReady();
  const pageDir = path.join(tmp, 'page');
  await bundle(pageDir);
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`[page] ${e.message}`);
  });
  await win.loadFile(path.join(pageDir, 'audio-page.html'));
  const js = (code) => win.webContents.executeJavaScript(code);
  const info = await js('window.__au.info()');
  const results = [];
  for (const ch of info.characters) {
    fs.mkdirSync(path.join(outBase, ch.id), { recursive: true });
    for (const cue of info.cues) {
      const b64 = await js(`window.__au.render(${JSON.stringify(ch.id)}, ${JSON.stringify(cue)}, ${volume})`);
      const bytes = Buffer.from(b64, 'base64');
      const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const a = analyse(samples, info.sr, info.t0, info.durations[cue]);
      const fp = crypto.createHash('sha256').update(String(await js(`window.__au.fingerprint(${JSON.stringify(ch.id)}, ${JSON.stringify(cue)})`))).digest('hex').slice(0, 16);
      fs.writeFileSync(path.join(outBase, ch.id, `${cue}.wav`), encodeWav16(samples, info.sr));
      results.push({ character: ch.id, cue, nominalDurationS: info.durations[cue], fp, ...a });
    }
  }
  const profiles = info.characters.map((c) => ({ id: c.id, ...c.sound }));
  fs.writeFileSync(path.join(outBase, 'analysis.json'), JSON.stringify({ sampleRate: info.sr, volume, note: 'analysed objectively, not heard by the author; WAVs are for the owner to audition', profiles, results }, FLOOR, 2));

  const rows = results
    .map((r) => `<tr><td>${r.cue}</td><td><audio controls preload="none" src="${r.character}/${r.cue}.wav"></audio></td><td>${f(r.kRmsDbfs)}</td><td>${f(r.peakDbfs)}</td><td>${f(r.centroidHz, 0)}</td><td>${r.dominantBand}</td></tr>`);
  let html = '<!doctype html><meta charset="utf-8"><title>GizeMate audio review</title><style>body{font:14px system-ui;margin:16px}td,th{padding:2px 8px;text-align:left}h2{margin-top:24px}</style><h1>GizeMate audio review</h1><p>Rendered offline from the real recipes at volume ' + volume + ' (after the 0.35 master and the character gain). Analysed objectively, not heard by the author: please audition. Audio is off by default in the app.</p>';
  for (const ch of info.characters) {
    html += `<h2>${ch.id} (voice ${ch.sound.voice}, pitch ${ch.sound.pitch}, gain ${ch.sound.gain})</h2><table><tr><th>cue</th><th>play</th><th>K-RMS dBFS</th><th>peak dBFS</th><th>centroid Hz</th><th>band</th></tr>`;
    html += rows.filter((_, i) => results[i].character === ch.id).join('') + '</table>';
  }
  fs.writeFileSync(path.join(outBase, 'index.html'), html);

  if (baselinePath) {
    const keep = ['silent', 'nearSilent', 'peakDbfs', 'kRmsDbfs', 'clippedSamples', 'dcOffset', 'leadingSilenceMs', 'trailingSilenceMs', 'durationVsNominal', 'tailAmp5msDbfs', 'centroidHz', 'dominantBand', 'activeEndS'];
    const base = results.map((r) => {
      const o = { character: r.character, cue: r.cue, fp: r.fp };
      for (const k of keep) o[k] = typeof r[k] === 'number' ? Math.round(r[k] * 1000) / 1000 : r[k];
      return o;
    });
    fs.writeFileSync(baselinePath, JSON.stringify({ sampleRate: info.sr, volume, results: base }, FLOOR, 1) + '\n');
  }

  console.log('character cue kRMS peak clip dc(1e-3) lead_ms trail_ms dur/nom tail5ms centroid band');
  for (const r of results) {
    console.log(`${r.character.padEnd(7)} ${r.cue.padEnd(8)} ${f(r.kRmsDbfs).padStart(7)} ${f(r.peakDbfs).padStart(7)} ${String(r.clippedSamples).padStart(3)} ${f(r.dcOffset * 1000, 2).padStart(7)} ${f(r.leadingSilenceMs, 0).padStart(5)} ${f(r.trailingSilenceMs, 0).padStart(5)} ${f(r.durationVsNominal, 2).padStart(5)} ${f(r.tailAmp5msDbfs, 0).padStart(6)} ${f(r.centroidHz, 0).padStart(6)} ${r.dominantBand}`);
  }
  win.destroy();
}

function finish(code) {
  clearTimeout(killer);
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* the OS cleans %TEMP% */
  }
  app.exit(code);
}

main().then(
  () => finish(0),
  (err) => {
    console.error('audio-review: failed:', err && err.stack ? err.stack : err);
    finish(1);
  },
);
