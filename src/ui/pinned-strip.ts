import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import { createSvgIcon } from './icons.ts';
import type { TabContextMenuController } from './tab-context-menu.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';

export function partitionPinnedOverflow(
	chipWidths: readonly number[],
	availableWidth: number,
	moreButtonWidth = 50,
	gap = 4,
): number {
	if (!chipWidths.length) return 0;
	if (availableWidth <= 0) return chipWidths.length;
	const totalWidth = chipWidths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
	if (totalWidth <= availableWidth) return chipWidths.length;

	const budget = Math.max(40, availableWidth - moreButtonWidth - gap);
	let used = 0;
	let count = 0;
	for (const w of chipWidths) {
		const next = used + (count > 0 ? gap : 0) + w;
		if (next > budget && count > 0) break;
		used = next;
		count++;
	}
	return Math.max(1, count);
}

export function renderPinnedStrip(
	doc: Document,
	strip: HTMLDivElement,
	pinnedTabs: readonly TrackedTab[],
	selectedID: string,
	store: TabFlowStore,
	meta: ItemMetadataService,
	actions: TabActionService,
	menus: TabContextMenuController,
): void {
	strip.replaceChildren();
	strip.hidden = pinnedTabs.length === 0;
	if (!pinnedTabs.length) return;

	const iconOnly = getPref('pinnedIconOnly');
	const approxChipWidth = (tab: TrackedTab): number => {
		if (iconOnly) return 28;
		const label = store.getRemark(tab.key).note || tab.shortTitle || tab.title;
		return Math.min(116, Math.max(52, label.length * 7 + 30));
	};
	const hostWidth = strip.parentElement?.clientWidth || 900;
	const maxWidth = Math.max(160, Math.floor(hostWidth * 0.36));
	const visibleCount = partitionPinnedOverflow(pinnedTabs.map(approxChipWidth), maxWidth);
	const visible = pinnedTabs.slice(0, visibleCount);
	const overflow = pinnedTabs.slice(visibleCount);

	for (const tab of visible) {
		const chip = doc.createElementNS(XHTML, 'button') as HTMLButtonElement;
		chip.type = 'button';
		chip.className = `ztf-pinned-chip${tab.tab.id === selectedID ? ' selected' : ''}${iconOnly ? ' icon-only' : ''}`;
		chip.title = tab.title;
		chip.append(createSvgIcon(doc, 'pin', 12));
		if (!iconOnly) {
			const span = doc.createElementNS(XHTML, 'span');
			const remark = getPref('enableTabRemarks') ? store.getRemark(tab.key).note : '';
			span.textContent = remark || tab.shortTitle || tab.title;
			chip.append(span);
		}
		chip.onclick = () => actions.selectTab(tab.tab.id);
		chip.oncontextmenu = (e: Event) => menus.openTabMenu(e as MouseEvent, tab);
		strip.append(chip);
	}

	if (overflow.length) {
		const moreBtn = doc.createElementNS(XHTML, 'button') as HTMLButtonElement;
		moreBtn.type = 'button';
		moreBtn.className = 'ztf-pinned-more';
		moreBtn.textContent = `+${overflow.length}`;
		moreBtn.title = t('zotero-tabflow-pinned-more-tip', `更多固定标签 (${overflow.length})`, { count: overflow.length });
		moreBtn.onclick = () => openOverflowMenu(doc, moreBtn, overflow, selectedID, store, meta, actions);
		strip.append(moreBtn);
	}
}

function openOverflowMenu(
	doc: Document,
	anchor: Element,
	overflow: readonly TrackedTab[],
	selectedID: string,
	store: TabFlowStore,
	meta: ItemMetadataService,
	actions: TabActionService,
): void {
	const popupset = doc.getElementById('mainPopupSet') || doc.querySelector('popupset');
	if (!popupset) return;
	const xul = (tag: string): any => (doc as any).createXULElement
		? (doc as any).createXULElement(tag)
		: doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
	const popup = xul('menupopup');
	popupset.append(popup);
	popup.addEventListener('popuphidden', (e: Event) => { if (e.target === popup) popup.remove(); });
	for (const tab of overflow) {
		const mi = xul('menuitem');
		mi.setAttribute('label', `${tab.tab.id === selectedID ? '✓ ' : ''}${meta.getDisplayTitle(tab)}`);
		mi.addEventListener('command', () => actions.selectTab(tab.tab.id));
		popup.append(mi);
	}
	popup.append(xul('menuseparator'));
	const unpinMenu = xul('menu');
	unpinMenu.setAttribute('label', t('zotero-tabflow-menu-unpin', '取消固定标签'));
	const unpinPop = xul('menupopup');
	unpinMenu.append(unpinPop);
	for (const tab of overflow) {
		const mi = xul('menuitem');
		mi.setAttribute('label', tab.title);
		mi.addEventListener('command', () => store.togglePinned(tab.key));
		unpinPop.append(mi);
	}
	popup.append(unpinMenu);
	const win = doc.defaultView as any;
	const rect = anchor.getBoundingClientRect();
	popup.openPopupAtScreen((win?.mozInnerScreenX || 0) + rect.left, (win?.mozInnerScreenY || 0) + rect.bottom, true);
}
