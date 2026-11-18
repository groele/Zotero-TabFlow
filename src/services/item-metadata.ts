import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { NativeTabLike, TrackedTab } from '../core/types.ts';

export function uncategorizedCollectionLabel(): string {
	return t('zotero-tabflow-uncategorized-collection', '未分类集合');
}

export class ItemMetadataService {
	private readonly win: Window;
	private readonly store: TabFlowStore;

	constructor(win: Window, store: TabFlowStore) {
		this.win = win;
		this.store = store;
	}

	getNativeTabs(): NativeTabLike[] {
		const tabs = (this.win as any).Zotero_Tabs?._tabs;
		return Array.isArray(tabs) ? tabs : [];
	}

	getSelectedTabID(): string {
		return String((this.win as any).Zotero_Tabs?.selectedID || '');
	}

	tabKey(tab: NativeTabLike | null | undefined): string | null {
		const itemID = tab?.data?.itemID;
		if (typeof itemID !== 'number') return null;
		const item = Zotero.Items.get(itemID);
		return item ? `${item.libraryID}:${item.key}` : null;
	}

	resolvePrimaryItem(itemID: number | null): any | null {
		if (typeof itemID !== 'number') return null;
		const item = Zotero.Items.get(itemID);
		if (!item) return null;
		return item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
	}

	resolveCollectionName(item: any): string {
		const uncategorized = uncategorizedCollectionLabel();
		if (!item) return uncategorized;
		const primary = item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
		const collectionIDs: number[] = primary.getCollections?.() || [];
		if (!collectionIDs.length) return uncategorized;

		const strategy = getPref('multiCollectionStrategy');
		if (strategy === 'active') {
			const activeCol = (this.win as any).ZoteroPane?.getSelectedCollections?.()?.find(
				(collection: { id: number }) => collectionIDs.includes(collection.id),
			);
			if (activeCol) {
				return String(activeCol.name || uncategorized);
			}
		}
		if (strategy === 'existing') {
			for (const cid of collectionIDs) {
				const col = Zotero.Collections.get(cid);
				if (col && this.store.state.groups.some((g) => g.name === col.name)) {
					return String(col.name);
				}
			}
		}
		const first = Zotero.Collections.get(collectionIDs[0]);
		return first ? String(first.name) : uncategorized;
	}

	plainTitle(value: string): string {
		const render = (Zotero.Utilities as any)?.Internal?.renderItemTitle;
		return typeof render === 'function' ? render.call((Zotero.Utilities as any).Internal, value) : value.replace(/<[^>]*>/g, '');
	}

	buildTrackedTabs(): TrackedTab[] {
		const enablePinned = getPref('enablePinnedTabs');
		const enableSleep = getPref('enableTabSleep');
		const { assignments, groups, pinned, sleeping } = this.store.state;
		const groupIds = new Set(groups.map((group) => group.id));
		const pinnedKeys = new Set(enablePinned ? pinned : []);
		const sleepingKeys = new Set(enableSleep ? sleeping : []);
		const collections = new Map<number, string>();
		return this.getNativeTabs()
			.filter((t) => t.type !== 'library')
			.map((tab) => {
				const itemID = typeof tab.data?.itemID === 'number' ? tab.data.itemID : null;
				const rawItem: any = itemID ? Zotero.Items.get(itemID) : null;
				const key = rawItem ? `${rawItem.libraryID}:${rawItem.key}` : `tab:${tab.id}`;
				const primary = rawItem?.parentItemID ? Zotero.Items.get(rawItem.parentItemID) || rawItem : rawItem;
				const title = this.plainTitle(String(primary?.getField?.('title') || tab.title || t('zotero-tabflow-untitled', '无标题')));
				const shortTitle = this.plainTitle(String(primary?.getField?.('shortTitle') || title));
				const filename = String(rawItem?.isAttachment?.() ? rawItem.attachmentFilename || title : title);
				const source = String(
					primary?.getField?.('publicationTitle') ||
						primary?.getField?.('proceedingsTitle') ||
						primary?.getField?.('bookTitle') ||
						primary?.getField?.('repository') ||
						'',
				);
				const creators = primary?.getCreators?.() || [];
				const firstAuthor = creators[0]?.lastName || creators[0]?.firstName || '';
				const year = String(primary?.getField?.('year') || '').slice(0, 4);
				const creatorYear = [firstAuthor, year].filter(Boolean).join(', ');
				const collection = collections.get(primary?.id) ?? this.resolveCollectionName(primary);
				if (primary) collections.set(primary.id, collection);
				const reader = sleepingKeys.has(key) ? (Zotero.Reader as any)?.getByTabID?.(tab.id) : null;
				const hostLoaded = Boolean(reader && reader.initialized !== false && !(tab.data as any)?.unloaded);
				return {
					tab,
					key,
					itemID,
					parentItemID: primary?.id ?? null,
					title,
					shortTitle,
					filename,
					source,
					creatorYear,
					collection,
					groupId: groupIds.has(assignments[key]) ? assignments[key] : '',
					pinned: pinnedKeys.has(key),
					status: sleepingKeys.has(key) && !hostLoaded ? 'sleeping' : 'active',
				};
			});
	}

	getDisplayTitle(t: { title: string; shortTitle: string; filename: string; key: string }): string {
		const mode = getPref('verticalTabTitleMode');
		const base = mode === 'shortTitle' ? t.shortTitle : mode === 'filename' ? t.filename : t.title;
		if (!getPref('enableTabRemarks')) return base;
		const r = this.store.getRemark(t.key);
		if (!r.note || r.mode === 'original') return base;
		return r.mode === 'note' ? r.note : `${r.note} · ${base}`;
	}

	getDisplaySubtitle(tabInfo: { key?: string; source: string; creatorYear: string; collection: string }): string {
		const mode = getPref('verticalTabSubtitleMode');
		if (mode === 'none') return '';
		if (mode === 'creatorYear') return tabInfo.creatorYear;
		if (mode === 'collection') return tabInfo.collection;
		if (mode === 'lastViewed' && tabInfo.key) {
			const h = this.store.state.history[tabInfo.key];
			const ts = h?.lastViewed ?? h?.firstSeen;
			if (!ts) return '';
			const mins = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
			if (mins < 60) return mins < 2 ? t('zotero-tabflow-time-just-now', '刚刚') : t('zotero-tabflow-time-mins', `${mins} 分钟前`, { count: mins });
			const hours = Math.floor(mins / 60);
			if (hours < 24) return t('zotero-tabflow-time-hours', `${hours} 小时前`, { count: hours });
			const days = Math.floor(hours / 24);
			return t('zotero-tabflow-time-days', `${days} 天前`, { count: days });
		}
		return tabInfo.source;
	}
}
