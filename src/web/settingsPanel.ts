// The web host's settings sheet (GizeMate): a native <dialog> opened with showModal(), which brings the
// focus trap, the top layer and Escape-to-close with no code of ours (the page never listens to keys). A
// bottom sheet on narrow windows, a side sheet from 700 CSS px (web.css), so the companion stays visible
// as a live preview while it is changed.
//
// Four areas behind a tab bar at the top of the sheet (the same structure as the Android panel,
// androidPanel.ts, and built from the same parts in ui/):
//   HOME        the active character live, quick switches, how to play;
//   CHARACTERS  the seven companions, animated, with descriptions and badges; choosing one restarts the page;
//   CUSTOMIZE   the active companion's name, palette, size, personality, behaviour, animation, interactions;
//   SETTINGS    language, sound, accessibility, performance, privacy and data (where data lives, saving to
//               a file and loading one), install and the offline copy, advanced (reset, start over), About.
//
// Built with the desktop settings' CSP-safe helpers (h/svg: no innerHTML, no style attributes). No
// <form>: a method=dialog form could run into form-action 'none', so buttons call close(). Controls
// report on input/change/click only; every change goes through deps.apply, which main.ts routes through
// the web allow-list (settingsModel.ts). The live previews share one low-rate loop that runs only on Home
// and Characters, only while the sheet is open and visible, and never under reduced motion.
import type { Settings } from '../shared/settings';
import type { CharacterId } from '../shared/characters/registry';
import { h, uid } from '../renderer/settings/dom';
import { showEvictionNote, type HostMode, type InstallHint } from './hostMode';
import { patchFor, type WebField, type WebPatchResult } from './settingsModel';
import type { WebSecretName } from './secretName';
import { installText, WS } from './strings';
import type { OfflineState } from './swRegister';
import { createActiveCard, createCharactersView } from './ui/charactersView';
import { fold, note, subhead, switchRow } from './ui/controls';
import { createCustomizeView } from './ui/customizeView';
import { bindReducedMotion } from './ui/motion';
import { createBrowserPreviewLoop } from './ui/previewLoop';
import { createCoreSettings } from './ui/settingsView';
import { createTabs } from './ui/tabs';

export interface SettingsPanelDeps {
  dialog: HTMLDialogElement;
  getSettings: () => Settings;
  /**
   * Applies one control's patch (main.ts: allow-list, validation, privacy forced off). `save` false is
   * a live preview while a slider moves; the final value comes with `save` true.
   */
  apply: (patch: Record<string, Record<string, unknown>>, save: boolean) => WebPatchResult;
  /** Inside the click that turns sound on: unlocks audio (audioUnlock.ts). */
  onSoundGesture: () => void;
  onResetSettings: () => void;
  /** Deletes the companion and reloads; false when storage refused (the sheet says so). */
  onStartOver: () => boolean;
  host: HostMode;
  installHint: () => InstallHint;
  /** The browser's install prompt (only offered when installHint() is 'prompt'). */
  onInstall: () => void;
  storageText: () => string;
  /** The offline copy's state (swRegister.ts); null shows no line (the Android app). */
  offlineState: () => OfflineState | null;
  version: string;
  onOpenChange?: (open: boolean) => void;
  /** The name-dependent extra (secretName.ts); absent: the name field is plain. */
  secret?: WebSecretName;
}

export interface SettingsPanel {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Puts the current settings and status into the controls (after a change made elsewhere). */
  refresh(): void;
  /**
   * "Take your companion to another device": an empty container for the profile export/import, inside a
   * section that stays hidden until something is put in it (setTransferVisible).
   */
  readonly transferSlot: HTMLElement;
  setTransferVisible(visible: boolean): void;
}

/** The tab the person was on survives a restart of the page (language or character change). */
const TAB_KEY = 'gizecat.sheet.tab';
/**
 * Set (sessionStorage, this tab only) while the sheet is open and cleared when the person closes it. A restart of the page
 * (language or character change) never closes it, so the flag survives the reload and the sheet opens again on its
 * remembered tab, instead of leaving the person on a bare page with focus on the body.
 */
const OPEN_KEY = 'gizecat.sheet.open';

