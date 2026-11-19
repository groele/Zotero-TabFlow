import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TabActionService } from '../services/tab-actions.ts';

export class ItemContextMenuController {
	private itemMenuEl: Element | null = null;
	private itemMenuEntry: Element | null = null;
	private itemSubPopup: Element | null = null;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly actions: TabActionService,
		private readonly onRefresh: () => void,
	) {}

	private xul(tag: string): any {
		return (this.doc as any).createXULElement
			? (this.doc as any).createXULElement(tag)
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
	}

	private item(popup: any, label: string, action: () => void): any {
		const mi = this.xul('menuitem');
		mi.setAttribute('label', label);
		mi.addEventListener('command', action);
		popup.append(mi);
		return mi;
	}

	attach(): void {
		const itemMenu = this.doc.getElementById('zotero-itemmenu');
		if (!itemMenu || this.itemMenuEl) return;
		const menu = this.xul('menu');
		menu.id = 'ztf-item-open-group';
		menu.setAttribute('label', t('zotero-tabflow-item-open-group', 'TabFlow：打开并分组'));
		const sub = this.xul('menupopup');
		menu.append(sub);
		itemMenu.append(menu);
		itemMenu.addEventListener('popupshowing', this.onItemMenuShowing);
		sub.addEventListener('popupshowing', this.onItemSubShowing);
		this.itemMenuEl = itemMenu;
		this.itemMenuEntry = menu;
		this.itemSubPopup = sub;
	}

	private onItemMenuShowing = (): void => {
		const enabled = getPref('enableItemContextMenu');
		const items = (this.win as any).ZoteroPane?.getSelectedItems?.() || [];
		if (this.itemMenuEntry) {
			(this.itemMenuEntry as HTMLElement).hidden = !enabled;
			if (!items.length) this.itemMenuEntry.setAttribute('disabled', 'true');
			else this.itemMenuEntry.removeAttribute('disabled');
		}
	};

	private onItemSubShowing = (): void => {
		if (!this.itemSubPopup) return;
		this.itemSubPopup.textContent = '';
		const selected: any[] = (this.win as any).ZoteroPane?.getSelectedItems?.() || [];
		this.item(this.itemSubPopup, t('zotero-tabflow-item-open-new-group', '打开到新分组…'), () => {
			const fallback = selected[0]?.getField?.('title')?.slice(0, 30) || t('zotero-tabflow-new-group-title', '新分组');
			const val = { value: fallback };
			if (!Services.prompt.prompt(this.win, t('zotero-tabflow-item-open-new-group', '打开到新分组'), t('zotero-tabflow-new-group-prompt', '分组名称：'), val, null, {}) || !val.value.trim()) return;
			const g = this.store.ensureGroup(val.value);
			void (async () => {
				for (const it of selected) await this.actions.openVirtualOrItem(it.id, g.id);
				this.onRefresh();
			})();
		});
		const groups = this.store.visibleGroups().filter((group) => group.id);
		if (groups.length) this.itemSubPopup.append(this.xul('menuseparator'));
		for (const g of groups) {
			this.item(this.itemSubPopup, g.name, () => {
				void (async () => {
					for (const it of selected) await this.actions.openVirtualOrItem(it.id, g.id);
					this.onRefresh();
				})();
			});
		}
	};

	dispose(): void {
		this.itemMenuEl?.removeEventListener('popupshowing', this.onItemMenuShowing);
		this.itemSubPopup?.removeEventListener('popupshowing', this.onItemSubShowing);
		this.itemMenuEntry?.remove();
		this.itemMenuEl = null;
		this.itemMenuEntry = null;
		this.itemSubPopup = null;
	}
}
