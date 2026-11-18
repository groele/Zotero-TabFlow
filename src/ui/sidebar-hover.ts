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

	show(anchor: HTMLElement, t: TrackedTab): void {
		if (!getPref('enableHoverPreview') || !this.card) return;
		const h = this.store.state.history[t.key];
		const last = h?.lastViewed || h?.firstSeen;
		const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86_400_000)) : 0;
		const remark = this.store.getRemark(t.key).note;

		this.card.textContent = '';
		const mk = (cls: string, text: string) => {
			const d = this.doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
			d.className = cls;
			d.textContent = text;
			return d;
		};
		this.card.append(
			mk('ztf-hc-title', t.title),
			mk('ztf-hc-meta', [t.creatorYear, t.source].filter(Boolean).join(' · ') || '暂无作者/期刊元数据'),
			mk('ztf-hc-meta', `集合：${t.collection} · 上次阅读：${days === 0 ? '今天' : `${days} 天前`}`),
		);
		if (remark) this.card.append(mk('ztf-hc-note', `备注：${remark}`));

		const rect = anchor.getBoundingClientRect();
		this.card.style.left = `${Math.min(rect.right + 8, this.win.innerWidth - 332)}px`;
		this.card.style.top = `${Math.min(rect.top, this.win.innerHeight - 165)}px`;
		this.card.hidden = false;
	}

	hide(): void {
		if (this.card) this.card.hidden = true;
	}

	dispose(): void {
		this.card?.remove();
		this.card = null;
	}
}
