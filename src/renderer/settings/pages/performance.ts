// Settings › Performance: keeping the companion light. These are the same settings as elsewhere
// (hardware acceleration from the old Diagnostics page, pausing for full-screen apps from Behaviour).
import type { PageContext, PageView } from '../context';
import { button, group, page, toggleRow } from '../controls';
import { h, icon } from '../dom';
import { S } from '../strings';
import { fullscreenControl } from './behavior';

const U = S.ui.performance;
const D = S.diagnostics;
const X = S.access;

export function performancePage(ctx: PageContext): PageView {
  const hw = toggleRow(ctx, 'diagnostics', 'hardwareAcceleration', { title: D.hwAccelTitle, desc: D.hwAccelDesc, icon: 'monitor' });
  const fullscreen = fullscreenControl(ctx, { title: X.fullscreenTitle, desc: X.fullscreenDesc });
  const advanced = button(U.openAdvanced);
  advanced.addEventListener('click', () => ctx.navigate({ page: 'settings', tab: 'advanced' }));
  const element = page(U.title, [
    h('p', { class: 'page-note' }, [icon('info'), h('span', { text: U.intro })]),
    group(U.groupGraphics, [hw.parts.row]),
    group(U.groupFullscreen, [fullscreen.row]),
    h('div', { class: 'row row-block' }, [h('p', { class: 'row-desc', text: U.usageNote }), h('div', { class: 'actions' }, [advanced])]),
  ]);
  return { id: 'performance', title: U.title, element, onShow: () => fullscreen.sync() };
}
