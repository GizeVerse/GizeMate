// What an action result says, in the interface language. Main returns fixed English messages (and, for
// login items, a code); the window words them itself (strings.errors.known, strings.loginText) and only
// shows main's text for something it does not know (a provider's own error, say).
import { actionMessageKey, rateLimitSeconds } from '../../shared/i18n/actionMessages';
import type { ActionResult } from '../../shared/ipc';
import { loginMessage } from './loginText';
import { S } from './strings';

/** The localised text of a result's message, or main's own text when it is not one of the known ones. */
export function actionMessage(r: Pick<ActionResult, 'message' | 'code'>): string | undefined {
  if (r.code !== undefined) return loginMessage(r);
  const key = actionMessageKey(r.message);
  if (key !== undefined) return S.errors.known[key];
  const wait = rateLimitSeconds(r.message);
  if (wait !== undefined) return S.errors.rateLimited(wait);
  return r.message;
}

/** The note after a successful action: the page's own localised text wins over main's message. */
export function successMessage(r: Pick<ActionResult, 'message' | 'code'>, pageText?: string): string | null {
  if (r.code !== undefined) return loginMessage(r) ?? pageText ?? null;
  return pageText ?? actionMessage(r) ?? null;
}
