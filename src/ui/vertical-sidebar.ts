import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { SidebarViewMode, TrackedTab } from '../core/types.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { GroupSection, reconcileGroupSections } from './group-section.ts';
import { createSvgIcon, type IconName } from './icons.ts';
import { SidebarHoverCard } from './sidebar-hover.ts';
import { SidebarSelection } from './sidebar-selection.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';

export class VerticalSidebarController {
	private sidebar: HTMLElement | null = null;
	private listEl: HTMLDivElement | null = null;
	private selection: SidebarSelection | null = null;
	private searchInput: HTMLInputElement | null = null;
	private hoverCard: SidebarHoverCard;
	private viewMode: SidebarViewMode = 'groups';
	private draggedKey: string | null = null;
	private groupSections = new Map<string, GroupSection>();

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly menus: TabContextMenuController,
		private readonly onRefresh: () => void,
	) {
		this.hoverCard = new SidebarHoverCard(win, doc, store);
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

		const headerActions = this.h('div', 'ztf-sb-header-actions');
		const autoBtn = this.h('button', 'ztf-sb-icon-btn ztf-sb-hide-collapsed');
		autoBtn.type = 'button';
		autoBtn.title = '按 Zotero 集合自动归组';
		autoBtn.append(createSvgIcon(this.doc, 'folder', 13));
		autoBtn.onclick = () => { this.actions.autoGroupByCollection(); this.onRefresh(); };

		const sleepBtn = this.h('button', 'ztf-sb-icon-btn ztf-sb-hide-collapsed');
		sleepBtn.type = 'button';
		sleepBtn.title = '休眠后台非固定标签（释放内存）';
		sleepBtn.append(createSvgIcon(this.doc, 'sleep', 13));
		sleepBtn.onclick = () => { this.actions.sleepInactiveTabs(); this.onRefresh(); };

		const collapseBtn = this.h('button', 'ztf-sb-icon-btn');
		collapseBtn.type = 'button';
		collapseBtn.append(createSvgIcon(this.doc, 'sidebar', 14));
		collapseBtn.title = '折叠/展开侧边栏';
		collapseBtn.onclick = () => {
			setPref('verticalSidebarCollapsed', !getPref('verticalSidebarCollapsed'));
			this.render();
		};
		headerActions.append(autoBtn, sleepBtn, collapseBtn);
		header.append(title, headerActions);

		const searchWrap = this.h('div', 'ztf-sb-search-wrap ztf-sb-hide-collapsed');
		const search = this.h('input', 'ztf-sb-search');
		search.type = 'search';
		search.placeholder = '过滤标题、备注、集合…';
		search.oninput = () => this.renderList();
		searchWrap.append(search);

		const views = this.h('div', 'ztf-sb-views ztf-sb-hide-collapsed');
		for (const [mode, label] of [
			['groups', '分组'],
			['collection', '集合'],
			['recent', '状态'],
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
		const resizer = this.h('div', 'ztf-sb-resizer ztf-sb-hide-collapsed');
		this.bindResizer(resizer, aside);

		aside.append(header, searchWrap, views, list, resizer);
		this.selection = new SidebarSelection(this.doc, this.store, headerActions, aside, list, () => this.renderList());
		deckParent.insertBefore(aside, deck);
		this.hoverCard.mount();

		this.sidebar = aside;
		this.listEl = list;
		this.searchInput = search;
	}

	private bindResizer(resizer: HTMLElement, aside: HTMLElement): void {
		resizer.onmousedown = (e: Event) => {
			const me = e as MouseEvent;
			if (me.button !== 0 || aside.classList.contains('collapsed')) return;
			me.preventDefault();
			resizer.classList.add('active');
			const startX = me.clientX;
			const startWidth = aside.getBoundingClientRect().width;
			const onMove = (ev: MouseEvent) => {
				aside.style.setProperty('--ztf-sb-width', `${Math.min(440, Math.max(200, Math.round(startWidth + ev.clientX - startX)))}px`);
			};
			const onUp = () => {
				resizer.classList.remove('active');
				this.win.removeEventListener('mousemove', onMove, true);
				this.win.removeEventListener('mouseup', onUp, true);
				setPref('verticalSidebarWidth', Math.round(aside.getBoundingClientRect().width));
			};
			this.win.addEventListener('mousemove', onMove, true);
			this.win.addEventListener('mouseup', onUp, true);
		};
	}

	render(): void {
		this.mount();
		if (!this.sidebar) return;
		const enabled = getPref('enableVerticalSidebar');
		const collapsed = getPref('verticalSidebarCollapsed');
		if (!enabled || collapsed) {
			for (const group of this.groupSections.values()) group.pause();
		}
		this.sidebar.hidden = !enabled || collapsed;
		this.sidebar.classList.toggle('collapsed', collapsed);
		if (!enabled || collapsed) {
			return;
		}

		this.sidebar.style.setProperty('--ztf-sb-width', `${getPref('verticalSidebarWidth')}px`);
		this.sidebar.style.setProperty('--ztf-row-height', `${getPref('verticalTabRowHeight')}px`);
		this.sidebar.style.setProperty('--ztf-font-size', `${getPref('verticalTabFontSize')}px`);
		this.renderList();
	}

	private renderList(): void {
		if (!this.listEl) return;
		const q = (this.searchInput?.value || '').trim().toLowerCase();
		const selectedID = this.meta.getSelectedTabID();
		const tracked = this.meta.buildTrackedTabs();
		this.selection?.beginRender(tracked);
		const allTracked = tracked.filter((t) => {
			if (!q) return true;
			const r = this.store.getRemark(t.key).note;
			return `${t.title} ${t.shortTitle} ${t.filename} ${t.collection} ${r}`.toLowerCase().includes(q);
		});

		if (this.viewMode === 'groups') {
			if (!this.groupSections.size) this.listEl.replaceChildren();
			const groups = this.store.orderedGroups();
			for (const g of groups) {
				const members = allTracked.filter((t) => t.groupId === g.id);
				const virtuals = getPref('enableVirtualMembers')
					? Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === g.id)
					: [];
				const collapsed = this.store.state.collapsed.includes(g.id);
				const section = this.getGroupSection(g.id);
				section.element.style.setProperty('--ztf-group-dot', g.color);
				section.update(g, collapsed, members.length + virtuals.length);
				section.heading.oncontextmenu = (e: Event) => this.menus.openGroupMenu(e as MouseEvent, g);
				if (!collapsed) {
					const body = this.doc.createDocumentFragment();
					for (const t of members) body.append(this.buildRow(t, selectedID));
					for (const v of virtuals) {
						const row = this.h('div', 'ztf-sb-row virtual');
						const ic = this.h('span', 'ztf-sb-row-icon');
						ic.append(createSvgIcon(this.doc, 'virtual', 13));
						const txt = this.h('div', 'ztf-sb-row-text');
						const ttl = this.h('div', 'ztf-sb-row-title');
						ttl.textContent = this.meta.getDisplayTitle(v);
						txt.append(ttl);
						row.append(ic, txt);
						row.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id).then(this.onRefresh);
						row.oncontextmenu = (e: Event) => this.menus.openVirtualMenu(e as MouseEvent, v, g.id);
						body.append(row);
					}
					section.body.replaceChildren(body);
				}
			}
			reconcileGroupSections(this.listEl, this.groupSections, groups.map((g) => g.id));
			this.selection?.updateControls();
			return;
		}

		this.clearGroupSections();
		this.listEl.replaceChildren();
		if (this.viewMode === 'collection') {
			const cols = [...new Set(allTracked.map((t) => t.collection))];
			cols.forEach((col, i) => {
				const items = allTracked.filter((t) => t.collection === col);
				const colors = ['#3977d5', '#21866a', '#8b5ac7', '#dc8225'];
				const sec = this.buildSection(col, colors[i % colors.length], items.length);
				const body = sec.querySelector('.ztf-sb-group-body')!;
				for (const t of items) body.append(this.buildRow(t, selectedID));
				this.listEl!.append(sec);
			});
			this.selection?.updateControls();
			return;
		}

		for (const [label, color, items] of [
			['已加载阅读器', '#16a34a', allTracked.filter((t) => t.status === 'active')],
			['已休眠省内存', '#d97706', allTracked.filter((t) => t.status === 'sleeping')],
		] as const) {
			const sec = this.buildSection(label, color, items.length);
			const body = sec.querySelector('.ztf-sb-group-body')!;
			for (const t of items) body.append(this.buildRow(t, selectedID));
			this.listEl.append(sec);
		}
		this.selection?.updateControls();
	}

	private getGroupSection(id: string): GroupSection {
		const cached = this.groupSections.get(id);
		if (cached) return cached;
		const section = new GroupSection(this.win, this.doc, {
			section: 'ztf-sb-group',
			heading: 'ztf-sb-group-head',
			body: 'ztf-sb-group-body',
		}, (closed) => this.store.setCollapsed(id, closed),
		(name) => this.store.renameGroup(id, name));
		section.heading.prepend(this.h('span', 'ztf-sb-dot'));
		section.heading.ondragover = (e: Event) => { if (this.draggedKey) e.preventDefault(); };
		section.heading.ondrop = (e: Event) => {
			e.preventDefault();
			if (!this.draggedKey) return;
			this.store.assignKey(this.draggedKey, id);
			this.draggedKey = null;
			this.onRefresh();
		};
		this.groupSections.set(id, section);
		return section;
	}

	private clearGroupSections(): void {
		for (const section of this.groupSections.values()) section.dispose();
		this.groupSections.clear();
	}

	private buildSection(title: string, color: string, count: number): HTMLElement {
		const wrap = this.h('div', 'ztf-sb-group');
		const head = this.h('div', 'ztf-sb-group-head');
		const dot = this.h('span', 'ztf-sb-dot');
		dot.style.background = color;
		const txt = this.h('span');
		txt.textContent = `${title} (${count})`;
		head.append(dot, txt);
		wrap.append(head, this.h('div', 'ztf-sb-group-body'));
		return wrap;
	}

	private buildRow(t: TrackedTab, selectedID: string): HTMLElement {
		const row = this.h('div', `ztf-sb-row${t.tab.id === selectedID ? ' selected' : ''}${t.status === 'sleeping' ? ' sleeping' : ''}`);
		row.draggable = true;
		const iconName: IconName = t.pinned ? 'pin' : t.status === 'sleeping' ? 'sleep' : t.tab.type === 'note' ? 'note' : 'pdf';
		const iconWrap = this.h('span', 'ztf-sb-row-icon');
		iconWrap.append(createSvgIcon(this.doc, iconName, 13));

		const textWrap = this.h('div', 'ztf-sb-row-text');
		const title = this.h('div', 'ztf-sb-row-title');
		title.textContent = this.meta.getDisplayTitle(t);
		textWrap.append(title);

		const sub = this.meta.getDisplaySubtitle(t);
		if (sub) {
			const subEl = this.h('div', 'ztf-sb-row-sub');
			subEl.textContent = sub;
			textWrap.append(subEl);
		}
		row.append(iconWrap, textWrap);
		const folderBtn = this.h('button', 'ztf-sb-row-action');
		folderBtn.type = 'button';
		folderBtn.title = '打开 PDF 附件所在文件夹';
		folderBtn.append(createSvgIcon(this.doc, 'folder', 12));
		folderBtn.onclick = (e: Event) => {
			e.stopPropagation();
			void this.actions.showInFilesystem(t.tab.id);
		};
		row.append(folderBtn);
		this.selection?.addCheckbox(row, t);
		row.onclick = () => this.actions.selectTab(t.tab.id);
		row.oncontextmenu = (e: Event) => this.menus.openTabMenu(e as MouseEvent, t);
		row.onmouseenter = () => this.hoverCard.show(row, t);
		row.onmouseleave = () => this.hoverCard.hide();
		row.ondragstart = () => { this.draggedKey = t.key; };
		row.ondragover = (e: Event) => {
			if (!this.draggedKey || this.draggedKey === t.key) return;
			e.preventDefault();
			row.setAttribute('data-ztf-drop', 'join');
		};
		row.ondragleave = () => row.removeAttribute('data-ztf-drop');
		row.ondrop = (e: Event) => {
			e.preventDefault();
			row.removeAttribute('data-ztf-drop');
			if (!this.draggedKey || this.draggedKey === t.key) return;
			this.store.assignKey(this.draggedKey, t.groupId);
			this.draggedKey = null;
			this.onRefresh();
		};
		row.ondragend = () => { this.draggedKey = null; };
		return row;
	}

	dispose(): void {
		this.clearGroupSections();
		this.hoverCard.dispose();
		this.sidebar?.remove();
		this.sidebar = null;
		this.listEl = null;
		this.selection = null;
		this.searchInput = null;
	}
}
