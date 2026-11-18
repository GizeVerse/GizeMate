import { describe, expect, it } from 'vitest';
import { createAppListeners } from '../../../../src/renderer/settings/appListeners';
import { SettingsStore } from '../../../../src/renderer/settings/store';
import { previewView } from './preview/fixture';

const V = { electron: '1', chrome: '1', node: '1' };
const timers = { setTimeout: () => 1, clearTimeout: () => undefined };

describe('app-level listeners survive a language rebuild', () => {
  it('keeps refreshing previews on a reduced-motion flip after store.unbindAll()', () => {
    const store = new SettingsStore({ update: () => Promise.resolve({ ok: true } as never) }, previewView(0, V), timers);
    const previews = { reduced: false, refresh: () => void refreshes++ };
    let refreshes = 0;
    const app = createAppListeners(store, previews);
    app.attach();
    previews.reduced = true;
    store.receive(previewView(1, V));
    expect(refreshes).toBe(1);

    // The language switch: pages are discarded and every listener is cleared, then the shell re-attaches.
    store.unbindAll();
    previews.reduced = false;
    store.receive(previewView(2, V));
    expect(refreshes).toBe(1); // proves unbindAll dropped it (the defect)
    app.attach(); // catches up on the flip that happened while detached
    expect(refreshes).toBe(2);
    previews.reduced = true;
    store.receive(previewView(3, V));
    expect(refreshes).toBe(3);
    app.attach(); // idempotent: no double registration
    previews.reduced = false;
    store.receive(previewView(4, V));
    expect(refreshes).toBe(5 - 1); // exactly one more (re-attach itself saw no change)
  });
});
