// The CUSTOMIZE area, shared by the Android panel and the browser sheet: everything that shapes the ACTIVE
// companion, in folds so the page never overwhelms: Look (name, palette, size), Personality, Behavior,
// Animation (drawing style, shadow, emotes) and Interactions. The cat's name and coat are
// general.catName and appearance.skin; every other character's are general.characterNames[id] and
// appearance.characterSkins[id] (palettes from its module). Every control goes through deps.apply, the
// host's web allow-list (settingsModel.ts patchFor); nothing is written here directly.
//
// The name field keeps the secret-name note exactly as before: attachSecretNote(nameInput, deps.secret)
// is called once, right after the field's own change handler, on the real input inside its row.
import { SKINS, RENDER_STYLES, type RenderStyle, type SkinId } from '../../shared/cat';
import { DEFAULT_CHARACTER, getCharacter, type CharacterId } from '../../shared/characters/registry';
import { ALL_EVENT_IDS, PERSONALITY_IDS, type AnyEventId, type PersonalityChoice } from '../../shared/companion';
import { PERSONALITY_TEXT } from '../../shared/personalityText';
import { disabledBehaviorSet, type BehaviorId, type Settings } from '../../shared/settings';
import { ACTIVITY_PRESET_IDS, type ActivityPresetId } from '../../shared/settingsPresets';
import { eventDescription, eventName } from '../../shared/worldText';
import { h, uid } from '../../renderer/settings/dom';
import { coatArt } from '../../renderer/settings/skins';
import { attachSecretNote } from '../secretNote';
import type { WebSecretName } from '../secretName';
import type { SessionFlags } from '../sessionFlags';
import { CAT_NAME_MAX, LEVEL_RANGE, MOVEMENT_RANGE, PACE_RANGE, patchFor, selectedPreset, SIZE_RANGE, SLEEP_RANGE, type WebField, type WebPatchResult } from '../settingsModel';
import { WS } from '../strings';
import { activeId, displayName, paletteName, skinFor } from './characterInfo';
import { fold, note, radioCards, slider, subhead, switchRow, type RadioCards } from './controls';
import { createScenePreview } from './scenePreview';

export interface CustomizeDeps {
  getSettings: () => Settings;
  /** One control's patch, through the web allow-list; `save` false is a live preview while a slider moves. */
  apply: (patch: Record<string, Record<string, unknown>>, save: boolean) => WebPatchResult;
  /** Session-only switches (laser, events pause): the Android panel only. */
  session?: { get(): SessionFlags; set(next: SessionFlags): void };
  secret?: WebSecretName;
  /** Something was saved or refused: the host refreshes its other pages. */
  onChanged?: () => void;
}

export interface CustomizeView {
  readonly root: HTMLElement;
  refresh(): void;
  /** The heading line (who is being customized) is part of the root; this is the name input, for tests. */
  readonly nameInput: HTMLInputElement;
}

