import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';

export class SidebarSelection {
	private active = false;
	private selected = new Set<string>();
	private tracked: TrackedTab[] = [];
	private toggle: HTMLButtonElement;
	private controls: HTMLDivElement;
	private count: HTMLSpanElement;
	private selectAll: HTMLButtonElement;
	private groups: HTMLSelectElement;
	private pinButtons: HTMLButtonElement[];
	private closeButton: HTMLButtonElement;

	constructor(
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		header: HTMLElement,
		aside: HTMLElement,
		private readonly list: HTMLElement,
		private readonly onChange: () => void,
		private readonly onCloseSelected?: (tabIds: string[]) => void,
	) {
		this.toggle = this.button('zotero-tabflow-batch-toggle', () => {
			this.active = !this.active;
			this.selected.clear();
			this.onChange();
		});
		header.prepend(this.toggle);

		this.controls = this.h('div');
		this.controls.className = 'ztf-batch-controls';
		this.count = this.h('span');
		this.selectAll = this.button('zotero-tabflow-batch-select-visible', () => {
			for (const checkbox of this.visibleCheckboxes()) {
				this.selected.add(checkbox.value);
				checkbox.checked = true;
			}
			this.updateControls();
		});
		this.groups = this.h('select');
		this.groups.setAttribute('data-l10n-id', 'zotero-tabflow-batch-group-label');
		this.groups.onchange = () => {
			if (this.groups.selectedIndex > 0) this.store.assignKeys(this.selectedKeys(), this.groups.value);
			this.groups.selectedIndex = 0;
		};
		this.pinButtons = [true, false].map((pinned) => this.button(
			pinned ? 'zotero-tabflow-batch-pin' : 'zotero-tabflow-batch-unpin',
			() => this.store.setPinnedKeys(this.selectedKeys(), pinned),
		));
		this.closeButton = this.button('zotero-tabflow-batch-close', () => {
			const ids = [...this.selected];
			this.selected.clear();
			this.onCloseSelected?.(ids);
		});
		this.controls.append(this.count, this.selectAll, this.groups, ...this.pinButtons, this.closeButton);
		aside.insertBefore(this.controls, list);
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
		return this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
	}

	private button(l10n: string, action: () => void): HTMLButtonElement {
		const btn = this.h('button');
		btn.type = 'button';
		btn.setAttribute('data-l10n-id', l10n);
		btn.onclick = action;
		return btn;
	}

	private visibleCheckboxes(): HTMLInputElement[] {
		return [...this.list.querySelectorAll<HTMLInputElement>('.ztf-batch-check')]
			.filter((checkbox) => !checkbox.closest('[hidden]'));
	}

	beginRender(tracked: TrackedTab[]): void {
		const enabled = getPref('enableBatchSelection');
		if (!enabled) {
			this.active = false;
			this.selected.clear();
		}
		this.tracked = tracked;
		const open = new Set(tracked.map((t) => t.tab.id));
		for (const id of this.selected) if (!open.has(id)) this.selected.delete(id);
		this.toggle.hidden = !enabled;
		this.toggle.setAttribute('aria-pressed', String(this.active));
		this.controls.hidden = !this.active;
		if (!this.active) return;

		const placeholder = this.h('option');
		placeholder.disabled = true;
		placeholder.selected = true;
		placeholder.setAttribute('data-l10n-id', 'zotero-tabflow-batch-move');
		this.groups.replaceChildren(placeholder);
		for (const group of this.store.visibleGroups()) {
			const option = this.h('option');
			option.value = group.id;
			option.textContent = group.name;
			this.groups.append(option);
		}
	}

	updateControls(): void {
		const count = this.selected.size;
		this.count.setAttribute('data-l10n-id', 'zotero-tabflow-batch-count');
		this.count.setAttribute('data-l10n-args', JSON.stringify({ count }));
		this.selectAll.disabled = !this.visibleCheckboxes().some((checkbox) => !checkbox.checked);
		this.groups.disabled = !count;
		for (const btn of this.pinButtons) {
			btn.hidden = !getPref('enablePinnedTabs');
			btn.disabled = !count;
		}
		this.closeButton.hidden = !this.onCloseSelected;
		this.closeButton.disabled = !count;
	}

	private selectedKeys(): string[] {
		return [...new Set(this.tracked.filter((t) => this.selected.has(t.tab.id)).map((t) => t.key))];
	}

	addCheckbox(row: HTMLElement, tab: TrackedTab): void {
		if (!this.active) return;
		const label = this.h('label');
		label.className = 'ztf-batch-target';
		const check = this.h('input');
		check.className = 'ztf-batch-check';
		check.type = 'checkbox';
		check.value = tab.tab.id;
		check.checked = this.selected.has(tab.tab.id);
		check.setAttribute('aria-label', tab.title);
		check.onchange = () => {
			if (check.checked) this.selected.add(tab.tab.id);
			else this.selected.delete(tab.tab.id);
			this.updateControls();
		};
		label.onclick = (event) => event.stopPropagation();
		label.append(check);
		row.prepend(label);
	}
}
