// Decisions taken before app 'ready' (ADR 0004 §6). Pure, so they are unit-tested on every host.
//
// Linux display backend: Electron chooses X11 or Wayland before the main script runs
// (app.commandLine.appendSwitch('ozone-platform') has no effect; review H1), and since
// Electron 38 a Wayland session runs native Wayland. The app does not switch backends itself:
// both native Wayland and XWayland get no overlay (review H2), so only an X11 session shows
// the cat. explicitOzone() reads what the user passed, for the platform identity.
import { BRAND } from '../../shared/brand';
import { t } from '../../shared/i18n';
import { DEFAULT_LOCALE, type Locale } from '../../shared/i18n/locale';

/** The ozone platform the user chose explicitly (--ozone-platform, else a concrete --ozone-platform-hint), or null. */
export function explicitOzone(getSwitch: (name: string) => string): string | null {
  const platform = getSwitch('ozone-platform').trim().toLowerCase();
  if (platform) return platform;
  const hint = getSwitch('ozone-platform-hint').trim().toLowerCase();
  return hint === 'x11' || hint === 'wayland' ? hint : null;
}

export type SandboxDecision = 'ok' | 'warn' | 'refuse';

/** A packaged build never runs its renderers without the Chromium sandbox (CLAUDE.md invariant; audit R5). */
export function sandboxDecision(packaged: boolean, noSandboxSwitch: boolean): SandboxDecision {
  if (!noSandboxSwitch) return 'ok';
  return packaged ? 'refuse' : 'warn';
}

/** The refusal dialog in `locale` (English by default; the product name comes from the brand layer). */
export function noSandboxDialog(locale: Locale = DEFAULT_LOCALE): { title: string; message: string } {
  return { title: t(locale, 'dialog.noSandboxTitle', { product: BRAND.product }), message: t(locale, 'dialog.noSandboxBody', { product: BRAND.product }) };
}
export const NO_SANDBOX_TITLE = noSandboxDialog().title;
export const NO_SANDBOX_MESSAGE = noSandboxDialog().message;
