#!/usr/bin/env node
// Static inspection of a Windows NSIS installer and its packaged payload. NOTHING IS EXECUTED from the
// installer or the payload: the installer is opened with the 7-Zip extractor that ships inside
// node_modules/electron-winstaller/vendor (copied to a temp tool folder, because the vendor files are
// named 7z-x64.exe/7z-x64.dll and 7-Zip wants 7z.dll), into a fresh temp directory outside the repo
// that is deleted afterwards. Re-runnable against any build.
//
//   node scripts/with-lock.mjs inspect -- node scripts/inspect-installer.mjs --installer <setup.exe> --arch <x64|arm64>
//        [--unpacked <win-unpacked dir>] [--expect-sha <hex>] [--expect-size <bytes>]
//        [--baseline-ref 3d247af] [--out <file.json>] [--keep]
//
// Sections of the JSON result: file (sha256, size, expectation), config (field-by-field diff of
// electron-builder.yml against a git ref, classified; build/installer.nsh identity; the NSIS GUID
// derivation), nsis (static reading of installer.nsh and of electron-builder's uninstaller template
// for user-data deletion), payload (extracted file list, forbidden files, comparison with the
// unpacked folder, exe VersionInfo, PE imports, check-win-payload result), exit code 1 on any failure.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARCHES, checkPayload, fileReader, readAsarHeader, readPe, rvaToOffset, walkAsar } from './check-win-payload.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested).

/** Flatten parsed YAML into { 'a.b.c': value, 'list[0]': value }; arrays are kept as JSON leaves. */
export function flattenConfig(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flattenConfig(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = JSON.stringify(value);
  }
  return out;
}

/** Keys whose change would alter install identity or upgrade behaviour. Anything else is a display/other difference. */
export const IDENTITY_KEY = [
  /^appId$/,
  /^productName$/,
  /^win\.(executableName|target|icon|requestedExecutionLevel|extraResources|asarUnpack|files)$/,
  /^nsis\./,
  /^electronFuses\./,
  /^asar$/,
  /^electronVersion$/,
  /^extraMetadata\./,
  /^directories\./,
  /^(linux|mac)\.(executableName|artifactName|target|category|hardenedRuntime|entitlements|entitlementsInherit|files|asarUnpack)$/,
];

