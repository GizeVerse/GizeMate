#!/usr/bin/env node
// Per-character smoke test of the PACKAGED app (fuses on, so Playwright cannot drive it), modelled on
// scripts/smoke-packaged.mjs. For each of the seven characters it launches the given exe ONCE with a fresh
// temporary userData directory (DESKTOP_CAT_USER_DATA), DESKTOP_CAT_LOGIN_ITEM=off (the HKCU Run entry is
// never written), and a seeded settings.json (general.activeCharacter = the character, general.language
// alternating 'tr'/'en', firstRunCompleted true so no welcome windows, startupState 'visible'). It waits,
// reads logs/main.log, asserts there are no error-level lines and no login-item writes, that the process
// stays alive, then stops ONLY the PID tree it started (a polite taskkill first, forced only if the
// process ignores it) and re-reads settings.json and characters/<id>.json after the stop.
//
// What it proves and what it does not: the app accepted the seeded settings (settings.json still names
// the character after the run: the app did not reset it) and started without error lines. The log has no
// line naming the active character, so "expected character in log" is checked only when such a line
// exists; the per-character state file (characters/<id>.json, cat: cat-state.json) is written by an
// autosave (60 s) or at shutdown and is REPORTED, not required, because a forced stop skips the save.
// Nothing here looks at pixels: that the right character is DRAWN is not verified by this script.
//
//   node scripts/with-lock.mjs smoke-chars -- node scripts/smoke-packaged-characters.mjs [exe] [--wait-ms 12000] [--only fox,cat] [--json out.json]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHARACTER_IDS = ['cat', 'monkey', 'fox', 'rabbit', 'ghost', 'slime', 'alien'];
export const SETTINGS_SCHEMA_VERSION = 3;

/** Language per run: alternating, so both 'tr' and 'en' are exercised (tr for the 1st, 3rd, ... character). */
export function languageFor(index) {
  return index % 2 === 0 ? 'tr' : 'en';
}

/** The seeded settings.json: only the fields that matter; every other field takes its schema default. */
export function seedSettings(character, language) {
  if (!CHARACTER_IDS.includes(character)) throw new Error(`unknown character ${character}`);
  if (language !== 'en' && language !== 'tr') throw new Error(`unsupported language ${language}`);
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    general: { activeCharacter: character, language, firstRunCompleted: true, startupState: 'visible' },
  };
}

/** Parse main.log (one JSON object per line); a non-JSON line becomes { l: 'unparsable' }. */
export function parseLog(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        const rec = JSON.parse(line);
        return rec !== null && typeof rec === 'object' ? rec : { l: 'unparsable', m: line.slice(0, 120) };
      } catch {
        return { l: 'unparsable', m: line.slice(0, 120) };
      }
    });
}

/** Counts and the interesting lines of a parsed log. */
export function summarizeLog(lines, character) {
  const text = (l) => `${l.s ?? ''}: ${l.m ?? ''}`;
  const started = lines.find((l) => l.m === 'started');
  const mentions = lines.filter((l) => JSON.stringify(l.d ?? '').includes(`"${character}"`) || /character/i.test(String(l.m ?? '')));
  const reconciled = lines.filter((l) => l.m === 'login item reconciled').map((l) => l.d ?? {});
  return {
    lines: lines.length,
    errors: lines.filter((l) => l.l === 'error').map(text),
    warnings: lines.filter((l) => l.l === 'warn').map(text),
    unparsable: lines.filter((l) => l.l === 'unparsable').length,
    started: Boolean(started),
    startState: started?.d?.startState ?? null,
    characterLines: mentions.map(text).slice(0, 5),
    characterNamedInLog: lines.some((l) => JSON.stringify(l.d ?? '').includes(`"${character}"`)),
    characterStateRecovered: lines.some((l) => l.m === 'character state recovered'),
    loginItemWrites: lines.filter((l) => l.m === 'login item written').length,
    loginItemGateClosedByEnv: reconciled.length === 0 || reconciled.every((d) => Array.isArray(d.gate) && d.gate.includes('env-off')),
  };
}

/** userData-relative state file of a character (the cat keeps cat-state.json). */
export function stateFileFor(character) {
  return character === 'cat' ? 'cat-state.json' : path.join('characters', `${character}.json`);
}

/** Verdict of one run: { ok, problems[] }. `r` is what runOne returns. */
export function evaluate(r) {
  const problems = [];
  if (!r.aliveAtCheck) problems.push('process did not stay alive');
  if (r.log.errors.length > 0) problems.push(`error-level log lines: ${r.log.errors.slice(0, 3).join(' | ')}`);
  if (!r.log.started) problems.push('no "started" log line');
  if (r.log.startState !== null && r.log.startState !== 'visible') problems.push(`start state ${r.log.startState}, expected visible`);
  if (r.log.loginItemWrites > 0) problems.push('login item was written');
  if (!r.log.loginItemGateClosedByEnv) problems.push('login item gate not closed by env');
  if (r.log.characterStateRecovered) problems.push('character state was recovered (unexpected on a fresh userData)');
  if (r.settingsAfter === null) problems.push('settings.json missing or unreadable after the run');
  else if (r.settingsAfter.activeCharacter !== r.character) problems.push(`settings.json activeCharacter is ${r.settingsAfter.activeCharacter} after the run, expected ${r.character}`);
  else if (r.settingsAfter.language !== r.language) problems.push(`settings.json language is ${r.settingsAfter.language} after the run, expected ${r.language}`);
  if (!r.stop.exited) problems.push('process did not exit after the stop');
  return { ok: problems.length === 0, problems };
}

