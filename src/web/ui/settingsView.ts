// The parts of the SETTINGS area both web panels share: language, sound, accessibility and the
// performance note. Each panel adds its own host-specific cards (permissions and journal on Android;
// install, storage, file transfer, reset and About in the browser sheet). Every control goes through
// deps.apply (the web allow-list, settingsModel.ts patchFor).
import type { LanguagePreference } from '../../shared/i18n/locale';
import type { Settings } from '../../shared/settings';
import { h } from '../../renderer/settings/dom';
import { patchFor, VOLUME_RANGE, type WebField, type WebPatchResult } from '../settingsModel';
import { WS } from '../strings';
import { fold, note, radioCards, slider, switchRow } from './controls';

export interface CoreSettingsDeps {
  getSettings: () => Settings;
  apply: (patch: Record<string, Record<string, unknown>>, save: boolean) => WebPatchResult;
  /** A switch that turns sound on was just flipped (inside the gesture): unlock the AudioContext. */
  onSoundGesture?: () => void;
  onChanged?: () => void;
}

export interface CoreSettings {
  readonly language: HTMLElement;
  readonly sound: HTMLElement;
  readonly accessibility: HTMLElement;
  readonly performance: HTMLElement;
  refresh(): void;
}

export function createCoreSettings(deps: CoreSettingsDeps): CoreSettings {
  const change = (c: WebField, save = true): void => {
    const patch = patchFor(c);
    if (!patch) return;
    const r = deps.apply(patch, save);
    if (!r.ok || save) refresh();
    if (save) deps.onChanged?.();
  };

  const LANGUAGES: readonly LanguagePreference[] = ['auto', 'en', 'tr'];
  const language = radioCards<LanguagePreference>(
    WS.settingsPage.language.label,
    LANGUAGES,
    (v) => (v === 'auto' ? [h('span', { class: 'title', text: WS.settingsPage.language.auto }), h('span', { class: 'desc', text: WS.settingsPage.language.autoDesc })] : [h('span', { class: 'title', text: WS.settingsPage.language[v] })]),
    (v) => change({ field: 'language', value: v }),
    true,
  );
  const languageCard = fold(WS.settingsPage.language.title, [language.root], true);

  const soundMaster = switchRow(WS.panel.audio.master, WS.panel.audio.masterDesc, (on) => {
    // Inside the gesture: the one moment a phone lets audio start.
    if (on) deps.onSoundGesture?.();
    change({ field: 'soundEnabled', value: on });
  });
  const soundCat = switchRow(WS.panel.audio.cat, null, (on) => change({ field: 'soundCat', value: on }));
  const soundWorld = switchRow(WS.panel.audio.world, null, (on) => change({ field: 'soundWorld', value: on }));
  const volume = slider(WS.panel.audio.volume, VOLUME_RANGE, (v) => `${Math.round(v * 100)}%`, (v, save) => change({ field: 'volume', value: v }, save));
  const soundNote = note(WS.panel.audio.needsSound);
  const soundCard = fold(WS.panel.audio.title, [soundMaster.root, soundCat.root, soundWorld.root, volume.root, soundNote]);

  const reduced = switchRow(WS.panel.accessibility.reducedMotion, WS.panel.accessibility.reducedMotionDesc, (on) => change({ field: 'reducedMotion', value: on }));
  const accessibilityCard = fold(WS.panel.accessibility.title, [reduced.root, note(WS.panel.accessibility.systemNote)]);

  const performanceCard = fold(WS.settingsPage.performance.title, [note(WS.settingsPage.performance.text)]);

  function refresh(): void {
    const s = deps.getSettings();
    language.set(s.general.language);
    soundMaster.input.checked = s.sound.enabled;
    soundCat.input.checked = s.sound.cat;
    soundWorld.input.checked = s.sound.world;
    soundCat.input.disabled = !s.sound.enabled;
    soundWorld.input.disabled = !s.sound.enabled;
    volume.set(s.sound.volume);
    volume.input.disabled = !s.sound.enabled;
    soundNote.hidden = s.sound.enabled;
    reduced.input.checked = s.companion.reducedMotion;
  }

  refresh();
  return { language: languageCard, sound: soundCard, accessibility: accessibilityCard, performance: performanceCard, refresh };
}
