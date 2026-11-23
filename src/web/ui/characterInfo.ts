// What the panels show about a character: its own name (the one the person chose, or the localised
// default), its palette and its descriptive texts. The texts come from the shared i18n catalogue
// (character.<id>.*), the structure from the character module; nothing here is a literal.
import { DEFAULT_CHARACTER, characterOrDefault, getCharacter, type CharacterId } from '../../shared/characters/registry';
import { t, type I18nKey } from '../../shared/i18n';
import type { Settings } from '../../shared/settings';
import { getLocale, WS } from '../strings';

type Part = 'name' | 'tagline' | 'description' | 'personality' | 'interactions';

/** One catalogue text of a character, in the active language. */
export function characterText(id: CharacterId, part: Part): string {
  return t(getLocale(), `character.${id}.${part}` as I18nKey);
}

/** The character's default name, in the active language (the species name). */
export const defaultName = (id: CharacterId): string => characterText(id, 'name');

/** The name to show: the cat's catName, another character's chosen name, or the species name. */
export function displayName(settings: Pick<Settings, 'general'>, id: CharacterId): string {
  if (id === DEFAULT_CHARACTER) return settings.general.catName;
  const chosen = settings.general.characterNames[id];
  return typeof chosen === 'string' && chosen.trim().length > 0 ? chosen.trim() : defaultName(id);
}

/** The palette in use for a character (always one of its own). */
export function skinFor(settings: Pick<Settings, 'appearance'>, id: CharacterId): string {
  const mod = getCharacter(id);
  if (id === DEFAULT_CHARACTER) return settings.appearance.skin;
  const chosen = settings.appearance.characterSkins[id];
  return chosen !== undefined && mod.skins.includes(chosen) ? chosen : (mod.skins[0] ?? settings.appearance.skin);
}

export const activeId = (settings: Pick<Settings, 'general'>): CharacterId => characterOrDefault(settings.general.activeCharacter);

/** A palette's display name (the cat's coats are the desktop's own labels). */
export function paletteName(id: CharacterId, palette: string): string {
  if (id === DEFAULT_CHARACTER) return (WS.skins as Readonly<Record<string, string>>)[palette] ?? palette;
  return WS.palettes[palette] ?? palette;
}

/** The structural facts shown as badges: kind, way of moving, and what it can do. */
export function badgesFor(id: CharacterId): string[] {
  const mod = getCharacter(id);
  const out: string[] = [WS.characters.kind[mod.kind], WS.characters.locomotion[mod.locomotion]];
  const caps = mod.capabilities;
  if (caps.climbsEdges) out.push(WS.characters.capability.climbsEdges);
  if (caps.flies) out.push(WS.characters.capability.flies);
  if (caps.passesThrough) out.push(WS.characters.capability.passesThrough);
  if (caps.squashes) out.push(WS.characters.capability.squashes);
  return out;
}
