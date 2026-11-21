import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TabActivity, TrackedTab } from '../core/types.ts';
import type { ItemMetadataService } from './item-metadata.ts';

export function formatReadingDuration(seconds?: number): string {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	if (total < 60) return '';
	const mins = Math.floor(total / 60);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	const rem = mins % 60;
	return rem ? `${hrs}h${rem}m` : `${hrs}h`;
}

export function formatReadingProgress(activity?: TabActivity): { text: string; ratio: number | null } {
	if (!activity) return { text: '', ratio: null };
	const dur = formatReadingDuration(activity.readSeconds);
	const page = Number(activity.lastPage) || 0;
	const total = Number(activity.totalPages) || 0;
	const pageText = page > 0 ? (total > 0 ? `p.${page}/${total}` : `p.${page}`) : '';
	const text = [dur, pageText].filter(Boolean).join(' · ');
	const ratio = page > 0 && total > 0 ? Math.max(0, Math.min(1, page / total)) : null;
	return { text, ratio };
}

export class ActivityTrackerService {
	private readonly store: TabFlowStore;
	private readonly meta: ItemMetadataService;

	constructor(store: TabFlowStore, meta: ItemMetadataService) {
		this.store = store;
		this.meta = meta;
	}

	trackActivity(previousSelected: string, tracked: readonly TrackedTab[] = this.meta.buildTrackedTabs()): string {
		const now = Date.now();
		let changed = false;
		const selectedID = this.meta.getSelectedTabID();
		for (const { key, tab } of tracked) {
			if (key.startsWith('tab:')) continue;
			if (!this.store.state.history[key]) {
				this.store.state.history[key] = { firstSeen: now, lastViewed: null };
				changed = true;
			}
			if (previousSelected !== selectedID && (tab.id === previousSelected || tab.id === selectedID)) {
				this.store.state.history[key].lastViewed = now;
				changed = true;
			}
		}
		if (changed) this.store.scheduleSave();
		return selectedID;
	}

	getStaleTabs(now = Date.now(), tracked?: readonly TrackedTab[]): Array<{ tracked: TrackedTab; days: number }> {
		if (!getPref('enableStaleSuggestions')) return [];
		const threshold = getPref('staleSuggestDays');
		const selected = this.meta.getSelectedTabID();
		const dayMs = 86_400_000;
		return (tracked ?? this.meta.buildTrackedTabs())
			.filter((t) => !t.pinned && t.tab.id !== selected)
			.map((t) => {
				const h = this.store.state.history[t.key];
				const since = h?.lastViewed ?? h?.firstSeen ?? now;
				return { tracked: t, days: Math.max(0, Math.floor((now - since) / dayMs)) };
			})
			.filter((x) => x.days >= threshold)
			.sort((a, b) => b.days - a.days);
	}

	getIdleTabsForSleep(now = Date.now(), tracked?: readonly TrackedTab[]): TrackedTab[] {
		if (!getPref('enableTabSleep')) return [];
		const mins = Math.max(0, Number(getPref('autoSleepMinutes')) || 0);
		if (mins <= 0) return [];
		const thresholdMs = mins * 60_000;
		const selected = this.meta.getSelectedTabID();
		return (tracked ?? this.meta.buildTrackedTabs()).filter((t) => {
			if (t.pinned || t.tab.id === selected || t.status !== 'active') return false;
			const h = this.store.state.history[t.key];
			const since = h?.lastViewed ?? h?.firstSeen ?? now;
			return now - since >= thresholdMs;
		});
	}

	trackReadingProgress(win: Window, elapsedSeconds: number, tracked?: readonly TrackedTab[]): boolean {
		const doc = win.document as Document | undefined;
		if (typeof doc?.hasFocus === 'function' && !doc.hasFocus()) return false;
		const selectedID = this.meta.getSelectedTabID();
		if (!selectedID) return false;
		const current = (tracked ?? this.meta.buildTrackedTabs()).find((t) => t.tab.id === selectedID);
		if (!current || current.key.startsWith('tab:') || current.tab.type !== 'reader') return false;

		const now = Date.now();
		const prev = this.store.state.history[current.key] ?? { firstSeen: now, lastViewed: now };
		const prevText = formatReadingProgress(prev).text;
		const reader: any = Zotero.Reader?.getByTabID?.(selectedID);
		const pdfApp = reader?._iframeWindow?.PDFViewerApplication;
		const page = Number(pdfApp?.page || (reader?.state?.pageIndex != null ? Number(reader.state.pageIndex) + 1 : 0)) || 0;
		const total = Number(pdfApp?.pagesCount || reader?.pagesCount || 0) || 0;

		const next: TabActivity = {
			...prev,
			lastViewed: now,
			readSeconds: (prev.readSeconds ?? 0) + Math.max(0, elapsedSeconds),
			...(page > 0 ? { lastPage: page } : {}),
			...(total > 0 ? { totalPages: total } : {}),
		};
		this.store.state.history[current.key] = next;
		this.store.scheduleSave();
		return formatReadingProgress(next).text !== prevText;
	}
}
