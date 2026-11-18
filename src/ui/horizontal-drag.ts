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
	) {}

	bindTabDrag(node: HTMLElement, t: TrackedTab): void {
		node.draggable = true;
		node.ondragstart = (e: Event) => {
			e.stopPropagation();
			this.draggedTabId = t.tab.id;
			this.draggedKey = t.key;
			this.draggedGroupId = null;
			(e as DragEvent).dataTransfer?.setData('text/plain', t.key);
		};
		node.ondragover = (e: Event) => {
			if (!this.draggedKey || this.draggedKey === t.key) return;
			e.preventDefault();
			node.setAttribute('data-ztf-drop', 'stack');
		};
		node.ondragleave = () => node.removeAttribute('data-ztf-drop');
		node.ondrop = (e: Event) => {
			e.preventDefault();
			node.removeAttribute('data-ztf-drop');
			if (!this.draggedKey || this.draggedKey === t.key) return;
			const me = e as MouseEvent;
			const rect = node.getBoundingClientRect();
			const ratio = rect.width > 0 ? (me.clientX - rect.left) / rect.width : 0.5;
			if (ratio < 0.25 || ratio > 0.75) {
				this.store.assignKey(this.draggedKey, t.groupId);
				const tabs = (this.win as any).Zotero_Tabs;
				const targetIdx = tabs?._tabs?.findIndex((x: any) => x.id === t.tab.id) ?? -1;
				if (targetIdx > 0 && this.draggedTabId) {
					tabs.move(this.draggedTabId, targetIdx + (ratio > 0.75 ? 1 : 0));
				}
			} else if (!t.groupId) {
				const val = { value: t.shortTitle.slice(0, 24) };
				if (Services.prompt.prompt(this.win, '叠放新建分组', '将两篇文献合并到新分组：', val, null, {}) && val.value.trim()) {
					const g = this.store.ensureGroup(val.value);
					this.store.assignKey(t.key, g.id);
					this.store.assignKey(this.draggedKey, g.id);
				}
			} else {
				this.store.assignKey(this.draggedKey, t.groupId);
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
			if (!this.draggedKey && this.draggedGroupId === null) return;
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
				this.store.moveGroup(this.draggedGroupId, groupId, true);
			} else if (this.draggedKey) {
				this.store.assignKey(this.draggedKey, groupId);
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
