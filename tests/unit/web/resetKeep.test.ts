import { describe, expect, it } from 'vitest';
import { applySettingsPatch, defaultSettings } from '../../../src/shared/settings';
import { keepCompanionOnReset } from '../../../src/web/resetKeep';
import { resetWebSettings } from '../../../src/web/settingsModel';

describe('Reset settings keeps the companion', () => {
  it('keeps the active character, its name and palette; resets everything else', () => {
    const r = applySettingsPatch(defaultSettings(), {
      general: { activeCharacter: 'fox', language: 'en', characterNames: { fox: 'Rusty' } },
      appearance: { size: 1.5, characterSkins: { fox: 'arctic' } },
    });
    if (!r.ok) throw new Error('fixture patch refused');
    const out = keepCompanionOnReset(r.settings, resetWebSettings());
    expect(out.general.activeCharacter).toBe('fox');
    expect(out.general.characterNames).toEqual({ fox: 'Rusty' });
    expect(out.appearance.characterSkins).toEqual({ fox: 'arctic' });
    expect(out.appearance.size).toBe(resetWebSettings().appearance.size);
    expect(out.general.language).toBe('auto');
  });
});
