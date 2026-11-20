import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { NativeTabLike, TrackedTab } from '../core/types.ts';

export function uncategorizedCollectionLabel(): string {
	return t('zotero-tabflow-uncategorized-collection', '未分类集合');
}

interface CachedItemFields {
	stamp: string;
	title: string;
	shortTitle: string;
	source: string;
	creatorYear: string;
}

const MAX_CACHE_ENTRIES = 600;

export class ItemMetadataService {
	private readonly win: Window;
	private readonly store: TabFlowStore;
	private readonly titleCache = new Map<string, string>();
	private readonly itemFields = new Map<number, CachedItemFields>();

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

	invalidateItemFields(ids: ReadonlySet<number>): void {
		for (const id of ids) this.itemFields.delete(id);
	}

	getOpenKeys(): string[] {
		return this.getNativeTabs().filter((tab) => tab.type !== 'library')
			.map((tab) => this.tabKey(tab) ?? `tab:${tab.id}`);
	}

	resolvePrimaryItem(itemID: number | null): any | null {
		if (typeof itemID !== 'number') return null;
		const item = Zotero.Items.get(itemID);
		if (!item) return null;
		return item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
	}

	resolveCollectionName(item: any, activeIds?: Set<number>, groupNames?: Set<string>, uncategorized = uncategorizedCollectionLabel()): string {
		if (!item) return uncategorized;
		const primary = item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
		const collectionIDs: number[] = primary.getCollections?.() || [];
		if (!collectionIDs.length) return uncategorized;

		const strategy = getPref('multiCollectionStrategy');
		if (strategy === 'active') {
			if (activeIds) {
				for (const cid of collectionIDs) {
					if (activeIds.has(cid)) {
						const col = Zotero.Collections.get(cid);
						if (col) return String(col.name || uncategorized);
					}
				}
			} else {
				const activeCol = (this.win as any).ZoteroPane?.getSelectedCollections?.()?.find(
					(collection: { id: number }) => collectionIDs.includes(collection.id),
				);
				if (activeCol) return String(activeCol.name || uncategorized);
			}
		}
		if (strategy === 'existing') {
			const names = groupNames ?? new Set(this.store.state.groups.map((g) => g.name));
			for (const cid of collectionIDs) {
				const col = Zotero.Collections.get(cid);
				if (col && names.has(col.name)) return String(col.name);
			}
		}
		const first = Zotero.Collections.get(collectionIDs[0]);
		return first ? String(first.name) : uncategorized;
	}

	plainTitle(value: string): string {
		const cached = this.titleCache.get(value);
		if (cached !== undefined) return cached;
		const render = (Zotero.Utilities as any)?.Internal?.renderItemTitle;
		let out: string;
		if (typeof render !== 'function') {
			out = value.replace(/<[^>]*>/g, '');
		} else {
			const rendered = render.call((Zotero.Utilities as any).Internal, value);
			const text = typeof rendered === 'string' ? rendered : String(rendered?.textContent ?? value);
			out = text.replace(/<[^>]*>/g, '');
		}
		if (this.titleCache.size >= MAX_CACHE_ENTRIES) this.titleCache.clear();
		this.titleCache.set(value, out);
		return out;
	}

	private extractPrimaryFields(primary: any, fallbackTitle: string): CachedItemFields {
		const stamp = typeof primary?.dateModified === 'string' ? primary.dateModified : '';
		const id = typeof primary?.id === 'number' ? primary.id : 0;
		const hit = id && stamp ? this.itemFields.get(id) : undefined;
		if (hit && hit.stamp === stamp) return hit;

		const rawTitle = primary?.getField?.('title');
		const title = this.plainTitle(String(rawTitle || fallbackTitle));
		const shortTitle = this.plainTitle(String(primary?.getField?.('shortTitle') || title));
		const source = String(
			primary?.getField?.('publicationTitle') ||
			primary?.getField?.('proceedingsTitle') ||
			primary?.getField?.('bookTitle') ||
			primary?.getField?.('repository') || '',
		);
		const creators = primary?.getCreators?.() || [];
		const firstAuthor = creators[0]?.lastName || creators[0]?.firstName || '';
		const year = String(primary?.getField?.('year') || '').slice(0, 4);
		const fields: CachedItemFields = { stamp, title, shortTitle, source, creatorYear: [firstAuthor, year].filter(Boolean).join(', ') };
		if (id && stamp && rawTitle) {
			if (this.itemFields.size >= MAX_CACHE_ENTRIES) this.itemFields.clear();
			this.itemFields.set(id, fields);
		}
		return fields;
	}

	buildTrackedTabs(onlyTabIDs?: ReadonlySet<string>): TrackedTab[] {
		const enablePinned = getPref('enablePinnedTabs');
		const enableSleep = getPref('enableTabSleep');
		const strategy = getPref('multiCollectionStrategy');
		const { assignments, groups, pinned, sleeping } = this.store.state;
		const groupIds = new Set(groups.map((group) => group.id));
		const groupNames = strategy === 'existing' ? new Set(groups.map((group) => group.name)) : undefined;
		const activeColIds = strategy === 'active'
			? new Set<number>(((this.win as any).ZoteroPane?.getSelectedCollections?.() || []).map((c: { id: number }) => c.id))
			: undefined;
		const uncategorized = uncategorizedCollectionLabel();
		const pinnedKeys = new Set(enablePinned ? pinned : []);
		const sleepingKeys = new Set(enableSleep ? sleeping : []);
		const collections = new Map<number, string>();
		const untitled = t('zotero-tabflow-untitled', '无标题');
		return this.getNativeTabs()
			.filter((t) => t.type !== 'library' && (!onlyTabIDs || onlyTabIDs.has(t.id)))
			.map((tab) => {
				const itemID = typeof tab.data?.itemID === 'number' ? tab.data.itemID : null;
				const rawItem: any = itemID ? Zotero.Items.get(itemID) : null;
				const key = rawItem ? `${rawItem.libraryID}:${rawItem.key}` : `tab:${tab.id}`;
				const primary = rawItem?.parentItemID ? Zotero.Items.get(rawItem.parentItemID) || rawItem : rawItem;
				const fields = this.extractPrimaryFields(primary, tab.title || untitled);
				const filename = String(rawItem?.isAttachment?.() ? rawItem.attachmentFilename || fields.title : fields.title);
				const collection = collections.get(primary?.id) ?? this.resolveCollectionName(primary, activeColIds, groupNames, uncategorized);
				if (primary) collections.set(primary.id, collection);
				const reader = sleepingKeys.has(key) ? (Zotero.Reader as any)?.getByTabID?.(tab.id) : null;
				const hostLoaded = Boolean(reader && reader.initialized !== false && !(tab.data as any)?.unloaded);
				return {
					tab,
					key,
					itemID,
					parentItemID: primary?.id ?? null,
					title: fields.title,
					shortTitle: fields.shortTitle,
					filename,
					source: fields.source,
					creatorYear: fields.creatorYear,
					collection,
					groupId: groupIds.has(assignments[key]) ? assignments[key] : '',
					pinned: pinnedKeys.has(key),
					status: tab.type.endsWith('-unloaded') || (sleepingKeys.has(key) && !hostLoaded) ? 'sleeping' : 'active',
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
