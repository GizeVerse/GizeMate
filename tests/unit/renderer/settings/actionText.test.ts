import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_MESSAGES, actionMessageKey } from '../../../../src/shared/i18n/actionMessages';
import { encryptionUnavailableMessage } from '../../../../src/main/store/secretStore';
import { actionMessage, successMessage } from '../../../../src/renderer/settings/actionText';
import { S, setLocale } from '../../../../src/renderer/settings/strings';

afterEach(() => setLocale('en'));

describe('action results are worded in the interface language', () => {
  it('shows Turkish text instead of main English message, and prefers the page text on success', () => {
    setLocale('tr');
    expect(successMessage({ message: ACTION_MESSAGES.personalityReset }, 'Kişilik sıfırlandı (sayfa).')).toBe('Kişilik sıfırlandı (sayfa).');
    expect(successMessage({ message: ACTION_MESSAGES.historyCleared })).toBe(S.errors.known.historyCleared);
    expect(S.errors.known.historyCleared).not.toBe(ACTION_MESSAGES.historyCleared);
    expect(actionMessage({ message: ACTION_MESSAGES.notOnScreen })).toBe('Arkadaşınız ekranda değil.');
    expect(actionMessage({ message: ACTION_MESSAGES.invalidApiKey })).toBe(S.errors.known.invalidApiKey);
    expect(actionMessage({ message: 'Please wait 7 s before testing again.' })).toBe(S.errors.rateLimited(7));
  });

  it('localises every known key in both languages and passes unknown text through', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale);
      for (const key of Object.keys(ACTION_MESSAGES) as Array<keyof typeof ACTION_MESSAGES>) {
        expect(actionMessageKey(ACTION_MESSAGES[key]), key).toBe(key);
        expect(S.errors.known[key].length, `${locale}:${key}`).toBeGreaterThan(5);
      }
    }
    expect(actionMessage({ message: 'provider said no' })).toBe('provider said no');
    expect(actionMessage({})).toBeUndefined();
  });

  it('recognises the platform-worded encryption refusal', () => {
    for (const os of ['win32', 'darwin', 'linux']) expect(actionMessageKey(encryptionUnavailableMessage(os)), os).toBe('encryptionUnavailable');
  });
});

describe('settings pages word action results through actionMessage', () => {
  const read = (rel: string): string => readFileSync(resolve(__dirname, '../../../../src/renderer/settings', rel), 'utf8');
  it.each(['pages/privacy.ts', 'pages/general.ts', 'pages/diagnostics.ts'])('%s never shows main’s raw text', (file) => {
    const src = read(file);
    expect(src).toContain('actionMessage(');
    expect(src).not.toMatch(/res\.message\s*\?\?/);
    expect(src).not.toMatch(/loginMessage\(res\)/);
  });
});