export function sheetOpenFlag(write?: boolean): boolean {
  try {
    const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (!store) return false;
    if (write === true) store.setItem(OPEN_KEY, '1');
    else if (write === false) store.removeItem(OPEN_KEY);
    return store.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const { dialog } = deps;
  let isOpen = false;

  const change = (c: WebField, save = true): void => {
    const patch = patchFor(c);
    if (!patch) return;
    const r = deps.apply(patch, save);
    if (!r.ok || save) refresh();
  };

  const previews = createBrowserPreviewLoop();
  const motion = bindReducedMotion(previews, deps.getSettings);

  // ---- header
  const titleId = 'settings-title';
  const closeBtn = h('button', { type: 'button', autofocus: true, text: WS.sheet.close });
  closeBtn.addEventListener('click', () => close());
  const head = h('div', { class: 'sheet-head' }, [h('h2', { id: titleId, text: WS.sheet.title }), closeBtn]);

  // ================= HOME
  const activeCard = createActiveCard({ getSettings: deps.getSettings, previews });
  const quickSound = switchRow(WS.panel.audio.master, null, (on) => {
    // The change of a checkbox is dispatched within the click (a user gesture): audio can start here.
    if (on) deps.onSoundGesture();
    change({ field: 'soundEnabled', value: on });
  });
  const quickEmotes = switchRow(WS.cat.emotesLabel, null, (on) => change({ field: 'emotes', value: on }));
  const quickId = uid('sheet-quick');
  const quickCard = h('section', { class: 'pcard', 'aria-labelledby': quickId }, [h('h2', { id: quickId, text: WS.home.quickTitle }), note(WS.home.quickDesc), quickSound.root, quickEmotes.root]);
  const goCustomize = h('button', { type: 'button', class: 'primary', text: WS.home.customize });
  const goCharacters = h('button', { type: 'button', text: WS.home.switchCharacter });
  const howFold = fold(WS.home.howTitle, WS.help.text.map((t) => h('p', { text: t })));
  const homePanel = h('div', { class: 'tab-page' }, [activeCard.root, quickCard, h('div', { class: 'actions home-actions' }, [goCustomize, goCharacters]), howFold]);

  // ================= CHARACTERS
  const characters = createCharactersView({
    getSettings: deps.getSettings,
    previews,
    choose: (id: CharacterId) => change({ field: 'activeCharacter', value: id }),
  });
  const charactersPanel = h('div', { class: 'tab-page' }, [characters.root]);

  // ================= CUSTOMIZE (no session-only switches here: those belong to the Android panel)
  const customize = createCustomizeView({ getSettings: deps.getSettings, apply: deps.apply, secret: deps.secret, onChanged: () => refresh() });
  const customizePanel = h('div', { class: 'tab-page' }, [customize.root]);

  // ================= SETTINGS
  const core = createCoreSettings({ getSettings: deps.getSettings, apply: deps.apply, onSoundGesture: deps.onSoundGesture, onChanged: () => refresh() });

  // ---- install (not in the Android app)
  const installNote = h('p', {});
  const installBtn = h('button', { type: 'button', class: 'primary', text: WS.install.promptButton });
  installBtn.addEventListener('click', () => deps.onInstall());
  const appleStorageNote = note(WS.install.appleStorage);
  const evictionNote = h('p', { class: 'note warn', text: WS.install.evictionNote });
  const installFold = fold(WS.install.title, [installNote, h('div', { class: 'actions' }, [installBtn]), appleStorageNote, evictionNote]);

  // ---- privacy and data: what is kept where, the offline copy, and the file transfer
  // profileUi.ts fills `transferSlot` with the export/import controls built on
  // src/shared/profileTransfer.ts (a local file only, never a network upload) and main.ts then calls
  // setTransferVisible(true). The section stays hidden while it is empty.
  const storageNote = h('p', {});
  const offlineNote = h('p', { class: 'note', 'aria-live': 'polite' });
  offlineNote.hidden = true;
  const transferSlot = h('div', { class: 'transfer-slot', id: 'transfer-slot' });
  const transferSection = h('section', { id: 'transfer-section', 'aria-labelledby': 'transfer-title' }, [h('h3', { id: 'transfer-title', text: WS.transfer.title }), transferSlot]);
  transferSection.hidden = true;
  const privacyFold = fold(WS.settingsPage.privacy.title, [
    ...WS.privacy.text(deps.host.place).map((t) => h('p', { text: t })),
    subhead(WS.settingsPage.privacy.dataTitle),
    storageNote,
    offlineNote,
    subhead(WS.settingsPage.privacy.memoryTitle),
    note(WS.settingsPage.privacy.memoryDesc),
    transferSection,
  ]);

  // ---- advanced: start again
  const resetNote = h('p', { class: 'note', 'aria-live': 'polite' });
  const resetBtn = h('button', { type: 'button', text: WS.reset.resetSettings });
  resetBtn.addEventListener('click', () => {
    deps.onResetSettings();
    resetNote.textContent = WS.reset.resetDone;
    refresh();
  });
  const startOverBtn = h('button', { type: 'button', class: 'danger', text: WS.reset.startOver });
  const confirmBtn = h('button', { type: 'button', class: 'danger', text: WS.reset.startOverConfirm });
  const cancelBtn = h('button', { type: 'button', text: WS.reset.startOverCancel });
  const confirmRow = h('div', { class: 'actions' }, [confirmBtn, cancelBtn]);
  const confirmAsk = h('p', { class: 'note warn', text: WS.reset.startOverAsk });
  const startOverNote = h('p', { class: 'note', 'aria-live': 'polite' });
  const setConfirming = (on: boolean): void => {
    confirmRow.hidden = !on;
    confirmAsk.hidden = !on;
    startOverBtn.hidden = on;
  };
  startOverBtn.addEventListener('click', () => {
    setConfirming(true);
    cancelBtn.focus();
  });
  cancelBtn.addEventListener('click', () => {
    setConfirming(false);
    startOverBtn.focus();
  });
  confirmBtn.addEventListener('click', () => {
    if (!deps.onStartOver()) startOverNote.textContent = WS.reset.startOverFailed;
  });
  setConfirming(false);
  const advancedFold = fold(WS.settingsPage.advanced.title, [
    note(WS.settingsPage.advanced.note),
    h('h3', { class: 'subhead', text: WS.reset.title }),
    note(WS.reset.resetSettingsDesc),
    h('div', { class: 'actions' }, [resetBtn]),
    resetNote,
    note(WS.reset.startOverDesc),
    h('div', { class: 'actions' }, [startOverBtn]),
    confirmAsk,
    confirmRow,
    startOverNote,
  ]);

  // ---- about
  // A plain link in the same window: it stays inside an installed app, opens offline, and the page's
  // own link comes back here. A new window would leave the Home Screen app for Safari.
  const privacyLink = h('a', { href: WS.about.privacyHref, text: WS.about.privacy });
  const licensesLink = h('a', { href: 'licenses.html', text: WS.about.licenses });
  const aboutFold = fold(WS.about.title, [h('p', { text: WS.about.text }), h('p', { class: 'note', text: WS.about.version(deps.version) }), h('p', {}, [privacyLink]), h('p', {}, [licensesLink])]);

  const settingsPanel = h('div', { class: 'tab-page' }, [core.language, core.sound, core.accessibility, core.performance, installFold, privacyFold, advancedFold, aboutFold]);

  // ================= navigation
  const content = h('div', { class: 'sheet-content' });
  const tabs = createTabs({
    label: WS.nav.label,
    className: 'tabbar tabbar-top',
    memoryKey: TAB_KEY,
    tabs: [
      { id: 'home', label: WS.nav.home, panel: homePanel },
      { id: 'characters', label: WS.nav.characters, panel: charactersPanel },
      { id: 'customize', label: WS.nav.customize, panel: customizePanel },
      { id: 'settings', label: WS.nav.settings, panel: settingsPanel },
    ],
    onSelect: () => syncPreviews(),
  });
  content.append(homePanel, charactersPanel, customizePanel, settingsPanel);
  goCustomize.addEventListener('click', () => tabs.select('customize', true));
  goCharacters.addEventListener('click', () => tabs.select('characters', true));

  dialog.replaceChildren(h('div', { class: 'sheet-top' }, [head, tabs.bar]), content);
  if (!dialog.hasAttribute('aria-labelledby')) dialog.setAttribute('aria-labelledby', titleId);

  /** The previews run only on the pages that show them, while the sheet is open. */
  function syncPreviews(): void {
    previews.setActive(isOpen && (tabs.current === 'home' || tabs.current === 'characters'));
  }

  function refresh(): void {
    const s = deps.getSettings();
    activeCard.refresh();
    characters.refresh();
    customize.refresh();
    core.refresh();
    motion.sync();
    quickSound.input.checked = s.sound.enabled;
    quickEmotes.input.checked = s.appearance.emotes;
    const hint = deps.installHint();
    const text = installText(hint);
    installFold.hidden = text === null && !showEvictionNote(deps.host);
    installNote.textContent = text ?? '';
    installNote.hidden = text === null;
    installBtn.hidden = hint !== 'prompt';
    appleStorageNote.hidden = hint !== 'apple';
    evictionNote.hidden = !showEvictionNote(deps.host);
    storageNote.textContent = deps.storageText();
    const offline = deps.offlineState();
    offlineNote.hidden = offline === null;
    offlineNote.textContent = offline === null ? '' : WS.offline[offline];
    offlineNote.classList.toggle('warn', offline === 'update-ready' || offline === 'failed');
  }

  function setOpen(open: boolean): void {
    if (isOpen === open) return;
    isOpen = open;
    sheetOpenFlag(open);
    syncPreviews();
    try {
      deps.onOpenChange?.(open);
    } catch {
      // The listener is optional.
    }
  }

  function open(): void {
    if (isOpen) return;
    refresh();
    resetNote.textContent = '';
    startOverNote.textContent = '';
    setConfirming(false);
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    setOpen(true);
  }

  function close(): void {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    setOpen(false);
  }

  // Escape (native), Android back (Chrome closes modal dialogs) or close(): all end here.
  dialog.addEventListener('close', () => setOpen(false));
  // A tap on the backdrop (outside the sheet's box) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });

  // Back from a restart with the sheet open: open it again on the remembered tab (after boot has finished wiring the page).
  if (sheetOpenFlag() && typeof setTimeout === 'function') {
    setTimeout(() => {
      open();
      tabs.select(tabs.current, true);
    }, 0);
  }

  return {
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    refresh,
    transferSlot,
    setTransferVisible(visible: boolean) {
      transferSection.hidden = !visible;
    },
  };
}
