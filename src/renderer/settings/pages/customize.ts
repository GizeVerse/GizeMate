// Customize: the active character's appearance, personality, behaviour, animation and interaction.
// Each tab is one of the existing pages, re-homed here.
import type { PageContext, PageView } from '../context';
import { tabbedPage } from '../tabbed';
import { S } from '../strings';
import { animationPage, appearancePage } from './appearance';
import { behaviorPage } from './behavior';
import { interactionPage } from './interaction';
import { personalityPage } from './personality';

export function customizePage(ctx: PageContext): PageView {
  const T = S.ui.tabs.customize;
  return tabbedPage(ctx, {
    id: 'customize',
    title: S.ui.customize.title,
    tabsLabel: T.label,
    tabs: [
      { id: 'appearance', label: T.appearance, views: [appearancePage(ctx)] },
      { id: 'personality', label: T.personality, views: [personalityPage(ctx)] },
      { id: 'behavior', label: T.behavior, views: [behaviorPage(ctx)] },
      { id: 'animation', label: T.animation, views: [animationPage(ctx)] },
      { id: 'interaction', label: T.interaction, views: [interactionPage(ctx)] },
    ],
  });
}
