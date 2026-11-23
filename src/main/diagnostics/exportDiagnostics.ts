// "Export diagnostics": asks where to save, then writes the report built by
// diagnosticsReport.ts. The user can read the JSON before sharing it.
import fs from 'node:fs';
import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { t } from '../../shared/i18n';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n/locale';
import type { ActionResult } from '../../shared/ipc';
import type { Logger } from '../contracts';

export async function exportDiagnosticsToFile(opts: {
  parent: BrowserWindow | null;
  defaultDir: string;
  build: () => Record<string, unknown>;
  logger: Logger;
  now?: () => Date;
  /** The effective interface language; absent = English. */
  locale?: Locale;
}): Promise<ActionResult> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const stamp = (opts.now ?? (() => new Date()))().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const defaultPath = path.join(opts.defaultDir, `desktop-cat-diagnostics-${stamp}.json`);
  const dialogOptions = {
    title: t(locale, 'dialog.diagnosticsTitle'),
    defaultPath,
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'] as Array<'createDirectory' | 'showOverwriteConfirmation'>,
  };
  const choice = opts.parent ? await dialog.showSaveDialog(opts.parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
  // Changing one's mind is not a failure: report it neutrally, not as an error.
  if (choice.canceled || !choice.filePath) return { ok: true, message: t(locale, 'dialog.diagnosticsCancelled') };
  try {
    const report = opts.build();
    await fs.promises.writeFile(choice.filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    opts.logger.info('diagnostics exported');
    return { ok: true, message: t(locale, 'dialog.diagnosticsSaved', { path: choice.filePath }) };
  } catch (err) {
    opts.logger.error('diagnostics export failed', { error: err });
    return { ok: false, message: t(locale, 'dialog.diagnosticsFailed') };
  }
}
