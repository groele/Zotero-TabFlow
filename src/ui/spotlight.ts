import { t } from '../core/i18n.ts';
import { getPref, setPref } from '../core/prefs.ts';
import { formatSnapshotTimestamp } from '../core/session-store.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import { buildSpotlightLibraryIndex, type LibraryIndexItem } from '../services/spotlight-library.ts';
import {
	buildGroupEntries, collectNativeClosedTabs, createSpotSectionButton, extractItemCardMeta,
	fetchRecentlyAddedEntries, formatRelativeTime, renderSpotEntryRow, type ClosedTabRecord, type SpotCardEntry,
} from '../services/spotlight-sections.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import type { PopoverController } from './popovers.ts';

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
	private entries: SpotCardEntry[] = [];
	private activeIndex = 0;
	private libraryCache: LibraryIndexItem[] = [];
	private cacheExpiresAt = 0;
	private libraryLoading = false;
	private libraryLoad: Promise<void> | null = null;
	private recentItems: SpotCardEntry[] = [];
	private closedTabs: ClosedTabRecord[] = [];
	private collapsedSections = new Set<string>(['groups']);

	constructor(win: Window, doc: Document, store: TabFlowStore, meta: ItemMetadataService, actions: TabActionService, popovers: PopoverController, onRefresh: () => void) {
		this.win = win; this.doc = doc; this.store = store; this.meta = meta;
		this.actions = actions; this.popovers = popovers; this.onRefresh = onRefresh;
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	init(): void {
		this.win.addEventListener('keydown', this.handleGlobalShortcut, true);
		this.win.addEventListener('TabClose', this.handleTabClose as EventListener, true);
	}

	private handleTabClose = (e: any): void => {
		const tabId = e?.detail?.id || e?.target?.id;
		const tab = this.meta.getNativeTabs?.().find((x) => x.id === tabId);
		const itemID = Number(tab?.data?.itemID);
		if (!tab || !itemID) return;
		const item = Zotero.Items?.get?.(itemID);
		if (!item) return;
		const key = `${item.libraryID}:${item.key}`;
		const info = extractItemCardMeta(item, this.meta.plainTitle.bind(this.meta));
		this.closedTabs = [
			{
				key, itemID, title: info.title || String(tab.title || ''), metaLine: info.subline,
				itemTypeLabel: info.itemTypeLabel, groupId: this.store.groupOfKey(key),
				closedAt: Date.now(), isPdf: info.isPdf,
			},
			...this.closedTabs.filter((c) => c.itemID !== itemID),
		].slice(0, 8);
	};

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

		this.panel = xul; this.input = input; this.resultsEl = results;
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
			else if (e.key === 'Enter') { e.preventDefault(); const item = this.entries[this.activeIndex]; if (item) { item.run(); if (!item.keepOpen) this.close(); } }
		});
	}

	private handleGlobalShortcut = (e: KeyboardEvent): void => {
		if (!getPref('enableSpotlight')) return;
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
			e.preventDefault(); e.stopPropagation();
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
		void this.refreshRecentItems();
		const target = anchor || this.doc.getElementById('tab-bar-container') || this.doc.documentElement;
		this.panel.openPopup(target, 'after_start', 0, 8, false, false);
	}

	private async refreshRecentItems(): Promise<void> {
		const tabs = this.meta.buildTrackedTabs();
		const openIds = new Set(tabs.flatMap((tab) => [tab.itemID, tab.parentItemID]).filter((n): n is number => typeof n === 'number'));
		const entries = await fetchRecentlyAddedEntries(this.meta, openIds, (id) => {
			void this.actions.openVirtualOrItem(id).then(async (opened) => {
				if (!opened) await (this.win as any).ZoteroPane?.selectItem?.(id);
				this.onRefresh();
			}).catch((error) => Zotero.logError(error));
		});
		this.recentItems = entries;
		if (['open', 'showing'].includes(this.panel?.state) && !this.input?.value.trim()) this.renderResults();
	}

	private warmLibraryCache(): Promise<void> {
		if (Date.now() < this.cacheExpiresAt) return Promise.resolve();
		if (this.libraryLoad) return this.libraryLoad;
		this.libraryLoading = true;
		this.libraryLoad = (async () => {
			try {
				const index = await buildSpotlightLibraryIndex(this.win, this.meta, () => !this.panel);
				if (index && this.panel) {
					this.libraryCache = index.entries;
					this.cacheExpiresAt = Date.now() + (index.complete ? 120_000 : 10_000);
				}
			} catch { /* Keep search usable. */ } finally {
				this.libraryLoading = false; this.libraryLoad = null;
				if (['open', 'showing'].includes(this.panel?.state) && this.input?.value.trim().startsWith('@')) this.renderResults();
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
		const cmdMode = /^>/.test(q) && !tabsMode;
		const terms = q.replace(tabsMode ? /^>tabs/ : /^([>@])/, '').split(/\s+/).filter(Boolean);
		const tabs = this.meta.buildTrackedTabs();
		const groups = this.store.orderedGroups();
		const groupMap = new Map(groups.map((g) => [g.id, g]));
		const matches = (value: string) => terms.every((term) => value.toLowerCase().includes(term));

		const tabEntries: SpotCardEntry[] = cmdMode || libMode ? [] : tabs
			.filter((tab) => matches(`${this.store.getRemark(tab.key).note} ${tab.title} ${tab.shortTitle} ${tab.filename} ${tab.collection} ${tab.creatorYear} ${groupMap.get(tab.groupId)?.name ?? ''}`))
			.map((tab) => {
				const grp = groupMap.get(tab.groupId);
				const r = getPref('enableTabRemarks') ? this.store.getRemark(tab.key).note : '';
				const viewedAt = this.store.state.history[tab.key]?.lastViewed ?? 0;
				const ago = formatRelativeTime(viewedAt);
				return {
					label: `${tab.pinned ? '📌 ' : ''}${r || tab.title}`,
					subline: tab.creatorYear || tab.collection || undefined,
					badge: grp ? { text: grp.name, color: grp.color } : undefined,
					hint: [tab.tab.type === 'reader' ? 'attachmentPDF' : (tab.tab.type || 'tab'), ago].filter(Boolean).join(' · '),
					iconKind: tab.filename?.toLowerCase().endsWith('.pdf') || tab.tab.type === 'reader' ? 'pdf' : 'article',
					run: () => this.actions.selectTab(tab.tab.id),
				};
			});
		if (tabsMode) {
			const viewedAt = (key: string) => this.store.state.history[key]?.lastViewed ?? 0;
			tabEntries.sort((a, b) => (viewedAt(b.label) - viewedAt(a.label)));
		}

		const openKeys = new Set(tabs.map((tab) => tab.key));
		const visibleVirtuals: SpotCardEntry[] = cmdMode || libMode || tabsMode || !getPref('enableVirtualMembers') ? []
			: Object.values(this.store.state.virtualMembers).flatMap((m) => {
				const gid = this.store.groupOfKey(m.key);
				const grp = groupMap.get(gid);
				if (openKeys.has(m.key) || !matches(`${this.store.getRemark(m.key).note} ${m.title} ${m.shortTitle} ${m.filename} ${m.collection} ${m.creatorYear} ${grp?.name ?? ''}`)) return [];
				const r = getPref('enableTabRemarks') ? this.store.getRemark(m.key).note : '';
				return [{
					label: `◌ ${r || m.title}`,
					subline: m.creatorYear || m.collection || undefined,
					badge: grp ? { text: grp.name, color: grp.color } : undefined,
					hint: t('zotero-tabflow-spot-virtual-hint', '虚拟保留'),
					iconKind: m.filename?.toLowerCase().endsWith('.pdf') ? 'pdf' : 'article',
					run: () => void this.actions.openVirtualOrItem(m.itemID, gid, false, m.key).then((ok) => { if (!ok) Services.prompt.alert(this.win, m.title, t('zotero-tabflow-spot-hidden-open-failed', '未能打开这篇文献。请检查附件文件是否可用。')); this.onRefresh(); }),
				}];
			});

		const plain = (v: string) => this.meta.plainTitle?.(v) ?? v;
		const closedEntries: SpotCardEntry[] = cmdMode || libMode || tabsMode ? []
			: collectNativeClosedTabs(this.win, this.closedTabs, plain, openKeys)
				.filter((c) => !terms.length || matches(`${c.title} ${c.metaLine} ${groupMap.get(c.groupId)?.name ?? ''}`))
				.map((c) => {
					const grp = groupMap.get(c.groupId);
					const ago = formatRelativeTime(c.closedAt);
					return {
						label: c.title,
						subline: c.metaLine || undefined,
						badge: grp ? { text: grp.name, color: grp.color } : undefined,
						hint: [c.itemTypeLabel, ago].filter(Boolean).join(' · '),
						iconKind: c.isPdf ? 'pdf' : 'article',
						run: () => void this.actions.openVirtualOrItem(c.itemID, c.groupId || undefined).then(() => this.onRefresh()),
					};
				});

		const recentEntries: SpotCardEntry[] = cmdMode || libMode || tabsMode ? []
			: this.recentItems.filter((r) => !terms.length || matches(`${r.label} ${r.subline ?? ''} ${r.hint}`));

		const groupEntries: SpotCardEntry[] = cmdMode || libMode || tabsMode ? []
			: buildGroupEntries(this.store, (gid) => {
				const firstTab = tabs.find((tItem) => tItem.groupId === gid);
				if (firstTab) this.actions.selectTab(firstTab.tab.id);
				else { this.store.setCollapsed(gid, false); this.onRefresh(); }
			}).filter((g) => !terms.length || matches(g.label));

		const libraryEntries: SpotCardEntry[] = [];
		if (libMode && terms.length) {
			const openItemIds = new Set(tabs.flatMap((tab) => [tab.itemID, tab.parentItemID]));
			const libHintFallback = t('zotero-tabflow-spot-hint-library', '文献库 · 打开');
			for (const it of this.libraryCache) {
				if (openKeys.has(it.fullKey) || openItemIds.has(it.id) || !terms.every((term) => it.searchText.includes(term))) continue;
				libraryEntries.push({
					label: `📖 ${it.title}`, hint: it.metaHint || libHintFallback, iconKind: 'article',
					run: () => void this.actions.openVirtualOrItem(it.id).then(async (opened) => {
						if (!opened) await (this.win as any).ZoteroPane?.selectItem?.(it.id);
						this.onRefresh();
					}).catch((error) => Zotero.logError(error)),
				});
				if (libraryEntries.length >= 6) break;
			}
		}

		const selectedID = this.meta.getSelectedTabID();
		const activeTab = tabs.find((tab) => tab.tab.id === selectedID);
		const sessionEntries: SpotCardEntry[] = !getPref('enableSessions') || libMode ? [] : [...this.store.state.sessions, ...(this.store.state.rollingSessions ?? [])]
			.map((s) => ({
				label: `💾 ${t('zotero-tabflow-spot-session-prefix', '会话')}：${s.name} (${s.openKeys.length})`,
				hint: t('zotero-tabflow-spot-session-hint', '预览并恢复'), iconKind: 'session' as const,
				run: () => this.win.setTimeout(() => void this.popovers.previewAndRestoreSession(s), 0),
			}))
			.filter((e) => !terms.length || matches(`${e.label} ${e.hint}`));

		const cmdEntries: SpotCardEntry[] = libMode ? [] : [
			...(getPref('enableSessions') ? [{ label: `🗂️ ${t('zotero-tabflow-spot-cmd-workspace', '打开 TabFlow 工作区…')}`, hint: t('zotero-tabflow-spot-hint-workspace', '工作区'), iconKind: 'cmd' as const, run: () => this.win.setTimeout(() => this.popovers.openWorkspaceHub(), 0) }] : []),
			{ label: `↩ ${t('zotero-tabflow-menu-undo-close', '恢复最近关闭的标签页')}`, hint: 'Ctrl+Shift+T', iconKind: 'cmd' as const, run: () => { this.actions.undoCloseTab(); this.onRefresh(); } },
			{ label: `📂 ${t('zotero-tabflow-spot-cmd-autogroup', '按 Zotero 集合自动分组')}`, hint: t('zotero-tabflow-spot-hint-autogroup', '自动归组'), iconKind: 'cmd' as const, run: () => { this.actions.autoGroupByCollection(); this.onRefresh(); } },
			{ label: `🗂️ ${t('zotero-tabflow-menu-suggest-venue', '按期刊自动归组建议…')}`, hint: t('zotero-tabflow-spot-hint-suggest', '归组建议'), iconKind: 'cmd' as const, run: () => this.win.setTimeout(() => this.popovers.openPublicationSuggest(), 0) },
			...(getPref('enableTabSleep') ? [{ label: `💤 ${t('zotero-tabflow-spot-cmd-sleep', '休眠所有后台非固定标签')}`, hint: t('zotero-tabflow-spot-hint-sleep', '释放内存'), iconKind: 'cmd' as const, run: () => { this.actions.sleepInactiveTabs(); this.onRefresh(); } }] : []),
			...(getPref('enableSessions') && !this.store.readOnly ? [{
				label: `💾 ${t('zotero-tabflow-spot-cmd-save-session', '保存当前工作区为会话…')}`, hint: t('zotero-tabflow-spot-hint-session', '会话'), iconKind: 'cmd' as const,
				run: () => this.win.setTimeout(() => {
					const val = { value: `${t('zotero-tabflow-session-default-name', '工作区会话')} · ${formatSnapshotTimestamp(Date.now())}` };
					if (!Services.prompt.prompt(this.win, t('zotero-tabflow-sessions-save', '保存会话快照'), t('zotero-tabflow-sessions-save-prompt', '请输入会话名称：'), val, null, { value: false })) return;
					this.store.saveSession(val.value, this.meta.buildTrackedTabs().map((item) => item.key)); this.onRefresh();
				}, 0),
			}] : []),
			...(getPref('enableVerticalSidebar') ? [{ label: `⇄ ${t('zotero-tabflow-spot-cmd-toggle-sidebar', '展开/收起垂直标签侧边栏')}`, hint: t('zotero-tabflow-spot-hint-sidebar', '侧边栏'), iconKind: 'cmd' as const, run: () => { setPref('verticalSidebarCollapsed', !getPref('verticalSidebarCollapsed')); this.onRefresh(); } }] : []),
			...(activeTab ? [
				...(getPref('enablePinnedTabs') ? [{ label: `📌 ${t('zotero-tabflow-spot-cmd-toggle-pin', '固定 / 取消固定当前标签')}`, hint: t('zotero-tabflow-spot-hint-pin', '固定'), iconKind: 'cmd' as const, run: () => { this.store.togglePinned(activeTab.key); this.onRefresh(); } }] : []),
				...(activeTab.itemID && activeTab.tab.type?.startsWith('reader') && getPref('enableShowInFilesystem') ? [{ label: `📂 ${t('zotero-tabflow-spot-cmd-pdf-folder', '打开当前 PDF 附件所在文件夹')}`, hint: t('zotero-tabflow-spot-hint-folder', '文件夹'), iconKind: 'cmd' as const, run: () => void this.actions.showInFilesystem(activeTab.tab.id) }] : []),
			] : []),
		].filter((c) => !terms.length || matches(`${c.label} ${c.hint}`));

		const fill = (prefix: string) => { if (this.input) { this.input.value = prefix; this.input.focus(); this.renderResults(); } };
		const helpEntries: SpotCardEntry[] = q === '?' ? [
			{ label: '@关键词', hint: t('zotero-tabflow-spot-help-lib', '搜索全部文库中的文献（不限于已打开标签）'), keepOpen: true, run: () => fill('@') },
			{ label: '>tabs', hint: t('zotero-tabflow-spot-help-tabs', '列出所有打开标签并按最近阅读时间排序'), keepOpen: true, run: () => fill('>tabs ') },
			{ label: '>命令', hint: t('zotero-tabflow-spot-help-cmd', '筛选保存工作区、切换侧边栏等快捷操作'), keepOpen: true, run: () => fill('>') },
		] : [];

		const sections: Array<[string, string, SpotCardEntry[]]> = q === '?'
			? [['help', t('zotero-tabflow-spot-help-hint', '搜索语法提示'), helpEntries]]
			: [
				['tabs', t('zotero-tabflow-spot-section-tabs', '打开的标签页'), [...tabEntries, ...visibleVirtuals]],
				['closed', t('zotero-tabflow-spot-section-closed', '最新关闭的标签页'), closedEntries],
				['recent', t('zotero-tabflow-spot-section-recent-items', '最近新增的条目'), recentEntries],
				['groups', t('zotero-tabflow-spot-section-groups', '标签组'), groupEntries],
				['library', t('zotero-tabflow-spot-section-library', '文库文献'), libraryEntries],
				['sessions', t('zotero-tabflow-spot-section-sessions', '会话与快照'), tabsMode ? [] : sessionEntries],
				['actions', t('zotero-tabflow-spot-section-actions', '操作'), tabsMode ? [] : cmdEntries],
			];

		const visibleEntries: SpotCardEntry[] = [];
		this.resultsEl.textContent = '';
		let index = 0;
		for (const [secKey, label, list] of sections) {
			if (!list.length) continue;
			const isCollapsed = !terms.length && this.collapsedSections.has(secKey);
			this.resultsEl.append(createSpotSectionButton(this.doc, label, isCollapsed, () => {
				if (this.collapsedSections.has(secKey)) this.collapsedSections.delete(secKey);
				else this.collapsedSections.add(secKey);
				this.renderResults();
			}));
			if (!isCollapsed) {
				for (const entry of list) {
					visibleEntries.push(entry);
					this.resultsEl.append(renderSpotEntryRow(this.doc, entry, index++ === this.activeIndex, () => {
						entry.run(); if (!entry.keepOpen) this.close();
					}));
				}
			}
		}
		this.entries = visibleEntries;
		this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.entries.length - 1));
		if (!this.entries.length && !sections.some(([, , l]) => l.length)) {
			const empty = this.h('div', 'ztf-spot-empty');
			empty.textContent = libMode && this.libraryLoading
				? t('zotero-tabflow-spot-library-loading', '正在搜索所有文库…')
				: t('zotero-tabflow-spot-empty', '没有匹配的文献或命令');
			this.resultsEl.append(empty);
		}
	}

	private highlightActive(): void {
		if (!this.resultsEl) return;
		const rows = [...this.resultsEl.querySelectorAll('.ztf-spot-row')];
		rows.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
		rows[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
	}

	dispose(): void {
		this.win.removeEventListener('keydown', this.handleGlobalShortcut, true);
		this.win.removeEventListener('TabClose', this.handleTabClose as EventListener, true);
		this.panel?.hidePopup?.(); this.panel?.remove?.();
		this.panel = null; this.input = null; this.resultsEl = null; this.entries = [];
		this.libraryCache = []; this.recentItems = []; this.closedTabs = []; this.cacheExpiresAt = 0;
	}
}