export function createCustomizeView(deps: CustomizeDeps): CustomizeView {
  const change = (c: WebField, save = true): WebPatchResult | null => {
    const patch = patchFor(c);
    if (!patch) return null;
    const r = deps.apply(patch, save);
    if (!r.ok || save) refresh();
    if (save) deps.onChanged?.();
    return r;
  };

  const who = h('p', { class: 'lead who', 'aria-live': 'polite' });

  // ---- look: name, palette, size
  const nameId = uid('cust-name');
  const nameErrId = uid('cust-name-error');
  const nameInput = h('input', { type: 'text', id: nameId, maxlength: CAT_NAME_MAX, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', spellcheck: 'false', 'aria-describedby': nameErrId });
  const nameErr = h('p', { class: 'error', id: nameErrId, 'aria-live': 'polite' });
  nameInput.addEventListener('change', () => {
    const s = deps.getSettings();
    const id = activeId(s);
    const field: WebField = id === DEFAULT_CHARACTER ? { field: 'catName', value: nameInput.value } : { field: 'characterName', id, value: nameInput.value };
    const patch = patchFor(field);
    const r = patch ? deps.apply(patch, true) : null;
    if (!r || !r.ok) {
      nameErr.textContent = WS.cat.nameInvalid;
      nameInput.value = displayName(deps.getSettings(), id);
    } else {
      nameErr.textContent = '';
      nameInput.value = displayName(r.settings, id);
      deps.onChanged?.();
    }
  });
  // Registered after the change handler above, so it reads the value that handler settled on.
  const nameField = h('div', { class: 'field' }, [h('label', { for: nameId, text: WS.cat.nameLabel }), nameInput, nameErr]);
  attachSecretNote(nameInput, deps.secret);

  const paletteHost = h('div', {});
  let palette: RadioCards<string> | null = null;
  let paletteFor: CharacterId | null = null;
  const disposers: Array<() => void> = [];
  function buildPalette(id: CharacterId): void {
    for (const d of disposers.splice(0)) d();
    const values: readonly string[] = id === DEFAULT_CHARACTER ? SKINS : getCharacter(id).skins;
    const label = id === DEFAULT_CHARACTER ? WS.cat.coatLabel : WS.customize.paletteLabel;
    palette = radioCards<string>(
      label,
      values,
      (v) => {
        if (id === DEFAULT_CHARACTER) return [coatArt(v as SkinId), h('span', { class: 'title', text: paletteName(id, v) })];
        // A swatch is the character itself, drawn once (still) in that palette by its real renderer.
        const canvas = h('canvas', { class: 'palette-canvas', 'aria-hidden': 'true' });
        const preview = createScenePreview(canvas, id, v);
        preview.still?.();
        disposers.push(() => preview.dispose());
        return [canvas, h('span', { class: 'title', text: paletteName(id, v) })];
      },
      (v) => change(id === DEFAULT_CHARACTER ? { field: 'skin', value: v as SkinId } : { field: 'characterSkin', id, value: v }),
    );
    paletteHost.replaceChildren(palette.root);
    paletteFor = id;
  }
  const size = slider(WS.cat.sizeLabel, SIZE_RANGE, (v) => `${Math.round(v * 100)}%`, (v, save) => change({ field: 'size', value: v }, save));
  const look = fold(WS.customize.look, [nameField, paletteHost, size.root], true);

  // ---- personality: the seven profiles and Auto (the companion never changes the choice)
  const PERSONALITY_VALUES: readonly PersonalityChoice[] = ['auto', ...PERSONALITY_IDS];
  const personality = radioCards<PersonalityChoice>(
    WS.panel.personality.groupLabel,
    PERSONALITY_VALUES,
    (p) =>
      p === 'auto'
        ? [h('span', { class: 'title', text: WS.panel.personality.auto }), h('span', { class: 'desc', text: WS.panel.personality.autoDesc })]
        : [h('span', { class: 'title', text: PERSONALITY_TEXT[p].name }), h('span', { class: 'desc', text: PERSONALITY_TEXT[p].summary })],
    (p) => change({ field: 'personality', value: p }),
    true,
  );
  const personalityFold = fold(WS.panel.personality.title, [note(WS.panel.personality.desc), personality.root]);

  // ---- behavior
  const preset = radioCards<ActivityPresetId>(
    WS.panel.behavior.activityLabel,
    ACTIVITY_PRESET_IDS,
    (p) => [h('span', { class: 'title', text: WS.presets[p].title }), h('span', { class: 'desc', text: WS.presets[p].desc })],
    (p) => change({ field: 'preset', value: p }),
    true,
  );
  const speed = slider(WS.panel.behavior.speed, MOVEMENT_RANGE, (v) => `${Math.round(v * 100)}%`, (v, save) => change({ field: 'movementSpeed', value: v }, save));
  const toggle = (id: BehaviorId, enabled: boolean): void => {
    change({ field: 'behaviorToggle', id, enabled, current: deps.getSettings() });
  };
  const edges = switchRow(WS.panel.behavior.edges, WS.panel.behavior.edgesDesc, (on) => toggle('screenEdges', on));
  const hunt = switchRow(WS.panel.behavior.hunt, WS.panel.behavior.huntDesc, (on) => {
    // Hunting is the chase and the pounce; the pounce needs the chase.
    toggle('chaseCursor', on);
    toggle('pounce', on);
  });
  const play = slider(WS.panel.behavior.play, LEVEL_RANGE, (v) => `${Math.round(v * 100)}%`, (v, save) => change({ field: 'cursorPlay', value: v }, save));
  const sleep = slider(WS.panel.behavior.sleep, SLEEP_RANGE, (v) => WS.panel.behavior.sleepValue(Math.round(v)), (v, save) => change({ field: 'sleepMinutes', value: v }, save));
  const activity = slider(WS.panel.behavior.activity, LEVEL_RANGE, (v) => `${Math.round(v * 100)}%`, (v, save) => change({ field: 'autonomy', value: v }, save));

  // World events: the master switch, the rare pool, the pace, a session pause and one switch per event.
  const eventsMaster = switchRow(WS.panel.behavior.eventsMaster, WS.panel.behavior.eventsMasterDesc, (on) => change({ field: 'eventsEnabled', value: on }));
  const eventsRare = switchRow(WS.panel.behavior.eventsRare, WS.panel.behavior.eventsRareDesc, (on) => change({ field: 'rareEvents', value: on }));
  const eventsPace = slider(WS.panel.behavior.eventsPace, PACE_RANGE, (v) => WS.panel.behavior.eventsPaceValue(v), (v, save) => change({ field: 'eventPace', value: v }, save));
  const eventsPause = deps.session
    ? switchRow(WS.panel.behavior.eventsPause, WS.panel.behavior.eventsPauseDesc, (on) => {
        const session = deps.session;
        if (!session) return;
        session.set({ ...session.get(), eventsPaused: on });
        refresh();
      })
    : null;
  const eventSwitches = new Map<AnyEventId, HTMLInputElement>();
  const eventRows = ALL_EVENT_IDS.map((id) => {
    const row = switchRow(eventName(id), eventDescription(id), (on) => change({ field: 'eventToggle', id, enabled: on, current: deps.getSettings() }));
    eventSwitches.set(id, row.input);
    return row.root;
  });
  const eventsList = h('details', { class: 'events-list' }, [h('summary', { text: WS.panel.behavior.eventsList }), h('p', { class: 'note', text: WS.panel.behavior.eventsListNote }), ...eventRows]);
  const behaviorFold = fold(WS.panel.behavior.title, [
    preset.root,
    speed.root,
    edges.root,
    hunt.root,
    play.root,
    subhead(WS.panel.behavior.restTitle),
    sleep.root,
    activity.root,
    note(WS.panel.behavior.restNote),
    subhead(WS.panel.behavior.eventsTitle),
    eventsMaster.root,
    eventsRare.root,
    eventsPace.root,
    eventsPause?.root ?? null,
    eventsList,
  ]);

  // ---- animation: drawing style, shadow and emotes (reduced motion is under Settings)
  const style = radioCards<RenderStyle>(WS.cat.styleLabel, RENDER_STYLES, (s) => [h('span', { class: 'title', text: WS.styles[s] })], (s) => change({ field: 'style', value: s }));
  const shadow = switchRow(WS.cat.shadowLabel, null, (on) => change({ field: 'shadow', value: on }));
  const emotes = switchRow(WS.cat.emotesLabel, null, (on) => change({ field: 'emotes', value: on }));
  const animationFold = fold(WS.customize.animation, [style.root, shadow.root, emotes.root, note(WS.customize.animationNote)]);

  // ---- interactions
  const petting = switchRow(WS.panel.interactions.petting, null, (on) => change({ field: 'petting', value: on }));
  const dragging = switchRow(WS.panel.interactions.dragging, null, (on) => change({ field: 'dragging', value: on }));
  const throwing = switchRow(WS.panel.interactions.throwing, null, (on) => change({ field: 'throwing', value: on }));
  const laser = deps.session
    ? switchRow(WS.panel.interactions.laser, WS.panel.interactions.laserDesc, (on) => {
        const session = deps.session;
        if (!session) return;
        session.set({ ...session.get(), laser: on });
        refresh();
      })
    : null;
  const laserNeedsHunt = note(WS.panel.interactions.laserNeedsHunt, true);
  const interactionsFold = fold(WS.panel.interactions.title, [
    petting.root,
    dragging.root,
    throwing.root,
    note(WS.panel.interactions.note),
    laser?.root ?? null,
    laser ? laserNeedsHunt : null,
    laser ? note(WS.panel.interactions.laserLimit) : null,
  ]);

  const root = h('div', { class: 'customize-view' }, [who, look, personalityFold, behaviorFold, animationFold, interactionsFold]);

  function refresh(): void {
    const s = deps.getSettings();
    const id = activeId(s);
    const off = disabledBehaviorSet(s.behavior);
    if (paletteFor !== id) buildPalette(id);
    who.textContent = WS.customize.forCharacter(displayName(s, id));
    if (document.activeElement !== nameInput) nameInput.value = displayName(s, id);
    deps.secret?.setName(displayName(s, id));
    palette?.set(skinFor(s, id));
    size.set(s.appearance.size);
    personality.set(s.companion.personality);
    preset.set(selectedPreset(s));
    speed.set(s.behavior.movementSpeed);
    edges.input.checked = !off.has('screenEdges');
    hunt.input.checked = !off.has('chaseCursor') && !off.has('pounce');
    play.set(s.behavior.cursorPlay);
    play.input.disabled = off.has('chaseCursor');
    sleep.set(s.behavior.sleepAfterIdleMinutes);
    activity.set(s.behavior.autonomy);

    const events = s.companion.events;
    const disabled = new Set<AnyEventId>(events.disabled);
    eventsMaster.input.checked = events.enabled;
    eventsRare.input.checked = events.rare;
    eventsRare.input.disabled = !events.enabled;
    eventsPace.set(events.pace);
    eventsPace.input.disabled = !events.enabled;
    if (eventsPause && deps.session) {
      eventsPause.input.checked = deps.session.get().eventsPaused;
      eventsPause.input.disabled = !events.enabled;
    }
    for (const [eid, input] of eventSwitches) {
      input.checked = !disabled.has(eid);
      input.disabled = !events.enabled;
    }

    style.set(s.appearance.style);
    shadow.input.checked = s.appearance.shadow;
    emotes.input.checked = s.appearance.emotes;

    petting.input.checked = s.interaction.petting;
    dragging.input.checked = s.interaction.dragging;
    throwing.input.checked = s.interaction.throwing;
    if (laser && deps.session) {
      laser.input.checked = deps.session.get().laser;
      // Chasing a light is cursor play: with hunting and pointer play off the companion will not follow the dot.
      laser.input.disabled = off.has('chaseCursor');
      laserNeedsHunt.hidden = !off.has('chaseCursor');
    }
  }

  refresh();
  return { root, refresh, nameInput };
}
