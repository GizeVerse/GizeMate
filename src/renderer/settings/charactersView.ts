// DOM-free view logic of the Characters area and of the character-aware controls in Customize: the
// text and badges of each character (from the shared catalogue and the character's module), the name
// shown for a companion, and the settings patches that change a name or a palette. Total functions:
// unknown ids become the cat, odd stored values are ignored.
import { characterOrDefault, getCharacter, CHARACTERS, type CharacterId, type CharacterModule } from '../../shared/characters/registry';
import { t, type I18nKey, type Locale } from '../../shared/i18n';
import type { Settings } from '../../shared/settings';
import type { FieldId } from './fields';
import { fieldId } from './patch';
import { S } from './strings';

export const CAPABILITY_IDS = ['climbsEdges', 'flies', 'passesThrough', 'squashes'] as const satisfies ReadonlyArray<keyof CharacterModule['capabilities']>;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CharacterCard {
  readonly id: CharacterId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly personality: string;
  readonly interactions: string;
  readonly kind: 'animal' | 'fantasy';
  readonly kindLabel: string;
  readonly locomotionLabel: string;
  /** Labels of the abilities this character has, in a fixed order. */
  readonly abilities: readonly string[];
}

const text = (locale: Locale, id: CharacterId, field: 'name' | 'tagline' | 'description' | 'personality' | 'interactions'): string => t(locale, `character.${id}.${field}` as I18nKey);

/** The catalogue name of a character in `locale` (what it is called until the user renames it). */
export function defaultCharacterName(id: CharacterId, locale: Locale): string {
  return text(locale, characterOrDefault(id), 'name');
}

/** Everything the Characters page shows for one character. */
export function characterCard(id: CharacterId, locale: Locale): CharacterCard {
  const m = getCharacter(characterOrDefault(id));
  const C = S.ui.characters;
  return {
    id: m.id,
    name: text(locale, m.id, 'name'),
    tagline: text(locale, m.id, 'tagline'),
    description: text(locale, m.id, 'description'),
    personality: text(locale, m.id, 'personality'),
    interactions: text(locale, m.id, 'interactions'),
    kind: m.kind,
    kindLabel: m.kind === 'animal' ? C.kindAnimal : C.kindFantasy,
    locomotionLabel: C.locomotion[m.locomotion],
    abilities: CAPABILITY_IDS.filter((c) => m.capabilities[c]).map((c) => C.abilities[c]),
  };
}

export function allCharacterIds(): readonly CharacterId[] {
  return CHARACTERS.map((c) => c.id);
}

export const activeCharacterOf = (settings: Pick<Settings, 'general'>): CharacterId => characterOrDefault(settings.general.activeCharacter);

/** The name stored for the character, or null when the user has not named it (the cat's is general.catName). */
export function storedName(settings: Pick<Settings, 'general'>, id: CharacterId): string | null {
  if (id === 'cat') return settings.general.catName.trim() === '' ? null : settings.general.catName;
  const v = settings.general.characterNames[id];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** The name the character answers to: the user's, else the catalogue's. */
export function displayName(settings: Pick<Settings, 'general'>, id: CharacterId, locale: Locale): string {
  return storedName(settings, id) ?? defaultCharacterName(id, locale);
}

/** The palette ids the character offers and the one in use (an unknown or missing id means the first). */
export function paletteOf(settings: Pick<Settings, 'appearance'>, id: CharacterId): { skins: readonly string[]; current: string } {
  const skins = getCharacter(id).skins;
  const chosen = id === 'cat' ? settings.appearance.skin : settings.appearance.characterSkins[id];
  return { skins, current: typeof chosen === 'string' && skins.includes(chosen) ? chosen : (skins[0] ?? '') };
}

/** The leaf to send to rename a character; an empty name removes a non-cat's own name (the cat's is required). */
export function renameLeaf(settings: Pick<Settings, 'general'>, id: CharacterId, name: string): { key: 'catName' | 'characterNames'; value: string | Record<string, string> } {
  if (id === 'cat') return { key: 'catName', value: name };
  // The patch leaf merges into the stored record; an id patched to '' is the explicit removal (see applySettingsPatch).
  if (name === '') return { key: 'characterNames', value: { [id]: '' } };
  return { key: 'characterNames', value: { ...settings.general.characterNames, [id]: name } };
}

/** The leaf to send to pick a palette. */
export function skinLeaf(settings: Pick<Settings, 'appearance'>, id: CharacterId, skin: string): { key: 'skin' | 'characterSkins'; value: string | Record<string, string> } {
  if (id === 'cat') return { key: 'skin', value: skin };
  return { key: 'characterSkins', value: { ...settings.appearance.characterSkins, [id]: skin } };
}

/** The label of a palette: the cat keeps its own table, the others use the shared colour words. */
export function skinLabel(id: CharacterId, skin: string): string {
  if (id === 'cat') return (S.appearance.skins as Readonly<Record<string, string>>)[skin] ?? skin;
  return S.ui.customize.skins[skin] ?? skin;
}

/** The settings the Characters, Customize and Welcome controls edit (every one has a control; a test pins it). */
export const CHARACTER_FIELD_IDS: readonly FieldId[] = [
  fieldId('general', 'activeCharacter'),
  fieldId('general', 'characterNames'),
  fieldId('appearance', 'characterSkins'),
];
/** The language preference (Settings › Language and the first-run page). */
export const LANGUAGE_FIELD_IDS: readonly FieldId[] = [fieldId('general', 'language')];
