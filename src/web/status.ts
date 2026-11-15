// Plain-language status of the companion for the page's polite live region and its buttons. The words come
// from the web catalogue (WS.status), so they follow the language; the subject is the companion's own name
// (settings companionName), or a neutral word when it has none. The name always stands alone: Turkish
// sentences put the verb phrase after it, so no case suffix is ever glued onto a user-chosen name.
import type { BehaviorState } from '../shared/cat';
import { WS, type WebStrings } from './strings';

export interface CatStatusInput {
  name: string;
  state: BehaviorState;
  paused: boolean;
}

/** One short sentence, e.g. "Miso is walking." / "Miso yürüyor." */
export function describeCat(s: CatStatusInput, strings: WebStrings = WS): string {
  const name = s.name.trim() || strings.status.noName;
  if (s.paused) return `${name} ${strings.status.paused}.`;
  return `${name} ${strings.status.phrase[s.state] ?? strings.status.here}.`;
}

/** What the companion is doing as a bare phrase for a status chip, e.g. "walking" ("wants some attention"). */
export function activityLabel(state: BehaviorState, strings: WebStrings = WS): string {
  const phrase = strings.status.phrase[state];
  if (!phrase) return strings.status.here.replace(/^is /, '');
  return phrase.startsWith('is ') ? phrase.slice(3) : phrase;
}

/** The companion sleeps or is about to: the Sleep / Wake button offers Wake. */
export function isAsleep(state: BehaviorState): boolean {
  return state === 'sleeping' || state === 'fallingAsleep';
}
