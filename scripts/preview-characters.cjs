// Visual QA for any character's overlay renderer (character-generic sibling of render-preview.cjs, which
// stays the cat's tool and is untouched).
//
//   node scripts/with-lock.mjs preview-chars -- npx electron scripts/preview-characters.cjs --character=<id|all>
//        [--sheet=clips|skins|pixel|motion|poses|focus|accessory|all  (comma list ok)] [--dpr=1|1.25|2]
//        [--out=<base dir>] [--stride=<ticks between motion frames, default 4>]
//
// Sheets are rendered through createCharacterRenderer(id, seeded random) and the real CatScene, with the
// scene's bounds (cyan) and hit rects (magenta, indexed) drawn on every cell. PNGs go to
// <out>/<id>/ (default out/preview-characters/<id>/). Until a character has its own renderer the registry
// returns the cat's: the tool prints which renderer class is used. Uses a temporary userData dir and
// software rendering, never sends OS input, and always exits (hard timeout).
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pageSrc = path.join(__dirname, 'preview-page');
const pageOut = path.join(root, 'out', 'preview-page-characters');

const argv = process.argv.slice(2);
const arg = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const outBase = arg('out') ? path.resolve(arg('out')) : path.join(root, 'out', 'preview-characters');
const characterArg = arg('character') || 'cat';
const sheetArg = (arg('sheet') || 'all').split(',').filter(Boolean);
const dpr = Number(arg('dpr') || '1') || 1;
const stride = Math.max(1, Math.round(Number(arg('stride') || '4') || 4));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcat-preview-chars-'));
app.setPath('userData', tmp);
app.disableHardwareAcceleration();

const killer = setTimeout(() => {
  console.error('preview-characters: timed out');
  app.exit(2);
}, 540000);

async function bundle() {
  const esbuild = require('esbuild');
  fs.mkdirSync(pageOut, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(pageSrc, 'characters.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome150',
    outfile: path.join(pageOut, 'characters.js'),
    define: { __DEV__: 'true', __APP_VERSION__: '"preview"' },
    logLevel: 'warning',
  });
  fs.copyFileSync(path.join(pageSrc, 'characters.html'), path.join(pageOut, 'characters.html'));
}

async function main() {
  await app.whenReady();
  await bundle();
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`[page] ${e.message}`);
  });
  await win.loadFile(path.join(pageOut, 'characters.html'));
  const js = (code) => win.webContents.executeJavaScript(code);
  const ids = await js('window.__cp.ids()');
  const allKinds = await js('window.__cp.kinds()');
  const chars = characterArg === 'all' ? ids : characterArg.split(',');
  for (const c of chars) if (!ids.includes(c)) throw new Error(`unknown character '${c}' (known: ${ids.join(', ')})`);
  const kinds = sheetArg.includes('all') ? allKinds : sheetArg;
  for (const k of kinds) if (!allKinds.includes(k)) throw new Error(`unknown sheet '${k}' (known: ${allKinds.join(', ')}, all)`);
  for (const id of chars) {
    const info = await js(`window.__cp.info(${JSON.stringify(id)})`);
    console.log(
      `preview-characters: ${id}: renderer ${info.renderer} (id ${info.rendererId}); hasOwnRenderer=${info.own}` +
        (info.own ? '' : ' -> CAT FALLBACK, not a character-specific renderer') +
        (id !== 'cat' && info.renderer === 'CatRenderer' ? ' -> WARNING: still the cat renderer class (placeholder), sheets show the cat' : '') +
        `; ${info.skins.length} skins, ${info.clips.length} module clips`,
    );
    const names = await js(`window.__cp.build(${JSON.stringify(id)}, ${JSON.stringify(kinds)}, ${stride})`);
    const dir = path.join(outBase, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of names) {
      const t0 = Date.now();
      const url = String(await js(`window.__cp.render(${JSON.stringify(name)}, ${dpr})`));
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      const file = path.join(dir, `${name}.png`);
      fs.writeFileSync(file, buf);
      console.log(`preview-characters: ${path.relative(root, file)} ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} (${Date.now() - t0} ms)`);
    }
  }
  win.destroy();
}

function finish(code) {
  clearTimeout(killer);
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* Chromium may still hold files in the temp profile; the OS cleans %TEMP%. */
  }
  app.exit(code);
}

main().then(
  () => finish(0),
  (err) => {
    console.error('preview-characters: failed:', err && err.stack ? err.stack : err);
    finish(1);
  },
);
