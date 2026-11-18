// "Reset settings" puts every setting back to its default but keeps the companion: which character is
// active and the names and palettes chosen for the characters (otherwise the page would swap to the cat
// although the Advanced note promises "Resetting settings keeps your companion"). The language is a setting
// like the others and goes back to 'auto'.
import type { Settings } from '../shared/settings';

export function keepCompanionOnReset(previous: Settings, fresh: Settings): Settings {
  return {
    ...fresh,
    general: { ...fresh.general, activeCharacter: previous.general.activeCharacter, characterNames: previous.general.characterNames },
    appearance: { ...fresh.appearance, characterSkins: previous.appearance.characterSkins },
  };
}
