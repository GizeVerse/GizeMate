// The static text of index.html (toolbar labels, the control group's name, the first screen's waiting
// message, the meta description) through the web catalogue. index.html carries a neutral English default so
// the page reads sensibly before main.js runs; main.js calls applyPageText at boot and on every language or
// companion-name change (a language change restarts the page). Structural types only, so it needs no DOM.
// The boot failure message and the <noscript> text appear only when main.js did not run, so they cannot be
// translated by script: index.html carries both languages for those two.
import type { WebStrings } from './strings';

export interface PageTextElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}
export interface PageTextDoc {
  getElementById(id: string): PageTextElement | null;
  querySelector(selector: string): PageTextElement | null;
}

/** Ids of the elements this module writes, in index.html. A test checks the page carries each of them. */
export const PAGE_TEXT_IDS = ['boot-wait-text', 'controls', 'btn-call', 'btn-settings', 'btn-panel'] as const;

export function applyPageText(doc: PageTextDoc, ws: WebStrings, companionName: string): void {
  const text = (id: string, value: string): void => {
    const el = doc.getElementById(id);
    if (el && el.textContent !== value) el.textContent = value;
  };
  text('boot-wait-text', ws.status.bootWaiting);
  text('btn-call', ws.toolbar.call(companionName));
  text('btn-settings', ws.toolbar.settings);
  text('btn-panel', ws.toolbar.panel);
  doc.getElementById('controls')?.setAttribute('aria-label', ws.toolbar.group);
  doc.querySelector('meta[name="description"]')?.setAttribute('content', ws.status.description);
}
