// The Android app's panel (GizeMate): four areas behind a bottom tab bar made for one hand.
//
//   HOME        the active character live (its own renderer, drawn small), the over-other-apps controls (a
//               large Start/Stop, Pause and Hide, and the in-app explanation that precedes Android's own
//               settings page), what it is doing right now, a few quick switches, and the way to the other
//               areas;
//   CHARACTERS  the seven companions, each animated, with description, personality, what it likes to do
//               and capability badges; choosing one restarts the page (main.ts);
//   CUSTOMIZE   the active companion: name, palette and size, personality, behaviour (activity, speed, rest
//               and sleep, screen edges, hunting, world events), animation and interactions (petting,
//               carrying, throwing, the session-only Laser mode);
//   SETTINGS    language, sound, accessibility, performance, the permissions of floating over other apps,
//               privacy and data (the journal, where data lives) and an advanced fold that opens the full
//               sheet (install, saving and loading a file, starting over).
//
// Every control goes through the web allow-list (settingsModel.ts), exactly like the sheet; nothing here
// reads the screen, other apps or the network. The floating companion itself is a separate service in
// another WebView: opening and closing this panel never touches its state, and while it runs this parked
// page only READS what it last saved (the journal) and never writes it.
//
// Built with the CSP-safe helpers (no innerHTML, no style attributes). The one timer (live status, every
// 2 s) runs only while the panel is open and the page is visible; the live character previews share one
// low-rate loop (ui/previewLoop.ts) that runs only on Home and Characters, while the panel is open, the
// page is visible and reduced motion is off.
import { h, uid } from '../renderer/settings/dom';
import { BRAND } from '../shared/brand';
import type { CharacterId } from '../shared/characters/registry';
import { type BehaviorState } from '../shared/cat';
import { JOURNAL_MAX, type AnyEventId, type JournalEntry, type Mood, type PersonalityId } from '../shared/companion';
import { PERSONALITY_TEXT } from '../shared/personalityText';
import { disabledBehaviorSet, type BehaviorId, type Settings } from '../shared/settings';
import { eventName, formatJournalDate, journalText } from '../shared/worldText';
import type { FloatingElements } from './floatingUi';
import type { FloatingState } from './floatingProtocol';
import type { SessionFlags } from './sessionFlags';
import { patchFor, type WebField, type WebPatchResult } from './settingsModel';
import { activityLabel } from './status';
import type { WebSecretName } from './secretName';
import { WS } from './strings';
import { createActiveCard, createCharactersView } from './ui/charactersView';
import { fold, note, subhead, switchRow } from './ui/controls';
import { createCustomizeView } from './ui/customizeView';
import { bindReducedMotion } from './ui/motion';
import { createBrowserPreviewLoop } from './ui/previewLoop';
import { createCoreSettings } from './ui/settingsView';
import { createTabs } from './ui/tabs';

/** What the status chips show: the in-page sim's companion status plus its behaviour state. */
export interface CompanionView {
  mood: Mood;
  event: AnyEventId | null;
  nextEventInMs: number | null;
  nearestPersonality: PersonalityId;
  personalityIsAuto: boolean;
  state: BehaviorState;
}

/**
 * Where the panel reads the companion from (main.ts). While the floating companion runs its WebView owns
 * it, so `live()` is false: no live status (null), the journal is the stored snapshot, and it cannot be
 * cleared from here.
 */
export interface CompanionSource {
  live(): boolean;
  status(): CompanionView | null;
  /** Oldest first, as the sim keeps it. */
  journal(): readonly JournalEntry[];
  /** True when the journal was cleared and saved. */
  clearJournal(): boolean;
}

export interface AndroidPanelDeps {
  getSettings: () => Settings;
  /** One control's patch, through the web allow-list; `save` false is a live preview while a slider moves. */
  apply: (patch: Record<string, Record<string, unknown>>, save: boolean) => WebPatchResult;
  companion: CompanionSource;
  /** Laser mode and the events pause: session-only, never stored with the settings (sessionFlags.ts). */
  session: { get(): SessionFlags; set(next: SessionFlags): void };
  /** A switch that turns sound on was just flipped (inside the gesture): unlock the AudioContext. */
  onSoundGesture?: () => void;
  /** Opens the full settings sheet (install, saving and loading a file, start over). */
  onCustomize: () => void;
  /** Leaves the panel for the in-app companion. */
  onStage: () => void;
  version: string;
  /** The panel opened or closed (the in-app companion steps aside while it is open). */
  onOpenChange?: (open: boolean) => void;
  /** The name-dependent extra (secretName.ts); absent: the name field is plain. */
  secret?: WebSecretName;
}

