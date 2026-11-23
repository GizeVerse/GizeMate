// Tray and context-menu wording names the active companion (never "the cat") and never glues a Turkish case
// suffix onto a user-chosen name; the launch notice is companion-neutral too.
import { describe, expect, it } from 'vitest';
import { catContextMenuModel, trayMenuModel, type MenuContext, type MenuItemModel } from '../../../src/main/lifecycle/menuModel';
import { launchNotice } from '../../../src/main/lifecycle/loginItemNotice';

const base: MenuContext = { catName: 'Pamuk', hidden: false, paused: false, state: 'idle', interactionsEnabled: true, perceptionConfigured: false, perceptionPaused: false, perceptionMode: 'off' };
const labels = (items: MenuItemModel[]): string[] => items.flatMap((i) => (i.kind === 'separator' ? [] : [i.label]));

describe('companion-neutral menus', () => {
  it('English names the companion in Pause/Resume/Call/Pet and never says cat', () => {
    const all = [...labels(trayMenuModel(base)), ...labels(trayMenuModel({ ...base, paused: true })), ...labels(catContextMenuModel(base))];
    expect(all).toContain('Pause Pamuk');
    expect(all).toContain('Resume Pamuk');
    expect(all).toContain('Call Pamuk');
    expect(all).toContain('Pet Pamuk');
    expect(all.join('|')).not.toMatch(/\bcat\b/i);
  });

  it('Turkish puts the name alone after a verb: no "adlı kediyi", no suffix glued to the name', () => {
    const items = [...trayMenuModel({ ...base, locale: 'tr' }), ...trayMenuModel({ ...base, locale: 'tr', hidden: true }), ...trayMenuModel({ ...base, locale: 'tr', paused: true }), ...catContextMenuModel({ ...base, locale: 'tr' })];
    const all = labels(items);
    expect(all).toContain('Göster: Pamuk');
    expect(all).toContain('Gizle: Pamuk');
    expect(all).toContain('Duraklat: Pamuk');
    expect(all).toContain('Devam ettir: Pamuk');
    expect(all).toContain('Çağır: Pamuk');
    expect(all).toContain('Sev: Pamuk');
    expect(all.join('|')).not.toMatch(/kedi|adlı/i);
    for (const l of all) expect(l, l).not.toMatch(/Pamuk[a-zçğıöşü]/);
  });

  it('the launch notice speaks of the companion in both languages', () => {
    expect(launchNotice('en').body).toMatch(/Your companion appears/);
    expect(launchNotice('tr').body).toMatch(/^Arkadaşınız oturum açtığınızda görünür\./);
  });
});
