// Home: the active character (live preview, name, what it is), its live status and the everyday
// controls. The status, call, show/hide, pause, laser and world-event controls are the former
// Companion page, embedded below; quick toggles for touch, sound and calmer motion sit between.
import { activeCharacterOf, characterCard, displayName, paletteOf } from '../charactersView';
import type { PageContext, PageView } from '../context';
import { button, group, page, toggleRow } from '../controls';
import { h } from '../dom';
import { previewCanvas } from '../previewCanvas';
import { getLocale, S } from '../strings';
import { demoteHeading } from '../tabbed';
import { soundDescriptions } from './audio';
import { companionPage } from './companion';

const H = S.ui.home;

export function homePage(ctx: PageContext): PageView {
  const active = activeCharacterOf(ctx.store.settings);
  const preview = previewCanvas(ctx, active, paletteOf(ctx.store.settings, active).current, 'preview-canvas preview-hero', 280, 210);
  const kicker = h('p', { class: 'hero-kicker', text: H.kicker });
  const name = h('h2', { class: 'hero-name' });
  const tagline = h('p', { class: 'hero-tagline' });
  const badges = h('div', { class: 'badge-row' });
  const change = button(H.changeCharacter, { icon: 'people' });
  const customize = button(H.customize, { variant: 'accent', icon: 'color' });
  change.addEventListener('click', () => ctx.navigate('characters'));
  customize.addEventListener('click', () => ctx.navigate({ page: 'customize', tab: 'appearance' }));
  const hero = h('section', { class: 'home-hero' }, [
    h('div', { class: 'home-stage' }, [preview.element]),
    h('div', { class: 'home-copy' }, [kicker, name, tagline, badges, h('div', { class: 'actions' }, [customize, change])]),
  ]);

  const interact = toggleRow(ctx, 'interaction', 'enabled', { title: S.interaction.enabledTitle, desc: S.interaction.enabledDesc, icon: 'touch' });
  const sound = toggleRow(ctx, 'sound', 'enabled', { title: S.audio.masterTitle, desc: soundDescriptions(ctx.store.view.status.platform).sound, icon: 'volume' });
  const calm = toggleRow(ctx, 'companion', 'reducedMotion', { title: S.access.reducedTitle, desc: S.access.reducedDesc, icon: 'view' });

  const status = companionPage(ctx);
  demoteHeading(status);
  status.element.querySelector('.page-title')?.classList.add('sr-only');

  const element = page(H.title, [hero, group(H.groupQuick, [interact.parts.row, sound.parts.row, calm.parts.row]), h('h2', { class: 'group-title', text: H.groupDetails }), status.element]);

  ctx.store.subscribe((view) => {
    const s = view.settings;
    const id = activeCharacterOf(s);
    const label = displayName(s, id, getLocale());
    const info = characterCard(id, getLocale());
    name.textContent = label;
    tagline.textContent = info.tagline;
    badges.replaceChildren(
      h('span', { class: 'badge', text: info.kindLabel }),
      h('span', { class: 'badge', text: info.locomotionLabel }),
    );
    preview.slot.setCharacter(id);
    preview.slot.setSkin(paletteOf(s, id).current);
    preview.element.setAttribute('aria-label', H.previewLabel(label));
    preview.element.removeAttribute('aria-hidden');
    preview.element.setAttribute('role', 'img');
  });

  return {
    id: 'home',
    title: H.title,
    element,
    onShow() {
      status.element.hidden = false;
      status.onShow?.();
      preview.slot.setVisible(true);
    },
    onHide() {
      status.onHide?.();
      preview.slot.setVisible(false);
    },
  };
}
