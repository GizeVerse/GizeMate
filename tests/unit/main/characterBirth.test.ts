// Review fix: a non-cat companion whose file parses but fails validation (no backup) is rebuilt with its own id and traits.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateCatState } from '../../../src/core/behavior';
import { createCatStore } from '../../../src/main/store/catStore';
import { createCharacterStores } from '../../../src/main/store/characterStore';
import { createJsonStore } from '../../../src/main/store/jsonStore';
import { memoryLogger, removeDir, tempDir } from './helpers';

describe('character store birth', () => {
  let dir: string;
  beforeEach(() => void (dir = tempDir()));
  afterEach(() => removeDir(dir));
  it('recovers a bad non-cat file as that character, not as a cat', () => {
    const logger = memoryLogger();
    const catStore = createCatStore({ store: createJsonStore({ filePath: path.join(dir, 'cat-state.json'), logger }), migrate: migrateCatState, random: () => 0.5, logger });
    fs.mkdirSync(path.join(dir, 'characters'));
    fs.writeFileSync(path.join(dir, 'characters', 'fox.json'), JSON.stringify({ schemaVersion: 1, character: 'fox', savedAt: 1, companion: { schemaVersion: 1, junk: true } }));
    const stores = createCharacterStores({ userData: dir, catStore, logger, random: () => 0.25, wallClock: () => 5000 });
    const load = stores.forCharacter('fox').load();
    expect(load.recovered).toBe(true);
    expect(load.cat.catId.startsWith('fox-')).toBe(true);
    const missing = stores.forCharacter('monkey').load();
    expect(missing.cat.catId.startsWith('monkey-')).toBe(true);
    stores.dispose();
  });
});
