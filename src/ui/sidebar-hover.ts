import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab, VirtualMemberMeta } from '../core/types.ts';

export class SidebarHoverCard {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly store: TabFlowStore;
	private card: HTMLDivElement | null = null;
	private showTimer: number | null = null;

	constructor(win: Window, doc: Document, store: TabFlowStore) {
		this.win = win; this.doc = doc; this.store = store;
	}

	mount(): void {
		if (this.card) return;
		const card = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		card.id = 'ztf-hover-card';
		card.hidden = true;
		this.doc.documentElement?.append(card);
		this.card = card;
	}

	scheduleShow(fn: () => void, delayMs = 180): void {
		this.cancelTimer();
		if (typeof this.win?.setTimeout === 'function') {
			this.showTimer = this.win.setTimeout(() => {
				this.showTimer = null;
				fn();
			}, delayMs);
		} else {
			fn();
		}
	}

	private cancelTimer(): void {
		if (this.showTimer !== null) {
			this.win?.clearTimeout?.(this.showTimer);
			this.showTimer = null;
		}
	}

	show(anchor: HTMLElement, tab: TrackedTab, placement: 'right' | 'below' = 'right'): void {
		if (!getPref('enableHoverPreview') || !this.card) return;
		const reader = (Zotero.Reader as any)?.getByTabID?.(tab.tab.id);
		const pageIdx = reader?.state?.pageIndex;
		const numPages = reader?._internalReader?._pdfDocument?.numPages;
		const pageText = typeof pageIdx === 'number' && pageIdx >= 0
			? (typeof numPages === 'number' && numPages > 0
				? t('zotero-tabflow-hover-page-of', `第 ${pageIdx + 1} / ${numPages} 页`, { page: pageIdx + 1, total: numPages })
				: t('zotero-tabflow-hover-page', `第 ${pageIdx + 1} 页`, { page: pageIdx + 1 }))
			: '';
		const itemObj: any = tab.itemID ? Zotero.Items.get(tab.itemID) : null;
		const annots = itemObj?.isAttachment?.() && typeof itemObj?.getAnnotations === 'function' ? itemObj.getAnnotations()?.length : undefined;
		const annotText = typeof annots === 'number' && annots >= 0 ? t('zotero-tabflow-hover-annots', `批注 ${annots} 条`, { count: annots }) : '';
		const readerMeta = [pageText, annotText].filter(Boolean).join(' · ');
		this.renderCard(anchor, tab.key, tab.title, tab.creatorYear, tab.source, tab.collection, readerMeta, placement);
	}

	showVirtual(anchor: HTMLElement, member: VirtualMemberMeta, groupName = '', placement: 'right' | 'below' = 'below'): void {
		if (!getPref('enableHoverPreview') || !this.card) return;
		const col = [member.collection, groupName].filter(Boolean).join(' · ');
		this.renderCard(anchor, member.key, member.title, member.creatorYear, member.source, col, t('zotero-tabflow-spot-virtual-hint', '虚拟保留'), placement);
	}

	private renderCard(
		anchor: HTMLElement, key: string, title: string, creatorYear: string,
		source: string, collection: string, extraMeta: string, placement: 'right' | 'below',
	): void {
		if (!this.card) return;
		const h = this.store.state.history[key];
		const last = h?.lastViewed;
		const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86_400_000)) : 0;
		const remark = getPref('enableTabRemarks') ? this.store.getRemark(key).note : '';
		this.card.textContent = '';
		const mk = (cls: string, text: string) => {
			const d = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
			d.className = cls;
			d.textContent = text;
			return d;
		};
		const lastText = !last ? t('zotero-tabflow-hover-never-viewed', '尚未查看')
			: days === 0 ? t('zotero-tabflow-hover-today', '今天')
				: t('zotero-tabflow-hover-days-ago', `${days} 天前`, { days });
		this.card.append(
			mk('ztf-hc-title', title),
			mk('ztf-hc-meta', [creatorYear, source].filter(Boolean).join(' · ') || t('zotero-tabflow-hover-no-meta', '暂无作者/期刊元数据')),
			mk('ztf-hc-meta', t('zotero-tabflow-hover-collection-last', `集合：${collection} · 上次阅读：${lastText}`, { collection, time: lastText })),
		);
		if (extraMeta) this.card.append(mk('ztf-hc-meta', extraMeta));
		if (remark) this.card.append(mk('ztf-hc-note', t('zotero-tabflow-hover-remark', `备注：${remark}`, { note: remark })));

		const rect = anchor.getBoundingClientRect();
		this.card.hidden = false;
		const cardRect = this.card.getBoundingClientRect?.();
		const cardW = cardRect?.width ? Math.ceil(cardRect.width) + 16 : 332;
		const cardH = cardRect?.height ? Math.ceil(cardRect.height) + 12 : 165;
		const left = placement === 'below' ? Math.min(rect.left, this.win.innerWidth - cardW) : Math.min(rect.right + 8, this.win.innerWidth - cardW);
		const top = placement === 'below' ? Math.min(rect.bottom + 6, this.win.innerHeight - cardH) : Math.min(rect.top, this.win.innerHeight - cardH);
		this.card.style.left = `${Math.max(8, left)}px`;
		this.card.style.top = `${Math.max(8, top)}px`;
	}

	hide(): void {
		this.cancelTimer();
		if (this.card && !this.card.hidden) this.card.hidden = true;
	}

	dispose(): void {
		this.cancelTimer();
		this.card?.remove();
		this.card = null;
	}
}
