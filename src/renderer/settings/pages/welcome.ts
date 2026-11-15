import type { PageContext, PageView } from '../context';
import { characterCard, allCharacterIds, displayName, paletteOf } from '../charactersView';
import { button, group, page, radioGroup, row, runAction, setNote, statusLine, type RadioItem } from '../controls';
import type { CharacterId } from '../../../shared/characters/registry';
import { activeCharacterOf } from '../charactersView';
import { fieldId } from '../patch';
import type { FieldBinding } from '../store';
import { languageRow } from './language';
import { h, icon, type GlyphName } from '../dom';
import { formatShortcut } from '../format';
import { previewCanvas } from '../previewCanvas';
import { deviceWords, getLocale, platformWording, S, type PlatformWording } from '../strings';

const W = S.welcome;
const UW = S.ui.welcome;
const CONTROL_ICONS: readonly GlyphName[] = ['touch', 'mouse', 'heart', 'more', 'pin'];
/** Index in W.privacyPoints of the point about what the app knows. */
const KNOWS_POINT = 1;

/**
 * The platform-specific parts of Welcome (1.4.0). Windows keeps its text; elsewhere the cat keeps to
 * the floor, and the tray entry and the privacy points use that platform's words. The point about
 * what the app knows is replaced there: it does not track windows or infer typing. Order and length
 * stay, because the page shows the first point separately.
 */
export function welcomePlatformText(wording: PlatformWording): {
  intro: (name: string) => string;
  controls: ReadonlyArray<{ title: string; text: string }>;
  privacyPoints: readonly string[];
} {
  if (wording === 'windows') return { intro: W.intro, controls: W.controls, privacyPoints: W.privacyPoints };
  return {
    intro: W.introFloorOnly,
    controls: [...W.controls.slice(0, -1), wording === 'mac' ? W.controlTrayMac : W.controlTrayElsewhere],
    privacyPoints: W.privacyPoints.map((p, i) => deviceWords(i === KNOWS_POINT ? W.privacyPointFloorOnly : p, wording)),
  };
}

export function welcomePage(ctx: PageContext): PageView {
  const wording = platformWording(ctx.store.view.status.platform);
  const text = welcomePlatformText(wording);
  const heading = h('h2', { class: 'hero-title' });
  const intro = h('p', { class: 'hero-text' });
  const preview = previewCanvas(ctx, activeCharacterOf(ctx.store.settings), '', 'preview-canvas preview-small', 160, 120);
  const art = h('div', { class: 'hero-art', 'aria-hidden': 'true' }, [preview.element]);

  const controls = h(
    'ul',
    { class: 'tips' },
    text.controls.map((c, i) =>
      h('li', { class: 'tip' }, [icon(CONTROL_ICONS[i] ?? 'info', 'tip-icon'), h('div', {}, [h('div', { class: 'tip-title', text: c.title }), h('div', { class: 'tip-text', text: c.text })])]),
    ),
  );
  const shortcutText = h('div', { class: 'tip-text' });
  controls.append(h('li', { class: 'tip' }, [icon('keyboard', 'tip-icon'), h('div', {}, [h('div', { class: 'tip-title', text: W.shortcutTitle }), shortcutText])]));

  const modePoint = h('li');
  const privacy = h('div', { class: 'callout callout-privacy' }, [
    icon('shield', 'callout-icon'),
    h('div', {}, [
      h('h2', { class: 'callout-title', text: W.privacyTitle }),
      h('ul', { class: 'bullets' }, [modePoint, ...text.privacyPoints.slice(1).map((p) => h('li', { text: p }))]),
    ]),
  ]);

  const start = button(W.start, { variant: 'accent' });
  const openPrivacy = button(W.openPrivacy, { icon: 'shield' });
  const status = statusLine();
  start.addEventListener('click', () => {
    void runAction(ctx, 'completeFirstRun', start, status).then((ok) => {
      if (ok) {
        setNote(status, W.started, 'ok');
        ctx.navigate('home');
      }
    });
  });
  openPrivacy.addEventListener('click', () => ctx.navigate('privacy'));

  // First run: the language (the detected one is shown, an explicit choice is stored) and the companion.
  const language = languageRow(ctx);
  const pickParts = row({ title: UW.characterLabel, desc: UW.characterDesc, icon: 'people', stacked: true });
  const pickBox = h('div', { class: 'segmented segmented-wrap', 'aria-labelledby': pickParts.titleId, 'aria-describedby': pickParts.describedBy });
  const pickItems: Array<RadioItem<CharacterId>> = allCharacterIds().map((id) => ({
    value: id,
    el: h('button', { type: 'button', class: 'segment', 'data-character': id, text: characterCard(id, getLocale()).name }),
  }));
  pickBox.append(...pickItems.map((i) => i.el));
  pickParts.control.append(pickBox);
  const pickBinding: FieldBinding = {
    field: fieldId('general', 'activeCharacter'),
    isBusy: () => false,
    sync: (v) => pick.set(typeof v === 'string' ? (v as CharacterId) : 'cat'),
    showError: (msg) => setNote(pickParts.error, msg, 'error'),
  };
  const pick = radioGroup<CharacterId>(pickBox, pickItems, (id) => {
    pick.set(id);
    ctx.store.set('general', 'activeCharacter', id, { origin: pickBinding });
  });
  ctx.store.bind(pickBinding);

  const element = page(S.nav.welcome, [
    h('div', { class: 'hero' }, [art, h('div', { class: 'hero-copy' }, [heading, intro])]),
    group(UW.groupLanguage, [language.parts.row], UW.languageDesc),
    group(UW.groupCharacter, [pickParts.row]),
    h('section', { class: 'group' }, [h('h2', { class: 'group-title', text: W.controlsTitle }), controls]),
    privacy,
    h('div', { class: 'actions' }, [start, openPrivacy]),
    status,
  ]);

  ctx.store.subscribe((view) => {
    const s = view.settings;
    heading.textContent = s.general.firstRunCompleted ? W.titleBack : W.title;
    intro.textContent = text.intro(displayName(s, activeCharacterOf(s), getLocale()));
    shortcutText.textContent = s.general.shortcutsEnabled ? W.shortcutText(formatShortcut(s.general.toggleShortcut, wording)) : W.shortcutDisabled;
    start.hidden = s.general.firstRunCompleted;
    const mode = view.status.perception.mode;
    modePoint.textContent = mode === 'off' ? (text.privacyPoints[0] ?? '') : deviceWords(`${S.privacy.banner[mode].title}. ${S.privacy.banner[mode].text}`, wording);
    const id = activeCharacterOf(s);
    preview.slot.setCharacter(id);
    preview.slot.setSkin(paletteOf(s, id).current);
  });

  return {
    id: 'welcome',
    title: S.nav.welcome,
    element,
    onShow: () => preview.slot.setVisible(true),
    onHide: () => preview.slot.setVisible(false),
  };
}
