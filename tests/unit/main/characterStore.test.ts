import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateCatState } from '../../../src/core/behavior';
import { PersistedCatSchema, type PersistedCat } from '../../../src/shared/catState';
import { createCatStore } from '../../../src/main/store/catStore';
import { CHARACTER_STATE_SCHEMA_VERSION, characterStatePath, createCharacterStores } from '../../../src/main/store/characterStore';
import { createJsonStore } from '../../../src/main/store/jsonStore';
import { memoryLogger, removeDir, tempDir } from './helpers';

const cat = (id: string, savedAt = 1): PersistedCat => PersistedCatSchema.parse({ schemaVersion: 1, catId: id.padEnd(8, '_'), bornAt: 1000, savedAt });

describe('per-character stores', () => {
  let dir: string;
  const catFile = (): string => path.join(dir, 'cat-state.json');
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => removeDir(dir));

  function setup() {
    const logger = memoryLogger();
    const catStore = createCatStore({ store: createJsonStore({ filePath: catFile(), logger }), migrate: migrateCatState, random: () => 0.5, logger });
    const stores = createCharacterStores({ userData: dir, catStore, logger, random: () => 0.25, wallClock: () => 5000 });
    return { catStore, stores, logger };
  }

  it('gives the cat its own existing store and every other character a file under characters/', () => {
    const { catStore, stores } = setup();
    expect(stores.forCharacter('cat')).toBe(catStore);
    expect(stores.forCharacter('monkey')).toBe(stores.forCharacter('monkey'));
    expect(stores.forCharacter('monkey')).not.toBe(stores.forCharacter('fox'));
    expect(characterStatePath(dir, 'fox')).toBe(path.join(dir, 'characters', 'fox.json'));
    expect(() => characterStatePath(dir, 'cat')).toThrow();
    stores.dispose();
  });

  it('a missing file is a fresh companion for that character, without a file until it is saved', () => {
    const { stores } = setup();
    const load = stores.forCharacter('ghost').load();
    expect(load.source).toBe('new');
    expect(fs.existsSync(path.join(dir, 'characters', 'ghost.json'))).toBe(false);
    stores.dispose();
  });

  it('saves in a versioned envelope and loads it back (sync and async)', async () => {
    const { stores } = setup();
    const s = stores.forCharacter('slime');
    s.attach(() => cat('slime-1', 42));
    expect(s.saveSync()).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'characters', 'slime.json'), 'utf8'));
    expect(onDisk).toMatchObject({ schemaVersion: CHARACTER_STATE_SCHEMA_VERSION, character: 'slime', savedAt: 5000 });
    expect(onDisk.companion.catId).toBe('slime-1_');
    s.dispose();

    const again = setup().stores.forCharacter('slime');
    const load = again.load();
    expect(load).toMatchObject({ recovered: false, source: 'file' });
    expect(load.cat.catId).toBe('slime-1_');
    again.attach(() => cat('slime-2', 43));
    expect(await again.save()).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'characters', 'slime.json'), 'utf8')).companion.catId).toBe('slime-2_');
    again.dispose();
  });

  it('never touches the cat file: saving other characters leaves cat-state.json byte-identical', () => {
    const { catStore, stores } = setup();
    catStore.attach(() => cat('the-cat', 7));
    catStore.saveSync();
    catStore.dispose();
    const before = fs.readFileSync(catFile());
    for (const id of ['monkey', 'fox', 'rabbit'] as const) {
      const s = stores.forCharacter(id);
      s.attach(() => cat(`${id}-1`));
      s.saveSync();
    }
    stores.dispose();
    expect(fs.readFileSync(catFile()).equals(before)).toBe(true);
    // The cat file keeps the shipped plain layout, no envelope.
    expect(JSON.parse(before.toString('utf8'))).toMatchObject({ schemaVersion: 1, catId: 'the-cat_' });
    expect(JSON.parse(before.toString('utf8')).companion).toBeUndefined();
  });

  it('a corrupt character file yields a fresh companion for that character only', () => {
    const { catStore, stores } = setup();
    catStore.attach(() => cat('the-cat', 7));
    catStore.saveSync();
    catStore.dispose();
    const fox = stores.forCharacter('fox');
    fox.attach(() => cat('fox-1'));
    fox.saveSync();
    fox.dispose();
    const monkey = stores.forCharacter('monkey');
    monkey.attach(() => cat('monkey-1'));
    monkey.saveSync();
    monkey.dispose();
    fs.rmSync(path.join(dir, 'characters', 'fox.json.bak'), { force: true });
    fs.writeFileSync(path.join(dir, 'characters', 'fox.json'), '{ not json');
    const catBefore = fs.readFileSync(catFile());
    const monkeyBefore = fs.readFileSync(path.join(dir, 'characters', 'monkey.json'));

    const fresh = createCharacterStores({ userData: dir, catStore, logger: memoryLogger(), random: () => 0.9 });
    const load = fresh.forCharacter('fox').load();
    expect(load).toMatchObject({ recovered: true, source: 'new' });
    expect(load.cat.catId).not.toBe('fox-1___');
    expect(fresh.forCharacter('monkey').load()).toMatchObject({ recovered: false, source: 'file' });
    expect(fresh.forCharacter('monkey').load().cat.catId).toBe('monkey-1');
    expect(fs.readFileSync(catFile()).equals(catBefore)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'characters', 'monkey.json')).equals(monkeyBefore)).toBe(true);
    fresh.dispose();
  });

  it('an envelope for another character, or a bare cat file dropped in its place, is not adopted', () => {
    const { stores } = setup();
    const monkey = stores.forCharacter('monkey');
    monkey.attach(() => cat('monkey-1'));
    monkey.saveSync();
    monkey.dispose();
    fs.mkdirSync(path.join(dir, 'characters'), { recursive: true });
    // monkey's file copied over fox's name
    fs.copyFileSync(path.join(dir, 'characters', 'monkey.json'), path.join(dir, 'characters', 'fox.json'));
    const fox = stores.forCharacter('fox').load();
    expect(fox.recovered).toBe(true);
    expect(fox.cat.catId).not.toBe('monkey-1');
    // a bare PersistedCat (the cat layout) in a character file
    fs.writeFileSync(path.join(dir, 'characters', 'rabbit.json'), JSON.stringify(cat('bare-cat')));
    const rabbit = stores.forCharacter('rabbit').load();
    expect(rabbit.recovered).toBe(true);
    expect(rabbit.cat.catId).not.toBe('bare-cat');
    stores.dispose();
  });

  it('keeps the backup copy of the previous save (crash safety of the shared jsonStore)', () => {
    const { stores } = setup();
    const s = stores.forCharacter('alien');
    s.attach(() => cat('alien-1'));
    s.saveSync();
    s.attach(() => cat('alien-2'));
    s.saveSync();
    expect(fs.existsSync(path.join(dir, 'characters', 'alien.json.bak'))).toBe(true);
    const bak = JSON.parse(fs.readFileSync(path.join(dir, 'characters', 'alien.json.bak'), 'utf8'));
    expect(bak.character).toBe('alien');
    s.dispose();
  });
});