/** Plain-text table. */
export function formatTable(rows) {
  const head = ['character', 'lang', 'alive', 'log', 'err', 'warn', 'in-log', 'state file', 'stop', 'verdict'];
  const body = rows.map((r) => [
    r.character,
    r.language,
    r.aliveAtCheck ? 'yes' : 'NO',
    String(r.log.lines),
    String(r.log.errors.length),
    String(r.log.warnings.length),
    r.log.characterNamedInLog ? 'yes' : 'no',
    r.stateFile.existsAfterStop ? 'written' : 'absent',
    r.stop.graceful ? 'graceful' : r.stop.exited ? 'forced' : 'LEFT',
    r.verdict.ok ? 'PASS' : 'FAIL',
  ]);
  const all = [head, ...body];
  const widths = head.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all.map((row) => row.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n');
}

export function parseArgs(argv) {
  const o = { exe: null, waitMs: 12000, only: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--wait-ms') o.waitMs = Number(next());
    else if (a === '--only') o.only = next().split(',').filter(Boolean);
    else if (a === '--json') o.json = next();
    else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else o.exe = a;
  }
  if (!Number.isFinite(o.waitMs) || o.waitMs < 1000) throw new Error('--wait-ms must be a number of at least 1000');
  if (o.only) for (const c of o.only) if (!CHARACTER_IDS.includes(c)) throw new Error(`--only: unknown character ${c}`);
  return o;
}

// ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function runOne(exe, character, language, waitMs) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `gmchar-${character}-`));
  fs.writeFileSync(path.join(userData, 'settings.json'), `${JSON.stringify(seedSettings(character, language), null, 2)}\n`);
  const env = { ...process.env, DESKTOP_CAT_USER_DATA: userData, DESKTOP_CAT_LOGIN_ITEM: 'off' };
  const child = spawn(exe, [], { env, stdio: 'ignore', detached: false });
  let exitCode = null;
  let exited = false;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });
  const result = { character, language, userData: null };
  try {
    await sleep(waitMs);
    result.aliveAtCheck = !exited && pidAlive(child.pid);
    result.logText = (() => {
      try {
        return fs.readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8');
      } catch {
        return '';
      }
    })();
    result.stateBeforeStop = fs.existsSync(path.join(userData, stateFileFor(character)));
  } finally {
    // Polite first (WM_CLOSE to this PID tree only), forced only if it ignores that.
    let graceful = false;
    if (!exited) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T'], { stdio: 'ignore' });
      for (let i = 0; i < 20 && !exited; i++) await sleep(500);
      graceful = exited;
    }
    if (!exited) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      for (let i = 0; i < 10 && !exited; i++) await sleep(500);
    }
    result.stop = { graceful, exited, exitCode };
    await sleep(500);
  }
  const lines = parseLog(result.logText ?? '');
  delete result.logText;
  result.log = summarizeLog(lines, character);
  const settingsAfter = readJson(path.join(userData, 'settings.json'));
  result.settingsAfter = settingsAfter ? { activeCharacter: settingsAfter.general?.activeCharacter, language: settingsAfter.general?.language } : null;
  result.stateFile = { path: stateFileFor(character).split(path.sep).join('/'), existsBeforeStop: Boolean(result.stateBeforeStop), existsAfterStop: fs.existsSync(path.join(userData, stateFileFor(character))) };
  delete result.stateBeforeStop;
  result.userDataFiles = fs.readdirSync(userData).sort();
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  result.userData = path.basename(userData);
  result.verdict = evaluate(result);
  return result;
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`smoke-characters: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const exe = opts.exe ? path.resolve(opts.exe) : path.join(root, 'release', 'win-unpacked', 'DesktopCat.exe');
  if (!fs.existsSync(exe)) {
    console.error(`smoke-characters: ${exe} not found`);
    return 2;
  }
  // Refuse a stale build (same rule as smoke-packaged.mjs).
  const { fileReader, readAsarFile, readAsarHeader } = await import('./check-win-payload.mjs');
  const asarPath = path.join(path.dirname(exe), 'resources', 'app.asar');
  let appVersion = null;
  if (fs.existsSync(asarPath)) {
    const r = fileReader(asarPath);
    try {
      const bytes = readAsarFile(r, readAsarHeader(r), 'package.json');
      appVersion = bytes ? JSON.parse(bytes.toString('utf8')).version : null;
    } finally {
      r.close();
    }
  }
  const repoVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (appVersion !== repoVersion) {
    console.error(`smoke-characters: build is ${appVersion}, repository is ${repoVersion}; refusing`);
    return 2;
  }
  const ids = opts.only ?? CHARACTER_IDS;
  const rows = [];
  for (const id of ids) {
    const index = CHARACTER_IDS.indexOf(id);
    rows.push(await runOne(exe, id, languageFor(index), opts.waitMs));
    console.error(`smoke-characters: ${id} ${rows.at(-1).verdict.ok ? 'PASS' : `FAIL (${rows.at(-1).verdict.problems.join('; ')})`}`);
  }
  console.log(formatTable(rows));
  const report = { exe: path.relative(root, exe), appVersion, waitMs: opts.waitMs, rows };
  if (opts.json) fs.writeFileSync(opts.json, `${JSON.stringify(report, null, 2)}\n`);
  return rows.every((r) => r.verdict.ok) ? 0 : 1;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invoked.toLowerCase() === import.meta.url.toLowerCase()) process.exitCode = await main(process.argv.slice(2));
