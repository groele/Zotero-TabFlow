import { contrastInk } from '../core/color-utils.ts';
import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';
import type { ActivityTrackerService } from '../services/activity-tracker.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { HorizontalDragController } from './horizontal-drag.ts';
import { createSvgIcon } from './icons.ts';
import type { PopoverController } from './popovers.ts';
import type { SpotlightController } from './spotlight.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';

export class HorizontalBarController {
	private root: HTMLDivElement | null = null;
	private pinnedStrip: HTMLDivElement | null = null;
	private toolbarActions: HTMLDivElement | null = null;
	private drag: HorizontalDragController;
	private lastSelectedID = '';
	private headingClickTimer: number | null = null;

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
	) {
		this.drag = new HorizontalDragController(win, store, onRefresh);
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
			e.stopPropagation();
			if (e.ctrlKey || area.scrollWidth <= area.clientWidth) return;
			e.preventDefault();
			const scale = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? area.clientWidth : 1;
			const direction = !e.deltaX && this.win.getComputedStyle(area)?.direction === 'rtl' ? -1 : 1;
			area.scrollLeft += (e.deltaX || e.deltaY) * scale * direction;
		}, { passive: false });
	}

	render(): void {
		const host = this.doc.getElementById('tab-bar-container');
		if (!host) return;
		this.mount();
		const enabled = getPref('enableHorizontalGroups');
		const mounted = enabled && Boolean(this.root?.isConnected);
		host.toggleAttribute('data-ztf-inline', mounted);
		if (this.root) this.root.hidden = !mounted;
		if (!mounted && this.pinnedStrip) this.pinnedStrip.hidden = true;
		this.renderToolbarButtons();
		if (!mounted || !this.root || this.root.querySelector('.ztf-inline-edit')) return;

		const tracked = this.meta.buildTrackedTabs();
		const selectedID = this.meta.getSelectedTabID();
		const scroll = this.root.scrollLeft;
		this.root.textContent = '';

		const pinnedTabs = getPref('enablePinnedTabs') ? tracked.filter((t) => t.pinned) : [];
		if (this.pinnedStrip) {
			const strip = this.pinnedStrip;
			const pinnedScroll = strip.scrollLeft;
			strip.replaceChildren();
			strip.hidden = pinnedTabs.length === 0;
			for (const t of pinnedTabs) {
				const chip = this.h('button', `ztf-pinned-chip${t.tab.id === selectedID ? ' selected' : ''}`);
				chip.type = 'button';
				const labelSpan = this.h('span');
				labelSpan.textContent = this.meta.getDisplayTitle(t);
				chip.append(createSvgIcon(this.doc, 'pin', 12), labelSpan);
				chip.title = t.title;
				chip.onclick = () => this.actions.selectTab(t.tab.id);
				chip.oncontextmenu = (e: Event) => this.menus.openTabMenu(e as MouseEvent, t);
				strip.append(chip);
			}
			strip.scrollLeft = pinnedScroll;
		}

		const unpinned = tracked.filter((t) => !t.pinned);
		for (const g of this.store.orderedGroups()) {
			const section = this.h('div', 'ztf-section');
			section.style.setProperty('--ztf-color', g.color);
			section.style.setProperty('--ztf-ink', contrastInk(g.color));
			const collapsed = this.store.state.collapsed.includes(g.id);
			const members = unpinned.filter((t) => t.groupId === g.id);
			const virtuals = getPref('enableVirtualMembers')
				? Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === g.id)
				: [];

			const heading = this.h('button', `ztf-heading${!g.id ? ' ztf-ungrouped' : ''}`);
			heading.type = 'button';
			heading.textContent = `${collapsed ? '▸' : '▾'} ${g.name} (${members.length + virtuals.length})`;
			heading.title = heading.textContent;
			heading.setAttribute('aria-expanded', String(!collapsed));
			heading.onmousedown = (e: Event) => e.stopPropagation();
			heading.onclick = (e: Event) => {
				e.stopPropagation();
				if (this.headingClickTimer !== null) this.win.clearTimeout(this.headingClickTimer);
				this.headingClickTimer = this.win.setTimeout(() => {
					this.headingClickTimer = null;
					this.store.setCollapsed(g.id, !collapsed);
				}, 210);
			};
			heading.ondblclick = (e: Event) => {
				e.stopPropagation();
				if (this.headingClickTimer !== null) {
					this.win.clearTimeout(this.headingClickTimer);
					this.headingClickTimer = null;
				}
				this.beginInlineEdit(heading, g.name, (next) => this.store.renameGroup(g.id, next));
			};
			heading.oncontextmenu = (e: Event) => this.menus.openGroupMenu(e as MouseEvent, g);
			this.drag.bindGroupDrag(heading, g.id, collapsed);
			section.append(heading);

			if (!collapsed) {
				for (const t of members) section.append(this.buildTabNode(t, selectedID));
				for (const v of virtuals) {
					const vNode = this.h('button', 'ztf-doc ztf-virtual');
					vNode.type = 'button';
					const label = this.h('span', 'ztf-doc-title');
					label.textContent = `◌ ${this.meta.getDisplayTitle(v)}`;
					vNode.append(label);
					vNode.title = `虚拟保留成员（点击重新加载）：${v.title}`;
					vNode.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id).then(this.onRefresh);
					vNode.oncontextmenu = (e: Event) => this.menus.openVirtualMenu(e as MouseEvent, v, g.id);
					section.append(vNode);
				}
			}
			this.root.append(section);
		}

		const addBtn = this.h('button', 'ztf-add-group');
		addBtn.type = 'button';
		addBtn.append(createSvgIcon(this.doc, 'plus', 13));
		addBtn.title = '新建分组';
		addBtn.onclick = () => {
			this.beginInlineEdit(addBtn, '', (next) => this.store.ensureGroup(next), '新分组名称…');
		};
		this.root.append(addBtn);
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

	private buildTabNode(t: TrackedTab, selectedID: string): HTMLElement {
		const node = this.h('div', `ztf-doc${t.tab.id === selectedID ? ' selected' : ''}${t.status === 'sleeping' ? ' ztf-sleeping' : ''}`);
		node.title = `${t.title}\n集合：${t.collection}`;
		const label = this.h('span', 'ztf-doc-title');
		label.textContent = `${t.status === 'sleeping' ? '💤 ' : ''}${this.meta.getDisplayTitle(t)}`;
		const closeBtn = this.h('button', 'ztf-doc-close');
		closeBtn.type = 'button';
		closeBtn.setAttribute('aria-label', `关闭标签：${t.title}`);
		closeBtn.append(createSvgIcon(this.doc, 'close', 11));
		closeBtn.onclick = (e) => {
			e.stopPropagation();
			void this.actions.closeTab(t.tab.id, true).then(this.onRefresh);
		};
		node.append(label, closeBtn);
		node.onclick = () => this.actions.selectTab(t.tab.id);
		node.onauxclick = (e: Event) => {
			if ((e as MouseEvent).button === 1) {
				e.preventDefault();
				void this.actions.closeTab(t.tab.id, true).then(this.onRefresh);
			}
		};
		node.oncontextmenu = (e: Event) => this.menus.openTabMenu(e as MouseEvent, t);
		this.drag.bindTabDrag(node, t);
		return node;
	}

	private renderToolbarButtons(): void {
		if (!this.toolbarActions) return;
		this.toolbarActions.textContent = '';
		if (getPref('enableVerticalSidebar')) {
			const open = !getPref('verticalSidebarCollapsed');
			const btn = this.h('button', `ztf-tb-btn${open ? ' active' : ''}`);
			btn.type = 'button';
			btn.append(createSvgIcon(this.doc, 'sidebar', 13));
			btn.title = open ? '收起垂直标签侧边栏' : '展开垂直标签侧边栏';
			btn.onclick = () => {
				setPref('verticalSidebarCollapsed', open);
				this.onRefresh();
			};
			this.toolbarActions.append(btn);
		}
		if (getPref('enableSpotlight')) {
			const btn = this.h('button', 'ztf-tb-btn');
			btn.type = 'button';
			btn.append(createSvgIcon(this.doc, 'search', 12), this.doc.createTextNode('Spotlight'));
			btn.title = '快速搜索与命令 (Ctrl+P)';
			btn.onclick = () => this.spotlight.open(btn);
			this.toolbarActions.append(btn);
		}
		if (getPref('enableSessions')) {
			const btn = this.h('button', 'ztf-tb-btn');
			btn.type = 'button';
			btn.append(createSvgIcon(this.doc, 'layers', 12), this.doc.createTextNode(`会话 (${this.store.state.sessions.length})`));
			btn.onclick = () => this.popovers.openSessionsMenu(btn);
			this.toolbarActions.append(btn);
		}
		if (getPref('enableStaleSuggestions')) {
			const count = this.tracker.getStaleTabs().length;
			const btn = this.h('button', `ztf-tb-btn${count ? ' warn' : ''}`);
			btn.type = 'button';
			btn.append(createSvgIcon(this.doc, 'clock', 12), this.doc.createTextNode(`建议关闭 (${count})`));
			btn.onclick = () => this.popovers.openStaleMenu(btn);
			this.toolbarActions.append(btn);
		}
	}

	dispose(): void {
		if (this.headingClickTimer !== null) {
			this.win.clearTimeout(this.headingClickTimer);
			this.headingClickTimer = null;
		}
		this.drag.clear();
		this.doc.getElementById('tab-bar-container')?.removeAttribute('data-ztf-inline');
		this.root?.remove();
		this.pinnedStrip?.remove();
		this.toolbarActions?.remove();
		this.root = null;
		this.pinnedStrip = null;
		this.toolbarActions = null;
	}
}
