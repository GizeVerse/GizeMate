// Renderer registry: one factory per character id. Other characters' renderers register here; until
// one exists its id resolves to the cat's renderer, so the app keeps working with every id.
import { characterOrDefault, type CharacterId } from '../../../shared/characters/registry';
import { createCatRenderer } from '../character/catRenderer';
import type { CharacterRenderer, CharacterRendererFactory } from '../character/types';
import { createMonkeyRenderer } from './monkey';
import { createFoxRenderer } from './fox';
import { createRabbitRenderer } from './rabbit';
import { createGhostRenderer } from './ghost';
import { createSlimeRenderer } from './slime';
import { createAlienRenderer } from './alien';

/** Registered factories; ids without an entry use the cat's. Add entries here (one line per character). */
const FACTORIES: Partial<Record<CharacterId, CharacterRendererFactory>> = {
  cat: createCatRenderer,
  monkey: createMonkeyRenderer,
  fox: createFoxRenderer,
  rabbit: createRabbitRenderer,
  ghost: createGhostRenderer,
  slime: createSlimeRenderer,
  alien: createAlienRenderer,
};

const OWN = new Map<CharacterId, boolean>();

/**
 * True when the id draws with its own renderer: a registered factory whose renderer reports that id. A
 * starter factory that still delegates to the cat's renderer reports 'cat' and so counts as the fallback.
 */
export function hasOwnRenderer(id: CharacterId): boolean {
  const known = OWN.get(id);
  if (known !== undefined) return known;
  const factory = FACTORIES[id];
  const own = factory !== undefined && factory(() => 0).id === id;
  OWN.set(id, own);
  return own;
}

/** Creates the renderer for `id` (unknown ids become the cat). */
export function createCharacterRenderer(id: unknown, random: () => number): CharacterRenderer {
  const f = FACTORIES[characterOrDefault(id)] ?? createCatRenderer;
  return f(random);
}
