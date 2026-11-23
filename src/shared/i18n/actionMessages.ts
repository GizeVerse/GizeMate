// The English messages the main process returns with an action result (src/main/ipc). Main keeps returning
// this English text (logs, tests and old callers read it); the settings window recognises it by identity and
// shows its own text in the interface language instead. One table is the single source for both sides, so a
// reworded message can never silently stop being localised.
export const ACTION_MESSAGES = {
  personalityReset: 'Personality reset.',
  historyCleared: 'Interaction history cleared.',
  journalCleared: 'Journal cleared.',
  outlinesUnavailable: 'Surface outlines are not available.',
  laserUnavailable: 'Laser mode is not available.',
  eventsUnavailable: 'World events are not available.',
  journalUnavailable: 'The journal is not available.',
  loginItemsMacOnly: 'Login Items settings exist on macOS only.',
  notOnScreen: 'Your companion is not on screen.',
  actionFailed: 'Something went wrong; details are in the log.',
  unknownAction: 'Unknown action.',
  invalidApiKey: 'That does not look like a valid API key.',
  apiKeyRemoved: 'API key removed.',
  apiKeySaveFailed: 'Could not save the API key; see the log for details.',
  /** Platform-worded in main (src/main/store/secretStore.ts); matched by shape below, not by identity. */
  encryptionUnavailable: 'Secure storage is not available, so API keys cannot be saved. Local AI providers still work without a key.',
} as const;

export type ActionMessageKey = keyof typeof ACTION_MESSAGES;

const BY_TEXT: ReadonlyMap<string, ActionMessageKey> = new Map((Object.keys(ACTION_MESSAGES) as ActionMessageKey[]).map((k) => [ACTION_MESSAGES[k], k]));

/** The key of a main-process message, or undefined for text that is not one of ours (a provider's error, say). */
export function actionMessageKey(message: string | undefined): ActionMessageKey | undefined {
  if (message === undefined) return undefined;
  if (/^Secure storage( \([^)]*\))? is not available, so API keys cannot be saved\./.test(message)) return 'encryptionUnavailable';
  return BY_TEXT.get(message);
}

/** "Please wait N s before testing again." (perception rate limit): the number of seconds, or undefined. */
export function rateLimitSeconds(message: string | undefined): number | undefined {
  const m = message === undefined ? null : /^Please wait (\d+) s before (?:testing again|the next preview)\.$/.exec(message);
  return m ? Number(m[1]) : undefined;
}
