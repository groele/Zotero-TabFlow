import { t } from '../core/i18n.ts';
import { getPref, setPref } from '../core/prefs.ts';
import { formatSnapshotTimestamp } from '../core/session-store.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import type { PopoverController } from './popovers.ts';

interface SpotEntry { label: string; hint: string; run: () => void; }
interface LibraryIndexItem { id: number; fullKey: string; title: string; metaHint: string; searchText: string; }

export class SpotlightController {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly store: TabFlowStore;
	private readonly meta: ItemMetadataService;
	private readonly actions: TabActionService;
	private readonly popovers: PopoverController;
	private readonly onRefresh: () => void;
	private panel: any = null;
	private input: HTMLInputElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private entries: SpotEntry[] = [];
	private activeIndex = 0;
	private libraryCache: LibraryIndexItem[] = [];
	private cacheTimestamp = 0;
	private libraryLoading = false;
	private libraryLoad: Promise<void> | null = null;

	constructor(win: Window, doc: Document, store: TabFlowStore, meta: ItemMetadataService, actions: TabActionService, popovers: PopoverController, onRefresh: () => void) {
		this.win = win;
		this.doc = doc;
		this.store = store;
		this.meta = meta;
		this.actions = actions;
		this.popovers = popovers;
		this.onRefresh = onRefresh;
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	init(): void {
		this.win.addEventListener('keydown', this.handleGlobalShortcut, true);
	}

	private mount(): void {
		if (this.panel) return;
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const xul = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('panel')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'panel');
		xul.id = 'ztf-spotlight-panel';
		xul.setAttribute('orient', 'vertical');

		const box = this.h('div', 'ztf-spot-box');
		const input = this.h('input', 'ztf-spot-input');
		input.type = 'search';
		input.setAttribute('data-l10n-id', 'zotero-tabflow-spotlight-search');
		const results = this.h('div', 'ztf-spot-results');
		box.append(input, results);
		xul.append(box);
		popupset.append(xul);

		this.panel = xul;
		this.input = input;
		this.resultsEl = results;

		xul.addEventListener('popupshown', () => { input.focus(); input.select(); });
		input.addEventListener('input', () => {
			this.activeIndex = 0;
			if (input.value.trim().startsWith('@') && input.value.trim().length > 1) void this.warmLibraryCache();
			this.renderResults();
		});
		box.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.isComposing) return;
			if (e.key === 'Escape') { e.preventDefault(); this.close(); }
			else if (e.key === 'ArrowDown') { e.preventDefault(); this.activeIndex = Math.max(0, Math.min(this.entries.length - 1, this.activeIndex + 1)); this.highlightActive(); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); this.activeIndex = Math.max(0, this.activeIndex - 1); this.highlightActive(); }
			else if (e.key === 'Enter') { e.preventDefault(); const item = this.entries[this.activeIndex]; if (item) { item.run(); this.close(); } }
		});
	}

	private handleGlobalShortcut = (e: KeyboardEvent): void => {
		if (!getPref('enableSpotlight')) return;
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
			e.preventDefault();
			e.stopPropagation();
			if (this.panel?.state === 'open') this.close();
			else this.open();
		}
	};

	open(anchor?: Element): void {
		if (!getPref('enableSpotlight')) return;
		this.mount();
		if (!this.panel || !this.input) return;
		this.input.value = '';
		this.activeIndex = 0;
		this.renderResults();
		const target = anchor || this.doc.getElementById('tab-bar-container') || this.doc.documentElement;
		this.panel.openPopup(target, 'after_start', 0, 8, false, false);
	}

	private warmLibraryCache(): Promise<void> {
		if (Date.now() - this.cacheTimestamp < 30_000 && this.libraryCache.length) return Promise.resolve();
		if (this.libraryLoad) return this.libraryLoad;
		this.libraryLoading = true;
		this.libraryLoad = (async () => {
			try {
				const api = Zotero.Libraries as any;
				const libraries = api?.getAll?.();
				const libraryIDs = Array.isArray(libraries)
					? [...new Set(libraries.map((library: any) => library?.libraryID).filter((id: unknown): id is number => Number.isInteger(id) && Number(id) > 0))]
					: [api?.userLibraryID ?? 1];
				const byLibrary = await Promise.all(libraryIDs.map(async (libraryID) => {
					try {
						const items = await (Zotero.Items as any)?.getAll?.(libraryID, true, false, false);
						return Array.isArray(items) ? items.filter((item: any) => item?.isRegularItem?.()).map((item: any) => ({ item, libraryID })) : [];
					} catch { return []; }
				}));
				this.libraryCache = byLibrary.flatMap((entries) => entries.map(({ item, libraryID }) => {
					const title = this.meta.plainTitle(String(item.getField?.('title') || ''));
					const creators = item.getCreators?.() || [];
					const author = creators[0]?.lastName || creators[0]?.firstName || '';
					const year = String(item.getField?.('year') || '').slice(0, 4);
					const pub = String(item.getField?.('publicationTitle') || item.getField?.('proceedingsTitle') || '');
					let libraryName = '';
					try { libraryName = api?.getName?.(libraryID) || ''; } catch { /* Library names are optional search metadata. */ }
					return {
						id: item.id,
						fullKey: `${libraryID}:${item.key}`,
						title: title || item.key,
						metaHint: [libraryName, author, year, pub].filter(Boolean).join(' · '),
						searchText: `${title} ${author} ${year} ${pub} ${libraryName}`.toLowerCase(),
					};
				}));
				this.cacheTimestamp = Date.now();
			} catch {
				// Keep search usable when a library cannot be indexed.
			} finally {
				this.libraryLoading = false;
				this.libraryLoad = null;
				if (this.input?.value.trim().startsWith('@')) this.renderResults();
			}
		})();
		return this.libraryLoad;
	}

	close(): void { this.panel?.hidePopup?.(); }

	private renderResults(): void {
		if (!this.resultsEl || !this.input) return;
		const q = this.input.value.trim().toLowerCase();
		const tabsMode = /^>tabs(?:\s|$)/.test(q);
		const libMode = /^@/.test(q);
		const terms = q.replace(tabsMode ? /^>tabs/ : /^([>@])/, '').split(/\s+/).filter(Boolean);
		const tabs = this.meta.buildTrackedTabs();
		const groups = this.store.orderedGroups();
		const names = new Map(groups.map((group) => [group.id, group.name]));
		const hiddenGroups = this.store.hiddenGroups();
		const hiddenIds = new Set(hiddenGroups.map((group) => group.id));
		const matches = (value: string) => terms.every((term) => value.toLowerCase().includes(term));
		const tabMatches = (tab: typeof tabs[number]) =>
			matches(`${this.store.getRemark(tab.key).note} ${tab.title} ${tab.shortTitle} ${tab.filename} ${tab.collection} ${tab.creatorYear} ${names.get(tab.groupId) ?? ''}`);
		if (tabsMode) {
			const viewedAt = (key: string) => this.store.state.history[key]?.lastViewed ?? 0;
			tabs.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
		}

		const tabEntries: SpotEntry[] = (q.startsWith('>') && !tabsMode) || libMode ? [] : tabs
			.filter((tab) => !hiddenIds.has(tab.groupId) && tabMatches(tab))
			.map((tab) => {
				const gName = names.get(tab.groupId) || t('zotero-tabflow-ungrouped', '未分组');
				const r = getPref('enableTabRemarks') ? this.store.getRemark(tab.key).note : '';
				return { label: `${tab.pinned ? '📌 ' : ''}${r || tab.title}`, hint: `${gName} · ${tab.collection}`, run: () => this.actions.selectTab(tab.tab.id) };
			});

		const openKeys = new Set(tabs.map((tab) => tab.key));
		const visibleVirtuals: SpotEntry[] = (q.startsWith('>') && !tabsMode) || libMode || tabsMode || !getPref('enableVirtualMembers') ? []
			: Object.values(this.store.state.virtualMembers).flatMap((m) => {
				const gid = this.store.groupOfKey(m.key);
				if (openKeys.has(m.key) || hiddenIds.has(gid) || !matches(`${this.store.getRemark(m.key).note} ${m.title} ${m.shortTitle} ${m.filename} ${m.collection} ${m.creatorYear} ${names.get(gid) ?? ''}`)) return [];
				const r = getPref('enableTabRemarks') ? this.store.getRemark(m.key).note : '';
				return [{
					label: `◌ ${r || m.title}`,
					hint: `${names.get(gid) || t('zotero-tabflow-ungrouped', '未分组')} · ${t('zotero-tabflow-spot-virtual-hint', '虚拟保留')}`,
					run: () => void this.actions.openVirtualOrItem(m.itemID, gid, false, m.key).then((opened) => {
						if (!opened) Services.prompt.alert(this.win, m.title, t('zotero-tabflow-spot-hidden-open-failed', '未能打开这篇文献。请检查附件文件是否可用。'));
						this.onRefresh();
					}),
				}];
			});
		const allTabEntries = [...tabEntries, ...visibleVirtuals];
		const openItemIds = new Set(tabs.flatMap((tab) => [tab.itemID, tab.parentItemID]));
		const libraryEntries: SpotEntry[] = !libMode || !terms.length ? [] : this.libraryCache
			.filter((it) => !openKeys.has(it.fullKey) && !openItemIds.has(it.id) && matches(it.searchText))
			.slice(0, 6)
			.map((it) => ({
				label: `📖 ${it.title}`,
				hint: it.metaHint || t('zotero-tabflow-spot-hint-library', '文献库 · 打开'),
				run: () => void this.actions.openVirtualOrItem(it.id).then(async (opened) => {
					if (!opened) await (this.win as any).ZoteroPane?.selectItem?.(it.id);
					this.onRefresh();
				}).catch((error) => Zotero.logError(error)),
			}));

		const selectedID = this.meta.getSelectedTabID();
		const activeTab = tabs.find((tab) => tab.tab.id === selectedID);
		const sessionEntries: SpotEntry[] = !getPref('enableSessions') || libMode ? [] : [...this.store.state.sessions, ...(this.store.state.rollingSessions ?? [])]
			.map((s) => ({
				label: `💾 ${t('zotero-tabflow-spot-session-prefix', '会话')}：${s.name} (${s.openKeys.length})`,
				hint: t('zotero-tabflow-spot-session-hint', '预览并恢复'),
				run: () => this.win.setTimeout(() => void this.popovers.previewAndRestoreSession(s), 0),
			}))
			.filter((e) => !terms.length || terms.every((term) => `${e.label} ${e.hint}`.toLowerCase().includes(term)));

		const hiddenDocuments = libMode || (q.startsWith('>') && !tabsMode) ? [] : [
			...tabs.filter((tab) => hiddenIds.has(tab.groupId) && tabMatches(tab)).map((tab) => ({
				groupId: tab.groupId,
				label: this.store.getRemark(tab.key).note || tab.title,
				hint: `${names.get(tab.groupId)} · ${t('zotero-tabflow-spot-hidden-select', '仅切换至此标签')}`,
				run: () => this.actions.selectTab(tab.tab.id),
			})),
			...(!tabsMode && getPref('enableVirtualMembers') ? Object.values(this.store.state.virtualMembers).flatMap((member) => {
				const groupId = this.store.groupOfKey(member.key);
				if (openKeys.has(member.key) || !hiddenIds.has(groupId) || !matches(`${this.store.getRemark(member.key).note} ${member.title} ${member.shortTitle} ${member.filename} ${member.collection} ${names.get(groupId)}`)) return [];
				return [{
					groupId,
					label: (getPref('enableTabRemarks') ? this.store.getRemark(member.key).note : '') || member.title,
					hint: `${names.get(groupId)} · ${t('zotero-tabflow-spot-hidden-open', '仅打开这篇文献')}`,
					run: () => {
						void this.actions.openVirtualOrItem(member.itemID, undefined, false, member.key).then((opened) => {
							if (!opened) Services.prompt.alert(this.win, member.title, t('zotero-tabflow-spot-hidden-open-failed', '未能打开这篇文献。请检查附件文件是否可用。'));
							this.onRefresh();
						});
					},
				}];
			}) : []),
		];
		const matchedHiddenIds = new Set(hiddenDocuments.map((entry) => entry.groupId));
		const restoreHint = t('zotero-tabflow-spot-hidden-hint', '恢复分组');
		const hiddenEntries: SpotEntry[] = libMode ? [] : hiddenGroups
			.filter((g) => matchedHiddenIds.has(g.id) || (!tabsMode && matches(`${g.name} ${restoreHint}`)))
			.map((g) => ({
				label: g.name,
				hint: restoreHint,
				run: () => { this.store.setGroupHidden(g.id, false); this.onRefresh(); },
			}));

		const cmdEntries: SpotEntry[] = libMode ? [] : [
			...(getPref('enableSessions') || getPref('enableGroupHiding') ? [{
				label: `🗂️ ${t('zotero-tabflow-spot-cmd-workspace', '打开 TabFlow 工作区（会话与隐藏项目）…')}`,
				hint: t('zotero-tabflow-spot-hint-workspace', '工作区'),
				run: () => this.win.setTimeout(() => this.popovers.openWorkspaceHub(), 0),
			}] : []),
			{ label: `↩ ${t('zotero-tabflow-menu-undo-close', '恢复最近关闭的标签页')}`, hint: 'Ctrl+Shift+T', run: () => { this.actions.undoCloseTab(); this.onRefresh(); } },
			{ label: `📂 ${t('zotero-tabflow-spot-cmd-autogroup', '按 Zotero 集合自动分组')}`, hint: t('zotero-tabflow-spot-hint-autogroup', '自动归组'), run: () => { this.actions.autoGroupByCollection(); this.onRefresh(); } },
			{ label: `🗂️ ${t('zotero-tabflow-menu-suggest-venue', '按期刊自动归组建议…')}`, hint: t('zotero-tabflow-spot-hint-suggest', '归组建议'), run: () => this.win.setTimeout(() => this.popovers.openPublicationSuggest(), 0) },
			...(getPref('enableTabSleep') ? [{
				label: `💤 ${t('zotero-tabflow-spot-cmd-sleep', '休眠所有后台非固定标签')}`,
				hint: t('zotero-tabflow-spot-hint-sleep', '释放内存'),
				run: () => { this.actions.sleepInactiveTabs(); this.onRefresh(); },
			}] : []),
			...(getPref('enableSessions') && !this.store.readOnly ? [{
				label: `💾 ${t('zotero-tabflow-spot-cmd-save-session', '保存当前工作区为会话…')}`,
				hint: t('zotero-tabflow-spot-hint-session', '会话'),
				run: () => this.win.setTimeout(() => {
					const val = { value: `${t('zotero-tabflow-session-default-name', '工作区会话')} · ${formatSnapshotTimestamp(Date.now())}` };
					if (!Services.prompt.prompt(this.win, t('zotero-tabflow-sessions-save', '保存会话快照'), t('zotero-tabflow-sessions-save-prompt', '请输入会话名称：'), val, null, { value: false })) return;
					this.store.saveSession(val.value, this.meta.buildTrackedTabs().map((item) => item.key));
					this.onRefresh();
				}, 0),
			}] : []),
			...(getPref('enableVerticalSidebar') ? [{
				label: `⇄ ${t('zotero-tabflow-spot-cmd-toggle-sidebar', '展开/收起垂直标签侧边栏')}`,
				hint: t('zotero-tabflow-spot-hint-sidebar', '侧边栏'),
				run: () => { setPref('verticalSidebarCollapsed', !getPref('verticalSidebarCollapsed')); this.onRefresh(); },
			}] : []),
			...(activeTab ? [
				...(getPref('enablePinnedTabs') ? [{
					label: `📌 ${t('zotero-tabflow-spot-cmd-toggle-pin', '固定 / 取消固定当前标签')}`,
					hint: t('zotero-tabflow-spot-hint-pin', '固定'),
					run: () => { this.store.togglePinned(activeTab.key); this.onRefresh(); },
				}] : []),
				...(activeTab.itemID && activeTab.tab.type?.startsWith('reader') && getPref('enableShowInFilesystem') ? [{
					label: `📂 ${t('zotero-tabflow-spot-cmd-pdf-folder', '打开当前 PDF 附件所在文件夹')}`,
					hint: t('zotero-tabflow-spot-hint-folder', '文件夹'),
					run: () => void this.actions.showInFilesystem(activeTab.tab.id),
				}] : []),
			] : []),
		].filter((c) => !terms.length || terms.every((term) => `${c.label} ${c.hint}`.toLowerCase().includes(term)));

		const sections = [
			[t('zotero-tabflow-spot-section-tabs', '打开的标签'), allTabEntries],
			[t('zotero-tabflow-spot-section-library', '文库文献'), libraryEntries],
			[t('zotero-tabflow-spot-section-hidden', '隐藏项目'), [...hiddenDocuments, ...hiddenEntries]],
			[t('zotero-tabflow-spot-section-sessions', '会话与快照'), tabsMode ? [] : sessionEntries],
			[t('zotero-tabflow-spot-section-actions', '操作'), tabsMode ? [] : cmdEntries],
		] as const;
		this.entries = sections.flatMap(([, entries]) => entries);
		this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.entries.length - 1));
		this.resultsEl.textContent = '';
		let index = 0;
		for (const [label, entries] of sections) {
			if (!entries.length) continue;
			const heading = this.h('div', 'ztf-spot-section');
			heading.setAttribute('role', 'heading');
			heading.setAttribute('aria-level', '2');
			heading.textContent = label;
			this.resultsEl.append(heading);
			for (const entry of entries) this.renderEntry(entry, index++);
		}
		if (!this.entries.length) {
			const empty = this.h('div', 'ztf-spot-empty');
			empty.textContent = libMode && this.libraryLoading
				? t('zotero-tabflow-spot-library-loading', '正在搜索所有文库…')
				: t('zotero-tabflow-spot-empty', '没有匹配的文献或命令');
			this.resultsEl.append(empty);
		}
	}

	private renderEntry(entry: SpotEntry, idx: number): void {
		const btn = this.h('button', `ztf-spot-row${idx === this.activeIndex ? ' active' : ''}`);
		btn.type = 'button';
		const main = this.h('span', 'ztf-spot-main');
		main.textContent = entry.label;
		const hint = this.h('span', 'ztf-spot-hint');
		hint.textContent = entry.hint;
		btn.append(main, hint);
		btn.onclick = () => { entry.run(); this.close(); };
		this.resultsEl?.append(btn);
	}

	private highlightActive(): void {
		if (!this.resultsEl) return;
		const rows = [...this.resultsEl.querySelectorAll('.ztf-spot-row')];
		rows.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
		rows[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
	}

	dispose(): void {
		this.win.removeEventListener('keydown', this.handleGlobalShortcut, true);
		this.panel?.hidePopup?.();
		this.panel?.remove?.();
		this.panel = null;
		this.input = null;
		this.resultsEl = null;
		this.entries = [];
	}
}
