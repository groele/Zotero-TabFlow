import { createSvgIcon, type IconName } from './icons.ts';

export interface ToolbarAction {
	id: string;
	label: string;
	title?: string;
	icon: IconName;
	iconOnly?: boolean;
	count?: number;
	status?: 'attention';
	pressed?: boolean;
	popup?: 'dialog' | 'menu';
	run: (button: HTMLButtonElement) => void;
}

export class ToolbarActions {
	private readonly buttons = new Map<string, HTMLButtonElement>();

	render(bar: HTMLDivElement, actions: readonly ToolbarAction[]): void {
		const doc = bar.ownerDocument;
		if (!doc) return;
		const ids = new Set(actions.map(({ id }) => id));
		for (const [id, button] of this.buttons) {
			if (!ids.has(id)) {
				button.remove();
				this.buttons.delete(id);
			}
		}
		bar.hidden = actions.length === 0;
		let next = bar.firstElementChild;
		for (const action of actions) {
			const { id, label, title, icon, count, pressed, popup } = action;
			let button = this.buttons.get(id);
			if (!button) {
				button = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
				button.type = 'button';
				button.className = 'ztf-tb-btn';
				button.dataset.action = id;
				const svg = createSvgIcon(doc, icon, 16);
				svg.setAttribute('aria-hidden', 'true');
				const caption = doc.createElementNS(button.namespaceURI, 'span');
				caption.className = 'ztf-tb-label';
				const badge = doc.createElementNS(button.namespaceURI, 'span');
				badge.className = 'ztf-tb-count';
				badge.setAttribute('aria-hidden', 'true');
				button.append(svg, caption, badge);
				this.buttons.set(id, button);
			}
			const caption = button.children[1] as HTMLElement;
			const badge = button.children[2] as HTMLElement;
			if (caption.textContent !== label) caption.textContent = label;
			const number = count ? (count > 99 ? '99+' : String(count)) : '';
			if (badge.textContent !== number) badge.textContent = number;
			badge.hidden = !number;
			button.title = title ?? label;
			button.setAttribute('aria-label', title?.startsWith(label) ? title : title ? `${label} · ${title}` : label);
			if (popup) button.setAttribute('aria-haspopup', popup);
			if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
			button.classList.toggle('ztf-tb-icon-only', Boolean(action.iconOnly));
			button.classList.toggle('ztf-tb-attention', action.status === 'attention');
			button.onclick = () => action.run(button);
			if (button !== next) bar.insertBefore(button, next);
			next = button.nextElementSibling;
		}
	}
}
