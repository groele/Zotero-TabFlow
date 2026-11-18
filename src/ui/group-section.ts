import type { TabGroup } from '../core/types.ts';

const CLICK_DELAY_MS = 210;
const XHTML = 'http://www.w3.org/1999/xhtml';

export class GroupSection {
	readonly element: HTMLDivElement;
	readonly heading: HTMLButtonElement;
	readonly body: HTMLDivElement;
	private readonly label: HTMLSpanElement;
	private readonly win: Window;
	private readonly doc: Document;
	private readonly setCollapsed: (collapsed: boolean) => void;
	private readonly rename: (name: string) => void;
	private timer: number | null = null;
	private cancelEdit: (() => void) | null = null;
	private name = '';
	private collapsed = false;
	private beforeClick: boolean | null = null;

	constructor(
		win: Window,
		doc: Document,
		classes: { section: string; heading: string; body: string },
		setCollapsed: (collapsed: boolean) => void,
		rename: (name: string) => void,
	) {
		this.win = win;
		this.doc = doc;
		this.setCollapsed = setCollapsed;
		this.rename = rename;
		this.element = doc.createElementNS(XHTML, 'div') as HTMLDivElement;
		this.element.className = classes.section;
		this.heading = doc.createElementNS(XHTML, 'button') as HTMLButtonElement;
		this.heading.type = 'button';
		this.heading.className = classes.heading;
		this.label = doc.createElementNS(XHTML, 'span') as HTMLSpanElement;
		this.body = doc.createElementNS(XHTML, 'div') as HTMLDivElement;
		this.body.className = classes.body;
		this.heading.append(this.label);
		this.element.append(this.heading, this.body);

		this.heading.addEventListener('click', (event: MouseEvent) => {
			event.stopPropagation();
			if (event.button !== 0) return;
			this.cancelPendingClick();
			if (event.detail === 0) {
				this.beforeClick = null;
				this.applyCollapsed(!this.collapsed);
			} else if (event.detail === 1) {
				this.beforeClick = null;
				this.timer = this.win.setTimeout(() => {
					this.timer = null;
					if (!this.heading.isConnected || this.heading.hidden) return;
					this.beforeClick = this.collapsed;
					this.applyCollapsed(!this.collapsed);
				}, CLICK_DELAY_MS);
			}
		});
		this.heading.addEventListener('dblclick', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.button !== 0) return;
			this.cancelPendingClick();
			// The host may recognize a double-click after the 210 ms delay.
			if (this.beforeClick !== null && this.collapsed !== this.beforeClick) {
				this.applyCollapsed(this.beforeClick);
			}
			this.beforeClick = null;
			this.edit();
		});
		this.heading.addEventListener('dragstart', () => this.resetClick());
		this.heading.addEventListener('contextmenu', () => this.resetClick());
	}

	update(group: TabGroup, collapsed: boolean, count: number): void {
		this.name = group.name;
		this.collapsed = collapsed;
		const label = `${collapsed ? '▸' : '▾'} ${group.name} (${count})`;
		if (this.label.textContent !== label) this.label.textContent = label;
		this.heading.title = label;
		this.heading.setAttribute('aria-expanded', String(!collapsed));
		this.body.hidden = collapsed;
	}

	private applyCollapsed(collapsed: boolean): void {
		this.collapsed = collapsed;
		this.setCollapsed(collapsed);
	}

	private edit(): void {
		if (this.cancelEdit || !this.heading.isConnected) return;
		const input = this.doc.createElementNS(XHTML, 'input') as HTMLInputElement;
		input.type = 'text';
		input.className = 'ztf-inline-edit ztf-group-edit';
		input.value = this.name;
		input.setAttribute('data-l10n-id', 'zotero-tabflow-rename-group-input');
		const finish = (save: boolean, focus: boolean) => {
			if (!this.cancelEdit) return;
			this.cancelEdit = null;
			input.remove();
			this.heading.hidden = false;
			const name = input.value.trim();
			if (save && name && name !== this.name) this.rename(name);
			if (focus) this.heading.focus({ preventScroll: true });
		};
		this.cancelEdit = () => finish(false, false);
		input.addEventListener('keydown', (event: KeyboardEvent) => {
			event.stopPropagation();
			if (event.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
			event.preventDefault();
			finish(event.key === 'Enter', true);
		});
		input.onblur = () => finish(true, false);
		this.heading.hidden = true;
		this.heading.after(input);
		input.focus();
		input.select();
	}

	private cancelPendingClick(): void {
		if (this.timer !== null) this.win.clearTimeout(this.timer);
		this.timer = null;
	}

	resetClick(): void {
		this.cancelPendingClick();
		this.beforeClick = null;
	}

	pause(): void {
		this.resetClick();
		this.cancelEdit?.();
	}

	dispose(): void {
		this.pause();
		this.element.remove();
	}
}

export function reconcileGroupSections(
	container: Element,
	cached: Map<string, GroupSection>,
	order: readonly string[],
	end: Element | null = null,
): void {
	const visible = new Set(order);
	for (const [id, section] of cached) {
		if (visible.has(id)) continue;
		section.dispose();
		cached.delete(id);
	}
	let next = end;
	for (let i = order.length - 1; i >= 0; i--) {
		const section = cached.get(order[i])!.element;
		if (section.parentElement !== container || section.nextElementSibling !== next) {
			container.insertBefore(section, next);
		}
		next = section;
	}
}