/** { key, before, after, kind }: kind 'identity-risk' (needs review) or 'display' (strings users read). */
export function diffConfigs(before, after) {
  const a = flattenConfig(before);
  const b = flattenConfig(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs = [];
  for (const key of keys) {
    if (a[key] === b[key]) continue;
    const identity = IDENTITY_KEY.some((re) => re.test(key));
    diffs.push({ key, before: a[key] ?? '(absent)', after: b[key] ?? '(absent)', kind: identity ? 'identity-risk' : 'display' });
  }
  return diffs;
}

/** Windows-section frozen identity fields, read from a parsed config (the upgrade-relevant set). */
export function identityFields(cfg) {
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const keys = [
    'appId', 'productName', 'win.executableName', 'win.requestedExecutionLevel', 'nsis.oneClick', 'nsis.perMachine', 'nsis.allowElevation',
    'nsis.allowToChangeInstallationDirectory', 'nsis.createDesktopShortcut', 'nsis.createStartMenuShortcut', 'nsis.shortcutName', 'nsis.runAfterFinish',
    'nsis.deleteAppDataOnUninstall', 'nsis.uninstallDisplayName', 'nsis.artifactName', 'nsis.buildUniversalInstaller', 'nsis.guid', 'nsis.include',
    'win.asarUnpack', 'win.extraResources', 'asar', 'copyright',
  ];
  return Object.fromEntries(keys.map((k) => [k, get(cfg, k) === undefined ? '(unset: electron-builder default)' : JSON.stringify(get(cfg, k))]));
}

/** electron-builder's NSIS GUID: UUID v5 of the appId in electron-builder's namespace unless nsis.guid is set. */
export function nsisGuid(cfg, uuidV5, namespace) {
  return cfg?.nsis?.guid || uuidV5(cfg.appId, namespace);
}

/** Paths that must not ship as standalone files. node_modules is judged separately (a dependency's own docs/maps). */
export const FORBIDDEN = [
  { re: /\.map$/i, why: 'source map' },
  { re: /(^|\/)\.env(\.|$)/i, why: '.env file' },
  { re: /(^|\/)secrets?(\/|$)/i, why: 'secrets folder' },
  { re: /(^|\/)[^/]*payload[^/]*$/i, why: 'payload file' },
  { re: /\.(pem|pfx|p12|key|cer)$/i, why: 'key or certificate' },
  { re: /\.(ts|tsx)$/i, why: 'TypeScript source (declaration files excluded below)' },
  { re: /(^|\/)(tests?|__tests__|e2e|playwright-report|\.claude|\.git)(\/|$)/i, why: 'test or dev folder' },
  { re: /(^|\/)(cat-state|settings)\.json$/i, why: 'user-data file' },
];

/** Split a path list into { hits (outside node_modules), dependencyHits (inside node_modules) }. */
export function findForbidden(paths) {
  const hits = [];
  const dependencyHits = [];
  for (const p of paths) {
    const norm = p.split('\\').join('/');
    if (/\.d\.ts$/i.test(norm)) continue;
    for (const f of FORBIDDEN) {
      if (!f.re.test(norm)) continue;
      // Windows packages carry LICENSE-like dependency files named .key etc.; keep them separate.
      (/(^|\/)node_modules\//.test(norm) ? dependencyHits : hits).push({ path: norm, why: f.why });
      break;
    }
  }
  return { hits, dependencyHits };
}

/** Lines of installer.nsh that delete or remove something outside the install dir (data-safety review). */
export function nsisDeletionStatements(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/;.*$/, '').trim();
    if (/^(RMDir|Delete|DeleteRegKey|DeleteRegValue|RMDir\s+\/r)\b/i.test(code)) out.push({ line: i + 1, text: code });
  });
  return out;
}

/** Imported DLL names of a PE image (import directory), for the runtime-dependency check. */
export function peImports(r) {
  const pe = readPe(r);
  const dir = pe.dataDirs[1];
  if (!dir || dir.rva === 0) return [];
  const names = [];
  let off = rvaToOffset(pe, dir.rva);
  if (off === null) return [];
  for (let i = 0; i < 512; i++, off += 20) {
    const d = r.read(off, 20);
    if (d.length < 20) break;
    const nameRva = d.readUInt32LE(12);
    if (nameRva === 0) break;
    const nameOff = rvaToOffset(pe, nameRva);
    if (nameOff === null) continue;
    const raw = r.read(nameOff, 128);
    const end = raw.indexOf(0);
    names.push(raw.subarray(0, end < 0 ? raw.length : end).toString('latin1'));
  }
  return names;
}

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

export function listFiles(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(path.relative(dir, p).split(path.sep).join('/'), fs.statSync(p).size);
    }
  };
  walk(dir);
  return out;
}

export function compareTrees(a, b) {
  const onlyA = [...a.keys()].filter((k) => !b.has(k)).sort();
  const onlyB = [...b.keys()].filter((k) => !a.has(k)).sort();
  const sizeDiffs = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)).map((k) => ({ path: k, a: a.get(k), b: b.get(k) }));
  return { onlyA, onlyB, sizeDiffs };
}

export function parseArgs(argv) {
  const o = { installer: null, arch: null, unpacked: null, expectSha: null, expectSize: null, baselineRef: '3d247af', out: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--installer') o.installer = next();
    else if (a === '--arch') o.arch = next();
    else if (a === '--unpacked') o.unpacked = next();
    else if (a === '--expect-sha') o.expectSha = next().toLowerCase();
    else if (a === '--expect-size') o.expectSize = Number(next());
    else if (a === '--baseline-ref') o.baselineRef = next();
    else if (a === '--out') o.out = next();
    else if (a === '--keep') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.installer) throw new Error('--installer is required');
  if (!o.arch || !Object.hasOwn(ARCHES, o.arch)) throw new Error(`--arch must be one of ${Object.keys(ARCHES).join(', ')}`);
  return o;
}

