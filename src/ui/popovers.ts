import { t } from '../core/i18n.ts';
import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TabSessionSnapshot } from '../core/types.ts';
import type { ActivityTrackerService } from '../services/activity-tracker.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import {
	applyPublicationGroupSuggestions,
	buildPublicationGroupSuggestions,
	buildSessionRestorePlan,
	executeSessionRestorePlan,
	exportSessionsJson,
	parseAndPreviewSessionImport,
	type SessionRestorePlan,
} from '../services/session-restore.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { SessionPreviewController } from './session-preview.ts';
import { WorkspaceHubController } from './workspace-hub.ts';

export class PopoverController {
	private activePopups = new Set<Element>();
	private restoring = false;
	private disposed = false;
	private preview: SessionPreviewController;
	private hub: WorkspaceHubController;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly tracker: ActivityTrackerService,
		private readonly onRefresh: () => void,
	) {
		this.preview = new SessionPreviewController(win, doc);
		this.hub = new WorkspaceHubController(win, doc, store, meta, actions, {
			onPreviewRestore: (s) => void this.previewAndRestoreSession(s),
			onQuickMerge: (s) => void this.quickMergeSession(s),
			onExportSessions: () => void this.exportSessions(),
			onImportSessions: () => void this.importSessions(),
			onRefresh,
		});
	}

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
			this.item(popup, t('zotero-tabflow-stale-header', `${threshold} 天未查看的文献 (${stale.length})`, { days: threshold, count: stale.length }), () => {}, true);
			if (!stale.length) this.item(popup, t('zotero-tabflow-stale-empty', '暂时没有建议清理的文献'), () => {}, true);
			for (const entry of stale) {
				const sub = this.xul('menu');
				sub.setAttribute('label', `${entry.tracked.title.slice(0, 56)} · ${entry.days}d`);
				const subPop = this.xul('menupopup');
				sub.append(subPop);
				popup.append(sub);
				this.item(subPop, t('zotero-tabflow-stale-view', '查看文献'), () => this.actions.selectTab(entry.tracked.tab.id));
				if (getPref('enableTabSleep')) {
					this.item(subPop, t('zotero-tabflow-stale-sleep', '休眠以释放内存'), () => { this.actions.sleepTab(entry.tracked.tab.id); this.onRefresh(); });
				}
				const keepEntry = Boolean(entry.tracked.groupId) && getPref('enableVirtualMembers');
				const closeLabel = keepEntry
					? t('zotero-tabflow-stale-close', '关闭标签页（保留在分组）')
					: t('zotero-tabflow-toolbar-close-tab', '关闭标签页');
				this.item(subPop, closeLabel, () => {
					void this.actions.closeTabs([entry.tracked.tab.id], { preserveVirtual: keepEntry, protectPinned: true, protectMedia: true }).then(this.onRefresh);
				});
			}
			popup.append(this.xul('menuseparator'));
			if (getPref('enableTabSleep')) {
				this.item(popup, t('zotero-tabflow-stale-sleep-all', '全部休眠释放内存'), () => {
					for (const s of stale) this.actions.sleepTab(s.tracked.tab.id);
					this.onRefresh();
				}, !stale.length);
			}
			this.item(popup, t('zotero-tabflow-stale-close-all', '关闭以上建议的全部标签页'), () => {
				void this.actions.closeTabs(stale.map((s) => s.tracked.tab.id), { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh);
			}, !stale.length);
			this.item(popup, t('zotero-tabflow-stale-threshold', `设置天数阈值…（当前 ${threshold} 天）`, { days: threshold }), () => {
				const val = { value: String(threshold) };
				if (Services.prompt.prompt(this.win, t('zotero-tabflow-stale-btn', '建议关闭', { count: stale.length }), t('zotero-tabflow-stale-threshold-prompt', '多少天未查看后列入建议（1–3650）：'), val, null, {})) {
					const num = Number(val.value);
					if (Number.isInteger(num) && num >= 1 && num <= 3650) { setPref('staleSuggestDays', num); this.onRefresh(); }
				}
			});
		});
	}

	openWorkspaceHub(anchor?: HTMLElement): void {
		if (!getPref('enableSessions') && !getPref('enableGroupHiding')) return;
		this.hub.open(anchor);
	}

	openHiddenGroupsMenu(_anchor: Element): void { this.openWorkspaceHub(); }
	openSessionsMenu(_anchor: Element): void { this.openWorkspaceHub(); }

	async previewAndRestoreSession(session: TabSessionSnapshot): Promise<void> {
		if (this.disposed || this.restoring) return;
		try {
			const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
			const [mergePlan, replacePlan] = await Promise.all([
				buildSessionRestorePlan(this.store, openKeys, session, true),
				buildSessionRestorePlan(this.store, openKeys, session, false),
			]);
			if (this.disposed) return;
			this.preview.openRestorePreview(mergePlan, replacePlan, (chosen) => this.executePlan(chosen));
		} catch (error) {
			Zotero.logError(error as Error);
			Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-session-restore-error', '加载会话预览失败，请查看 Zotero 错误控制台。'));
		}
	}

	private async quickMergeSession(session: TabSessionSnapshot): Promise<void> {
		if (this.disposed || this.restoring) return;
		try {
			const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
			const mergePlan = await buildSessionRestorePlan(this.store, openKeys, session, true);
			await this.executePlan(mergePlan);
		} catch (error) {
			Zotero.logError(error as Error);
			Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-session-restore-error', '恢复会话失败，请查看 Zotero 错误控制台。'));
		}
	}

	private async executePlan(plan: SessionRestorePlan): Promise<void> {
		if (this.disposed || this.restoring) return;
		this.restoring = true;
		try {
			const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
			const result = await executeSessionRestorePlan(
				plan,
				this.store,
				(itemID) => this.actions.openVirtualOrItem(itemID, undefined, true),
				openKeys,
				() => this.disposed,
			);
			if (!this.disposed && (result.failed || plan.missing.length)) {
				const missing = plan.missing.length;
				Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-session-restore-partial',
					`工作区已应用。已打开 ${result.opened} 项，打开失败 ${result.failed} 项，未找到 ${missing} 项。`,
					{ ...result, missing }));
			}
		} catch (error) {
			Zotero.logError(error as Error);
			Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-session-restore-error', '恢复会话失败，请查看 Zotero 错误控制台。'));
		} finally {
			this.restoring = false;
			if (!this.disposed) this.onRefresh();
		}
	}

	openPublicationSuggest(): void {
		const suggestions = buildPublicationGroupSuggestions(this.store, this.meta.buildTrackedTabs());
		if (!suggestions.length) {
			Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-suggest-none', '当前未分组打开标签中没有可按期刊聚合的文献（需同一期刊 ≥2 篇或匹配已有分组）。'));
			return;
		}
		this.preview.openPublicationSuggestPreview(suggestions, (chosen) => {
			applyPublicationGroupSuggestions(this.store, chosen);
			this.onRefresh();
		});
	}

	private async exportSessions(): Promise<void> {
		try {
			const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
			fp.init((this.win as any).browsingContext || (this.win as any), t('zotero-tabflow-sessions-export', '导出会话到 JSON 文件'), Ci.nsIFilePicker.modeSave);
			fp.appendFilter('JSON', '*.json');
			fp.defaultString = 'zotero-tabflow-sessions.json';
			const res = await new Promise<number>((resolve) => fp.open(resolve));
			if (this.disposed || (res !== Ci.nsIFilePicker.returnOK && res !== Ci.nsIFilePicker.returnReplace)) return;
			const version = (Zotero as any).zoterotabflow?.version;
			await Zotero.File.putContentsAsync(fp.file, exportSessionsJson(this.store.state.sessions, version), 'utf-8');
		} catch (error) {
			Zotero.logError(error as Error);
			if (!this.disposed) Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-export-error', '无法写入会话文件。请检查保存位置和文件权限。'));
		}
	}

	private async importSessions(): Promise<void> {
		try {
			const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
			fp.init((this.win as any).browsingContext || (this.win as any), t('zotero-tabflow-sessions-import', '从 JSON 文件导入会话'), Ci.nsIFilePicker.modeOpen);
			fp.appendFilter('JSON', '*.json');
			const res = await new Promise<number>((resolve) => fp.open(resolve));
			if (res !== Ci.nsIFilePicker.returnOK) return;
			const text = await Zotero.File.getContentsAsync(fp.file, 'utf-8') as string;
			const preview = await parseAndPreviewSessionImport(text);
			if (!preview.sessions.length || this.disposed) return;
			this.preview.openImportPreview(preview, () => {
				const imported = this.store.importSessions(preview.sessions);
				if (imported < preview.sessions.length) {
					const skipped = preview.sessions.length - imported;
					Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-import-partial',
						`已导入 ${imported} 个会话，未导入 ${skipped} 个。请检查可用会话容量及工作区是否可写。`, { imported, skipped }));
				}
				this.onRefresh();
			});
		} catch (error) {
			Zotero.logError(error as Error);
			Services.prompt.alert(this.win, 'Zotero TabFlow', t('zotero-tabflow-import-error', '无法解析该会话文件，请确认其为有效的 TabFlow 导出 JSON。'));
		}
	}

	dispose(): void {
		this.disposed = true;
		this.hub.dispose();
		this.preview.dispose();
		for (const p of this.activePopups) { (p as any).hidePopup?.(); p.remove(); }
		this.activePopups.clear();
	}
}
