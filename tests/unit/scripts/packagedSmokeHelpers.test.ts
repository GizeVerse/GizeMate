// Pure helpers of scripts/smoke-packaged-characters.mjs and scripts/inspect-installer.mjs (nothing
// is launched or extracted here). REAL: runs the helpers on literal inputs and on the repository's own
// electron-builder.yml and build/installer.nsh.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS as APP_CHARACTER_IDS } from '../../../src/shared/characters/types';
import { SETTINGS_SCHEMA_VERSION as APP_SCHEMA } from '../../../src/shared/settings';
// @ts-expect-error a plain .mjs script without declarations
import * as smokeModule from '../../../scripts/smoke-packaged-characters.mjs';
// @ts-expect-error a plain .mjs script without declarations
import * as inspectModule from '../../../scripts/inspect-installer.mjs';

interface LogSummary {
  lines: number;
  errors: string[];
  warnings: string[];
  unparsable: number;
  started: boolean;
  startState: string | null;
  characterNamedInLog: boolean;
  characterStateRecovered: boolean;
  loginItemWrites: number;
  loginItemGateClosedByEnv: boolean;
}
const smoke = smokeModule as {
  CHARACTER_IDS: string[];
  SETTINGS_SCHEMA_VERSION: number;
  languageFor(i: number): string;
  seedSettings(c: string, l: string): { schemaVersion: number; general: Record<string, unknown> };
  parseLog(t: string): Array<Record<string, unknown>>;
  summarizeLog(lines: Array<Record<string, unknown>>, c: string): LogSummary;
  stateFileFor(c: string): string;
  evaluate(r: unknown): { ok: boolean; problems: string[] };
  parseArgs(a: string[]): { exe: string | null; waitMs: number; only: string[] | null; json: string | null };
  formatTable(rows: unknown[]): string;
};
const inspect = inspectModule as {
  flattenConfig(v: unknown): Record<string, string>;
  diffConfigs(a: unknown, b: unknown): Array<{ key: string; kind: string; before: string; after: string }>;
  nsisGuid(cfg: unknown, v5: (n: string, ns: string) => string, ns: string): string;
  findForbidden(p: string[]): { hits: Array<{ path: string; why: string }>; dependencyHits: Array<{ path: string }> };
  nsisDeletionStatements(t: string): Array<{ line: number; text: string }>;
  compareTrees(a: Map<string, number>, b: Map<string, number>): { onlyA: string[]; onlyB: string[]; sizeDiffs: unknown[] };
  parseArgs(a: string[]): { installer: string; arch: string; baselineRef: string; keep: boolean };
};

const goodLog = [
  '{"t":1,"l":"info","s":"app","m":"started","d":{"startState":"visible"}}',
  '{"t":2,"l":"info","s":"login","m":"login item reconciled","d":{"rule":"gate-closed","gate":["env-off"]}}',
].join('\n');

function run(over: Record<string, unknown> = {}) {
  const log = smoke.summarizeLog(smoke.parseLog(goodLog), 'fox');
  return {
    character: 'fox',
    language: 'en',
    aliveAtCheck: true,
    log,
    settingsAfter: { activeCharacter: 'fox', language: 'en' },
    stop: { exited: true, graceful: false },
    stateFile: { existsAfterStop: false },
    ...over,
  };
}

