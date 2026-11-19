import { computeNativeTabMoveTarget } from '../core/drag-utils.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { NativeTabLike, TabCloseOptions, TrackedTab, VirtualMemberMeta } from '../core/types.ts';
import { openAttachmentFolder } from './attachment-folder.ts';
import { uncategorizedCollectionLabel, type ItemMetadataService } from './item-metadata.ts';

export function isTabBusyOrProtected(
	tab: NativeTabLike,
	reader: any,
	options: TabCloseOptions,
	isPinned: boolean,
	selectedID: string,
): boolean {
	if (options.protectPinned && isPinned) return true;
	if (options.protectSelected && tab.id === selectedID) return true;
	if (options.protectMedia) {
		if ((tab.audioStatus?.active && !tab.audioStatus.paused) || tab.data?.soundPlaying
			|| reader?.soundPlaying || reader?._internalReader?.hasUnsavedChanges) {
			return true;
		}
	}
	return false;
}

function toVirtualMember(tab: TrackedTab): VirtualMemberMeta | null {
	if (!tab.itemID) return null;
	const { key, itemID, parentItemID, title, shortTitle, filename, source, creatorYear, collection } = tab;
	return { key, itemID, parentItemID, title, shortTitle, filename, source, creatorYear, collection, type: tab.tab.type };
}

export class TabActionService {
	private readonly win: Window;
	private readonly store: TabFlowStore;
	private readonly meta: ItemMetadataService;

	constructor(win: Window, store: TabFlowStore, meta: ItemMetadataService) {
		this.win = win;
		this.store = store;
		this.meta = meta;
	}

	selectTab(tabId: string): void {
		const tabs = (this.win as any).Zotero_Tabs;
		if (!tabs) return;
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const key = this.meta.tabKey(tab);
		if (key && this.store.isSleeping(key)) this.store.setSleeping(key, false);
		if (tab) {
			const groupId = this.store.groupOfKey(key);
			if (this.store.state.collapsed.includes(groupId)) this.store.setCollapsed(groupId, false);
			void Promise.resolve(tabs.select(tabId)).catch((error) => Zotero.logError(error as Error));
		}
	}

	async closeTab(tabId: string, preserveVirtual = true): Promise<void> {
		await this.closeTabs([tabId], { preserveVirtual, protectPinned: true, protectMedia: true });
	}

	async closeTabs(tabIds: readonly string[], options: TabCloseOptions = {}): Promise<number> {
		const tabs = (this.win as any).Zotero_Tabs;
		if (!tabs || !tabIds.length) return 0;
		const preserveVirtual = options.preserveVirtual ?? true;
		const selectedID = this.meta.getSelectedTabID();
		const nativeMap = new Map(this.meta.getNativeTabs().map((t) => [t.id, t]));
		const trackedMap = new Map(this.meta.buildTrackedTabs().map((t) => [t.tab.id, t]));

		const toClose: string[] = [];
		const backups: VirtualMemberMeta[] = [];
		for (const id of new Set(tabIds)) {
			const tab = nativeMap.get(id);
			if (!tab || tab.type === 'library') continue;
			const tracked = trackedMap.get(id);
			const reader = (Zotero.Reader as any)?.getByTabID?.(id);
			if (isTabBusyOrProtected(tab, reader, options, Boolean(tracked?.pinned), selectedID)) continue;
			if (tracked?.groupId && preserveVirtual && getPref('enableVirtualMembers')) {
				const member = toVirtualMember(tracked);
				if (member) backups.push(member);
			}
			toClose.push(id);
		}
		if (!toClose.length) return 0;
		try {
			tabs.close(toClose.length === 1 ? toClose[0] : toClose);
		} catch (error) {
			Zotero.logError(error as Error);
			return 0;
		}
		if (backups.length) {
			for (const member of backups) this.store.state.virtualMembers[member.key] = member;
			this.store.save();
		}
		return toClose.length;
	}

	hideGroup(groupId: string): void {
		const tabs = this.meta.buildTrackedTabs().filter((tab) => tab.groupId === groupId);
		const members = tabs.map(toVirtualMember).filter((member) => member !== null);
		if (groupId) this.store.setGroupHidden(groupId, true, members);
		else this.store.hideUngrouped(tabs.map((tab) => tab.key), members);
	}

	undoCloseTab(): boolean {
		const tabs = (this.win as any).Zotero_Tabs;
		if (typeof tabs?.undoClose !== 'function') return false;
		try {
			void Promise.resolve(tabs.undoClose()).catch((error) => Zotero.logError(error as Error));
			return true;
		} catch (error) {
			Zotero.logError(error as Error);
			return false;
		}
	}

	sleepTab(tabId: string): boolean {
		if (!getPref('enableTabSleep')) return false;
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const key = this.meta.tabKey(tab);
		if (!tab || !key || tabId === this.meta.getSelectedTabID() || tab.type.endsWith('-unloaded')) return false;
		if (getPref('enablePinnedTabs') && this.store.isPinned(key)) return false;
		const tabs = (this.win as any).Zotero_Tabs;
		const reader = (Zotero.Reader as any)?.getByTabID?.(tabId);
		if (typeof tabs?.unload !== 'function' || tabs.canUnload?.(tabId) === false
			|| isTabBusyOrProtected(tab, reader, { protectMedia: true }, false, '')) return false;
		try {
			tabs.unload(tabId);
		} catch (error) {
			Zotero.logError(error as Error);
			return false;
		}
		const unloaded = this.meta.getNativeTabs().find((candidate) => candidate.id === tabId)?.type.endsWith('-unloaded') === true;
		if (!unloaded) return false;
		this.store.setSleeping(key, true);
		return true;
	}

