// 1.4.0 profile transfer: the native save/open dialogs (main only, parented to the settings
// window) and the file access behind profileService.ts. The renderer never sees a path.
import fs from 'node:fs';
import path from 'node:path';
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { BRAND } from '../../shared/brand';
import { t } from '../../shared/i18n';
import type { Locale } from '../../shared/i18n/locale';
import { PROFILE_FILE_EXTENSION } from '../../shared/profileTransfer';
import type { CappedRead, ProfileDialogs, ProfileFs } from './profileService';

const filters = (locale: Locale): Array<{ name: string; extensions: string[] }> => [
  { name: t(locale, 'dialog.profileFilter', { product: BRAND.product }), extensions: [PROFILE_FILE_EXTENSION] },
];

export interface ProfileDialogOptions {
  /** The settings window (dialogs are modal to it), or null. */
  parent: () => BrowserWindow | null;
  /** Where the save dialog starts (app.getPath('documents')); may throw. */
  documentsDir: () => string;
  /** The effective interface language, read each time a dialog opens. */
  locale: () => Locale;
}

export function createElectronProfileDialogs(opts: ProfileDialogOptions): ProfileDialogs {
  const startIn = (name: string): string => {
    try {
      return path.join(opts.documentsDir(), name);
    } catch {
      return name;
    }
  };
  return {
    async chooseSavePath(defaultName) {
      const options: SaveDialogOptions = {
        title: t(opts.locale(), 'dialog.profileSaveTitle', { product: BRAND.product }),
        defaultPath: startIn(defaultName),
        filters: filters(opts.locale()),
        // Windows and macOS confirm an overwrite natively; Linux needs the flag.
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      };
      const parent = opts.parent();
      const choice = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      return choice.canceled || !choice.filePath ? null : choice.filePath;
    },
    async chooseOpenPath() {
      const options: OpenDialogOptions = {
        title: t(opts.locale(), 'dialog.profileOpenTitle', { product: BRAND.product }),
        filters: filters(opts.locale()),
        properties: ['openFile'],
      };
      const parent = opts.parent();
      const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return choice.canceled ? null : (choice.filePaths[0] ?? null);
    },
  };
}

/** node:fs behind ProfileFs. readTextCapped never reads more than maxBytes + 1 bytes. */
export const nodeProfileFs: ProfileFs = {
  async writeText(filePath, text, opts) {
    // 'wx' fails with EEXIST instead of replacing a file the save dialog never confirmed.
    await fs.promises.writeFile(filePath, text, { encoding: 'utf8', flag: opts?.createOnly === true ? 'wx' : 'w' });
  },
  async stat(filePath) {
    const s = await fs.promises.stat(filePath);
    return { isFile: s.isFile(), size: s.size };
  },
  async readTextCapped(filePath, maxBytes): Promise<CappedRead> {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      // One byte more than allowed tells a file at the cap from one that grew past it after stat.
      const buf = Buffer.alloc(maxBytes + 1);
      let total = 0;
      while (total < buf.length) {
        const { bytesRead } = await handle.read(buf, total, buf.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > maxBytes) return { ok: false, reason: 'too-large' };
      return { ok: true, text: buf.subarray(0, total).toString('utf8') };
    } finally {
      await handle.close();
    }
  },
};
