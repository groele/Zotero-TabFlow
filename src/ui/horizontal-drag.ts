import { parseZoteroDraggedItemIDs } from '../core/drag-utils.ts';
import { t } from '../core/i18n.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';

export class HorizontalDragController {
	private draggedTabId: string | null = null;
	private draggedKey: string | null = null;
	private draggedGroupId: string | null = null;
	private hoverTimer: number | null = null;

	constructor(
		private readonly win: Window,
		private readonly store: TabFlowStore,
		private readonly onRefresh: () => void,
		private readonly onMoveTab?: (draggedTabId: string, targetTabId: string, after: boolean) => void,
		private readonly onOpenItemsInGroup?: (itemIDs: number[], groupId: string) => void,
	) {}

	bindTabDrag(node: HTMLElement, tab: TrackedTab): void {
		node.draggable = true;
		node.ondragstart = (e: Event) => {
			e.stopPropagation();
			this.draggedTabId = tab.tab.id;
			this.draggedKey = tab.key;
			this.draggedGroupId = null;
			(e as DragEvent).dataTransfer?.setData('text/plain', tab.key);
		};
		node.ondragover = (e: Event) => {
			if (!this.draggedKey || this.draggedKey === tab.key) return;
			e.preventDefault();
			node.setAttribute('data-ztf-drop', 'stack');
		};
		node.ondragleave = () => node.removeAttribute('data-ztf-drop');
		node.ondrop = (e: Event) => {
			e.preventDefault();
			node.removeAttribute('data-ztf-drop');
			if (!this.draggedKey || this.draggedKey === tab.key) return;
			const me = e as MouseEvent;
			const rect = node.getBoundingClientRect();
			const ratio = rect.width > 0 ? (me.clientX - rect.left) / rect.width : 0.5;
			if (ratio < 0.25 || ratio > 0.75) {
				this.store.assignKey(this.draggedKey, tab.groupId);
				if (this.draggedTabId) {
					this.onMoveTab?.(this.draggedTabId, tab.tab.id, ratio > 0.75);
				}
			} else if (!tab.groupId) {
				const val = { value: tab.shortTitle.slice(0, 24) };
				if (Services.prompt.prompt(this.win, t('zotero-tabflow-stack-group-title', '叠放新建分组'), t('zotero-tabflow-stack-group-prompt', '将两篇文献合并到新分组：'), val, null, {}) && val.value.trim()) {
					const g = this.store.ensureGroup(val.value);
					this.store.assignKey(tab.key, g.id);
					this.store.assignKey(this.draggedKey, g.id);
				}
			} else {
				this.store.assignKey(this.draggedKey, tab.groupId);
			}
			this.clear();
			this.onRefresh();
		};
		node.ondragend = () => this.clear();
	}

	bindGroupDrag(heading: HTMLElement, groupId: string, collapsed: boolean): void {
		heading.draggable = true;
		heading.ondragstart = (e: Event) => {
			e.stopPropagation();
			this.draggedGroupId = groupId;
			this.draggedKey = null;
		};
		heading.ondragover = (e: Event) => {
			const extItems = parseZoteroDraggedItemIDs((e as DragEvent).dataTransfer);
			if (!this.draggedKey && this.draggedGroupId === null && !extItems.length) return;
			e.preventDefault();
			if (this.draggedKey && collapsed && this.hoverTimer === null) {
				this.hoverTimer = this.win.setTimeout(() => {
					this.hoverTimer = null;
					this.store.setCollapsed(groupId, false);
				}, 600);
			}
		};
		heading.ondragleave = () => {
			if (this.hoverTimer !== null) {
				this.win.clearTimeout(this.hoverTimer);
				this.hoverTimer = null;
			}
		};
		heading.ondrop = (e: Event) => {
			e.preventDefault();
			if (this.draggedGroupId !== null && this.draggedGroupId !== groupId) {
				const rect = heading.getBoundingClientRect();
				const after = rect.width > 0 ? (e as MouseEvent).clientX >= rect.left + rect.width / 2 : true;
				this.store.moveGroup(this.draggedGroupId, groupId, after);
			} else if (this.draggedKey) {
				this.store.assignKey(this.draggedKey, groupId);
			} else {
				const extItems = parseZoteroDraggedItemIDs((e as DragEvent).dataTransfer);
				if (extItems.length) this.onOpenItemsInGroup?.(extItems, groupId);
			}
			this.clear();
			this.onRefresh();
		};
		heading.ondragend = () => this.clear();
	}

	clear(): void {
		this.draggedTabId = null;
		this.draggedKey = null;
		this.draggedGroupId = null;
		if (this.hoverTimer !== null) {
			this.win.clearTimeout(this.hoverTimer);
			this.hoverTimer = null;
		}
	}
}
