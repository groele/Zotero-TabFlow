import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TabSessionSnapshot } from '../core/types.ts';
import type { ActivityTrackerService } from '../services/activity-tracker.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';

export class PopoverController {
	private activePopups = new Set<Element>();
	private restoring = false;
	private disposed = false;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly tracker: ActivityTrackerService,
		private readonly onRefresh: () => void,
	) {}

	private xul(tag: string): any {
		return (this.doc as any).createXULElement
			? (this.doc as any).createXULElement(tag)
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
	}

	private openPopupMenu(anchor: Element, build: (popup: any) => void): void {
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const popup = this.xul('menupopup');
		popupset.append(popup);
		this.activePopups.add(popup);
		popup.addEventListener('popuphidden', (e: Event) => {
			if (e.target === popup) { this.activePopups.delete(popup); popup.remove(); }
		});
		build(popup);
		const rect = anchor.getBoundingClientRect();
		popup.openPopupAtScreen((this.win as any).mozInnerScreenX + rect.right, (this.win as any).mozInnerScreenY + rect.bottom, true);
	}

	private item(popup: any, label: string, action: () => void, disabled = false): any {
		const mi = this.xul('menuitem');
		mi.setAttribute('label', label);
		if (disabled) mi.setAttribute('disabled', 'true');
		mi.addEventListener('command', action);
		popup.append(mi);
		return mi;
	}

	openStaleMenu(anchor: Element): void {
		if (!getPref('enableStaleSuggestions')) return;
		const stale = this.tracker.getStaleTabs();
		const threshold = getPref('staleSuggestDays');
		this.openPopupMenu(anchor, (popup) => {
			this.item(popup, `${threshold} 天未查看的文献 (${stale.length})`, () => {}, true);
			if (!stale.length) this.item(popup, '暂时没有建议清理的文献', () => {}, true);
			for (const entry of stale) {
				const sub = this.xul('menu');
				sub.setAttribute('label', `${entry.tracked.title.slice(0, 56)} · ${entry.days} 天`);
				const subPop = this.xul('menupopup');
				sub.append(subPop);
				popup.append(sub);
				this.item(subPop, '查看文献', () => this.actions.selectTab(entry.tracked.tab.id));
				if (getPref('enableTabSleep')) {
					this.item(subPop, '休眠以释放内存', () => { this.actions.sleepTab(entry.tracked.tab.id); this.onRefresh(); });
				}
				this.item(subPop, '关闭标签页（保留在分组）', () => {
					void this.actions.closeTab(entry.tracked.tab.id, true).then(this.onRefresh);
				});
			}
			popup.append(this.xul('menuseparator'));
			if (getPref('enableTabSleep')) {
				this.item(popup, '全部休眠释放内存', () => {
					for (const s of stale) this.actions.sleepTab(s.tracked.tab.id);
					this.onRefresh();
				}, !stale.length);
			}
			this.item(popup, '关闭以上建议的全部标签页', () => {
				for (const s of stale) void this.actions.closeTab(s.tracked.tab.id, true);
				this.onRefresh();
			}, !stale.length);
			this.item(popup, `设置天数阈值…（当前 ${threshold} 天）`, () => {
				const val = { value: String(threshold) };
				if (Services.prompt.prompt(this.win, '建议关闭阈值', '多少天未查看后列入建议（1–3650）：', val, null, {})) {
					const num = Number(val.value);
					if (Number.isInteger(num) && num >= 1 && num <= 3650) { setPref('staleSuggestDays', num); this.onRefresh(); }
				}
			});
		});
	}

	openSessionsMenu(anchor: Element): void {
		if (!getPref('enableSessions')) return;
		this.openPopupMenu(anchor, (popup) => {
			this.item(popup, '保存当前工作区为会话…', () => {
				const val = { value: '' };
				if (!Services.prompt.prompt(this.win, '保存会话快照', '请输入会话名称：', val, null, {})) return;
				this.store.saveSession(val.value || '工作区会话', this.meta.buildTrackedTabs().map((t) => t.key));
				this.onRefresh();
			});
			popup.append(this.xul('menuseparator'));
			const sessions = this.store.state.sessions;
			if (!sessions.length) { this.item(popup, '暂无已保存的会话', () => {}, true); return; }
			for (const s of sessions) {
				const sub = this.xul('menu');
				sub.setAttribute('label', `${s.name} (${s.openKeys.length} 篇)`);
				const subPop = this.xul('menupopup');
				sub.append(subPop);
				popup.append(sub);
				this.item(subPop, '合并恢复会话（保留当前分组）', () => void this.restoreSession(s, true), this.restoring);
				this.item(subPop, '恢复会话并替换当前分组…', () => {
					if (Services.prompt.confirm(this.win, '替换当前分组', '用会话的分组与固定状态替换当前设置？已打开的标签页会保留。')) {
						void this.restoreSession(s, false);
					}
				}, this.restoring);
				this.item(subPop, '删除此会话', () => { this.store.deleteSession(s.id); this.onRefresh(); });
			}
		});
	}

	private async restoreSession(session: TabSessionSnapshot, merge: boolean): Promise<void> {
		if (this.disposed || this.restoring) return;
		this.restoring = true;
		try {
			this.store.restoreSessionLayout(session, merge);
			const open = new Set(this.meta.buildTrackedTabs().map((t) => t.key));
			for (const fullKey of session.openKeys) {
				if (this.disposed) return;
				if (open.has(fullKey)) continue;
				const [libStr, itemKey] = fullKey.split(':');
				const libraryID = Number(libStr);
				if (!Number.isInteger(libraryID) || libraryID <= 0 || !itemKey) continue;
				try {
					const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
					if (this.disposed) return;
					if (item && !item.deleted) {
						await this.actions.openVirtualOrItem(item.id, undefined, true);
						open.add(fullKey);
					}
				} catch (error) {
					Zotero.logError(error as Error);
				}
			}
		} finally {
			this.restoring = false;
			if (!this.disposed) this.onRefresh();
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const p of this.activePopups) { (p as any).hidePopup?.(); p.remove(); }
		this.activePopups.clear();
	}
}
