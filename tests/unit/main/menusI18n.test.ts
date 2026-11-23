// Menus, tray tooltip and launch notice in Turkish: localized, product name from the brand layer,
// English unchanged by default, tooltip always within the Windows limit.
import { describe, expect, it } from 'vitest';
import { BRAND } from '../../../src/shared/brand';
import { BEHAVIOR_STATES } from '../../../src/shared/cat';
import { catContextMenuModel, fitTooltip, trayMenuModel, trayTooltip, type MenuContext, type MenuItemModel } from '../../../src/main/lifecycle/menuModel';
import { announceLaunchAtLogin, LAUNCH_NOTICE, launchNotice } from '../../../src/main/lifecycle/loginItemNotice';

const base: MenuContext = {
  catName: 'Miso',
  hidden: false,
  paused: false,
  state: 'idle',
  interactionsEnabled: true,
  perceptionConfigured: true,
  perceptionPaused: false,
  perceptionMode: 'ai-cloud',
};

const labels = (items: MenuItemModel[]): string[] => items.flatMap((i) => (i.kind === 'separator' ? [] : [i.label]));
const shape = (items: MenuItemModel[]): string[] => items.map((i) => (i.kind === 'separator' ? '-' : i.action));

describe('menus by locale', () => {
  it('default (no locale) equals explicit English', () => {
    expect(labels(trayMenuModel(base))).toEqual(labels(trayMenuModel({ ...base, locale: 'en' })));
    expect(labels(catContextMenuModel(base))).toEqual(labels(catContextMenuModel({ ...base, locale: 'en' })));
    expect(trayTooltip(base)).toBe(trayTooltip({ ...base, locale: 'en' }));
    expect(labels(trayMenuModel(base))).toContain(`Quit ${BRAND.product}`);
  });

  it('Turkish menus differ from English, keep the actions, and name the cat and the product', () => {
    const en = trayMenuModel(base);
    const tr = trayMenuModel({ ...base, locale: 'tr' });
    expect(shape(tr)).toEqual(shape(en));
    expect(labels(tr)).not.toEqual(labels(en));
    expect(labels(tr).join('|')).toContain('Miso');
    expect(labels(tr).join('|')).toContain(BRAND.product);
    for (const item of [...tr, ...catContextMenuModel({ ...base, locale: 'tr' })]) if (item.kind !== 'separator') expect(item.label.trim().length).toBeGreaterThan(0);
  });

  it('keeps tooltips within 127 characters for every state, mode and locale', () => {
    for (const locale of ['en', 'tr'] as const) {
      for (const state of BEHAVIOR_STATES) {
        for (const perceptionMode of ['off', 'local-stats', 'ai-local', 'ai-cloud'] as const) {
          for (const flags of [{}, { hidden: true }, { paused: true }, { perceptionPaused: true }]) {
            expect(trayTooltip({ ...base, state, perceptionMode, locale, ...flags }).length).toBeLessThanOrEqual(127);
          }
        }
      }
    }
    expect(trayTooltip({ ...base, locale: 'tr', state: 'chasingCursor' })).toContain('imleci kovalıyor');
  });

  it('fitTooltip truncates with an ellipsis and never splits a surrogate pair', () => {
    expect(fitTooltip('short')).toBe('short');
    const long = 'a'.repeat(125) + '😀' + 'b'.repeat(10);
    const cut = fitTooltip(long);
    expect(cut.length).toBeLessThanOrEqual(127);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/[\ud800-\udbff]…$/);
  });
});

describe('launch notice by locale', () => {
  it('stays English by default and names the product from the brand layer in both languages', () => {
    expect(launchNotice()).toEqual(LAUNCH_NOTICE);
    expect(LAUNCH_NOTICE.title).toBe(`${BRAND.product} now starts with Windows`);
    const tr = launchNotice('tr');
    expect(tr.title).toContain(BRAND.product);
    expect(tr.title).not.toBe(LAUNCH_NOTICE.title);
    expect(tr.body).not.toBe(LAUNCH_NOTICE.body);
  });

  it('asks the surface for the Turkish notice when the locale says so', () => {
    const seen: Array<{ title: string; body: string }> = [];
    const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
    announceLaunchAtLogin({
      status: { showNotice: true } as never,
      test: false,
      launchedAtLogin: false,
      surface: {
        notify: (n) => {
          seen.push(n);
          return true;
        },
      },
      markShown() {},
      openSettings() {},
      logger,
      locale: 'tr',
    });
    expect(seen).toEqual([launchNotice('tr')]);
  });
});
