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

	trackActivity(previousSelected: string): string {
		const now = Date.now();
		let changed = false;
		const selectedID = this.meta.getSelectedTabID();
		for (const tab of this.meta.getNativeTabs().filter((t) => t.type !== 'library')) {
			const key = this.meta.tabKey(tab);
			if (!key) continue;
			if (!this.store.state.history[key]) {
				this.store.state.history[key] = { firstSeen: now, lastViewed: null };
				changed = true;
			}
		}
		if (previousSelected !== selectedID) {
			for (const id of [previousSelected, selectedID]) {
				const tab = this.meta.getNativeTabs().find((t) => t.id === id && t.type !== 'library');
				const key = this.meta.tabKey(tab);
				if (key && this.store.state.history[key]) {
					this.store.state.history[key].lastViewed = now;
					changed = true;
				}
			}
		}
		if (changed) this.store.save(false);
		return selectedID;
	}

	getStaleTabs(now = Date.now()): Array<{ tracked: TrackedTab; days: number }> {
		if (!getPref('enableStaleSuggestions')) return [];
		const threshold = getPref('staleSuggestDays');
		const selected = this.meta.getSelectedTabID();
		const dayMs = 86_400_000;
		return this.meta
			.buildTrackedTabs()
			.filter((t) => !t.pinned && t.tab.id !== selected)
			.map((t) => {
				const h = this.store.state.history[t.key];
				const since = h?.lastViewed ?? h?.firstSeen ?? now;
				return { tracked: t, days: Math.max(0, Math.floor((now - since) / dayMs)) };
			})
			.filter((x) => x.days >= threshold)
			.sort((a, b) => b.days - a.days);
	}
}
