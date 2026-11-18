import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { VirtualMemberMeta } from '../core/types.ts';
import type { ItemMetadataService } from './item-metadata.ts';

export class TabActionService {
	constructor(
		private readonly win: Window,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
	) {}

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
		const tabs = (this.win as any).Zotero_Tabs;
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		if (!tabs || !tab || tab.type === 'library') return;
		const tracked = this.meta.buildTrackedTabs().find((x) => x.tab.id === tabId);
		if (tracked && preserveVirtual && getPref('enableVirtualMembers') && tracked.groupId && tracked.itemID) {
			const vMeta: VirtualMemberMeta = {
				key: tracked.key,
				itemID: tracked.itemID,
				parentItemID: tracked.parentItemID,
				title: tracked.title,
				shortTitle: tracked.shortTitle,
				filename: tracked.filename,
				source: tracked.source,
				creatorYear: tracked.creatorYear,
				collection: tracked.collection,
				type: tab.type,
			};
			this.store.saveVirtualMember(vMeta);
		}
		tabs.close(tabId);
	}

	sleepTab(tabId: string): void {
		if (!getPref('enableTabSleep')) return;
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const key = this.meta.tabKey(tab);
		if (!key || this.store.isPinned(key)) return;
		this.store.setSleeping(key, true);
		const reader = (Zotero.Reader as any)?.getByTabID?.(tabId);
		if (reader?.unload) {
			try { reader.unload(); } catch { /* Best-effort unload */ }
		}
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
		const item: any = Zotero.Items.get(itemID);
		if (!item) return;
		const key = `${item.libraryID}:${item.key}`;
		if (groupId) this.store.assignKey(key, groupId);
		this.store.removeVirtualMember(key);
		if (item.isAttachment?.()) {
			await Zotero.Reader.open(item.id, undefined, { openInBackground });
			return;
		}
		const attachment = await item.getBestAttachment?.();
		if (attachment) await Zotero.Reader.open(attachment.id, undefined, { openInBackground });
	}

	autoGroupByCollection(onlyTabIDs?: string[]): number {
		let moved = 0;
		const filterSet = onlyTabIDs ? new Set(onlyTabIDs) : null;
		for (const t of this.meta.buildTrackedTabs()) {
			if (filterSet && !filterSet.has(t.tab.id)) continue;
			if (!t.groupId && t.collection && t.collection !== '未分类集合') {
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
		const att = item?.isFileAttachment?.() ? item : await item?.getBestAttachment?.();
		if (att) await (this.win as any).ZoteroPane?.showAttachmentInFilesystem?.(att.id);
	}

	showInLibrary(tabId: string): void {
		const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
		const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
		if (primary) (this.win as any).ZoteroPane?.selectItem?.(primary.id);
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
