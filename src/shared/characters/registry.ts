// The character registry: every companion in the universe, in the order the Characters page shows
// them. Pure data: platform-agnostic.
import { CAT_MODULE } from './cat';
import { ALIEN_MODULE } from './alien';
import { FOX_MODULE } from './fox';
import { GHOST_MODULE } from './ghost';
import { MONKEY_MODULE } from './monkey';
import { RABBIT_MODULE } from './rabbit';
import { SLIME_MODULE } from './slime';
import { CHARACTER_IDS, DEFAULT_CHARACTER, type CharacterId, type CharacterModule } from './types';

export { CHARACTER_IDS, DEFAULT_CHARACTER };
export type { CharacterId, CharacterModule };

/** Every character, animals first, then the fantasy creatures; the cat (the original companion) leads. */
export const CHARACTERS: readonly CharacterModule[] = Object.freeze([CAT_MODULE, MONKEY_MODULE, FOX_MODULE, RABBIT_MODULE, GHOST_MODULE, SLIME_MODULE, ALIEN_MODULE]);

const BY_ID: ReadonlyMap<string, CharacterModule> = new Map(CHARACTERS.map((c) => [c.id, c]));

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function getCharacter(id: CharacterId): CharacterModule {
  return BY_ID.get(id) ?? CAT_MODULE;
}

/** Any stored or received value to a known id; unknown, missing or malformed values become the cat. */
export function characterOrDefault(value: unknown): CharacterId {
  return isCharacterId(value) ? value : DEFAULT_CHARACTER;
}
