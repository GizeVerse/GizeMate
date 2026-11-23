// Settings › Language (and the same control on the first-run page): Automatic, English or Turkish
// (general.language). The detected language is shown but never stored; only an explicit choice is.
import { DEFAULT_LOCALE } from '../../../shared/i18n/locale';
import type { PageContext, PageView } from '../context';
import { group, page, segmentedRow, setNote, type RowParts } from '../controls';
import { S } from '../strings';

const L = S.ui.language;

/** The language row; `view.locale` (what main resolved) is what Automatic currently means. */
export function languageRow(ctx: PageContext): { parts: RowParts } {
  const row = segmentedRow(
    ctx,
    'general',
    'language',
    [
      { value: 'auto', label: L.auto },
      { value: 'en', label: L.en },
      { value: 'tr', label: L.tr },
    ],
    { title: L.rowTitle, desc: L.rowDesc, icon: 'globe' },
  );
  ctx.store.subscribe((view) => {
    const auto = ctx.store.intended('general', 'language') === 'auto';
    setNote(row.parts.note, auto ? L.autoNote(L.detected[view.locale ?? DEFAULT_LOCALE]) : null, 'info');
  });
  return row;
}

export function languagePage(ctx: PageContext): PageView {
  const row = languageRow(ctx);
  const element = page(L.title, [group(null, [row.parts.row])]);
  return { id: 'language', title: L.title, element };
}