// ---------------------------------------------------------------------------------------------
// Impure steps.

function gitShow(ref, file) {
  const r = spawnSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git show ${ref}:${file} failed: ${r.stderr}`);
  return r.stdout;
}

function loadYaml(text) {
  const yaml = require('js-yaml');
  return yaml.load(text);
}

function builderNamespace() {
  const src = fs.readFileSync(path.join(root, 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js'), 'utf8');
  const m = /ELECTRON_BUILDER_NS_UUID\s*=\s*(?:builder_util_runtime_1\.)?(?:UUID\.parse\()?["']([0-9a-f-]{36})["']/i.exec(src) ?? /["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/i.exec(src);
  return m ? m[1] : null;
}

function configSection(opts) {
  const baseText = gitShow(opts.baselineRef, 'electron-builder.yml');
  const baseNsh = gitShow(opts.baselineRef, 'build/installer.nsh');
  const curText = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  const curNsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const base = loadYaml(baseText);
  const cur = loadYaml(curText);
  const diffs = diffConfigs(base, cur);
  const out = {
    baselineRef: opts.baselineRef,
    differences: diffs,
    identityRiskCount: diffs.filter((d) => d.kind === 'identity-risk').length,
    identityFieldsNow: identityFields(cur),
    identityFieldsBaseline: identityFields(base),
    installerNsh: {
      identical: baseNsh === curNsh,
      sha256Baseline: crypto.createHash('sha256').update(baseNsh).digest('hex'),
      sha256Now: crypto.createHash('sha256').update(curNsh).digest('hex'),
    },
  };
  try {
    const { UUID } = require('builder-util-runtime');
    const ns = builderNamespace();
    const v5 = (name, namespace) => UUID.v5(name, UUID.parse(namespace).constructor === Buffer ? UUID.parse(namespace) : namespace);
    out.nsisGuid = { namespace: ns, baseline: null, now: null };
    // builder-util-runtime accepts a namespace string or a parsed buffer, depending on its version.
    const derive = (cfg) => nsisGuid(cfg, (n, s) => UUID.v5(n, s.length === 16 ? s : UUID.parse(s)), ns);
    out.nsisGuid.baseline = derive(base);
    out.nsisGuid.now = derive(cur);
    out.nsisGuid.equal = out.nsisGuid.baseline === out.nsisGuid.now;
    void v5;
  } catch (e) {
    out.nsisGuid = { error: e instanceof Error ? e.message : String(e), equal: base.appId === cur.appId && !base.nsis?.guid && !cur.nsis?.guid };
  }
  return out;
}

function nsisSection(cfg) {
  const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const tpl = fs.readFileSync(path.join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'uninstaller.nsh'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'node_modules', 'app-builder-lib', 'out', 'targets', 'nsis', 'NsisTarget.js'), 'utf8');
  return {
    deleteAppDataOnUninstall: cfg.nsis?.deleteAppDataOnUninstall,
    // electron-builder defines DELETE_APP_DATA_ON_UNINSTALL only when the option is truthy.
    defineEmittedOnlyWhenTruthy: /if \(options\.deleteAppDataOnUninstall\)\s*\{\s*defines\.DELETE_APP_DATA_ON_UNINSTALL/.test(build),
    templateDeletesUserDataOnlyBehind: /--delete-app-data/.test(tpl) && /!ifdef DELETE_APP_DATA_ON_UNINSTALL/.test(tpl),
    templateRmdirUserData: tpl.split(/\r?\n/).filter((l) => /RMDir \/r "\$APPDATA/.test(l)).map((l) => l.trim()),
    installerNshDeletions: nsisDeletionStatements(nsh),
    installerNshTouchesAppDataFolderOnly: /login-item-removed-by-uninstall/.test(nsh),
  };
}

function find7z(tmp) {
  const vendor = path.join(root, 'node_modules', 'electron-winstaller', 'vendor');
  const tool = path.join(tmp, 'tool');
  fs.mkdirSync(tool, { recursive: true });
  fs.copyFileSync(path.join(vendor, '7z-x64.exe'), path.join(tool, '7z.exe'));
  fs.copyFileSync(path.join(vendor, '7z-x64.dll'), path.join(tool, '7z.dll'));
  return path.join(tool, '7z.exe');
}

function extract(sevenZ, archive, dest) {
  const r = spawnSync(sevenZ, ['x', '-y', `-o${dest}`, archive], { encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`7z failed (${r.status}) on ${archive}: ${(r.stdout || '').slice(-400)} ${r.stderr}`);
}

function versionInfo(exe) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo | ConvertTo-Json -Compress`], { encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr.trim() };
  const v = JSON.parse(r.stdout);
  return Object.fromEntries(['ProductName', 'FileDescription', 'CompanyName', 'FileVersion', 'ProductVersion', 'InternalName', 'OriginalFilename', 'LegalCopyright'].map((k) => [k, v[k] ?? null]));
}

