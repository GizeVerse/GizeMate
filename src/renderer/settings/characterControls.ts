// Customize controls that follow the ACTIVE character: its name and its palette. The cat keeps
// general.catName and appearance.skin; every other character uses general.characterNames[id] and
// appearance.characterSkins[id]. One name field serves them all (it re-targets when the active
// character changes), so the name note helper attaches to that single input and row.
import { getCharacter, type CharacterId } from '../../shared/characters/registry';
import { MAX_CAT_NAME_LENGTH } from './catalog';
import { activeCharacterOf, displayName, paletteOf, renameLeaf, skinLabel, skinLeaf, storedName } from './charactersView';
import type { PageContext } from './context';
import { radioGroup, row, setNote, type RadioItem, type RowParts } from './controls';
import { h, icon } from './dom';
import { fieldId } from './patch';
import { previewCanvas } from './previewCanvas';
import type { PreviewSlot } from './previews';
import { coatArt } from './skins';
import type { FieldBinding } from './store';
import { getLocale, S } from './strings';
import { validateCatName } from './validate';
import type { SkinId } from '../../shared/cat';

const U = S.ui.customize;

export interface NameField {
  parts: RowParts;
  input: HTMLInputElement;
}

/** The name field of the active character. */
export function nameField(ctx: PageContext): NameField {
  const parts = row({ title: U.nameTitle, desc: U.nameDesc, icon: 'rename' });
  const input = h('input', {
    type: 'text',
    class: 'text-input',
    maxlength: MAX_CAT_NAME_LENGTH + 8,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-labelledby': parts.titleId,
    'aria-describedby': parts.describedBy,
  });
  parts.control.append(input);
  setNote(parts.note, S.validation.catNameHint, 'info');
  let synced = '';
  let invalid = false;
  const dirty = (): boolean => input.value !== synced;
  const busy = (): boolean => invalid || (document.activeElement === input && dirty());
  const showError = (msg: string | null): void => {
    setNote(parts.error, msg, 'error');
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const refresh = (): void => {
    const s = ctx.store.settings;
    const id = activeCharacterOf(s);
    // The field shows the user's own name, or nothing (placeholder = the default name) for a character not yet named.
    synced = storedName(s, id) ?? (id === 'cat' ? s.general.catName : '');
    input.value = synced;
    input.placeholder = displayName(s, id, getLocale());
  };
  const origin = (key: string): FieldBinding => ({ field: fieldId('general', key as 'catName'), isBusy: busy, sync: refresh, showError });
  for (const key of ['catName', 'characterNames', 'activeCharacter']) ctx.store.bind(origin(key));
  const commitBinding = origin('catName');
  const commit = (): void => {
    if (!dirty()) {
      invalid = false;
      showError(null);
      return;
    }
    const s = ctx.store.settings;
    const id = activeCharacterOf(s);
    const text = input.value.trim();
    // A non-cat character may go back to its default name by clearing the field; the cat's name is required.
    if (id !== 'cat' && text === '') {
      invalid = false;
      showError(null);
      const leaf = renameLeaf(s, id, '');
      ctx.store.set('general', 'characterNames', leaf.value as Record<string, string>, { origin: commitBinding });
      return;
    }
    const res = validateCatName(input.value);
    if (!res.ok) {
      invalid = true;
      showError(res.error);
      return;
    }
    invalid = false;
    showError(null);
    input.value = res.value;
    const leaf = renameLeaf(s, id, res.value);
    if (leaf.key === 'catName') ctx.store.set('general', 'catName', leaf.value as string, { origin: commitBinding });
    else ctx.store.set('general', 'characterNames', leaf.value as Record<string, string>, { origin: commitBinding });
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape' && dirty()) {
      e.preventDefault();
      invalid = false;
      input.value = synced;
      showError(null);
    }
  });
  refresh();
  return { parts, input };
}

/** Swatches of the active character's palettes (cat: its coat drawings; others: the real renderer in each palette). */
export function paletteRow(ctx: PageContext): { parts: RowParts; setVisible(visible: boolean): void } {
  const parts = row({ title: U.paletteTitle, desc: U.paletteDesc, icon: 'color', stacked: true });
  const holder = h('div', { class: 'swatch-sets' });
  parts.control.append(holder);
  const sets = new Map<CharacterId, { el: HTMLElement; set(skin: string): void; slots: PreviewSlot[] }>();
  let shown = false;

  const build = (id: CharacterId) => {
    const { skins } = getCharacter(id);
    const container = h('div', { class: 'swatches', 'aria-labelledby': parts.titleId, 'aria-describedby': parts.describedBy, hidden: true });
    const slots: PreviewSlot[] = [];
    const items: Array<RadioItem<string>> = skins.map((skin) => {
      let art: Node;
      if (id === 'cat') art = coatArt(skin as SkinId);
      else {
        const c = previewCanvas(ctx, id, skin, 'swatch-canvas', 96, 72);
        slots.push(c.slot);
        art = c.element;
      }
      return {
        value: skin,
        el: h('button', { type: 'button', class: 'swatch', 'data-skin': skin }, [h('span', { class: 'swatch-art' }, [art, icon('check', 'swatch-check')]), h('span', { class: 'swatch-name', text: skinLabel(id, skin) })]),
      };
    });
    container.append(...items.map((i) => i.el));
    holder.append(container);
    const handle = radioGroup<string>(container, items, (skin) => {
      handle.set(skin);
      const leaf = skinLeaf(ctx.store.settings, id, skin);
      if (leaf.key === 'skin') ctx.store.set('appearance', 'skin', leaf.value as SkinId, { origin: binding });
      else ctx.store.set('appearance', 'characterSkins', leaf.value as Record<string, string>, { origin: binding });
    });
    const entry = { el: container, set: (v: string) => handle.set(v), slots };
    sets.set(id, entry);
    return entry;
  };

  const render = (): void => {
    const s = ctx.store.settings;
    const id = activeCharacterOf(s);
    const set = sets.get(id) ?? build(id);
    for (const [other, entry] of sets) {
      entry.el.hidden = other !== id;
      for (const slot of entry.slots) slot.setVisible(shown && other === id);
    }
    set.set(paletteOf(s, id).current);
  };
  const binding: FieldBinding = { field: fieldId('appearance', 'skin'), isBusy: () => false, sync: render, showError: (msg) => setNote(parts.error, msg, 'error') };
  ctx.store.bind(binding);
  for (const f of ['characterSkins'] as const) ctx.store.bind({ ...binding, field: fieldId('appearance', f) });
  ctx.store.bind({ ...binding, field: fieldId('general', 'activeCharacter') });
  render();
  return {
    parts,
    setVisible(visible) {
      shown = visible;
      render();
    },
  };
}
