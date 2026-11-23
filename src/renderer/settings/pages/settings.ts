// Settings: language, sound, privacy, data and memory, performance, accessibility, desktop behaviour,
// then the rarely needed Advanced and About. Each tab holds one or more of the existing pages.
import type { PageContext, PageView } from '../context';
import { tabbedPage } from '../tabbed';
import { S } from '../strings';
import { aboutPage } from './about';
import { accessibilityPage } from './accessibility';
import { aiPage } from './ai';
import { audioPage } from './audio';
import { diagnosticsPage } from './diagnostics';
import { generalPage } from './general';
import { journalPage } from './journal';
import { languagePage } from './language';
import { memoryPage } from './personality';
import { performancePage } from './performance';
import { privacyPage } from './privacy';

export function settingsPage(ctx: PageContext): PageView {
  const T = S.ui.tabs.settings;
  return tabbedPage(ctx, {
    id: 'settings',
    title: S.ui.settings.title,
    tabsLabel: T.label,
    tabs: [
      { id: 'language', label: T.language, views: [languagePage(ctx)] },
      { id: 'sound', label: T.sound, views: [audioPage(ctx)] },
      { id: 'privacy', label: T.privacy, views: [privacyPage(ctx), aiPage(ctx)] },
      { id: 'data', label: T.data, views: [memoryPage(ctx), journalPage(ctx)] },
      { id: 'performance', label: T.performance, views: [performancePage(ctx)] },
      { id: 'accessibility', label: T.accessibility, views: [accessibilityPage(ctx)] },
      { id: 'desktop', label: T.desktop, views: [generalPage(ctx)] },
      { id: 'advanced', label: T.advanced, views: [diagnosticsPage(ctx)], note: S.ui.advanced.note },
      { id: 'about', label: T.about, views: [aboutPage(ctx)] },
    ],
  });
}