function payloadSection(opts, tmp, failures, warnings) {
  const sevenZ = find7z(tmp);
  const outer = path.join(tmp, 'outer');
  extract(sevenZ, path.resolve(opts.installer), outer);
  const outerFiles = [...listFiles(outer).keys()];
  const appArchive = outerFiles.find((p) => /\$PLUGINSDIR\/app-[^/]+\.7z$/i.test(p));
  if (!appArchive) throw new Error('no $PLUGINSDIR/app-*.7z in the installer');
  const appDir = path.join(tmp, 'app');
  extract(sevenZ, path.join(outer, ...appArchive.split('/')), appDir);
  const files = listFiles(appDir);
  const res = {
    outerFiles,
    appArchive,
    extractedFiles: files.size,
    extractedBytes: [...files.values()].reduce((s, n) => s + n, 0),
    topLevel: [...new Set([...files.keys()].map((k) => k.split('/')[0]))].sort(),
    uninstallerPresent: outerFiles.some((p) => /Uninstall DesktopCat\.exe$/i.test(p)),
  };
  // Forbidden standalone files in the extracted tree (outside app.asar), then inside app.asar.
  const treeScan = findForbidden([...files.keys()].filter((k) => !/^resources\/app\.asar$/.test(k)));
  res.forbiddenStandalone = treeScan.hits;
  res.dependencyHitsStandalone = treeScan.dependencyHits.slice(0, 50);
  if (treeScan.hits.length) failures.push(`forbidden standalone files: ${treeScan.hits.slice(0, 5).map((h) => h.path).join(', ')}`);
  const asarFile = path.join(appDir, 'resources', 'app.asar');
  const ar = fileReader(asarFile);
  try {
    const entries = [...walkAsar(readAsarHeader(ar).header)].filter((e) => !e.dir).map((e) => e.path);
    const scan = findForbidden(entries);
    res.asar = { files: entries.length, forbidden: scan.hits, dependencyHits: scan.dependencyHits.slice(0, 50), nonNodeModulesFiles: entries.filter((p) => !p.startsWith('node_modules/')) };
    if (scan.hits.length) failures.push(`forbidden files inside app.asar: ${scan.hits.slice(0, 5).map((h) => h.path).join(', ')}`);
    if (scan.dependencyHits.length) warnings.push(`${scan.dependencyHits.length} dependency file(s) inside node_modules match the forbidden patterns (see asar.dependencyHits)`);
  } finally {
    ar.close();
  }
  // Exe identity and runtime imports.
  const exe = path.join(appDir, 'DesktopCat.exe');
  res.versionInfo = versionInfo(exe);
  if (res.versionInfo.FileVersion && !String(res.versionInfo.FileVersion).startsWith(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version)) {
    failures.push(`exe FileVersion ${res.versionInfo.FileVersion} differs from package.json version`);
  }
  const er = fileReader(exe);
  try {
    res.imports = peImports(er);
  } finally {
    er.close();
  }
  res.icons = { 'resources/app.asar assets': res.asar.nonNodeModulesFiles.filter((p) => /^assets\/.*\.(ico|png|icns)$/i.test(p)).length, exeHasIconResource: null };
  res.keyHashes = Object.fromEntries(['DesktopCat.exe', 'resources/app.asar', 'resources/native/DesktopCatUia.exe'].filter((k) => files.has(k)).map((k) => [k, sha256File(path.join(appDir, ...k.split('/')))]));
  // Static payload check on the extracted tree (PE machine, koffi, fuses, asar integrity).
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    res.payloadCheck = checkPayload({ arch: opts.arch, dir: appDir, exe: 'DesktopCat.exe', strict: true, out: null, config: null }, root);
  } finally {
    process.chdir(cwd);
  }
  if (!res.payloadCheck.ok) failures.push(`check-win-payload strict failed: ${res.payloadCheck.failures.concat(res.payloadCheck.warnings).join('; ')}`);
  if (opts.unpacked) {
    const unpacked = path.resolve(opts.unpacked);
    const cmp = compareTrees(files, listFiles(unpacked));
    res.versusUnpacked = { dir: path.relative(root, unpacked).split(path.sep).join('/'), onlyInInstaller: cmp.onlyA, onlyInUnpacked: cmp.onlyB, sizeDiffs: cmp.sizeDiffs };
    // The installer packs win-unpacked verbatim; LICENSE/locales etc. must match. Differences are failures.
    if (cmp.onlyA.length || cmp.onlyB.length || cmp.sizeDiffs.length) failures.push('installer payload differs from the unpacked folder (see payload.versusUnpacked)');
    const exeUnpacked = sha256File(path.join(unpacked, 'DesktopCat.exe'));
    res.versusUnpacked.exeSha256Equal = exeUnpacked === res.keyHashes['DesktopCat.exe'];
    if (!res.versusUnpacked.exeSha256Equal) failures.push('DesktopCat.exe differs between installer payload and unpacked folder');
  }
  return res;
}