describe('smoke-packaged-characters helpers', () => {
  it('covers exactly the roster and the settings schema version of the app', () => {
    expect(smoke.CHARACTER_IDS).toEqual([...APP_CHARACTER_IDS]);
    expect(smoke.SETTINGS_SCHEMA_VERSION).toBe(APP_SCHEMA);
  });

  it('alternates tr and en so both languages run', () => {
    const langs = smoke.CHARACTER_IDS.map((_, i) => smoke.languageFor(i));
    expect(new Set(langs)).toEqual(new Set(['tr', 'en']));
    expect(langs[0]).toBe('tr');
    expect(langs[1]).toBe('en');
  });

  it('seeds a settings file with the character, language, no welcome blocks and a visible start', () => {
    const s = smoke.seedSettings('ghost', 'tr');
    expect(s.schemaVersion).toBe(3);
    expect(s.general).toEqual({ activeCharacter: 'ghost', language: 'tr', firstRunCompleted: true, startupState: 'visible' });
    expect(() => smoke.seedSettings('dog', 'en')).toThrow(/unknown character/);
    expect(() => smoke.seedSettings('cat', 'de')).toThrow(/unsupported language/);
  });

  it('parses the JSON-lines log and tolerates garbage', () => {
    const lines = smoke.parseLog(`${goodLog}\nnot json\n\n42\n`);
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.l === 'unparsable')).toHaveLength(2);
  });

  it('summarises errors, warnings, start state, login item and character mentions', () => {
    const text = [
      goodLog,
      '{"l":"error","s":"x","m":"boom"}',
      '{"l":"warn","s":"y","m":"hmm"}',
      '{"l":"info","s":"app","m":"active character changed","d":{"to":"fox"}}',
      '{"l":"info","s":"login","m":"login item written"}',
    ].join('\n');
    const s = smoke.summarizeLog(smoke.parseLog(text), 'fox');
    expect(s.errors).toEqual(['x: boom']);
    expect(s.warnings).toEqual(['y: hmm']);
    expect(s.started).toBe(true);
    expect(s.startState).toBe('visible');
    expect(s.characterNamedInLog).toBe(true);
    expect(s.loginItemWrites).toBe(1);
    expect(s.loginItemGateClosedByEnv).toBe(true);
  });

  it('names the state file per character (the cat keeps cat-state.json)', () => {
    expect(smoke.stateFileFor('cat')).toBe('cat-state.json');
    expect(smoke.stateFileFor('slime')).toBe(path.join('characters', 'slime.json'));
  });

  it('passes a clean run and fails each defect separately', () => {
    expect(smoke.evaluate(run())).toEqual({ ok: true, problems: [] });
    expect(smoke.evaluate(run({ aliveAtCheck: false })).ok).toBe(false);
    expect(smoke.evaluate(run({ settingsAfter: { activeCharacter: 'cat', language: 'en' } })).problems.join()).toMatch(/activeCharacter is cat/);
    expect(smoke.evaluate(run({ settingsAfter: null })).ok).toBe(false);
    expect(smoke.evaluate(run({ stop: { exited: false, graceful: false } })).ok).toBe(false);
    const withError = run({ log: smoke.summarizeLog(smoke.parseLog(`${goodLog}\n{"l":"error","s":"a","m":"b"}`), 'fox') });
    expect(smoke.evaluate(withError).problems.join()).toMatch(/error-level/);
    const noStart = run({ log: smoke.summarizeLog([], 'fox') });
    expect(smoke.evaluate(noStart).problems.join()).toMatch(/started/);
  });

  it('parses arguments and rejects unknown characters', () => {
    expect(smoke.parseArgs(['a.exe', '--wait-ms', '5000', '--only', 'cat,fox'])).toMatchObject({ exe: 'a.exe', waitMs: 5000, only: ['cat', 'fox'] });
    expect(() => smoke.parseArgs(['--only', 'dog'])).toThrow(/unknown character/);
    expect(() => smoke.parseArgs(['--wait-ms', '5'])).toThrow();
  });

  it('prints one table row per run', () => {
    const rows = [{ ...run(), verdict: { ok: true, problems: [] } }];
    const table = smoke.formatTable(rows);
    expect(table.split('\n')).toHaveLength(2);
    expect(table).toContain('PASS');
  });
});

