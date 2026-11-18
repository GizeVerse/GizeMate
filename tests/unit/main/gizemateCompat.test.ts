// v1.5.0 files must keep loading and re-saving unchanged for the cat after the GizeMate additions
// (settings schema 3, cat-state.json schema 1, the v1.5.0 profile format).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateCatState } from '../../../src/core/behavior';
import { createCatStore } from '../../../src/main/store/catStore';
import { createJsonStore } from '../../../src/main/store/jsonStore';
import { PersistedCatSchema } from '../../../src/shared/catState';
import { buildProfile, parseProfile, PROFILE_FORMAT, serializeProfile } from '../../../src/shared/profileTransfer';
import { defaultSettings, migrateSettings, SETTINGS_SCHEMA_VERSION } from '../../../src/shared/settings';
import { memoryLogger, removeDir, tempDir } from './helpers';

/** A settings.json as v1.5.0 wrote it: schema 3, none of the GizeMate keys. */
const V150_SETTINGS = {
  schemaVersion: 3,
  general: { catName: 'Pamuk', firstRunCompleted: true, shortcutsEnabled: true, toggleShortcut: 'Ctrl+Alt+C', showDockIcon: true },
  appearance: { skin: 'tuxedo', size: 1.25, opacity: 0.8, emotes: true },
  behavior: { movementSpeed: 1.2 },
  loginItem: { preference: 'enabled', decidedBy: 'user', v1Value: null },
};

describe('v1.5.0 settings.json', () => {
  it('loads with the new defaults and keeps every old value', () => {
    const s = migrateSettings(V150_SETTINGS);
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(s.general.activeCharacter).toBe('cat');
    expect(s.general.language).toBe('auto');
    expect(s.general.characterNames).toEqual({});
    expect(s.appearance.characterSkins).toEqual({});
    expect(s.general.catName).toBe('Pamuk');
    expect(s.appearance.skin).toBe('tuxedo');
    expect(s.appearance.size).toBe(1.25);
    expect(s.appearance.opacity).toBe(0.8);
    expect(s.behavior.movementSpeed).toBe(1.2);
    expect(s.loginItem.preference).toBe('enabled');
  });

  it('re-saves compatibly: the next load of the saved file is identical, and the schema number is unchanged', () => {
    const once = migrateSettings(V150_SETTINGS);
    const saved = JSON.parse(JSON.stringify(once));
    expect(saved.schemaVersion).toBe(3);
    expect(migrateSettings(saved)).toEqual(once);
  });

  it('tolerates unknown keys and wrong types in the new fields without losing the rest', () => {
    const s = migrateSettings({
      ...V150_SETTINGS,
      general: { ...V150_SETTINGS.general, activeCharacter: 'dragon', language: 'de', characterNames: 'nope', futureKey: 1 },
      appearance: { ...V150_SETTINGS.appearance, characterSkins: 5 },
      somethingNew: { a: 1 },
    });
    expect(s.general.activeCharacter).toBe('cat');
    expect(s.general.language).toBe('auto');
    expect(s.general.characterNames).toEqual({});
    expect(s.appearance.characterSkins).toEqual({});
    expect(s.general.catName).toBe('Pamuk');
    expect(defaultSettings().general.activeCharacter).toBe('cat');
  });
});

describe('v1.5.0 cat-state.json', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => removeDir(dir));

  it('loads as the cat, and a save keeps the plain schema-1 layout (no envelope, same keys)', async () => {
    const file = path.join(dir, 'cat-state.json');
    const original = PersistedCatSchema.parse({ schemaVersion: 1, catId: 'legacy-cat-0001', bornAt: 1_700_000_000_000, savedAt: 1_700_000_100_000 });
    fs.writeFileSync(file, JSON.stringify(original, null, 2));
    const logger = memoryLogger();
    const store = createCatStore({ store: createJsonStore({ filePath: file, logger }), migrate: migrateCatState, random: () => 0.5, logger });
    const load = store.load();
    expect(load).toMatchObject({ recovered: false, source: 'file' });
    expect(load.cat.catId).toBe('legacy-cat-0001');
    store.attach(() => load.cat);
    expect(await store.save()).toBe(true);
    store.dispose();
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(after).sort()).toEqual(Object.keys(original).sort());
    expect(after.schemaVersion).toBe(1);
    expect(after.catId).toBe('legacy-cat-0001');
    // the GizeMate per-character area is not created by touching the cat
    expect(fs.existsSync(path.join(dir, 'characters'))).toBe(false);
  });
});

describe('v1.5.0 profile format', () => {
  it('stays format 1.1, imports with unknown new keys ignored, and never carries the device-only GizeMate fields', () => {
    expect(PROFILE_FORMAT).toEqual({ major: 1, minor: 1 });
    const settings = migrateSettings({ ...V150_SETTINGS, general: { ...V150_SETTINGS.general, activeCharacter: 'fox', language: 'tr' } });
    const cat = PersistedCatSchema.parse({ schemaVersion: 1, catId: 'legacy-cat-0001', bornAt: 1000, savedAt: 2000 });
    const exported = JSON.parse(serializeProfile(buildProfile(settings, cat, { now: new Date(0), app: { version: '1.5.0', host: 'win32' }, includeMemory: false })));
    expect(exported.character).toBe('cat');
    expect(JSON.stringify(exported)).not.toMatch(/activeCharacter|language|characterNames|characterSkins/);
    // a file from a future build: extra top-level, appearance and character sections are dropped, not fatal
    const future = { ...exported, characters: { monkey: { catId: 'm' } }, appearance: { ...exported.appearance, characterSkins: { fox: 'x' } } };
    const parsed = parseProfile(JSON.stringify(future));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.profile.cat.catId).toBe('legacy-cat-0001');
      expect(Object.keys(parsed.profile.appearance)).not.toContain('characterSkins');
    }
  });
});
