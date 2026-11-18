// Review fixes: removal, bounds and prototype safety of general.characterNames / appearance.characterSkins.
import { describe, expect, it } from 'vitest';
import { applySettingsPatch, defaultSettings, MAX_CHARACTER_RECORD_ENTRIES, SettingsSchema } from '../../../src/shared/settings';

const base = (): ReturnType<typeof defaultSettings> => {
  const r = applySettingsPatch(defaultSettings(), { general: { characterNames: { fox: 'Foxy' } }, appearance: { characterSkins: { fox: 'arctic' } } });
  if (!r.ok) throw new Error(r.error);
  return r.settings;
};

describe('character name and skin records', () => {
  it('an id patched to the empty string is removed, other entries stay', () => {
    const s = applySettingsPatch(base(), { general: { characterNames: { ghost: 'Boo' } } });
    expect(s.ok && s.settings.general.characterNames).toEqual({ fox: 'Foxy', ghost: 'Boo' });
    const r = applySettingsPatch(s.ok ? s.settings : base(), { general: { characterNames: { fox: '' } }, appearance: { characterSkins: { fox: '' } } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.general.characterNames).toEqual({ ghost: 'Boo' });
      expect(r.settings.appearance.characterSkins).toEqual({});
    }
  });
  it('rejects unknown ids, over-long values, too many entries and non-string values', () => {
    expect(applySettingsPatch(base(), { general: { characterNames: { dragon: 'X' } } }).ok).toBe(false);
    expect(applySettingsPatch(base(), { general: { characterNames: { fox: 'x'.repeat(25) } } }).ok).toBe(false);
    expect(applySettingsPatch(base(), { appearance: { characterSkins: { fox: 's'.repeat(25) } } }).ok).toBe(false);
    expect(applySettingsPatch(base(), { general: { characterNames: { fox: 5 } } }).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'n']));
    expect(applySettingsPatch(base(), { general: { characterNames: many } }).ok).toBe(false);
  });
  it('is prototype-pollution safe', () => {
    const evil = JSON.parse('{"general":{"characterNames":{"__proto__":{"polluted":"yes"},"fox":"Ok"}}}');
    const r = applySettingsPatch(base(), evil);
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const loaded = SettingsSchema.parse(JSON.parse('{"general":{"characterNames":{"__proto__":"x","constructor":"y","fox":"Ok"}}}'));
    expect(loaded.general.characterNames).toEqual({ fox: 'Ok' });
    expect(Object.getPrototypeOf(loaded.general.characterNames)).toBe(Object.prototype);
  });
  it('on load a bad entry is dropped alone and the count is bounded', () => {
    const names: Record<string, unknown> = { fox: 'Foxy', ghost: 'x'.repeat(40), monkey: '  ', rabbit: 7 };
    const loaded = SettingsSchema.parse({ general: { characterNames: names } });
    expect(loaded.general.characterNames).toEqual({ fox: 'Foxy' });
    expect(MAX_CHARACTER_RECORD_ENTRIES).toBeLessThanOrEqual(16);
  });
});
