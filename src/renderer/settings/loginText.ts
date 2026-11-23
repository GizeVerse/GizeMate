// Startup-at-sign-in wording: main reports a code (ipc LoginCode) beside its English text; the window
// words the code in the interface language and falls back to main's text for a code it does not know.
import type { ActionResult, LoginItemStatus } from '../../shared/ipc';
import { S } from './strings';

const own = (code: string | undefined): string | null => {
  if (code === undefined) return null;
  const text = (S.loginText as Record<string, unknown>)[code];
  return typeof text === 'string' ? text : null;
};

/** The status line's reason in the interface language (main's English text when there is no code). */
export function loginReason(s: Pick<LoginItemStatus, 'reason' | 'reasonCode'>): string | null {
  return own(s.reasonCode) ?? s.reason;
}

/** The message of a login-item action result in the interface language (main's text when there is no code). */
export function loginMessage(r: Pick<ActionResult, 'message' | 'code'>): string | undefined {
  return own(r.code) ?? r.message;
}
