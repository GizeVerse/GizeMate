// The settings window's product names (ADR 0004 §9): BRAND.product everywhere, the installed name only where
// the text tells the user what to find or click in Windows (the installed name) and in the About
// heading's "formerly". DOM-free: walks every string the window can show.
import { describe, expect, it } from 'vitest';
import { BRAND } from '../../../../src/shared/brand';
import { S } from '../../../../src/renderer/settings/strings';

/** Every string in S, by path; functions are called with placeholder arguments where they allow it. */
function leaves(value: unknown, at: string, out: Array<readonly [string, string]>): void {
  if (typeof value === 'string') out.push([at, value]);
  else if (typeof value === 'function') {
    let result: unknown;
    try {
      result = (value as (...args: unknown[]) => unknown)('x', 'y', 'z');
    } catch {
      return; // needs typed arguments; its fixed text is covered by the page tests
    }
    leaves(result, `${at}()`, out);
  } else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) leaves(v, at ? `${at}.${k}` : k, out);
}

const ALL: Array<readonly [string, string]> = [];
leaves(S, '', ALL);
const text = (p: string): string => ALL.find(([at]) => at === p)?.[1] ?? '';

describe('settings window: product names', () => {
  it('calls the app by the product name in titles, the brand, the startup choices and the quit row', () => {
    expect(S.app.title).toBe(`${BRAND.product} Settings`);
    expect(S.app.pageTitle('General')).toBe(`General · ${BRAND.product}`);
    expect(S.app.brand).toBe(BRAND.product);
    expect(S.general.startupStateTitle).toBe(`When ${BRAND.product} starts`);
    expect(S.general.launchNoticeTitle).toBe(`${BRAND.product} now starts with Windows`);
    expect(S.general.quitTitle).toBe(`Quit ${BRAND.product}`);
    expect(S.diagnostics.versions.app).toBe(BRAND.product);
  });

  it('About reads "<product> — a <platform> character (formerly <previous names>)"', () => {
    expect(`${S.app.brand}${S.about.identity}`).toBe(`${BRAND.product} — a ${BRAND.platform} character (formerly ${BRAND.previousName} and ${BRAND.formerName})`);
  });

  it('no string spells an earlier display name except the About heading (and the installed name where Windows shows it)', () => {
    const stale = ALL.filter(([, s]) => s.includes(BRAND.previousName)).map(([at]) => at);
    expect(stale).toEqual(['about.identity']);
  });

  it('names the installed name only where Windows (or macOS Finder) shows that name, or as the former name', () => {
    // Task Manager › Startup apps and Settings › Apps list the installed name (BRAND.installedName).
    expect(text('general.launchStatus.windowsDisabled')).toContain(`open Task Manager › Startup apps and enable the ${BRAND.installedName} entry`);
    expect(text('about.uninstall')).toContain(`Settings › Apps › Installed apps, find ${BRAND.installedName} and choose Uninstall`);
    const old = ALL.filter(([, s]) => s.includes(BRAND.installedName)).map(([at]) => at);
    // 1.4.0: macOS Finder shows the app under the same installed name (Applications › ${BRAND.installedName}).
    expect(text('about.uninstallMac')).toContain(`drag ${BRAND.installedName} from Applications to the Trash`);
    // 1.4.0: the Dock row tells where to reopen Settings: the Applications folder lists the app as installed.
    expect(text('general.dockDesc')).toContain(`open ${BRAND.installedName} from the Applications folder`);
    // loginText.*: main's startup codes, worded where Windows or macOS shows the installed name (Task Manager, Applications, Login Items).
    const expected = ['about.identity', 'about.uninstall', 'about.uninstallMac', 'general.dockDesc', 'general.launchStatus.windowsDisabled'];
    const login = ['macApproval', 'macNotFound', 'macNotInApplications', 'macRequiresApproval', 'stillStarts', 'windowsDisabled', 'windowsDisabledRestored', 'windowsDisabledSaved', 'wrongLocation'].map((k) => `loginText.${k}`);
    // Since 1.6.0 the installed name IS the product name, so "strings naming it" is every string naming the product and the
    // exact-list check only applies if the two are ever staged apart again (ADR 0004 §9).
    if (BRAND.installedName !== BRAND.product) expect(old.sort()).toEqual([...expected, ...login].sort());
    else for (const k of [...expected, ...login]) expect(old, k).toContain(k);
  });

  it('the walk reaches the strings it checks', () => {
    expect(ALL.length).toBeGreaterThan(300);
    expect(ALL.filter(([, s]) => s.includes(BRAND.product)).length).toBeGreaterThan(15);
  });
});
