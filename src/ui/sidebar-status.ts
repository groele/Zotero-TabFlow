import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';

export interface WorkspaceStatusCounts {
	active: number;
	sleeping: number;
	virtual: number;
	overBudget: boolean;
	budget: number;
}

export function computeWorkspaceStatusCounts(
	tracked: readonly TrackedTab[],
	store: TabFlowStore,
): WorkspaceStatusCounts {
	const active = tracked.filter((item) => item.status === 'active').length;
	const sleeping = tracked.filter((item) => item.status === 'sleeping').length;
	const openKeys = new Set(tracked.map((item) => item.key));
	const virtual = getPref('enableVirtualMembers')
		? Object.keys(store.state.virtualMembers).filter((key) => !openKeys.has(key)).length
		: 0;
	const budget = Math.max(0, Number(getPref('activeReaderBudget')) || 0);
	return {
		active,
		sleeping,
		virtual,
		overBudget: budget > 0 && active > budget,
		budget,
	};
}

export function renderSidebarStatusBar(
	doc: Document,
	bar: HTMLDivElement,
	counts: WorkspaceStatusCounts,
	onSleepInactive: () => void,
): void {
	bar.replaceChildren();
	const summary = doc.createElementNS(XHTML, 'span') as HTMLSpanElement;
	summary.className = 'ztf-sb-status-text';
	summary.textContent = t(
		'zotero-tabflow-sidebar-status-counts',
		`活动 ${counts.active} · 已卸载 ${counts.sleeping} · 虚拟 ${counts.virtual}`,
		{ active: counts.active, sleeping: counts.sleeping, virtual: counts.virtual },
	);
	bar.append(summary);

	if (counts.overBudget) {
		const warn = doc.createElementNS(XHTML, 'button') as HTMLButtonElement;
		warn.type = 'button';
		warn.className = 'ztf-sb-budget-warn';
		warn.textContent = t(
			'zotero-tabflow-budget-exceeded-btn',
			`超出 ${counts.budget} 篇上限 · 休眠后台`,
			{ budget: counts.budget },
		);
		warn.title = t('zotero-tabflow-budget-exceeded-tip', '点击休眠后台非固定标签页以减轻负荷');
		warn.onclick = onSleepInactive;
		bar.append(warn);
	}
}

export function renderSidebarEmptyState(
	doc: Document,
	list: HTMLDivElement,
	hasQuery: boolean,
	hasSessions: boolean,
	onClearQuery: () => void,
	onRestoreLastSession: () => void,
	onFocusLibrary: () => void,
): void {
	const box = doc.createElementNS(XHTML, 'div') as HTMLDivElement;
	box.className = 'ztf-sb-empty';
	const msg = doc.createElementNS(XHTML, 'div') as HTMLDivElement;
	msg.className = 'ztf-sb-empty-msg';
	const btn = doc.createElementNS(XHTML, 'button') as HTMLButtonElement;
	btn.type = 'button';
	btn.className = 'ztf-sb-empty-btn';

	if (hasQuery) {
		msg.textContent = t('zotero-tabflow-empty-filter', '没有符合筛选条件的标签页');
		btn.textContent = t('zotero-tabflow-empty-clear-filter', '清除筛选');
		btn.onclick = onClearQuery;
	} else if (hasSessions) {
		msg.textContent = t('zotero-tabflow-empty-no-tabs', '当前没有打开的文献阅读标签');
		btn.textContent = t('zotero-tabflow-empty-restore-session', '恢复最近会话');
		btn.onclick = onRestoreLastSession;
	} else {
		msg.textContent = t('zotero-tabflow-empty-no-tabs', '当前没有打开的文献阅读标签');
		btn.textContent = t('zotero-tabflow-empty-open-library', '返回我的文库');
		btn.onclick = onFocusLibrary;
	}
	box.append(msg, btn);
	list.append(box);
}
