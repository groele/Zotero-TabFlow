import { TABFLOW_DRAG_MIME, hasTabFlowDraggedTab, hasZoteroDraggedItems, parseZoteroDraggedItemIDs } from '../core/drag-utils.ts';
import { t } from '../core/i18n.ts';
import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { SidebarViewMode, TrackedTab } from '../core/types.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { GroupSection, reconcileGroupSections } from './group-section.ts';
import { indexGroupMembers, shouldRenderGroupHeading } from './group-visibility.ts';
import { createSvgIcon } from './icons.ts';
import { SidebarHoverCard } from './sidebar-hover.ts';
import { bindSidebarKeyboardNavigation, captureSidebarFocusAnchor, restoreSidebarFocusAnchor } from './sidebar-keyboard.ts';
import { buildSidebarTabRow, buildSidebarVirtualRow, type SidebarRowDeps } from './sidebar-row.ts';
import { SidebarSelection } from './sidebar-selection.ts';
import { computeWorkspaceStatusCounts, buildSidebarSection, renderSidebarEmptyState, renderSidebarStatusBar } from './sidebar-status.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';

export class VerticalSidebarController {
	private sidebar: HTMLElement | null = null;
	private listEl: HTMLDivElement | null = null;
	private statusEl: HTMLDivElement | null = null;
	private selection: SidebarSelection | null = null;
	private searchInput: HTMLInputElement | null = null;
	private hoverCard: SidebarHoverCard;
	private ownsHoverCard: boolean;
	private viewMode: SidebarViewMode = 'groups';
	private draggedKey: string | null = null;
	private draggedTabId: string | null = null;
	private groupSections = new Map<string, GroupSection>();
	private collapsedSections = new Set<string>();
	private stopResize: (() => void) | null = null;
	private lastStyleSig = ''; private searchTimer: number | null = null;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly menus: TabContextMenuController,
		private readonly onRefresh: () => void,
		private readonly onRestoreLastSession?: () => void,
		sharedHoverCard?: SidebarHoverCard,
	) {
		this.ownsHoverCard = !sharedHoverCard;
		this.hoverCard = sharedHoverCard ?? new SidebarHoverCard(win, doc, store);
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	mount(): void {
		if (this.sidebar) return;
		const deck: Element | undefined = (this.win as any).Zotero_Tabs?.deck;
		const deckParent = deck?.parentElement;
		if (!deck || !deckParent) return;

		const aside: HTMLElement = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('vbox')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'vbox');
		aside.id = 'ztf-sidebar';

		const header = this.h('div', 'ztf-sb-header');
		const title = this.h('span', 'ztf-sb-title ztf-sb-hide-collapsed');
		title.append(createSvgIcon(this.doc, 'layers', 13), this.doc.createTextNode('TabFlow'));

		const mkBtn = (icon: Parameters<typeof createSvgIcon>[1], size: number, tip: string, fn: () => void, cls = 'ztf-sb-icon-btn ztf-sb-hide-collapsed') => {
			const b = this.h('button', cls);
			b.type = 'button';
			b.title = tip;
			b.append(createSvgIcon(this.doc, icon, size));
			b.onclick = fn;
			return b;
		};
		const headerActions = this.h('div', 'ztf-sb-header-actions');
		headerActions.append(
			mkBtn('plus', 13, t('zotero-tabflow-sidebar-new-group', '新建分组'), () => {
				const input = { value: '' };
				if (!Services.prompt.prompt(this.win, t('zotero-tabflow-new-group-title', '新建标签分组'), t('zotero-tabflow-new-group-prompt', '请输入新分组名称：'), input, null, {})) return;
				this.store.ensureGroup(input.value);
				this.viewMode = 'groups';
				this.onRefresh();
			}),
			mkBtn('folder', 13, t('zotero-tabflow-auto-group-tip', '按 Zotero 集合自动归组'), () => {
				this.actions.autoGroupByCollection();
				this.onRefresh();
			}),
			mkBtn('sleep', 13, t('zotero-tabflow-sleep-inactive-tip', '休眠后台非固定标签（释放内存）'), () => {
				this.actions.sleepInactiveTabs();
				this.onRefresh();
			}),
			mkBtn('sidebar', 14, t('zotero-tabflow-sidebar-toggle-tip', '折叠/展开侧边栏'), () => {
				setPref('verticalSidebarCollapsed', !getPref('verticalSidebarCollapsed'));
				this.render();
			}, 'ztf-sb-icon-btn'),
		);
		header.append(title, headerActions);

		const searchWrap = this.h('div', 'ztf-sb-search-wrap ztf-sb-hide-collapsed');
		const search = this.h('input', 'ztf-sb-search');
		search.type = 'search';
		search.placeholder = t('zotero-tabflow-sidebar-search-placeholder', '过滤标题、备注、集合…');
		search.oninput = () => {
			if (this.searchTimer !== null) { this.win.clearTimeout(this.searchTimer); this.searchTimer = null; }
			if (!search.value.trim()) { this.renderList(); return; }
			this.searchTimer = this.win.setTimeout(() => { this.searchTimer = null; this.renderList(); }, 60);
		};
		searchWrap.append(search);

		const views = this.h('div', 'ztf-sb-views ztf-sb-hide-collapsed');
		for (const [mode, label] of [
			['groups', t('zotero-tabflow-sidebar-view-groups', '分组')],
			['collection', t('zotero-tabflow-sidebar-view-collection', '集合')],
			['recent', t('zotero-tabflow-sidebar-view-status', '状态')],
		] as const) {
			const btn = this.h('button', `ztf-sb-view-btn${this.viewMode === mode ? ' active' : ''}`);
			btn.type = 'button';
			btn.dataset.mode = mode;
			btn.textContent = label;
			btn.onclick = () => {
				this.viewMode = mode;
				views.querySelectorAll('.ztf-sb-view-btn').forEach((b: Element) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode));
				this.renderList();
			};
			views.append(btn);
		}

		const list = this.h('div', 'ztf-sb-list ztf-sb-hide-collapsed');
		list.addEventListener('scroll', () => this.hoverCard.hide(), { passive: true });
		const statusBar = this.h('div', 'ztf-sb-status-bar ztf-sb-hide-collapsed');
		const resizer = this.h('div', 'ztf-sb-resizer ztf-sb-hide-collapsed');
		this.bindResizer(resizer, aside);

		aside.append(header, searchWrap, views, list, statusBar, resizer);
		this.selection = new SidebarSelection(
			this.doc, this.store, headerActions, aside, list,
			() => this.renderList(),
			(ids) => void this.actions.closeTabs(ids, { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh),
		);
		bindSidebarKeyboardNavigation(aside, list, search, () => { search.value = ''; this.renderList(); });
		deckParent.insertBefore(aside, deck);
		if (this.ownsHoverCard) this.hoverCard.mount();

		this.sidebar = aside;
		this.listEl = list;
		this.statusEl = statusBar;
		this.searchInput = search;
	}

	private bindResizer(resizer: HTMLElement, aside: HTMLElement): void {
		resizer.onmousedown = (e: Event) => {
			const me = e as MouseEvent;
			if (me.button !== 0 || aside.classList.contains('collapsed')) return;
			me.preventDefault();
			this.stopResize?.();
			resizer.classList.add('active');
			const startX = me.clientX;
			const startWidth = aside.getBoundingClientRect().width;
			const onMove = (ev: MouseEvent) => aside.style.setProperty('--ztf-sb-width', `${Math.min(440, Math.max(200, Math.round(startWidth + ev.clientX - startX)))}px`);
			const cleanup = () => {
				resizer.classList.remove('active');
				this.win.removeEventListener('mousemove', onMove, true);
				this.win.removeEventListener('mouseup', onUp, true);
				this.stopResize = null;
			};
			const onUp = () => { cleanup(); setPref('verticalSidebarWidth', Math.round(aside.getBoundingClientRect().width)); };
			this.stopResize = cleanup;
			this.win.addEventListener('mousemove', onMove, true);
			this.win.addEventListener('mouseup', onUp, true);
		};
	}

	render(tracked?: readonly TrackedTab[]): void {
		this.mount();
		if (!this.sidebar) return;
		const enabled = getPref('enableVerticalSidebar');
		const collapsed = getPref('verticalSidebarCollapsed');
		if (!enabled || collapsed) {
			for (const group of this.groupSections.values()) group.pause();
			this.sidebar.hidden = true;
			this.sidebar.classList.toggle('collapsed', collapsed);
			return;
		}
		this.sidebar.hidden = false;
		this.sidebar.classList.remove('collapsed');

		const sbW = getPref('verticalSidebarWidth'), rowH = getPref('verticalTabRowHeight'), fontSz = getPref('verticalTabFontSize');
		const styleSig = `${sbW}|${rowH}|${fontSz}`;
		if (this.lastStyleSig !== styleSig) {
			this.lastStyleSig = styleSig;
			this.sidebar.style.setProperty('--ztf-sb-width', `${sbW}px`);
			this.sidebar.style.setProperty('--ztf-row-height', `${rowH}px`);
			this.sidebar.style.setProperty('--ztf-font-size', `${fontSz}px`);
		}
		this.renderList(tracked);
	}

	private renderList(snapshot?: readonly TrackedTab[]): void {
		if (!this.listEl) return;
		this.hoverCard.hide();
		const focusAnchor = captureSidebarFocusAnchor(this.doc, this.sidebar);
		const q = (this.searchInput?.value || '').trim().toLowerCase();
		const selectedID = this.meta.getSelectedTabID();
		const tracked = snapshot ?? this.meta.buildTrackedTabs();
		const groups = this.store.visibleGroups();
		const visibleGroupIds = new Set(groups.map((group) => group.id));
		const visibleTabs = tracked.filter((tab) => visibleGroupIds.has(tab.groupId));
		this.selection?.beginRender(visibleTabs);
		if (this.statusEl) {
			renderSidebarStatusBar(this.doc, this.statusEl, computeWorkspaceStatusCounts(tracked, this.store), () => {
				this.actions.sleepInactiveTabs();
				this.onRefresh();
			});
		}
		const allTracked = visibleTabs.filter((t) => !q || `${t.title} ${t.shortTitle} ${t.filename} ${t.collection} ${this.store.getRemark(t.key).note}`.toLowerCase().includes(q));
		const openKeys = new Set(tracked.map((tab) => tab.key));
		const virtualList = getPref('enableVirtualMembers')
			? Object.values(this.store.state.virtualMembers).filter((m) => !openKeys.has(m.key) && visibleGroupIds.has(this.store.groupOfKey(m.key)))
			: [];
		const matchingVirtuals = virtualList.filter((m) => !q || `${m.title} ${m.shortTitle} ${m.collection}`.toLowerCase().includes(q));
		if (this.viewMode === 'groups') {
			if (!this.groupSections.size) this.listEl.replaceChildren();
			const tabsByGroup = indexGroupMembers(allTracked, (tab) => tab.groupId);
			const virtualsByGroup = indexGroupMembers(matchingVirtuals, (member) => this.store.groupOfKey(member.key));
			const collapsedIds = new Set(this.store.state.collapsed);
			const showUngrouped = getPref('newTabMode') === 'collection' && !this.store.state.ungroupedHeadingHidden;
			const renderedGroups = groups.filter((g) => {
				const hasOpenMembers = tabsByGroup.has(g.id);
				const hasVirtualMembers = virtualsByGroup.has(g.id);
				const hasCustomHeading = showUngrouped && Boolean(this.store.state.ungroupedName);
				return shouldRenderGroupHeading(g.id, hasOpenMembers, hasVirtualMembers, hasCustomHeading);
			});
			for (const g of renderedGroups) {
				const members = tabsByGroup.get(g.id) ?? [];
				const virtuals = virtualsByGroup.get(g.id) ?? [];
				const showHeading = Boolean(g.id) || showUngrouped;
				const collapsed = showHeading && collapsedIds.has(g.id);
				const section = this.getGroupSection(g.id);
				section.element.style.setProperty('--ztf-group-dot', g.color);
				section.update(g, collapsed, members.length + virtuals.length, showHeading);
				section.heading.oncontextmenu = (e: Event) => this.menus.openGroupMenu(e as MouseEvent, g);
				if (!collapsed) {
					const body = this.doc.createDocumentFragment();
					for (const t of members) body.append(buildSidebarTabRow(this.rowDeps(), t, selectedID));
					for (const v of virtuals) body.append(buildSidebarVirtualRow(this.rowDeps(), v, g.id));
					section.body.replaceChildren(body);
				}
			}
			reconcileGroupSections(this.listEl, this.groupSections, renderedGroups.map((g) => g.id));
		} else {
			this.clearGroupSections();
			this.listEl.replaceChildren();
			if (this.viewMode === 'collection') {
				const colors = ['#3977d5', '#21866a', '#8b5ac7', '#dc8225'];
				const openCols = indexGroupMembers(allTracked, (tab) => tab.collection);
				const virtCols = indexGroupMembers(matchingVirtuals, (m) => m.collection);
				[...new Set([...openCols.keys(), ...virtCols.keys()])].forEach((col, i) => {
					const items = openCols.get(col) ?? [];
					const vItems = virtCols.get(col) ?? [];
					const sec = buildSidebarSection(this.doc, this.collapsedSections, `col:${col}`, col, colors[i % colors.length], items.length + vItems.length, () => {
						const g = this.store.ensureGroup(col);
						this.store.assignKeys([...items, ...vItems].map((x) => x.key), g.id);
						this.viewMode = 'groups';
						this.onRefresh();
					});
					const body = sec.querySelector('.ztf-sb-group-body')!;
					for (const item of items) body.append(buildSidebarTabRow(this.rowDeps(), item, selectedID));
					for (const v of vItems) body.append(buildSidebarVirtualRow(this.rowDeps(), v, this.store.groupOfKey(v.key)));
					this.listEl!.append(sec);
				});
			} else if (allTracked.length || matchingVirtuals.length) {
				const deps = this.rowDeps();
				for (const [id, label, color, items, vItems] of [
					['status:active', t('zotero-tabflow-sidebar-status-active', '已加载阅读器'), '#16a34a', allTracked.filter((x) => x.status === 'active'), []],
					['status:sleeping', t('zotero-tabflow-sidebar-status-sleeping', '已休眠省内存'), '#d97706', allTracked.filter((x) => x.status === 'sleeping'), []],
					['status:virtual', t('zotero-tabflow-sidebar-status-virtual', '虚拟保留成员'), '#64748b', [], matchingVirtuals],
				] as const) {
					const sec = buildSidebarSection(this.doc, this.collapsedSections, id, label, color, items.length + vItems.length);
					const body = sec.querySelector('.ztf-sb-group-body')!;
					for (const item of items) body.append(buildSidebarTabRow(deps, item, selectedID));
					for (const v of vItems) body.append(buildSidebarVirtualRow(deps, v, this.store.groupOfKey(v.key)));
					this.listEl.append(sec);
				}
			}
		}

		const noMatches = Boolean(q) && !allTracked.length && !matchingVirtuals.length;
		const noNonGroupRows = this.viewMode !== 'groups' && !allTracked.length && !matchingVirtuals.length;
		const brandNewEmpty = !q && this.viewMode === 'groups' && !allTracked.length && !virtualList.length && !groups.some((g) => Boolean(g.id));
		if (noMatches || noNonGroupRows || brandNewEmpty) {
			this.clearGroupSections();
			this.listEl.replaceChildren();
			renderSidebarEmptyState(
				this.doc, this.listEl, Boolean(q),
				Boolean(this.store.state.sessions.length || this.store.state.rollingSessions?.length),
				() => { if (this.searchInput) { this.searchInput.value = ''; this.renderList(); } },
				() => this.onRestoreLastSession?.(),
				() => { const lib = (this.win as any).Zotero_Tabs?._tabs?.find((x: { type: string }) => x.type === 'library'); if (lib) (this.win as any).Zotero_Tabs?.select?.(lib.id); },
			);
		}
		this.selection?.updateControls();
		restoreSidebarFocusAnchor(this.listEl, focusAnchor);
	}

	private rowDeps(): SidebarRowDeps {
		return {
			doc: this.doc, store: this.store, meta: this.meta, actions: this.actions, menus: this.menus,
			hoverCard: this.hoverCard, selection: this.selection, onRefresh: this.onRefresh,
			getDraggedKey: () => this.draggedKey, setDraggedKey: (key) => { this.draggedKey = key; },
			getDraggedTabId: () => this.draggedTabId, setDraggedTabId: (id) => { this.draggedTabId = id; },
		};
	}

	private getGroupSection(id: string): GroupSection {
		const cached = this.groupSections.get(id);
		if (cached) return cached;
		const section = new GroupSection(
			this.win,
			this.doc,
			{ section: 'ztf-sb-group', heading: 'ztf-sb-group-head', body: 'ztf-sb-group-body' },
			(closed) => this.store.setCollapsed(id, closed),
			(name) => this.store.renameGroup(id, name),
		);
		section.heading.dataset.ztfNav = 'head';
		section.heading.dataset.ztfNavId = id;
		section.heading.prepend(this.h('span', 'ztf-sb-dot'));
		section.heading.ondragover = (e: Event) => {
			const dt = (e as DragEvent).dataTransfer;
			if (this.draggedKey || hasTabFlowDraggedTab(dt) || hasZoteroDraggedItems(dt)) e.preventDefault();
		};
		section.heading.ondrop = (e: Event) => {
			e.preventDefault();
			const dt = (e as DragEvent).dataTransfer;
			const dropped = this.draggedKey || dt?.getData(TABFLOW_DRAG_MIME) || '';
			if (dropped) {
				this.store.assignKey(dropped, id);
				this.draggedKey = null; this.draggedTabId = null; this.onRefresh();
				return;
			}
			const extIds = parseZoteroDraggedItemIDs(dt);
			if (extIds.length) void Promise.all(extIds.map((itemID) => this.actions.openVirtualOrItem(itemID, id))).then(this.onRefresh);
		};
		this.groupSections.set(id, section);
		return section;
	}

	private clearGroupSections(): void { for (const section of this.groupSections.values()) section.dispose(); this.groupSections.clear(); }

	dispose(): void {
		if (this.searchTimer !== null) { this.win.clearTimeout(this.searchTimer); this.searchTimer = null; }
		this.stopResize?.(); this.lastStyleSig = ''; this.clearGroupSections();
		if (this.ownsHoverCard) this.hoverCard.dispose();
		this.sidebar?.remove();
		this.sidebar = null; this.listEl = null; this.statusEl = null; this.selection = null; this.searchInput = null;
	}
}