describe('inspect-installer helpers', () => {
  it('flattens and diffs configs, classifying identity versus display changes', () => {
    const before = { appId: 'a', productName: 'P', nsis: { shortcutName: 'P' }, mac: { extendInfo: { X: 'GizeCat' } }, linux: { synopsis: 'old' } };
    const after = { appId: 'b', productName: 'P', nsis: { shortcutName: 'Q' }, mac: { extendInfo: { X: 'GizeMate' } }, linux: { synopsis: 'new' } };
    const d = inspect.diffConfigs(before, after);
    const byKey = Object.fromEntries(d.map((x) => [x.key, x.kind]));
    expect(byKey['appId']).toBe('identity-risk');
    expect(byKey['nsis.shortcutName']).toBe('identity-risk');
    expect(byKey['mac.extendInfo.X']).toBe('display');
    expect(byKey['linux.synopsis']).toBe('display');
    expect(inspect.diffConfigs(before, before)).toEqual([]);
  });

  it('derives the NSIS GUID from the appId unless nsis.guid is set', () => {
    const v5 = (n: string, ns: string) => `${ns}:${n}`;
    expect(inspect.nsisGuid({ appId: 'x' }, v5, 'NS')).toBe('NS:x');
    expect(inspect.nsisGuid({ appId: 'x', nsis: { guid: 'G' } }, v5, 'NS')).toBe('G');
  });

  it('flags source maps, env files, secrets folders and payload files outside node_modules only', () => {
    const r = inspect.findForbidden(['out/main/index.js.map', 'x/.env', 'resources/secrets/a.bin', 'resources/egg-payload.bin', 'out/main/index.js', 'node_modules/foo/a.js.map', 'node_modules/foo/index.d.ts']);
    expect(r.hits.map((h) => h.path)).toEqual(['out/main/index.js.map', 'x/.env', 'resources/secrets/a.bin', 'resources/egg-payload.bin']);
    expect(r.dependencyHits.map((h) => h.path)).toEqual(['node_modules/foo/a.js.map']);
  });

  it('lists the deletion statements of an NSIS script ignoring comments', () => {
    const s = inspect.nsisDeletionStatements('; RMDir /r "$APPDATA\\x"\n  DeleteRegValue HKCU "a" "b"\nFileOpen $R7 "x" w\n');
    expect(s).toEqual([{ line: 2, text: 'DeleteRegValue HKCU "a" "b"' }]);
  });

  it('compares two file trees', () => {
    const c = inspect.compareTrees(new Map([['a', 1], ['b', 2], ['c', 3]]), new Map([['a', 1], ['b', 9], ['d', 4]]));
    expect(c.onlyA).toEqual(['c']);
    expect(c.onlyB).toEqual(['d']);
    expect(c.sizeDiffs).toEqual([{ path: 'b', a: 2, b: 9 }]);
  });

  it('parses arguments', () => {
    expect(inspect.parseArgs(['--installer', 'a.exe', '--arch', 'arm64'])).toMatchObject({ installer: 'a.exe', arch: 'arm64', baselineRef: '3d247af', keep: false });
    expect(() => inspect.parseArgs(['--installer', 'a.exe', '--arch', 'x86'])).toThrow();
    expect(() => inspect.parseArgs(['--arch', 'x64'])).toThrow();
  });

  it('REAL repository files: installer.nsh never removes the user-data folder or its files', () => {
    const nsh = fs.readFileSync(path.join(process.cwd(), 'build', 'installer.nsh'), 'utf8');
    for (const s of inspect.nsisDeletionStatements(nsh)) {
      expect(s.text).not.toMatch(/RMDir/i);
      expect(s.text).not.toMatch(/\$APPDATA/i);
      expect(s.text).not.toMatch(/settings\.json|cat-state\.json|characters/i);
    }
    const yml = fs.readFileSync(path.join(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(yml).toMatch(/deleteAppDataOnUninstall:\s*false/);
    expect(yml).toMatch(/^appId:\s*io\.github\.enesiltas\.desktopcat$/m);
  });
});