	sleepInactiveTabs(): number {
		if (!getPref('enableTabSleep')) return 0;
		const selected = this.meta.getSelectedTabID();
		let count = 0;
		for (const t of this.meta.buildTrackedTabs()) {
			if (t.tab.id !== selected && !t.pinned && t.status === 'active') {
				if (this.sleepTab(t.tab.id)) count++;
			}
		}
		return count;
	}

	async openVirtualOrItem(itemID: number, groupId?: string, openInBackground = false): Promise<boolean> {
		try {
			const item = Zotero.Items.get(itemID);
			if (!item || item.deleted) return false;
			const isNote = item.isNote?.() === true;
			const target = isNote || item.isAttachment() ? item : await item.getBestAttachment();
			if (!target || target.deleted) return false;
			const key = `${target.libraryID}:${target.key}`;
			const virtual = this.store.state.virtualMembers[key];
			const existing = this.meta.getNativeTabs().find((tab) => tab.data?.itemID === target.id);
			if (existing) {
				if (!openInBackground) this.selectTab(existing.id);
			} else if (isNote) {
				await Zotero.Notes.open(target.id, undefined, { openInBackground });
			} else {
				if (target.isFileAttachment() && !await target.fileExists()) return false;
				await Zotero.Reader.open(target.id, undefined, { openInBackground });
			}
			if (groupId !== undefined) this.store.assignKey(key, groupId);
			const currentGroup = this.store.groupOfKey(key);
			const hidden = this.store.state.groups.some((group) => group.id === currentGroup && group.hidden === true);
			if (!hidden && virtual && this.store.state.virtualMembers[key] === virtual) this.store.removeVirtualMember(key);
			return true;
		} catch (error) {
			Zotero.logError(error as Error);
			return false;
		}
	}

	autoGroupByCollection(onlyTabIDs?: string[]): number {
		let moved = 0;
		const filterSet = onlyTabIDs ? new Set(onlyTabIDs) : null;
		const hiddenNames = new Set(this.store.hiddenGroups().map((group) => group.name));
		for (const t of this.meta.buildTrackedTabs()) {
			if (filterSet && !filterSet.has(t.tab.id)) continue;
			if (!t.groupId && !t.pinned && t.collection && !hiddenNames.has(t.collection) && t.collection !== uncategorizedCollectionLabel()) {
				const group = this.store.ensureGroup(t.collection);
				this.store.assignKey(t.key, group.id);
				moved++;
			}
		}
		return moved;
	}

	async showInFilesystem(tabId: string): Promise<void> {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const itemID = tab?.data?.itemID;
		if (typeof itemID !== 'number') return;
		const item: any = Zotero.Items.get(itemID);
		await openAttachmentFolder(item, this.win);
	}

	showInLibrary(tabId: string): void {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
		if (primary) (this.win as any).ZoteroPane?.selectItem?.(primary.id);
	}

	moveTabRelative(draggedTabId: string, targetTabId: string, after: boolean): boolean {
		const tabs = (this.win as any).Zotero_Tabs;
		if (!tabs?.move) return false;
		const ids = this.meta.getNativeTabs().map((t) => t.id);
		const targetIdx = computeNativeTabMoveTarget(ids, draggedTabId, targetTabId, after);
		if (targetIdx < 0) return false;
		tabs.move(draggedTabId, targetIdx);
		return true;
	}

	async showCollectionInLibrary(tabId: string): Promise<boolean> {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
		if (!primary) return false;
		const cols: number[] = primary.getCollections?.() || [];
		const pane = (this.win as any).ZoteroPane;
		if (cols.length && pane?.collectionsView?.selectCollection) {
			const tabs = (this.win as any).Zotero_Tabs;
			if (tabs && tabs.selectedID !== 'zotero-pane') await tabs.select('zotero-pane');
			await pane.collectionsView.selectCollection(cols[0]);
			return Boolean(await pane.selectItem?.(primary.id));
		}
		await pane?.selectItem?.(primary.id);
		return false;
	}

	copyReference(tabId: string): void {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
		if (primary) this.copyReferencesForItems([primary]);
	}

	copyReferencesForItems(items: any[]): void {
		if (!items.length) return;
		try {
			const qc = (Zotero as any).QuickCopy;
			if (qc?.getContentFromItems) {
				const format = qc.getFormatFromURL?.(qc.lastActiveURL) || Zotero.Prefs.get('export.quickCopy.setting');
				const helper = Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper);
				const content = qc.getContentFromItems(items, format, (translation: { string?: string }, worked: boolean) => {
					if (worked && translation.string) helper.copyString(translation.string);
				});
				if (content?.text) helper.copyString(content.text);
			}
		} catch (error) {
			Zotero.logError(error as Error);
		}
	}

	async reloadTab(tabId: string): Promise<void> {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		if (!tab || !tab.type.startsWith('reader')) return;
		if (tab.type === 'reader-unloaded') {
			this.selectTab(tabId);
			return;
		}
		const reader = Zotero.Reader.getByTabID(tabId);
		if (isTabBusyOrProtected(tab, reader, { protectMedia: true }, false, '')) return;
		try {
			// The host Reader reloads in place and accepts no argument.
			if (typeof reader?.reload === 'function') await Reflect.apply(reader.reload, reader, []);
		} catch (error) {
			Zotero.logError(error as Error);
		}
	}
}
