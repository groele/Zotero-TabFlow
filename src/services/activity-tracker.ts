import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';
import type { ItemMetadataService } from './item-metadata.ts';

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

	getIdleTabsForSleep(now = Date.now()): TrackedTab[] {
		if (!getPref('enableTabSleep')) return [];
		const mins = Math.max(0, Number(getPref('autoSleepMinutes')) || 0);
		if (mins <= 0) return [];
		const thresholdMs = mins * 60_000;
		const selected = this.meta.getSelectedTabID();
		return this.meta.buildTrackedTabs().filter((t) => {
			if (t.pinned || t.tab.id === selected || t.status !== 'active') return false;
			const h = this.store.state.history[t.key];
			const since = h?.lastViewed ?? h?.firstSeen ?? now;
			return now - since >= thresholdMs;
		});
	}
}
