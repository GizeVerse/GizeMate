// What the active character is called and wears (GizeMate). The cat keeps its shipped settings
// (general.catName, appearance.skin); every other character uses general.characterNames[id] (or its
// localised default name) and appearance.characterSkins[id] (validated against the module's palettes).
// Pure and Electron-free.
import { characterOrDefault, DEFAULT_CHARACTER, getCharacter, type CharacterId } from '../shared/characters/registry';
import { resolveLocale, t, type I18nKey, type Locale } from '../shared/i18n';
import type { Settings } from '../shared/settings';
import { bodyMargins, type BodyMargins, type ResolvedAppearance } from './overlay/renderMapping';

export type { BodyMargins, ResolvedAppearance };

type Named = Pick<Settings, 'general' | 'appearance'>;

/** The effective interface language: the setting, or the system's when it is 'auto' (never written back). */
export function effectiveLocale(settings: Pick<Settings, 'general'>, systemLocale: string | readonly string[] | undefined): Locale {
  return resolveLocale(settings.general.language, systemLocale);
}

/** The active character id from settings (an unknown id falls back to the cat). */
export function activeCharacterOf(settings: Pick<Settings, 'general'>): CharacterId {
  return characterOrDefault(settings.general.activeCharacter);
}

/** The display name of `character`: the cat's is general.catName; the others' the user's own name or the localised default. */
export function characterDisplayName(settings: Named, character: CharacterId, locale: Locale): string {
  if (character === DEFAULT_CHARACTER) return settings.general.catName;
  const own = settings.general.characterNames[character];
  if (typeof own === 'string' && own.trim().length > 0) return own.trim();
  return t(locale, `character.${character}.name` as I18nKey);
}

/** The palette id of `character`: the cat's is appearance.skin; the others' their chosen palette when the module has it, else its first. */
export function characterPalette(settings: Named, character: CharacterId): string {
  if (character === DEFAULT_CHARACTER) return settings.appearance.skin;
  const skins = getCharacter(character).skins;
  const chosen = settings.appearance.characterSkins[character];
  return typeof chosen === 'string' && skins.includes(chosen) ? chosen : (skins[0] ?? settings.appearance.skin);
}

/** The appearance an overlay renders: settings.appearance with the active character's palette in `skin`. */
export function appearanceFor(settings: Named, character: CharacterId): ResolvedAppearance {
  const skin = characterPalette(settings, character);
  return skin === settings.appearance.skin ? settings.appearance : { ...settings.appearance, skin };
}

export { bodyMargins };
