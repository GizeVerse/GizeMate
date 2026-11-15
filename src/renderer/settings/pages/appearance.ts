// Customize › Appearance and Customize › Animation. Appearance edits the ACTIVE character: its name and
// palette (characterControls.ts) and the look shared by all of them (style, size, opacity). Animation
// holds the motion and effect preferences. Sound has its own page under Settings.
import { RENDER_STYLES } from '../../../shared/cat';
import { activeCharacterOf, displayName } from '../charactersView';
import { nameField, paletteRow } from '../characterControls';
import type { PageContext, PageView } from '../context';
import { button, group, page, segmentedRow, sliderRow, toggleRow } from '../controls';
import { h, icon } from '../dom';
import { NUMERIC_FIELDS } from '../fields';
import { previewCanvas } from '../previewCanvas';
import { attachSecretNote } from '../secretNote';
import { getLocale, platformWording, S } from '../strings';

const A = S.appearance;
const U = S.ui.customize;

export function appearancePage(ctx: PageContext): PageView {
  // Who is being customized: a small live preview, the name and a way to switch.
  const active = activeCharacterOf(ctx.store.settings);
  const preview = previewCanvas(ctx, active, '', 'preview-canvas preview-small', 160, 120);
  const heading = h('h2', { class: 'context-title' });
  const change = button(U.changeCharacter, { icon: 'people' });
  change.addEventListener('click', () => ctx.navigate('characters'));
  const context = h('div', { class: 'context-bar' }, [
    h('span', { class: 'context-stage' }, [preview.element]),
    h('div', { class: 'context-text' }, [heading, h('p', { class: 'muted', text: U.forCharacterDesc })]),
    change,
  ]);

  const name = nameField(ctx);
  attachSecretNote({ row: name.parts.row, before: name.parts.note, input: name.input, subscribe: (cb) => ctx.store.subscribe(() => cb()) });
  const palette = paletteRow(ctx);
  const style = segmentedRow(
    ctx,
    'appearance',
    'style',
    RENDER_STYLES.map((s) => ({ value: s, label: A.styles[s] })),
    { title: A.styleTitle, desc: A.styleDesc, icon: 'sparkle' },
  );
  const size = sliderRow(ctx, NUMERIC_FIELDS.size, { title: A.sizeTitle, desc: A.sizeDesc, icon: 'zoom' });
  const opacity = sliderRow(ctx, NUMERIC_FIELDS.opacity, { title: A.opacityTitle, desc: A.opacityDesc, icon: 'brightness' });
  const capture = toggleRow(ctx, 'appearance', 'hideFromScreenCapture', { title: A.captureTitle, desc: platformWording(ctx.store.view.status.platform) === 'mac' ? A.captureDescMac : A.captureDesc, icon: 'hide' });

  const element = page(S.nav.appearance, [
    context,
    group(U.groupIdentity, [name.parts.row]),
    group(U.groupLook, [palette.parts.row, style.parts.row, size.parts.row, opacity.parts.row, capture.parts.row]),
  ]);

  ctx.store.subscribe((view) => {
    const id = activeCharacterOf(view.settings);
    heading.textContent = U.forCharacter(displayName(view.settings, id, getLocale()));
    preview.slot.setCharacter(id);
    preview.element.setAttribute('aria-label', S.ui.home.previewLabel(displayName(view.settings, id, getLocale())));
    preview.slot.setSkin(
      id === 'cat' ? view.settings.appearance.skin : (view.settings.appearance.characterSkins[id] ?? ''),
    );
  });

  return {
    id: 'appearance',
    title: S.nav.appearance,
    element,
    onShow() {
      preview.slot.setVisible(true);
      palette.setVisible(true);
    },
    onHide() {
      preview.slot.setVisible(false);
      palette.setVisible(false);
    },
  };
}

export function animationPage(ctx: PageContext): PageView {
  const speed = sliderRow(ctx, NUMERIC_FIELDS.animationSpeed, { title: A.animTitle, desc: A.animDesc, icon: 'stopwatch' });
  const shadow = toggleRow(ctx, 'appearance', 'shadow', { title: A.shadowTitle, desc: A.shadowDesc, icon: 'layers' });
  const emotes = toggleRow(ctx, 'appearance', 'emotes', { title: A.emotesTitle, desc: A.emotesDesc, icon: 'heart' });
  const element = page(U.animationTitle, [
    h('p', { class: 'page-note' }, [icon('info'), h('span', { text: U.animationIntro })]),
    group(U.animationTitle, [speed.parts.row]),
    group(A.groupEffects, [shadow.parts.row, emotes.parts.row]),
  ]);
  return { id: 'animation', title: U.animationTitle, element };
}
