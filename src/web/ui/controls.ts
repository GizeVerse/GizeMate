// Small form controls shared by the web panels (the Android home panel and the browser sheet): one
// vocabulary of switches, sliders, radio cards, cards and folds, so both look and behave the same. Built
// with the CSP-safe helpers (no innerHTML, no style attributes); text only through textContent.
import { h, uid } from '../../renderer/settings/dom';

export interface SwitchRow {
  root: HTMLElement;
  input: HTMLInputElement;
}

export function switchRow(label: string, desc: string | null, onToggle: (on: boolean) => void): SwitchRow {
  const id = uid('ui-switch');
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id });
  input.addEventListener('change', () => onToggle(input.checked));
  const descId = desc ? `${id}-desc` : null;
  if (descId) input.setAttribute('aria-describedby', descId);
  const text = h('div', { class: 'row-text' }, [h('label', { for: id, text: label }), desc ? h('span', { class: 'row-desc', id: descId }, [desc]) : null]);
  return { root: h('div', { class: 'field-row panel-row' }, [text, input]), input };
}

export interface Slider {
  root: HTMLElement;
  input: HTMLInputElement;
  set(v: number): void;
}

export function slider(label: string, r: { min: number; max: number; step: number }, format: (v: number) => string, onValue: (v: number, save: boolean) => void): Slider {
  const id = uid('ui-range');
  const input = h('input', { type: 'range', id, min: r.min, max: r.max, step: r.step });
  const out = h('output', { for: id });
  input.addEventListener('input', () => {
    out.textContent = format(Number(input.value));
    onValue(Number(input.value), false);
  });
  input.addEventListener('change', () => onValue(Number(input.value), true));
  return {
    root: h('div', { class: 'field' }, [h('div', { class: 'field-row' }, [h('label', { for: id, text: label }), out]), input]),
    input,
    set(v) {
      input.value = String(v);
      out.textContent = format(v);
    },
  };
}

export interface RadioCards<T extends string> {
  root: HTMLElement;
  set(value: T | null): void;
  setDisabled(disabled: boolean): void;
}

export function radioCards<T extends string>(
  label: string,
  values: readonly T[],
  content: (v: T) => (Node | string)[],
  onPick: (v: T) => void,
  wide = false,
): RadioCards<T> {
  const labelId = uid('ui-radio-label');
  const group = uid('ui-radio');
  const inputs = new Map<T, { input: HTMLInputElement; card: HTMLElement }>();
  const cards = values.map((v) => {
    // One name per group: the browser keeps one choice checked and moves between them with the arrow keys.
    const input = h('input', { type: 'radio', name: group, value: v });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      for (const other of inputs.values()) other.card.classList.toggle('checked', other.input.checked);
      onPick(v);
    });
    const card = h('label', { class: 'card' }, [input, ...content(v)]);
    inputs.set(v, { input, card });
    return card;
  });
  return {
    root: h('div', {}, [h('p', { class: 'legend', id: labelId, text: label }), h('div', { class: wide ? 'cards wide' : 'cards', role: 'radiogroup', 'aria-labelledby': labelId }, cards)]),
    set(value) {
      for (const [v, { input, card }] of inputs) {
        input.checked = v === value;
        card.classList.toggle('checked', v === value);
      }
    },
    setDisabled(disabled) {
      for (const { input } of inputs.values()) input.disabled = disabled;
    },
  };
}

/** A titled group of controls. */
export function card(title: string, children: readonly (Node | null)[], id?: string): HTMLElement {
  const headingId = uid('ui-card');
  return h('section', { class: 'pcard', 'aria-labelledby': headingId, id }, [h('h2', { id: headingId, text: title }), ...children]);
}

/** A card that folds away: a native <details>, so the keyboard and screen readers get it for free. */
export function fold(title: string, children: readonly (Node | null)[], open = false, id?: string): HTMLDetailsElement {
  const el = h('details', { class: 'pcard fold', id }, [h('summary', {}, [h('span', { class: 'fold-title', text: title })]), h('div', { class: 'fold-body' }, children)]);
  el.open = open;
  return el;
}

/** A smaller heading inside a card. */
export function subhead(text: string): HTMLElement {
  return h('h3', { class: 'subhead', text });
}

export function note(text: string, hidden = false): HTMLElement {
  return h('p', { class: 'note', text, hidden });
}