export interface AndroidPanel {
  readonly root: HTMLElement;
  /** The floating-companion buttons and texts, for createFloatingUi (floatingUi.ts). */
  readonly floating: FloatingElements;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** The settings changed elsewhere (the sheet, a profile): show them. */
  refresh(): void;
  /** Native's floating state: the chip, the hero line and the permission rows. */
  setFloatingState(state: FloatingState): void;
}

/** How often the live status and the journal are re-read while the panel is open, ms. */
const LIVE_REFRESH_MS = 2000;
/** The tab the person was on survives a restart of the page (language or character change). */
const TAB_KEY = 'gizecat.panel.tab';

export function createAndroidPanel(deps: AndroidPanelDeps): AndroidPanel {
  let isOpen = false;
  let liveTimer: number | null = null;

  const change = (c: WebField, save = true): void => {
    const patch = patchFor(c);
    if (!patch) return;
    const r = deps.apply(patch, save);
    // A refused change puts the old value back; a saved one may change other controls too.
    if (!r.ok || save) refresh();
  };

  const previews = createBrowserPreviewLoop();
  const motion = bindReducedMotion(previews, deps.getSettings);

  // ---- header
  const chip = h('span', { class: 'chip', 'aria-live': 'polite' });
  const head = h('header', { class: 'panel-head' }, [
    h('img', { class: 'panel-logo', src: 'icons/icon-192.png', alt: '', width: 48, height: 48 }),
    h('div', { class: 'panel-title' }, [h('h1', { text: BRAND.product }), h('p', { text: WS.panel.subtitle })]),
    chip,
  ]);

  // ================= HOME
  const activeCard = createActiveCard({ getSettings: deps.getSettings, previews });

  // The floating companion: the elements createFloatingUi drives.
  const heroText = h('p', { class: 'lead' });
  const startBtn = h('button', { type: 'button', class: 'primary big' });
  const pauseBtn = h('button', { type: 'button', hidden: true });
  const hideBtn = h('button', { type: 'button', hidden: true });
  const stopBtn = h('button', { type: 'button', class: 'danger', hidden: true });
  const statusLine = h('p', { class: 'panel-status', role: 'status', 'aria-live': 'polite', hidden: true });
  const askTitle = h('h3', { id: 'floating-ask-title' });
  const askText = h('div', { class: 'ask-text' });
  const askOpen = h('button', { type: 'button', class: 'primary' });
  const askLater = h('button', { type: 'button' });
  const ask = h('div', { class: 'panel-ask', role: 'region', hidden: true }, [askTitle, askText, h('div', { class: 'actions' }, [askOpen, askLater])]);
  const heroId = uid('home-hero');
  const hero = h('section', { class: 'pcard hero', 'aria-labelledby': heroId }, [
    h('h2', { id: heroId, text: WS.panel.hero.title }),
    heroText,
    h('div', { class: 'hero-actions' }, [startBtn, pauseBtn, hideBtn, stopBtn]),
    statusLine,
    ask,
  ]);

  const chipItem = (label: string): { root: HTMLElement; value: HTMLElement } => {
    const value = h('span', { class: 'sc-value' });
    return { root: h('li', { class: 'status-chip' }, [h('span', { class: 'sc-label', text: label }), value]), value };
  };
  const moodChip = chipItem(WS.panel.companion.mood);
  const doingChip = chipItem(WS.panel.companion.activity);
  const personalityChip = chipItem(WS.panel.companion.personality);
  const eventChip = chipItem(WS.panel.companion.event);
  const liveNote = note(WS.panel.companion.floatingNote, true);
  const statusId = uid('home-status');
  const statusCard = h('section', { class: 'pcard status-block', 'aria-labelledby': statusId }, [
    h('h2', { id: statusId, text: WS.panel.companion.statusTitle }),
    h('ul', { class: 'status-chips' }, [moodChip.root, doingChip.root, personalityChip.root, eventChip.root]),
    liveNote,
  ]);

  // A few quick switches (the same settings as in Customize and Settings: refresh keeps them in step).
  const toggle = (id: BehaviorId, enabled: boolean): void => change({ field: 'behaviorToggle', id, enabled, current: deps.getSettings() });
  const quickSound = switchRow(WS.panel.audio.master, null, (on) => {
    if (on) deps.onSoundGesture?.();
    change({ field: 'soundEnabled', value: on });
  });
  const quickEvents = switchRow(WS.panel.behavior.eventsMaster, null, (on) => change({ field: 'eventsEnabled', value: on }));
  const quickEdges = switchRow(WS.panel.behavior.edges, null, (on) => toggle('screenEdges', on));
  const quickId = uid('home-quick');
  const quickCard = h('section', { class: 'pcard', 'aria-labelledby': quickId }, [h('h2', { id: quickId, text: WS.home.quickTitle }), note(WS.home.quickDesc), quickSound.root, quickEvents.root, quickEdges.root]);

  const goCustomize = h('button', { type: 'button', class: 'primary', text: WS.home.customize });
  const goCharacters = h('button', { type: 'button', text: WS.home.switchCharacter });
  const stageBtn = h('button', { type: 'button', text: WS.panel.footer.stage });
  stageBtn.addEventListener('click', () => deps.onStage());
  const homeActions = h('div', { class: 'actions home-actions' }, [goCustomize, goCharacters, stageBtn]);

  const homePanel = h('div', { class: 'tab-page' }, [activeCard.root, hero, statusCard, quickCard, homeActions]);

  // ================= CHARACTERS
  const characters = createCharactersView({
    getSettings: deps.getSettings,
    previews,
    choose: (id: CharacterId) => change({ field: 'activeCharacter', value: id }),
  });
  const charactersPanel = h('div', { class: 'tab-page' }, [characters.root]);

  // ================= CUSTOMIZE
  const customize = createCustomizeView({ getSettings: deps.getSettings, apply: deps.apply, session: deps.session, secret: deps.secret, onChanged: () => refresh() });
  const customizePanel = h('div', { class: 'tab-page' }, [customize.root]);

  // ================= SETTINGS
  const core = createCoreSettings({ getSettings: deps.getSettings, apply: deps.apply, onSoundGesture: deps.onSoundGesture, onChanged: () => refresh() });

  // Floating over other apps: what Android has allowed.
  const overlayState = h('span', { class: 'row-state' });
  const overlayRow = h('div', { class: 'perm-row' }, [h('span', { class: 'row-label', text: WS.panel.permissions.overlay }), overlayState]);
  const notifState = h('span', { class: 'row-state' });
  const notifRow = h('div', { class: 'perm-row' }, [h('span', { class: 'row-label', text: WS.panel.permissions.notifications }), notifState]);
  const desktopFold = fold(WS.settingsPage.desktop.title, [h('div', { class: 'perm-list' }, [overlayRow, notifRow]), note(WS.panel.permissions.note)]);

  // Privacy and data: where it lives, and the journal (inspect, clear); file saving and starting over are in the sheet.
  const journalEnabled = switchRow(WS.panel.journal.enabled, null, (on) => change({ field: 'journalEnabled', value: on }));
  const journalCount = h('p', { class: 'note', 'aria-live': 'polite' });
  const journalList = h('ol', { class: 'journal-list' });
  const journalEmpty = h('p', { class: 'journal-empty', hidden: true });
  const journalNote = note(WS.panel.journal.storedNote, true);
  const journalMsg = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const clearBtn = h('button', { type: 'button', class: 'danger', text: WS.panel.journal.clear });
  const clearYes = h('button', { type: 'button', class: 'danger', text: WS.panel.journal.clearConfirm });
  const clearNo = h('button', { type: 'button', text: WS.panel.journal.clearCancel });
  const clearAsk = h('div', { class: 'panel-ask', role: 'group', 'aria-label': WS.panel.journal.clear, hidden: true }, [
    h('p', { text: WS.panel.journal.clearAsk }),
    h('div', { class: 'actions' }, [clearYes, clearNo]),
  ]);
  let journalSignature = '';
  clearBtn.addEventListener('click', () => {
    clearAsk.hidden = false;
    clearNo.focus();
  });
  clearNo.addEventListener('click', () => {
    clearAsk.hidden = true;
    clearBtn.focus();
  });
  clearYes.addEventListener('click', () => {
    clearAsk.hidden = true;
    journalMsg.textContent = deps.companion.clearJournal() ? WS.panel.journal.cleared : WS.panel.journal.clearFailed;
    journalSignature = '';
    refreshLive();
    clearBtn.focus();
  });
  const privacyFold = fold(WS.settingsPage.privacy.title, [
    ...WS.privacy.text('app').map((t) => note(t)),
    subhead(WS.settingsPage.privacy.dataTitle),
    note(WS.storage.androidApp),
    subhead(WS.settingsPage.privacy.memoryTitle),
    note(WS.settingsPage.privacy.memoryDesc),
    subhead(WS.panel.journal.title),
    note(WS.panel.journal.desc),
    journalEnabled.root,
    journalCount,
    journalEmpty,
    journalList,
    journalNote,
    h('div', { class: 'actions' }, [clearBtn]),
    clearAsk,
    journalMsg,
    note(WS.settingsPage.privacy.moreNote),
  ]);

  const moreBtn = h('button', { type: 'button', text: WS.panel.footer.settings });
  moreBtn.addEventListener('click', () => deps.onCustomize());
  const advancedFold = fold(WS.settingsPage.advanced.title, [note(WS.settingsPage.advanced.note), h('div', { class: 'actions' }, [moreBtn]), note(WS.about.version(deps.version))]);

  const settingsPanel = h('div', { class: 'tab-page' }, [core.language, core.sound, core.accessibility, core.performance, desktopFold, privacyFold, advancedFold]);

  // ================= navigation
  const content = h('div', { class: 'panel-content', id: 'panel-content', tabindex: '-1' });
  const tabs = createTabs({
    label: WS.nav.label,
    memoryKey: TAB_KEY,
    tabs: [
      { id: 'home', label: WS.nav.home, panel: homePanel },
      { id: 'characters', label: WS.nav.characters, panel: charactersPanel },
      { id: 'customize', label: WS.nav.customize, panel: customizePanel },
      { id: 'settings', label: WS.nav.settings, panel: settingsPanel },
    ],
    onSelect: () => {
      syncPreviews();
      content.scrollTop = 0;
    },
  });
  content.append(homePanel, charactersPanel, customizePanel, settingsPanel);
  goCustomize.addEventListener('click', () => tabs.select('customize', true));
  goCharacters.addEventListener('click', () => tabs.select('characters', true));

  const skip = h('a', { class: 'skip-link', href: '#panel-content', text: WS.nav.skip });
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    content.focus();
  });
  // DOM order is the reading order (skip link, header, navigation, content); CSS puts the bar at the bottom.
  const root = h('main', { class: 'panel', id: 'panel', 'aria-label': BRAND.product, hidden: true }, [skip, head, tabs.bar, content]);
  tabs.bar.classList.add('tabbar-bottom');

  /** The previews run only on the pages that show them, while the panel is open. */
  function syncPreviews(): void {
    previews.setActive(isOpen && (tabs.current === 'home' || tabs.current === 'characters'));
  }

  /** The live status chips and the journal: read from the companion (or its stored snapshot), never written here. */
  function refreshLive(): void {
    const s = deps.getSettings();
    const live = deps.companion.live();
    const status = deps.companion.status();
    const flags = deps.session.get();
    liveNote.hidden = live;
    moodChip.root.hidden = status === null;
    doingChip.root.hidden = status === null;
    if (status) {
      moodChip.value.textContent = WS.panel.companion.moods[status.mood] ?? String(status.mood);
      doingChip.value.textContent = activityLabel(status.state);
    }
    // 'auto' shows its nearest profile once the live companion can say which; the choice itself never changes.
    const choice = s.companion.personality;
    personalityChip.value.textContent =
      choice === 'auto'
        ? status && status.personalityIsAuto
          ? WS.panel.companion.personalityAuto(PERSONALITY_TEXT[status.nearestPersonality]?.name ?? '')
          : WS.panel.personality.auto
        : PERSONALITY_TEXT[choice].name;
    let eventText: string;
    if (!s.companion.events.enabled) eventText = WS.panel.companion.eventOff;
    else if (flags.eventsPaused) eventText = WS.panel.companion.eventPaused;
    else if (status?.event) eventText = WS.panel.companion.eventRunning(eventName(status.event));
    else if (status && status.nextEventInMs !== null && Number.isFinite(status.nextEventInMs)) eventText = WS.panel.companion.eventNext(Math.max(1, Math.round(status.nextEventInMs / 60_000)));
    else eventText = WS.panel.companion.eventNone;
    // Without a live companion nothing is known about the schedule: only the switches can be said.
    eventChip.root.hidden = status === null && s.companion.events.enabled && !flags.eventsPaused;
    eventChip.value.textContent = eventText;

    const entries = deps.companion.journal();
    const newest = entries.length > 0 ? entries[entries.length - 1] : undefined;
    const signature = `${live ? 'l' : 's'}:${entries.length}:${newest ? newest.at : 0}:${s.companion.journal.enabled ? 1 : 0}`;
    journalNote.hidden = live;
    clearBtn.disabled = !live;
    if (signature !== journalSignature) {
      journalSignature = signature;
      const shown = entries.slice(-JOURNAL_MAX).reverse();
      journalList.replaceChildren(
        ...shown.map((e) => h('li', { class: 'journal-entry' }, [h('time', { class: 'journal-date', text: formatJournalDate(e.at) }), h('span', { class: 'journal-text', text: journalText(e.id, e.outcome) })])),
      );
      journalCount.textContent = shown.length > 0 ? WS.panel.journal.count(shown.length) : '';
      journalEmpty.hidden = shown.length > 0;
      journalEmpty.textContent = s.companion.journal.enabled ? WS.panel.journal.empty : WS.panel.journal.emptyOff;
    }
  }

  function refresh(): void {
    const s = deps.getSettings();
    const off = disabledBehaviorSet(s.behavior);
    activeCard.refresh();
    characters.refresh();
    customize.refresh();
    core.refresh();
    motion.sync();
    quickSound.input.checked = s.sound.enabled;
    quickEvents.input.checked = s.companion.events.enabled;
    quickEdges.input.checked = !off.has('screenEdges');
    journalEnabled.input.checked = s.companion.journal.enabled;
    journalSignature = '';
    refreshLive();
  }

  function setFloatingState(state: FloatingState): void {
    const word = !state.running ? WS.panel.chip.off : state.hidden ? WS.panel.chip.hidden : state.paused ? WS.panel.chip.paused : WS.panel.chip.running;
    chip.textContent = word;
    chip.className = `chip ${!state.running ? 'chip-off' : state.hidden || state.paused ? 'chip-idle' : 'chip-on'}`;
    heroText.textContent = !state.running ? WS.panel.hero.off : state.hidden ? WS.panel.hero.hidden : state.paused ? WS.panel.hero.paused : WS.panel.hero.running;
    overlayState.textContent = state.overlayPermission ? WS.panel.permissions.overlayOk : WS.panel.permissions.overlayNeeded;
    overlayState.className = `row-state ${state.overlayPermission ? 'ok' : 'needed'}`;
    notifState.textContent = state.notifications ? WS.panel.permissions.notificationsOn : state.canAskNotifications ? WS.panel.permissions.notificationsOptional : WS.panel.permissions.notificationsOff;
    notifState.className = `row-state ${state.notifications ? 'ok' : 'optional'}`;
    // Whether the floating companion runs decides what the status and the journal can show.
    if (isOpen) refreshLive();
  }
  // Before native answers: calm defaults, not a guess about the permission.
  heroText.textContent = WS.panel.hero.off;
  chip.textContent = WS.panel.chip.off;
  chip.className = 'chip chip-off';

  function stopLiveTimer(): void {
    if (liveTimer === null) return;
    window.clearInterval(liveTimer);
    liveTimer = null;
  }

  function setOpen(open: boolean): void {
    if (isOpen === open) return;
    isOpen = open;
    root.hidden = !open;
    document.documentElement.classList.toggle('gizecat-panel-open', open);
    try {
      deps.onOpenChange?.(open);
    } catch {
      // The listener is optional.
    }
    syncPreviews();
    if (open) {
      refresh();
      // Nothing keeps the CPU busy behind a page nobody can see: no ticks while hidden.
      liveTimer = window.setInterval(() => {
        if (!document.hidden) refreshLive();
      }, LIVE_REFRESH_MS);
      head.querySelector('h1')?.setAttribute('tabindex', '-1');
      head.querySelector<HTMLElement>('h1')?.focus();
    } else {
      stopLiveTimer();
      // A half-answered confirmation does not wait for the next visit.
      clearAsk.hidden = true;
      journalMsg.textContent = '';
    }
  }

  refresh();
  return {
    root,
    floating: { start: startBtn, pause: pauseBtn, hide: hideBtn, stop: stopBtn, ask, askText, askOpen, askLater, status: statusLine },
    get isOpen() {
      return isOpen;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    refresh,
    setFloatingState,
  };
}
