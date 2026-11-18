// GizeMate on the web host: which companion is active, its name and palette as the renderer and the
// name tracker see them, and the interface language. Pure helpers (no DOM types): main.ts wires them.
// The detected language is never stored; settings.general.language keeps the user's own choice.
import { DEFAULT_CHARACTER, characterOrDefault, getCharacter, type CharacterId } from '../shared/characters/registry';
import { t, type I18nKey, type Locale } from '../shared/i18n';
import { hostLocale } from './strings';
import type { Settings } from '../shared/settings';
import type { ResolvedAppearance } from '../main/overlay/renderMapping';

/** The active companion (an unknown stored id reads as the cat). */
export function activeCharacterOf(settings: Pick<Settings, 'general'>): CharacterId {
  return characterOrDefault(settings.general.activeCharacter);
}

/** The companion's own name: the cat's catName; the others' chosen name, or the localised default. */
export function companionName(settings: Pick<Settings, 'general'>, locale: Locale): string {
  const id = activeCharacterOf(settings);
  if (id === DEFAULT_CHARACTER) return settings.general.catName;
  const chosen = settings.general.characterNames[id];
  if (typeof chosen === 'string' && chosen.trim().length > 0) return chosen.trim();
  return t(locale, `character.${id}.name` as I18nKey);
}

/** The palette in use: the cat's appearance.skin; another character's chosen palette when it is one of its own, else its first. */
export function effectiveSkin(settings: Pick<Settings, 'general' | 'appearance'>): string {
  const id = activeCharacterOf(settings);
  if (id === DEFAULT_CHARACTER) return settings.appearance.skin;
  const mod = getCharacter(id);
  const chosen = settings.appearance.characterSkins[id];
  return chosen !== undefined && mod.skins.includes(chosen) ? chosen : (mod.skins[0] ?? settings.appearance.skin);
}

/** The appearance the renderer mapping reads: the same object for the cat, `skin` replaced for the others. */
export function renderAppearance(settings: Pick<Settings, 'general' | 'appearance'>): ResolvedAppearance {
  if (activeCharacterOf(settings) === DEFAULT_CHARACTER) return settings.appearance;
  return { ...settings.appearance, skin: effectiveSkin(settings) };
}

/** The effective interface language: the stored choice, or (auto) the browser's language list. */
export function webLocale(settings: Pick<Settings, 'general'>, languages: string | readonly string[] | undefined): Locale {
  return hostLocale(settings.general.language, languages);
}

/** The slice of a Document the language needs. */
export interface LangTarget {
  documentElement: { lang: string };
}

/** Sets <html lang> and hands the locale to the strings layer (`setStringsLocale`, when given). Returns the locale. */
export function applyWebLocale(
  settings: Pick<Settings, 'general'>,
  languages: string | readonly string[] | undefined,
  doc: LangTarget,
  setStringsLocale?: (locale: Locale) => void,
): Locale {
  const locale = webLocale(settings, languages);
  doc.documentElement.lang = locale;
  setStringsLocale?.(locale);
  return locale;
}
