import { t } from '../core/i18n.ts';
import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';
import type { ActivityTrackerService } from '../services/activity-tracker.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { HorizontalDragController } from './horizontal-drag.ts';
import { GroupSection, reconcileGroupSections } from './group-section.ts';
import { indexGroupMembers, shouldCollapseHorizontalChip, shouldRenderGroupHeading } from './group-visibility.ts';
import { createSvgIcon } from './icons.ts';
import { renderPinnedStrip } from './pinned-strip.ts';
import type { PopoverController } from './popovers.ts';
import type { SidebarHoverCard } from './sidebar-hover.ts';
import type { SpotlightController } from './spotlight.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';
import { ToolbarActions, type ToolbarAction } from './toolbar-actions.ts';
import { computeWorkspaceHubCounts } from './workspace-hub.ts';

export class HorizontalBarController {
	private root: HTMLDivElement | null = null;
	private pinnedStrip: HTMLDivElement | null = null;
	private toolbarActions: HTMLDivElement | null = null;
	private readonly toolbar = new ToolbarActions();
	private drag: HorizontalDragController;
	private lastSelectedID = '';
	private groupSections = new Map<string, GroupSection>();
	private addGroupButton: HTMLButtonElement | null = null;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly tracker: ActivityTrackerService,
		private readonly menus: TabContextMenuController,
		private readonly popovers: PopoverController,
		private readonly spotlight: SpotlightController,
		private readonly onRefresh: () => void,
		private readonly hoverCard?: SidebarHoverCard,
	) {
		this.drag = new HorizontalDragController(
			win,
			store,
			onRefresh,
			(draggedTabId, targetTabId, after) => this.actions.moveTabRelative(draggedTabId, targetTabId, after),
			(itemIDs, groupId) => {
				void (async () => {
					for (const id of itemIDs) await this.actions.openVirtualOrItem(id, groupId);
					this.onRefresh();
				})();
			},
		);
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	mount(): void {
		const host = this.doc.getElementById('tab-bar-container');
		const inner = host?.querySelector('.tab-bar-inner-container');
		if (!host || !inner) return;

		if (!this.root) {
			const root = this.h('div');
			root.id = 'ztf-inline';
			root.setAttribute('role', 'group');
			root.setAttribute('aria-label', 'TabFlow');
			this.bindWheel(root);
			this.root = root;
		}
		if (this.root.parentElement !== inner) inner.insertBefore(this.root, inner.querySelector('.tabs-wrapper'));
		if (!this.pinnedStrip) {
			this.pinnedStrip = this.h('div', 'ztf-pinned-strip');
			this.pinnedStrip.hidden = true;
			this.pinnedStrip.setAttribute('role', 'group');
			this.pinnedStrip.setAttribute('data-l10n-id', 'zotero-tabflow-pinned-strip');
			this.bindWheel(this.pinnedStrip);
		}
		if (this.pinnedStrip.parentElement !== inner) inner.insertBefore(this.pinnedStrip, this.root);

		if (!this.toolbarActions) {
			const bar = this.h('div');
			bar.id = 'ztf-toolbar-actions';
			this.toolbarActions = bar;
		}
		const nativeToolbar = this.doc.getElementById('zotero-tabs-toolbar') || inner;
		if (this.toolbarActions.parentElement !== nativeToolbar) nativeToolbar.append(this.toolbarActions);
	}

	private bindWheel(area: HTMLDivElement): void {
		area.addEventListener('wheel', (e: WheelEvent) => {
			this.hoverCard?.hide();
			e.stopPropagation();
			if (e.ctrlKey || area.scrollWidth <= area.clientWidth) return;
			e.preventDefault();
			const scale = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? area.clientWidth : 1;
			const direction = !e.deltaX && this.win.getComputedStyle(area)?.direction === 'rtl' ? -1 : 1;
			area.scrollLeft += (e.deltaX || e.deltaY) * scale * direction;
		}, { passive: false });
	}

	render(snapshot?: readonly TrackedTab[]): void {
		const host = this.doc.getElementById('tab-bar-container');
		if (!host) return;
		this.mount();
		const sidebarHealthy = getPref('enableVerticalSidebar') && !getPref('verticalSidebarCollapsed') && Boolean(this.doc.getElementById('ztf-sidebar')?.isConnected);
		const compactMode = getPref('enableHorizontalGroups') && getPref('compactTopBar') && sidebarHealthy;
		const enabled = getPref('enableHorizontalGroups') && !compactMode;
		const mounted = enabled && Boolean(this.root?.isConnected);
		host.toggleAttribute('data-ztf-inline', mounted || compactMode);
		if (!mounted) {
			if (this.pinnedStrip) this.pinnedStrip.hidden = true;
			for (const group of this.groupSections.values()) group.pause();
		}
		if (this.root) this.root.hidden = !mounted;
		const trackedTabs = snapshot ?? (mounted || getPref('enableStaleSuggestions') ? this.meta.buildTrackedTabs() : []);
		this.renderToolbarButtons(compactMode, sidebarHealthy, trackedTabs);
		if (!mounted || !this.root || this.root.querySelector('.ztf-inline-edit')) return;

		const rawGroups = this.store.visibleGroups();
		const visibleGroupIds = new Set(rawGroups.map((group) => group.id));
		const tracked = trackedTabs.filter((tab) => visibleGroupIds.has(tab.groupId));
		const selectedID = this.meta.getSelectedTabID();
		const scroll = this.root.scrollLeft;

		const pinnedTabs = getPref('enablePinnedTabs') ? tracked.filter((t) => t.pinned) : [];
		if (this.pinnedStrip) {
			const strip = this.pinnedStrip;
			const pinnedScroll = strip.scrollLeft;
			renderPinnedStrip(this.doc, strip, pinnedTabs, selectedID, this.store, this.meta, this.actions, this.menus);
			strip.scrollLeft = pinnedScroll;
		}

		const unpinned = indexGroupMembers(tracked.filter((t) => !t.pinned), (tab) => tab.groupId);
		const openKeys = new Set(trackedTabs.map((tab) => tab.key));
		const virtualMembers = getPref('enableVirtualMembers')
			? Object.values(this.store.state.virtualMembers).filter((member) => !openKeys.has(member.key))
			: [];
		const virtualsByGroup = indexGroupMembers(virtualMembers, (member) => this.store.groupOfKey(member.key));
		const collapsedIds = new Set(this.store.state.collapsed);
		const compactPref = getPref('horizontalTabCompactMode');
		const totalInlineChips = tracked.filter((t) => !t.pinned).length + virtualMembers.filter((m) => visibleGroupIds.has(this.store.groupOfKey(m.key))).length;
		const groups = rawGroups.filter((g) => {
			const hasMembers = unpinned.has(g.id);
			const hasVirtuals = virtualsByGroup.has(g.id);
			const hasCustomHeading = !this.store.state.ungroupedHeadingHidden && Boolean(this.store.state.ungroupedName);
			return shouldRenderGroupHeading(g.id, hasMembers, hasVirtuals, hasCustomHeading);
		});
		for (const g of groups) {
			let section = this.groupSections.get(g.id);
			if (!section) {
				section = new GroupSection(this.win, this.doc, {
					section: 'ztf-section',
					heading: 'ztf-heading',
					body: 'ztf-section-body',
				}, (closed) => this.store.setCollapsed(g.id, closed),
				(name) => this.store.renameGroup(g.id, name));
				section.heading.onmousedown = (event) => event.stopPropagation();
				this.groupSections.set(g.id, section);
			}
			section.element.style.setProperty('--ztf-color', g.color);
			const showHeading = Boolean(g.id) || !this.store.state.ungroupedHeadingHidden;
			const collapsed = showHeading && collapsedIds.has(g.id);
			const members = unpinned.get(g.id) ?? [];
			const virtuals = virtualsByGroup.get(g.id) ?? [];

			section.update(g, collapsed, members.length + virtuals.length, showHeading);
			section.heading.oncontextmenu = (e: Event) => this.menus.openGroupMenu(e as MouseEvent, g);
			this.drag.bindGroupDrag(section.heading, g.id, collapsed);

			if (!collapsed) {
				const nodes = this.doc.createDocumentFragment();
				for (const t of members) nodes.append(this.buildTabNode(t, selectedID, shouldCollapseHorizontalChip(compactPref, totalInlineChips, t.tab.id === selectedID)));
				const collapseVirtual = shouldCollapseHorizontalChip(compactPref, totalInlineChips, false);
				for (const v of virtuals) {
					const vNode = this.h('button', `ztf-doc ztf-virtual${collapseVirtual ? ' ztf-chip-collapsed' : ''}`);
					vNode.type = 'button';
					const label = this.h('span', 'ztf-doc-title');
					label.textContent = collapseVirtual ? '···' : `◌ ${this.meta.getDisplayTitle(v)}`;
					vNode.append(label);
					vNode.setAttribute('aria-label', v.title);
					vNode.title = t('zotero-tabflow-virtual-reload-tip', `虚拟保留成员（点击重新加载）：${v.title}`, { title: v.title });
					vNode.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id, false, v.key).then((opened) => {
						if (!opened) Services.prompt.alert(this.win, v.title, t('zotero-tabflow-spot-hidden-open-failed', '未能打开这篇文献。请检查附件文件是否可用。'));
						this.onRefresh();
					});
					vNode.oncontextmenu = (e: Event) => this.menus.openVirtualMenu(e as MouseEvent, v, g.id);
					vNode.onmouseenter = () => this.hoverCard?.scheduleShow(() => this.hoverCard?.showVirtual(vNode, v, g.name, 'below'));
					vNode.onmouseleave = () => this.hoverCard?.hide();
					vNode.onmousedown = () => this.hoverCard?.hide();
					nodes.append(vNode);
				}
				section.body.replaceChildren(nodes);
			}
		}

		if (!this.addGroupButton) {
			const addBtn = this.h('button', 'ztf-add-group');
			addBtn.type = 'button';
			addBtn.append(createSvgIcon(this.doc, 'plus', 13));
			addBtn.title = t('zotero-tabflow-new-group-title', '新建分组');
			addBtn.onclick = () => this.beginInlineEdit(addBtn, '', (next) => this.store.ensureGroup(next), t('zotero-tabflow-new-group-placeholder', '新分组名称…'));
			this.root.append(addBtn);
			this.addGroupButton = addBtn;
		}
		reconcileGroupSections(this.root, this.groupSections, groups.map((g) => g.id), this.addGroupButton);
		this.root.scrollLeft = scroll;
		if (selectedID && selectedID !== this.lastSelectedID) {
			this.lastSelectedID = selectedID;
			this.root.querySelector('.ztf-doc.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
	}

	private beginInlineEdit(anchor: HTMLElement, initial: string, onCommit: (name: string) => void, placeholder = ''): void {
		const input = this.h('input', 'ztf-inline-edit');
		input.type = 'text';
		input.value = initial;
		if (placeholder) input.placeholder = placeholder;
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			input.replaceWith(anchor);
			const clean = input.value.trim();
			if (save && clean) onCommit(clean);
			this.onRefresh();
		};
		input.onmousedown = (e: Event) => e.stopPropagation();
		input.onclick = (e: Event) => e.stopPropagation();
		input.onkeydown = (e: Event) => {
			const ke = e as KeyboardEvent;
			if (ke.isComposing) return;
			ke.stopPropagation();
			if (ke.key === 'Enter') { ke.preventDefault(); finish(true); }
			else if (ke.key === 'Escape') { ke.preventDefault(); finish(false); }
		};
		input.onblur = () => finish(true);
		anchor.replaceWith(input);
		input.focus();
		input.select();
	}

	private buildTabNode(tab: TrackedTab, selectedID: string, compactChip = false): HTMLElement {
		const selected = tab.tab.id === selectedID;
		const node = this.h('div', `ztf-doc${selected ? ' selected' : ''}${tab.status === 'sleeping' ? ' ztf-sleeping' : ''}${compactChip ? ' ztf-chip-collapsed' : ''}`);
		const remark = getPref('enableTabRemarks') ? this.store.getRemark(tab.key).note : '';
		node.title = `${remark ? `[${remark}] ` : ''}${tab.title}\n${t('zotero-tabflow-collection-label', '集合')}：${tab.collection}`;
		node.setAttribute('aria-label', tab.title);
		const label = this.h('span', 'ztf-doc-title');
		label.textContent = compactChip ? '···' : `${tab.status === 'sleeping' ? '💤 ' : ''}${this.meta.getDisplayTitle(tab)}`;
		const closeBtn = this.h('button', 'ztf-doc-close');
		closeBtn.type = 'button';
		closeBtn.setAttribute('aria-label', t('zotero-tabflow-close-tab-aria', `关闭标签：${tab.title}`, { title: tab.title }));
		closeBtn.append(createSvgIcon(this.doc, 'close', 11));
		closeBtn.onclick = (e) => {
			e.stopPropagation();
			void this.actions.closeTab(tab.tab.id, true).then(this.onRefresh);
		};
		node.append(label, closeBtn);
		node.onclick = () => { this.hoverCard?.hide(); this.actions.selectTab(tab.tab.id); };
		node.onmouseenter = () => this.hoverCard?.scheduleShow(() => this.hoverCard?.show(node, tab, 'below'));
		node.onmouseleave = () => this.hoverCard?.hide();
		node.onmousedown = () => this.hoverCard?.hide();
		node.onauxclick = (e: Event) => {
			if ((e as MouseEvent).button === 1) {
				e.preventDefault();
				void this.actions.closeTab(tab.tab.id, true).then(this.onRefresh);
			}
		};
		node.oncontextmenu = (e: Event) => this.menus.openTabMenu(e as MouseEvent, tab);
		this.drag.bindTabDrag(node, tab);
		return node;
	}

	private renderToolbarButtons(compactMode: boolean, sidebarHealthy: boolean, tracked: readonly TrackedTab[]): void {
		if (!this.toolbarActions) return;
		const actions: ToolbarAction[] = [];
		if (compactMode || (getPref('enableHorizontalGroups') && sidebarHealthy)) {
			actions.push({
				id: 'compact', icon: 'topbar', iconOnly: true, pressed: compactMode,
				label: t('zotero-tabflow-compact-topbar', '精简顶栏'),
				title: compactMode
					? t('zotero-tabflow-expand-topbar-tip', '恢复水平分组标签栏')
					: t('zotero-tabflow-compact-topbar-tip', '收起水平文献标签以节省顶部空间（保留文库与侧栏）'),
				run: () => { setPref('compactTopBar', !compactMode); this.onRefresh(); },
			});
		}
		if (getPref('enableVerticalSidebar')) {
			const open = !getPref('verticalSidebarCollapsed');
			actions.push({
				id: 'sidebar', icon: 'sidebar', iconOnly: true, pressed: open,
				label: t('zotero-tabflow-toolbar-sidebar', '标签侧栏'),
				title: open ? t('zotero-tabflow-sidebar-toggle-close', '收起垂直标签侧边栏') : t('zotero-tabflow-sidebar-toggle-open', '展开垂直标签侧边栏'),
				run: () => { setPref('verticalSidebarCollapsed', open); this.onRefresh(); },
			});
		}
		if (getPref('enableSpotlight')) {
			const shortcut = Zotero.isMac ? '⌘P' : 'Ctrl+P';
			actions.push({
				id: 'spotlight', icon: 'search', label: t('zotero-tabflow-toolbar-spotlight', '快速查找'),
				title: t('zotero-tabflow-toolbar-spotlight-tip', `查找标签、文献和操作（${shortcut}）`, { shortcut }),
				run: (button) => this.spotlight.open(button),
			});
		}
		const hubCounts = computeWorkspaceHubCounts(this.store);
		if (getPref('enableSessions') || getPref('enableGroupHiding')) {
			actions.push({
				id: 'workspace', icon: 'workspace', popup: 'dialog', count: hubCounts.hidden,
				label: t('zotero-tabflow-workspace-btn', '工作区'),
				title: t('zotero-tabflow-toolbar-workspace-tip', `隐藏项目 ${hubCounts.hidden}`, { count: hubCounts.hidden }),
				run: (button) => this.popovers.openWorkspaceHub(button),
			});
		}
		const count = this.tracker.getStaleTabs(Date.now(), tracked).length;
		if (count) {
			actions.push({
				id: 'stale', icon: 'clock', popup: 'menu', count, status: 'attention',
				label: t('zotero-tabflow-toolbar-stale', '建议关闭'),
				title: t('zotero-tabflow-stale-btn', `建议关闭 (${count})`, { count }),
				run: (button) => this.popovers.openStaleMenu(button),
			});
		}
		this.toolbar.render(this.toolbarActions, actions);
	}

	dispose(): void {
		this.hoverCard?.hide();
		for (const group of this.groupSections.values()) group.dispose();
		this.groupSections.clear();
		this.drag.clear();
		this.doc.getElementById('tab-bar-container')?.removeAttribute('data-ztf-inline');
		this.root?.remove();
		this.pinnedStrip?.remove();
		this.toolbarActions?.remove();
		this.root = null;
		this.addGroupButton = null;
		this.pinnedStrip = null;
		this.toolbarActions = null;
	}
}
