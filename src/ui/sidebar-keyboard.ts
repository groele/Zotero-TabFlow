export interface FocusAnchor {
	type: 'head' | 'row' | 'virtual';
	id: string;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el || typeof el.closest !== 'function') return false;
	if (el.matches('input, textarea, select') || el.isContentEditable) return true;
	return Boolean(el.closest('.ztf-inline-edit, [contenteditable="true"]'));
}

export function visibleSidebarNavItems(list: Element | null): HTMLElement[] {
	if (!list) return [];
	return [...list.querySelectorAll<HTMLElement>('[data-ztf-nav]')].filter((el) => !el.closest('[hidden]'));
}

export function computeNextNavIndex(current: number, total: number, key: string): number {
	if (total <= 0) return -1;
	if (key === 'Home') return 0;
	if (key === 'End') return total - 1;
	if (key === 'ArrowDown') return current < 0 ? 0 : Math.min(total - 1, current + 1);
	if (key === 'ArrowUp') return current <= 0 ? 0 : current - 1;
	return current;
}

export function captureSidebarFocusAnchor(doc: Document, aside: Element | null): FocusAnchor | null {
	const active = doc.activeElement as HTMLElement | null;
	if (!aside || !active || !aside.contains(active)) return null;
	const nav = active.closest('[data-ztf-nav]') as HTMLElement | null;
	if (!nav) return null;
	const type = nav.dataset.ztfNav as FocusAnchor['type'];
	const id = nav.dataset.ztfNavId || '';
	return id || type === 'head' ? { type, id } : null;
}

export function restoreSidebarFocusAnchor(list: Element | null, anchor: FocusAnchor | null): void {
	if (!list || !anchor) return;
	for (const el of visibleSidebarNavItems(list)) {
		if (el.dataset.ztfNav === anchor.type && (el.dataset.ztfNavId || '') === anchor.id) {
			el.focus({ preventScroll: true });
			return;
		}
	}
}

export function bindSidebarKeyboardNavigation(
	aside: HTMLElement,
	list: HTMLElement,
	searchInput: HTMLInputElement,
	onClearSearch: () => void,
): void {
	aside.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.isComposing || e.keyCode === 229) return;
		const target = e.target as HTMLElement | null;

		if (target === searchInput) {
			if (e.key === 'ArrowDown') {
				const first = visibleSidebarNavItems(list)[0];
				if (first) {
					e.preventDefault();
					first.focus();
					first.scrollIntoView({ block: 'nearest' });
				}
			} else if (e.key === 'Escape' && searchInput.value) {
				e.preventDefault();
				onClearSearch();
			}
			return;
		}

		if (isEditableKeyboardTarget(target)) return;
		const isChildControl = Boolean(target?.closest('button.ztf-sb-row-action, input.ztf-batch-check'));

		if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			searchInput.focus();
			searchInput.select();
			return;
		}

		const items = visibleSidebarNavItems(list);
		const focusedNav = (target?.closest('[data-ztf-nav]') as HTMLElement | null) || null;
		const idx = focusedNav ? items.indexOf(focusedNav) : -1;

		if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
			const nextIdx = computeNextNavIndex(idx, items.length, e.key);
			if (nextIdx >= 0 && items[nextIdx]) {
				e.preventDefault();
				items[nextIdx].focus();
				items[nextIdx].scrollIntoView({ block: 'nearest' });
			}
			return;
		}

		if (!focusedNav) return;
		const navType = focusedNav.dataset.ztfNav;

		if (e.key === 'Enter') {
			if (isChildControl) return;
			e.preventDefault();
			focusedNav.click();
			return;
		}

		if (e.key === 'ArrowRight' && navType === 'head') {
			e.preventDefault();
			const groupEl = focusedNav.closest('.ztf-sb-group');
			const body = groupEl?.querySelector<HTMLElement>('.ztf-sb-group-body');
			if (body?.hidden) {
				focusedNav.click();
			} else {
				const firstChild = body?.querySelector<HTMLElement>('[data-ztf-nav="row"], [data-ztf-nav="virtual"]');
				firstChild?.focus();
				firstChild?.scrollIntoView({ block: 'nearest' });
			}
			return;
		}

		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			const groupEl = focusedNav.closest('.ztf-sb-group');
			const head = groupEl?.querySelector<HTMLElement>('[data-ztf-nav="head"]');
			const body = groupEl?.querySelector<HTMLElement>('.ztf-sb-group-body');
			if (navType === 'head') {
				if (body && !body.hidden) focusedNav.click();
			} else if (head) {
				head.focus();
				head.scrollIntoView({ block: 'nearest' });
			}
		}
	});
}
