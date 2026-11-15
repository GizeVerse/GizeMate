// World-event text in Turkish: the same ids and outcome tokens as English, safe lookups, English unchanged.
import { afterEach, describe, expect, it } from 'vitest';
import { EVENT_TEXT, eventDescription, eventName, journalText, setWorldTextLocale } from '../../../src/shared/worldText';
import { EVENT_TEXT_TR } from '../../../src/shared/i18n/worldTextTr';
import type { AnyEventId } from '../../../src/shared/companion';

afterEach(() => setWorldTextLocale('en'));

const ids = Object.keys(EVENT_TEXT) as AnyEventId[];

describe('world text: Turkish mirror', () => {
  it('covers the same events and outcome tokens as English', () => {
    expect(Object.keys(EVENT_TEXT_TR).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(Object.keys(EVENT_TEXT_TR[id].outcomes).sort(), id).toEqual(Object.keys(EVENT_TEXT[id].outcomes).sort());
      for (const text of [EVENT_TEXT_TR[id].name, EVENT_TEXT_TR[id].description, EVENT_TEXT_TR[id].fallback, ...Object.values(EVENT_TEXT_TR[id].outcomes)]) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the warm, quiet tone: no exclamation marks', () => {
    for (const id of ids) {
      const t = EVENT_TEXT_TR[id];
      expect([t.name, t.description, t.fallback, ...Object.values(t.outcomes)].join(' ')).not.toContain('!');
    }
  });
});

describe('world text lookups', () => {
  it('is English without any setup, byte-identical to before', () => {
    expect(eventName('mouseEncounter')).toBe('Little Mouse');
    expect(eventDescription('miniTsunami')).toBe('A small, harmless wave rolls along the floor.');
    expect(journalText('mouseEncounter', 'watched')).toBe('A little mouse ran across the floor. The cat watched it go.');
    expect(journalText('mouseEncounter', 'cut')).toBe(EVENT_TEXT.mouseEncounter.fallback);
    expect(journalText('nope' as AnyEventId, 'watched')).toBe('Something small and unexpected happened.');
  });

  it('follows an explicit locale or the default locale', () => {
    expect(eventName('mouseEncounter', 'tr')).toBe('Küçük Fare');
    expect(journalText('mouseEncounter', 'watched', 'tr')).toBe(EVENT_TEXT_TR.mouseEncounter.outcomes.watched);
    setWorldTextLocale('tr');
    expect(eventName('mouseEncounter')).toBe('Küçük Fare');
    expect(eventName('mouseEncounter', 'en')).toBe('Little Mouse');
  });

  it('falls back to the event sentence for unknown outcomes, including Object.prototype names, in both languages', () => {
    for (const locale of ['en', 'tr'] as const) {
      const fallback = (locale === 'tr' ? EVENT_TEXT_TR : EVENT_TEXT).mouseEncounter.fallback;
      for (const token of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'unknown']) {
        expect(journalText('mouseEncounter', token as never, locale), `${locale}:${token}`).toBe(fallback);
      }
    }
    expect(journalText('nope' as AnyEventId, 'x', 'tr')).toBe('Küçük ve beklenmedik bir şey oldu.');
  });
});
