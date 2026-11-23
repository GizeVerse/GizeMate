import { describe, expect, it } from 'vitest';
import { firstSystemLocale, resolveLocale } from '../../../src/shared/i18n/locale';

describe('firstSystemLocale (the pre-ready dialog language)', () => {
  it('skips readers that throw or answer empty and takes the next one', () => {
    const tag = firstSystemLocale([
      () => {
        throw new Error('app.getLocale() before ready');
      },
      () => '',
      () => undefined,
      () => ' tr-TR ',
      () => 'en-US',
    ]);
    expect(tag).toBe('tr-TR');
    expect(resolveLocale('auto', tag)).toBe('tr');
  });

  it('is empty (English under auto, the choice under an explicit language) when nothing answers', () => {
    const tag = firstSystemLocale([() => undefined, () => null]);
    expect(tag).toBe('');
    expect(resolveLocale('auto', tag)).toBe('en');
    expect(resolveLocale('tr', tag)).toBe('tr');
  });
});
