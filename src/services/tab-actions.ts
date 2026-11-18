import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TabCloseOptions, TrackedTab, VirtualMemberMeta } from '../core/types.ts';
import { openAttachmentFolder } from './attachment-folder.ts';
import { uncategorizedCollectionLabel, type ItemMetadataService } from './item-metadata.ts';

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
			this.store.setCollapsed(this.store.groupOfKey(key), false);
			tabs.select(tabId);
		}
	}

	async closeTab(tabId: string, preserveVirtual = true): Promise<void> {
		await this.closeTabs([tabId], { preserveVirtual });
	}

	async closeTabs(tabIds: readonly string[], options: TabCloseOptions = {}): Promise<number> {
		const tabs = (this.win as any).Zotero_Tabs;
		if (!tabs || !tabIds.length) return 0;
		const preserveVirtual = options.preserveVirtual ?? true;
		const protectPinned = options.protectPinned ?? false;
		const protectSelected = options.protectSelected ?? false;
		const selectedID = this.meta.getSelectedTabID();
		const nativeMap = new Map(this.meta.getNativeTabs().map((t) => [t.id, t]));
		const trackedMap = new Map(this.meta.buildTrackedTabs().map((t) => [t.tab.id, t]));

		const toClose: string[] = [];
		for (const id of new Set(tabIds)) {
			const tab = nativeMap.get(id);
			if (!tab || tab.type === 'library') continue;
			if (protectSelected && id === selectedID) continue;
			const tracked = trackedMap.get(id);
			if (protectPinned && tracked?.pinned) continue;
			if (tracked?.groupId && preserveVirtual && getPref('enableVirtualMembers')) {
				const member = toVirtualMember(tracked);
				if (member) this.store.saveVirtualMember(member);
			}
			toClose.push(id);
		}
		if (!toClose.length) return 0;
		tabs.close(toClose.length === 1 ? toClose[0] : toClose);
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
			tabs.undoClose();
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
		if (!key || this.store.isPinned(key)) return false;
		const tabs = (this.win as any).Zotero_Tabs;
		const reader = (Zotero.Reader as any)?.getByTabID?.(tabId);
		let unloaded = false;
		if (typeof tabs?.unload === 'function') {
			try { tabs.unload(tabId); unloaded = true; } catch { /* fallback below */ }
		}
		if (!unloaded && reader?.unload) {
			try { reader.unload(); unloaded = true; } catch { /* ignore */ }
		}
		this.store.setSleeping(key, true);
		return unloaded;
	}

	sleepInactiveTabs(): number {
		if (!getPref('enableTabSleep')) return 0;
		const selected = this.meta.getSelectedTabID();
		let count = 0;
		for (const t of this.meta.buildTrackedTabs()) {
			if (t.tab.id !== selected && !t.pinned && t.status === 'active') {
				this.sleepTab(t.tab.id);
				count++;
			}
		}
		return count;
	}

	async openVirtualOrItem(itemID: number, groupId?: string, openInBackground = false): Promise<void> {
		try {
			const item = Zotero.Items.get(itemID);
			if (!item || item.deleted) return;
			const attachment = item.isAttachment() ? item : await item.getBestAttachment();
			if (!attachment || attachment.deleted) return;
			if (attachment.isFileAttachment() && !await attachment.fileExists()) return;
			const key = `${attachment.libraryID}:${attachment.key}`;
			const virtual = this.store.state.virtualMembers[key];
			await Zotero.Reader.open(attachment.id, undefined, { openInBackground });
			if (groupId) this.store.assignKey(key, groupId);
			const currentGroup = this.store.groupOfKey(key);
			const hidden = this.store.state.groups.some((group) => group.id === currentGroup && group.hidden === true);
			if (!hidden && virtual && this.store.state.virtualMembers[key] === virtual) this.store.removeVirtualMember(key);
		} catch (error) {
			Zotero.logError(error as Error);
		}
	}

	autoGroupByCollection(onlyTabIDs?: string[]): number {
		let moved = 0;
		const filterSet = onlyTabIDs ? new Set(onlyTabIDs) : null;
		const hiddenNames = new Set(this.store.hiddenGroups().map((group) => group.name));
		for (const t of this.meta.buildTrackedTabs()) {
			if (filterSet && !filterSet.has(t.tab.id)) continue;
			if (!t.groupId && t.collection && !hiddenNames.has(t.collection) && t.collection !== uncategorizedCollectionLabel()) {
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

	showCollectionInLibrary(tabId: string): boolean {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
		if (!primary) return false;
		const cols: number[] = primary.getCollections?.() || [];
		const pane = (this.win as any).ZoteroPane;
		if (cols.length && pane?.collectionsView?.selectCollection) {
			pane.collectionsView.selectCollection(cols[0]);
			pane.selectItem?.(primary.id);
			return true;
		}
		pane?.selectItem?.(primary.id);
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
				const format = Zotero.Prefs.get('export.quickCopy.setting');
				const content = qc.getContentFromItems(items, format);
				const helper = Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper);
				helper.copyString(content?.text || items.map((i) => i.getField?.('title')).filter(Boolean).join('\n'));
			}
		} catch (error) {
			Zotero.logError(error as Error);
		}
	}

	async reloadTab(tabId: string): Promise<void> {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const itemID = tab?.data?.itemID;
		if (!tab || typeof itemID !== 'number') return;
		const item: any = Zotero.Items.get(itemID);
		const targetID = item?.isAttachment?.() ? item.id : (await item?.getBestAttachment?.())?.id ?? itemID;
		const tabs = (this.win as any).Zotero_Tabs;
		tabs.close(tabId);
		await new Promise((r) => this.win.setTimeout(r, 250));
		await Zotero.Reader.open(targetID, undefined, { openInBackground: false });
	}
}
