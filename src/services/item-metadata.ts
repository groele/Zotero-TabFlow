import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { NativeTabLike, TrackedTab } from '../core/types.ts';

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
		if (!item) return '未分类集合';
		const primary = item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
		const collectionIDs: number[] = primary.getCollections?.() || [];
		if (!collectionIDs.length) return '未分类集合';

		const strategy = getPref('multiCollectionStrategy');
		if (strategy === 'active') {
			const activeCol = (this.win as any).ZoteroPane?.getSelectedCollections?.()?.find(
				(collection: { id: number }) => collectionIDs.includes(collection.id),
			);
			if (activeCol) {
				return String(activeCol.name || '未分类集合');
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
		return first ? String(first.name) : '未分类集合';
	}

	plainTitle(value: string): string {
		const render = (Zotero.Utilities as any)?.Internal?.renderItemTitle;
		return typeof render === 'function' ? render.call((Zotero.Utilities as any).Internal, value) : value.replace(/<[^>]*>/g, '');
	}

	buildTrackedTabs(): TrackedTab[] {
		const enablePinned = getPref('enablePinnedTabs');
		const enableSleep = getPref('enableTabSleep');
		return this.getNativeTabs()
			.filter((t) => t.type !== 'library')
			.map((tab) => {
				const key = this.tabKey(tab) || `tab:${tab.id}`;
				const itemID = typeof tab.data?.itemID === 'number' ? tab.data.itemID : null;
				const rawItem: any = itemID ? Zotero.Items.get(itemID) : null;
				const primary = this.resolvePrimaryItem(itemID);
				const title = this.plainTitle(String(primary?.getField?.('title') || tab.title || '无标题'));
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
				const collection = this.resolveCollectionName(primary);
				const sleeping = enableSleep && this.store.isSleeping(key);
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
					groupId: this.store.groupOfKey(key),
					pinned: enablePinned && this.store.isPinned(key),
					status: sleeping ? 'sleeping' : 'active',
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

	getDisplaySubtitle(t: { source: string; creatorYear: string; collection: string }): string {
		const mode = getPref('verticalTabSubtitleMode');
		if (mode === 'none') return '';
		if (mode === 'creatorYear') return t.creatorYear;
		if (mode === 'collection') return t.collection;
		return t.source;
	}
}
