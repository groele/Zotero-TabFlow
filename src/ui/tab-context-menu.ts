import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import { DEFAULT_PALETTE, type TabGroup, type TrackedTab, type VirtualMemberMeta } from '../core/types.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';

export class TabContextMenuController {
	private popups = new Set<Element>();
	private disposed = false;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly onRefresh: () => void,
	) {}

	private defer(fn: () => void): void {
		const run = () => { if (!this.disposed) fn(); };
		if (typeof this.win?.setTimeout === 'function') this.win.setTimeout(run, 0);
		else run();
	}

	private xul(tag: string): any {
		return (this.doc as any).createXULElement
			? (this.doc as any).createXULElement(tag)
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
	}

	private item(popup: any, label: string, action: () => void, attrs: Record<string, string | boolean> = {}): any {
		const mi = this.xul('menuitem');
		mi.setAttribute('label', label);
		for (const [k, v] of Object.entries(attrs)) {
			if (v !== false) mi.setAttribute(k, String(v));
		}
		mi.addEventListener('command', action);
		popup.append(mi);
		return mi;
	}

	private openAt(event: MouseEvent, build: (popup: any) => void): void {
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const popup = this.xul('menupopup');
		popupset.append(popup);
		this.popups.add(popup);
		popup.addEventListener('popuphidden', (e: Event) => {
			if (e.target === popup) { this.popups.delete(popup); popup.remove(); }
		});
		build(popup);
		popup.openPopupAtScreen(event.screenX, event.screenY, true);
	}

	openTabMenu(event: MouseEvent, tracked: TrackedTab): void {
		const tabMenuEnabled = getPref('enableTabContextMenu');
		if (!tabMenuEnabled && (tracked.groupId || !this.store.state.ungroupedHeadingHidden)) return;
		event.preventDefault();
		event.stopPropagation();
		this.openAt(event, (popup) => {
			if (!tracked.groupId) this.addUngroupedHeadingRestore(popup);
			if (!tabMenuEnabled) return;
			if (getPref('enablePinnedTabs')) {
				this.item(popup, tracked.pinned ? t('zotero-tabflow-menu-unpin', '取消固定标签') : `📌 ${t('zotero-tabflow-menu-pin', '固定标签（防误关）')}`, () => {
					this.store.togglePinned(tracked.key);
					this.onRefresh();
				});
			}
			if (getPref('enableTabRemarks')) {
				const remark = this.store.getRemark(tracked.key);
				this.item(popup, remark.note ? `✎ ${t('zotero-tabflow-menu-edit-remark', '编辑标签备注…')}` : `✎ ${t('zotero-tabflow-menu-set-remark', '设置标签备注…')}`, () => {
					this.defer(() => {
						const val = { value: remark.note };
						if (Services.prompt.prompt(this.win, t('zotero-tabflow-menu-set-remark', '设置标签备注'), t('zotero-tabflow-remark-prompt', '输入备注（≤300 字，不改原文件名）：'), val, null, {})) {
							this.store.setRemark(tracked.key, val.value);
							this.onRefresh();
						}
					});
				});
				const dispMenu = this.xul('menu');
				dispMenu.setAttribute('label', t('zotero-tabflow-menu-display-mode', '标签显示模式'));
				const dispPop = this.xul('menupopup');
				dispMenu.append(dispPop);
				popup.append(dispMenu);
				for (const [mode, label] of [
					['both', t('zotero-tabflow-remark-mode-both', '备注 + 原标题')],
					['note', t('zotero-tabflow-remark-mode-note', '仅显示备注')],
					['original', t('zotero-tabflow-remark-mode-original', '仅显示原标题')],
				] as const) {
					this.item(dispPop, label, () => { this.store.setDisplayMode(tracked.key, mode); this.onRefresh(); }, { type: 'radio', checked: remark.mode === mode });
				}
			}
			if (getPref('enableTabSleep') && !tracked.pinned) {
				this.item(popup, tracked.status === 'sleeping' ? `⚡ ${t('zotero-tabflow-menu-wake', '唤醒标签页')}` : `💤 ${t('zotero-tabflow-menu-sleep', '休眠标签（释放内存）')}`, () => {
					if (tracked.status === 'sleeping') this.actions.selectTab(tracked.tab.id);
					else this.actions.sleepTab(tracked.tab.id);
					this.onRefresh();
				});
			}
			popup.append(this.xul('menuseparator'));
			const groupMenu = this.xul('menu');
			groupMenu.setAttribute('label', t('zotero-tabflow-menu-join-group', '加入分组'));
			const groupPop = this.xul('menupopup');
			groupMenu.append(groupPop);
			popup.append(groupMenu);
			for (const g of this.store.visibleGroups().filter((x) => x.id)) {
				this.item(groupPop, g.name, () => { this.store.assignKey(tracked.key, g.id); this.onRefresh(); }, { type: 'checkbox', checked: tracked.groupId === g.id });
			}
			this.item(groupPop, t('zotero-tabflow-menu-new-group-join', '新建分组并加入…'), () => {
				this.defer(() => {
					const val = { value: '' };
					if (Services.prompt.prompt(this.win, t('zotero-tabflow-new-group-title', '新建分组'), t('zotero-tabflow-new-group-prompt', '分组名称：'), val, null, {}) && val.value.trim()) {
						const g = this.store.ensureGroup(val.value);
						this.store.assignKey(tracked.key, g.id);
						this.onRefresh();
					}
				});
			});
			this.item(groupPop, t('zotero-tabflow-menu-remove-group', '移出分组'), () => { this.store.assignKey(tracked.key, ''); this.onRefresh(); }, { disabled: !tracked.groupId });

			popup.append(this.xul('menuseparator'));
			this.item(popup, t('zotero-tabflow-menu-show-library', '在文献库中定位'), () => this.actions.showInLibrary(tracked.tab.id));
			this.item(popup, t('zotero-tabflow-menu-show-collection', '在集合树中定位所属集合'), () => void this.actions.showCollectionInLibrary(tracked.tab.id).catch((error) => Zotero.logError(error)));
			if (getPref('enableCopyReference')) this.item(popup, t('zotero-tabflow-menu-copy-ref', '复制引用到剪贴板'), () => this.actions.copyReference(tracked.tab.id));
			if (getPref('enableShowInFilesystem')) this.item(popup, t('zotero-tabflow-menu-show-fs', '在文件管理器中显示'), () => void this.actions.showInFilesystem(tracked.tab.id));
			if (getPref('enableReloadTab') && tracked.tab.type.startsWith('reader')) this.item(popup, t('zotero-tabflow-menu-reload', '重新加载标签页'), () => void this.actions.reloadTab(tracked.tab.id));
			popup.append(this.xul('menuseparator'));
			if (getPref('enableVirtualMembers') && tracked.groupId) {
				this.item(popup, t('zotero-tabflow-menu-close-virtual', '关闭标签（保留在分组）'), () => void this.actions.closeTab(tracked.tab.id, true).then(this.onRefresh));
			}
			this.item(popup, t('zotero-tabflow-menu-close-hard', '彻底关闭标签页'), () => void this.actions.closeTab(tracked.tab.id, false).then(this.onRefresh));
			this.item(popup, `↩ ${t('zotero-tabflow-menu-undo-close', '恢复最近关闭的标签页')}`, () => { this.actions.undoCloseTab(); this.onRefresh(); });
		});
	}

	openGroupMenu(event: MouseEvent, group: TabGroup): void {
		event.preventDefault();
		event.stopPropagation();
		this.openAt(event, (popup) => {
			this.item(popup, `${t('zotero-tabflow-rename-group-title', '重命名分组')}…`, () => {
				this.defer(() => {
					const val = { value: group.name };
					if (Services.prompt.prompt(this.win, t('zotero-tabflow-rename-group-title', '重命名分组'), t('zotero-tabflow-rename-group-prompt', '分组名称：'), val, null, {}) && val.value.trim()) {
						this.store.renameGroup(group.id, val.value);
						this.onRefresh();
					}
				});
			});
			const virtualMembers = Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === group.id);
			if (!group.id) {
				const ungroupedTabs = this.meta.buildTrackedTabs().filter((tab) => !tab.groupId);
				const ungrouped = ungroupedTabs.filter((tab) => !tab.pinned);
				if (getPref('enableGroupHiding') && (ungroupedTabs.length || virtualMembers.length)) {
					this.item(popup, t('zotero-tabflow-hide-ungrouped', '隐藏当前未分组文献'), () => this.actions.hideGroup(''));
				}
				this.item(popup, t('zotero-tabflow-menu-convert-ungrouped', `将未分组文献转为新分组… (${ungrouped.length})`, { count: ungrouped.length }), () => {
					this.defer(() => {
						const val = { value: '' };
						if (Services.prompt.prompt(this.win, t('zotero-tabflow-new-group-title', '新建分组'), t('zotero-tabflow-new-group-prompt', '分组名称：'), val, null, {}) && val.value.trim()) {
							const g = this.store.ensureGroup(val.value);
							for (const item of ungrouped) this.store.assignKey(item.key, g.id);
							this.onRefresh();
						}
					});
				}, { disabled: !ungrouped.length });
			} else {
				if (getPref('enableGroupHiding')) {
					this.item(popup, t('zotero-tabflow-hide-group', '隐藏分组'), () => this.actions.hideGroup(group.id));
				}
			}
			this.item(popup, t('zotero-tabflow-dissolve-group', '解散此分组'), () => this.defer(() => this.confirmDissolve(group)));
			const colorMenu = this.xul('menu');
			colorMenu.setAttribute('label', t('zotero-tabflow-menu-group-color', '分组颜色'));
			const colorPop = this.xul('menupopup');
			colorMenu.append(colorPop);
			popup.append(colorMenu);
			for (const [label, hex] of DEFAULT_PALETTE) {
				this.item(colorPop, `${label} (${hex})`, () => { this.store.setGroupColor(group.id, hex); this.onRefresh(); });
			}
			this.item(colorPop, t('zotero-tabflow-menu-custom-color', '自定义 Hex 颜色…'), () => {
				this.defer(() => {
					const val = { value: group.color };
					if (Services.prompt.prompt(this.win, t('zotero-tabflow-menu-custom-color', '自定义颜色'), t('zotero-tabflow-custom-color-prompt', '输入 3 位或 6 位 Hex 颜色：'), val, null, {})) {
						this.store.setGroupColor(group.id, val.value);
						this.onRefresh();
					}
				});
			});
			popup.append(this.xul('menuseparator'));
			if (virtualMembers.length) {
				this.item(popup, `▶ ${t('zotero-tabflow-menu-open-virtual-all', `打开组内全部虚拟文献 (${virtualMembers.length})`, { count: virtualMembers.length })}`, () => {
					void (async () => {
						for (const m of virtualMembers) await this.actions.openVirtualOrItem(m.itemID, group.id, false, m.key);
						this.onRefresh();
					})();
				});
			}
			this.item(popup, t('zotero-tabflow-menu-open-group-only', '仅打开本组（关闭其他标签）'), () => {
				const ids = this.meta.buildTrackedTabs().filter((x) => x.groupId !== group.id && !x.pinned).map((x) => x.tab.id);
				void this.actions.closeTabs(ids, { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh);
			});
			this.item(popup, t('zotero-tabflow-menu-close-group-all', '关闭组内所有已开标签'), () => {
				const ids = this.meta.buildTrackedTabs().filter((x) => x.groupId === group.id).map((x) => x.tab.id);
				void this.actions.closeTabs(ids, { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh);
			});
		});
	}

	openVirtualMenu(event: MouseEvent, member: VirtualMemberMeta, groupId: string): void {
		event.preventDefault();
		event.stopPropagation();
		this.openAt(event, (popup) => {
			if (!groupId) this.addUngroupedHeadingRestore(popup);
			this.item(popup, `▶ ${t('zotero-tabflow-menu-load-virtual', '加载标签页')}`, () => {
				void this.actions.openVirtualOrItem(member.itemID, groupId, false, member.key).then((opened) => {
					if (!opened) Services.prompt.alert(this.win, member.title, t('zotero-tabflow-spot-hidden-open-failed', '未能打开这篇文献。请检查附件文件是否可用。'));
					this.onRefresh();
				});
			});
			this.item(popup, t('zotero-tabflow-menu-remove-virtual', '从分组移除虚拟成员'), () => {
				this.store.removeVirtualMember(member.key);
				this.store.assignKey(member.key, '');
				this.onRefresh();
			});
		});
	}

	private addUngroupedHeadingRestore(popup: Element): void {
		if (!this.store.state.ungroupedHeadingHidden) return;
		this.item(popup, t('zotero-tabflow-show-ungrouped-heading', '恢复未分组标题'), () => {
			if (this.store.setUngroupedHeadingHidden(false)) this.onRefresh();
		}, { disabled: this.store.readOnly });
	}

	private confirmDissolve(group: TabGroup): void {
		const title = t('zotero-tabflow-dissolve-group', '解散此分组');
		try {
			if (group.id) {
				const message = t('zotero-tabflow-dissolve-group-confirm', `解散“${group.name}”？标签页将保留并回到未分组。`, { name: group.name });
				if (!Services.prompt.confirm(this.win, title, message)) return;
			}
			if (this.store.dissolveGroup(group.id)) {
				this.onRefresh();
				return;
			}
		} catch (error) {
			Zotero.logError(error as Error);
		}
		Services.prompt.alert(this.win, title, t('zotero-tabflow-dissolve-group-failed', '无法解散分组：数据为只读，或分组已不存在。'));
	}

	dispose(): void {
		this.disposed = true;
		for (const p of this.popups) { (p as any).hidePopup?.(); p.remove(); }
		this.popups.clear();
	}
}