export function run(opts) {
  const failures = [];
  const warnings = [];
  const installer = path.resolve(opts.installer);
  const stat = fs.statSync(installer);
  const sha = sha256File(installer);
  const result = {
    tool: 'inspect-installer',
    staticOnly: true,
    installer: path.basename(installer),
    arch: opts.arch,
    file: { bytes: stat.size, sha256: sha, expectedSha256: opts.expectSha, expectedBytes: opts.expectSize },
  };
  if (opts.expectSha && opts.expectSha !== sha) failures.push(`sha256 ${sha} differs from expected ${opts.expectSha}`);
  if (opts.expectSize !== null && opts.expectSize !== stat.size) failures.push(`size ${stat.size} differs from expected ${opts.expectSize}`);
  result.config = configSection(opts);
  if (result.config.identityRiskCount > 0) warnings.push(`${result.config.identityRiskCount} identity-risk config difference(s) versus ${opts.baselineRef}: review config.differences`);
  if (!result.config.installerNsh.identical) warnings.push('build/installer.nsh differs from the baseline');
  if (result.config.nsisGuid.equal === false) failures.push('NSIS GUID differs from the baseline: an upgrade would not find the old install');
  result.nsis = nsisSection(loadYaml(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')));
  if (result.nsis.deleteAppDataOnUninstall !== false) failures.push('nsis.deleteAppDataOnUninstall is not false');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gizemate-inspect-'));
  result.tempDir = tmp;
  try {
    result.payload = payloadSection(opts, tmp, failures, warnings);
  } finally {
    if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    result.tempDirRemoved = !opts.keep && !fs.existsSync(tmp);
  }
  result.failures = failures;
  result.warnings = warnings;
  result.ok = failures.length === 0;
  return result;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`inspect-installer: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  let result;
  try {
    result = run(opts);
  } catch (e) {
    console.error(`inspect-installer: ${e instanceof Error ? e.stack : String(e)}`);
    return 2;
  }
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (opts.out) fs.writeFileSync(opts.out, text);
  process.stdout.write(text);
  return result.ok ? 0 : 1;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invoked.toLowerCase() === import.meta.url.toLowerCase()) process.exitCode = main(process.argv.slice(2));
