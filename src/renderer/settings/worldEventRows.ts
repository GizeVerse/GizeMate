// The world-event controls of the Behaviour page: master switch, rare pool, pace and one switch for each
// of the 20 everyday and 6 rare events. They all edit the one leaf companion.events, which is always
// sent whole (the disabled list included), exactly as the settings merge expects.
import { EVENT_PACE_RANGE, RARE_EVENT_IDS, WORLD_EVENT_IDS, type AnyEventId } from '../../shared/companion';
import { eventDescription, eventName } from '../../shared/worldText';
import { activeCharacterOf, displayName } from './charactersView';
import { eventsWith, readEvents, setEventEnabled } from './companionView';
import type { PageContext } from './context';
import { nestedSliderRow, nestedToggleRow, setNote, type ToggleHandle } from './controls';
import { h } from './dom';
import { formatMultiplier } from './format';
import { getLocale, S } from './strings';

const B = S.behavior;

/** Pace slider range: the shared constants, in the UI's step grid (quarter steps). */
export const PACE_RANGE = { min: EVENT_PACE_RANGE.min, max: EVENT_PACE_RANGE.max, step: 0.25, format: 'multiplier' } as const;

export function paceLabel(value: number): string {
  return value === EVENT_PACE_RANGE.default ? B.worldPaceDefault : formatMultiplier(value);
}

export interface WorldEventRows {
  master: HTMLElement[];
  normal: HTMLElement[];
  rare: HTMLElement[];
}

export function worldEventRows(ctx: PageContext): WorldEventRows {
  const enabled = nestedToggleRow(
    ctx,
    'companion',
    'events',
    { read: (v) => readEvents(v).enabled, write: (cur, on) => eventsWith(cur, { enabled: on }) },
    { title: B.worldEnabledTitle, desc: B.worldEnabledDesc, icon: 'sparkle' },
  );
  const rare = nestedToggleRow(
    ctx,
    'companion',
    'events',
    { read: (v) => readEvents(v).rare, write: (cur, on) => eventsWith(cur, { rare: on }) },
    { title: B.worldRareTitle, desc: B.worldRareDesc, icon: 'sparkle' },
  );
  const pace = nestedSliderRow(
    ctx,
    'companion',
    'events',
    PACE_RANGE,
    { read: (v) => readEvents(v).pace, write: (n, cur) => eventsWith(cur, { pace: n }) },
    paceLabel,
    { title: B.worldPaceTitle, desc: B.worldPaceDesc, icon: 'clock' },
  );

  const companionNow = (): string => {
    const s = ctx.store.settings;
    return displayName(s, activeCharacterOf(s), getLocale());
  };
  const described = new Map<ToggleHandle, AnyEventId>();
  const eventSwitch = (id: AnyEventId): ToggleHandle => {
    const handle = nestedToggleRow(
      ctx,
      'companion',
      'events',
      {
        read: (v) => !readEvents(v).disabled.includes(id),
        write: (cur, on) => eventsWith(cur, { disabled: setEventEnabled(readEvents(cur).disabled, id, on) }),
      },
      { title: eventName(id), desc: eventDescription(id, undefined, companionNow()) },
    );
    described.set(handle, id);
    return handle;
  };
  const normal = WORLD_EVENT_IDS.map(eventSwitch);
  const rareList = RARE_EVENT_IDS.map(eventSwitch);

  const sessionNote = h('p', { class: 'group-desc', text: B.worldSessionNote });

  ctx.store.subscribe(() => {
    const who = companionNow();
    for (const [handle, id] of described) {
      const el = handle.parts.row.querySelector('.row-desc');
      if (el) el.textContent = eventDescription(id, undefined, who);
    }
    const e = readEvents(ctx.store.intended('companion', 'events'));
    rare.setDisabled(!e.enabled);
    pace.setDisabled(!e.enabled);
    for (const t of normal) t.setDisabled(!e.enabled);
    for (const t of rareList) t.setDisabled(!e.enabled || !e.rare);
    setNote(rare.parts.note, e.enabled ? null : B.worldNeedsEnabled, 'info');
    setNote(pace.parts.note, e.enabled ? null : B.worldNeedsEnabled, 'info');
    setNote(normal[0]?.parts.note ?? h('div'), e.enabled ? null : B.worldNeedsEnabled, 'info');
    setNote(rareList[0]?.parts.note ?? h('div'), !e.enabled ? B.worldNeedsEnabled : e.rare ? null : B.worldNeedsRare, 'info');
  });

  return {
    master: [enabled.parts.row, rare.parts.row, pace.parts.row, sessionNote],
    normal: normal.map((t) => t.parts.row),
    rare: rareList.map((t) => t.parts.row),
  };
}
