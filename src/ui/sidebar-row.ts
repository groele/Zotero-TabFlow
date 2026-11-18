import { t } from '../core/i18n.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab, VirtualMemberMeta } from '../core/types.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { createSvgIcon, type IconName } from './icons.ts';
import type { SidebarHoverCard } from './sidebar-hover.ts';
import type { SidebarSelection } from './sidebar-selection.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';

export interface SidebarRowDeps {
	doc: Document;
	store: TabFlowStore;
	meta: ItemMetadataService;
	actions: TabActionService;
	menus: TabContextMenuController;
	hoverCard: SidebarHoverCard;
	selection: SidebarSelection | null;
	onRefresh: () => void;
	getDraggedKey: () => string | null;
	setDraggedKey: (key: string | null) => void;
}

export function buildSidebarVirtualRow(deps: SidebarRowDeps, v: VirtualMemberMeta, groupId: string): HTMLElement {
	const row = deps.doc.createElementNS(XHTML, 'div') as HTMLDivElement;
	row.className = 'ztf-sb-row virtual';
	row.tabIndex = -1;
	row.dataset.ztfNav = 'virtual';
	row.dataset.ztfNavId = v.key;
	const ic = deps.doc.createElementNS(XHTML, 'span');
	ic.className = 'ztf-sb-row-icon';
	ic.append(createSvgIcon(deps.doc, 'virtual', 13));
	const txt = deps.doc.createElementNS(XHTML, 'div');
	txt.className = 'ztf-sb-row-text';
	const ttl = deps.doc.createElementNS(XHTML, 'div');
	ttl.className = 'ztf-sb-row-title';
	ttl.textContent = deps.meta.getDisplayTitle(v);
	txt.append(ttl);
	row.append(ic, txt);
	row.onclick = () => void deps.actions.openVirtualOrItem(v.itemID, groupId).then(deps.onRefresh);
	row.oncontextmenu = (e: Event) => deps.menus.openVirtualMenu(e as MouseEvent, v, groupId);
	return row;
}

export function buildSidebarTabRow(deps: SidebarRowDeps, item: TrackedTab, selectedID: string): HTMLElement {
	const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
		const el = deps.doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
		el.className = cls;
		return el;
	};
	const row = h('div', `ztf-sb-row${item.tab.id === selectedID ? ' selected' : ''}${item.status === 'sleeping' ? ' sleeping' : ''}`);
	row.tabIndex = -1;
	row.dataset.ztfNav = 'row';
	row.dataset.ztfNavId = item.key;
	row.draggable = true;
	const iconName: IconName = item.pinned ? 'pin' : item.status === 'sleeping' ? 'sleep' : item.tab.type === 'note' ? 'note' : 'pdf';
	const iconWrap = h('span', 'ztf-sb-row-icon');
	iconWrap.append(createSvgIcon(deps.doc, iconName, 13));

	const textWrap = h('div', 'ztf-sb-row-text');
	const title = h('div', 'ztf-sb-row-title');
	title.textContent = deps.meta.getDisplayTitle(item);
	textWrap.append(title);

	const sub = deps.meta.getDisplaySubtitle(item);
	if (sub) {
		const subEl = h('div', 'ztf-sb-row-sub');
		subEl.textContent = sub;
		textWrap.append(subEl);
	}
	row.append(iconWrap, textWrap);
	const folderBtn = h('button', 'ztf-sb-row-action');
	folderBtn.type = 'button';
	folderBtn.title = t('zotero-tabflow-open-pdf-folder-tip', '打开 PDF 附件所在文件夹');
	folderBtn.append(createSvgIcon(deps.doc, 'folder', 12));
	folderBtn.onclick = (e: Event) => {
		e.stopPropagation();
		void deps.actions.showInFilesystem(item.tab.id);
	};
	row.append(folderBtn);
	deps.selection?.addCheckbox(row, item);
	row.onclick = () => deps.actions.selectTab(item.tab.id);
	row.oncontextmenu = (e: Event) => deps.menus.openTabMenu(e as MouseEvent, item);
	row.onmouseenter = () => deps.hoverCard.show(row, item);
	row.onmouseleave = () => deps.hoverCard.hide();
	row.ondragstart = () => deps.setDraggedKey(item.key);
	row.ondragover = (e: Event) => {
		const dragged = deps.getDraggedKey();
		if (!dragged || dragged === item.key) return;
		e.preventDefault();
		row.setAttribute('data-ztf-drop', 'join');
	};
	row.ondragleave = () => row.removeAttribute('data-ztf-drop');
	row.ondrop = (e: Event) => {
		e.preventDefault();
		row.removeAttribute('data-ztf-drop');
		const dragged = deps.getDraggedKey();
		if (!dragged || dragged === item.key) return;
		deps.store.assignKey(dragged, item.groupId);
		deps.setDraggedKey(null);
		deps.onRefresh();
	};
	row.ondragend = () => deps.setDraggedKey(null);
	return row;
}
