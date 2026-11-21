import { TABFLOW_DRAG_MIME, hasTabFlowDraggedTab, hasZoteroDraggedItems, parseZoteroDraggedItemIDs } from '../core/drag-utils.ts';
import { t } from '../core/i18n.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab, VirtualMemberMeta } from '../core/types.ts';
import { formatReadingProgress } from '../services/activity-tracker.ts';
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
	getDraggedTabId: () => string | null;
	setDraggedTabId: (id: string | null) => void;
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
	row.onclick = () => void deps.actions.openVirtualOrItem(v.itemID, groupId, false, v.key).then((opened) => {
		if (!opened) Services.prompt.alert(deps.doc.defaultView ?? null, v.title, t('zotero-tabflow-spot-hidden-open-failed', '未能打开这篇文献。请检查附件文件是否可用。'));
		deps.onRefresh();
	});
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
	const prog = formatReadingProgress(deps.store.state.history[item.key]);
	const subText = [sub, prog.text].filter(Boolean).join(' · ');
	if (subText) {
		const subEl = h('div', 'ztf-sb-row-sub');
		subEl.textContent = subText;
		textWrap.append(subEl);
	}
	if (prog.ratio !== null && prog.ratio > 0) {
		const bar = h('div', 'ztf-sb-progress');
		const fill = h('span', 'ztf-sb-progress-fill');
		if (fill.style) fill.style.width = `${Math.round(prog.ratio * 100)}%`;
		bar.append(fill);
		textWrap.append(bar);
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
	if (item.itemID && item.tab.type.startsWith('reader')) row.append(folderBtn);
	deps.selection?.addCheckbox(row, item);
	row.onclick = () => { deps.hoverCard.hide(); deps.actions.selectTab(item.tab.id); };
	row.oncontextmenu = (e: Event) => { deps.hoverCard.hide(); deps.menus.openTabMenu(e as MouseEvent, item); };
	row.onmouseenter = () => deps.hoverCard.scheduleShow(() => deps.hoverCard.show(row, item, 'right'), 120);
	row.onmouseleave = () => deps.hoverCard.hide();
	row.onmousedown = () => deps.hoverCard.hide();
	row.ondragstart = (event: Event) => {
		deps.hoverCard.hide();
		deps.setDraggedKey(item.key);
		deps.setDraggedTabId(item.tab.id);
		const dt = (event as DragEvent).dataTransfer;
		dt?.setData(TABFLOW_DRAG_MIME, item.key);
		dt?.setData('text/plain', item.key);
	};
	row.ondragover = (e: Event) => {
		const dt = (e as DragEvent).dataTransfer;
		const dragged = deps.getDraggedKey();
		const hasCrossTab = !dragged && hasTabFlowDraggedTab(dt);
		const hasExt = !dragged && !hasCrossTab && hasZoteroDraggedItems(dt);
		if ((!dragged || dragged === item.key) && !hasCrossTab && !hasExt) return;
		e.preventDefault();
		if (hasExt) {
			row.setAttribute('data-ztf-drop', 'join');
			return;
		}
		const rect = row.getBoundingClientRect();
		const ratio = rect.height > 0 ? ((e as MouseEvent).clientY - rect.top) / rect.height : 0.5;
		row.setAttribute('data-ztf-drop', ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'join');
	};
	row.ondragleave = () => row.removeAttribute('data-ztf-drop');
	row.ondrop = (e: Event) => {
		e.preventDefault();
		const zone = row.getAttribute('data-ztf-drop') || 'join';
		row.removeAttribute('data-ztf-drop');
		const dt = (e as DragEvent).dataTransfer;
		const dragged = deps.getDraggedKey() || dt?.getData(TABFLOW_DRAG_MIME) || '';
		const draggedTabId = deps.getDraggedTabId();
		if (dragged && dragged !== item.key) {
			deps.store.assignKey(dragged, item.groupId);
			if ((zone === 'before' || zone === 'after') && draggedTabId) {
				deps.actions.moveTabRelative(draggedTabId, item.tab.id, zone === 'after');
			}
			deps.setDraggedKey(null);
			deps.setDraggedTabId(null);
			deps.onRefresh();
			return;
		}
		const extIds = parseZoteroDraggedItemIDs(dt);
		if (extIds.length) {
			void (async () => {
				for (const id of extIds) await deps.actions.openVirtualOrItem(id, item.groupId);
				deps.onRefresh();
			})();
		}
	};
	row.ondragend = () => {
		deps.setDraggedKey(null);
		deps.setDraggedTabId(null);
	};
	return row;
}
