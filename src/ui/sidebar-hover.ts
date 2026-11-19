import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TrackedTab } from '../core/types.ts';

export class SidebarHoverCard {
	private card: HTMLDivElement | null = null;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
	) {}

	mount(): void {
		if (this.card) return;
		const card = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		card.id = 'ztf-hover-card';
		card.hidden = true;
		this.doc.documentElement?.append(card);
		this.card = card;
	}

	show(anchor: HTMLElement, tab: TrackedTab): void {
		if (!getPref('enableHoverPreview') || !this.card) return;
		const h = this.store.state.history[tab.key];
		const last = h?.lastViewed;
		const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86_400_000)) : 0;
		const remark = getPref('enableTabRemarks') ? this.store.getRemark(tab.key).note : '';

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
			mk('ztf-hc-title', tab.title),
			mk('ztf-hc-meta', [tab.creatorYear, tab.source].filter(Boolean).join(' · ') || t('zotero-tabflow-hover-no-meta', '暂无作者/期刊元数据')),
			mk('ztf-hc-meta', t('zotero-tabflow-hover-collection-last', `集合：${tab.collection} · 上次阅读：${lastText}`, { collection: tab.collection, time: lastText })),
		);
		if (readerMeta) this.card.append(mk('ztf-hc-meta', readerMeta));
		if (remark) this.card.append(mk('ztf-hc-note', t('zotero-tabflow-hover-remark', `备注：${remark}`, { note: remark })));

		const rect = anchor.getBoundingClientRect();
		this.card.hidden = false;
		const cardRect = this.card.getBoundingClientRect?.();
		const cardW = cardRect?.width ? Math.ceil(cardRect.width) + 16 : 332;
		const cardH = cardRect?.height ? Math.ceil(cardRect.height) + 12 : 165;
		this.card.style.left = `${Math.max(0, Math.min(rect.right + 8, this.win.innerWidth - cardW))}px`;
		this.card.style.top = `${Math.max(0, Math.min(rect.top, this.win.innerHeight - cardH))}px`;
	}

	hide(): void {
		if (this.card) this.card.hidden = true;
	}

	dispose(): void {
		this.card?.remove();
		this.card = null;
	}
}
