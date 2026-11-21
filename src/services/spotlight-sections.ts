import type { TabFlowStore } from '../core/store.ts';
import type { ItemMetadataService } from './item-metadata.ts';

export type SpotIconKind = 'pdf' | 'article' | 'note' | 'group' | 'session' | 'cmd';

export interface SpotCardEntry {
	label: string;
	subline?: string;
	badge?: { text: string; color?: string };
	hint: string;
	iconKind?: SpotIconKind;
	keepOpen?: boolean;
	run: () => void;
}

export interface ClosedTabRecord {
	key: string;
	itemID: number;
	title: string;
	metaLine: string;
	itemTypeLabel: string;
	groupId: string;
	closedAt: number;
	isPdf: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function formatRelativeTime(timestampMs: number): string {
	if (!timestampMs || !Number.isFinite(timestampMs)) return '';
	const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
	if (diffSec < 60) return '1 min ago';
	const mins = Math.floor(diffSec / 60);
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.floor(hours / 24);
	return `${days} d ago`;
}

export function extractItemCardMeta(item: any, plainTitle: (v: string) => string): {
	title: string;
	subline: string;
	itemTypeLabel: string;
	isPdf: boolean;
	dateAddedMs: number;
} {
	const primary = item?.parentItemID ? Zotero.Items?.get?.(item.parentItemID) || item : item;
	const rawTitle = primary?.getField?.('title') || item?.getField?.('title') || '';
	const title = plainTitle(String(rawTitle || item?.key || ''));
	const creators = primary?.getCreators?.() || [];
	const firstAuthor = creators[0]
		? [creators[0].firstName, creators[0].lastName].filter(Boolean).join(' ')
		: '';
	const year = String(primary?.getField?.('year') || primary?.getField?.('date') || '').slice(0, 4);
	const pub = String(primary?.getField?.('publicationTitle') || primary?.getField?.('proceedingsTitle') || '');
	const subline = [firstAuthor, year, pub].filter(Boolean).join(' · ');
	const isPdf = Boolean(
		item?.isPDFAttachment?.() ||
		String(item?.attachmentContentType || '').toLowerCase() === 'application/pdf',
	);
	const itemTypeLabel = isPdf
		? (item?.attachmentLinkMode === 2 ? 'attachmentPDFLink' : 'attachmentPDF')
		: String(primary?.itemType || item?.itemType || 'item');
	const rawDate = item?.dateAdded || primary?.dateAdded;
	const dateAddedMs = rawDate ? Date.parse(String(rawDate).replace(' ', 'T')) || 0 : 0;
	return { title, subline, itemTypeLabel, isPdf, dateAddedMs };
}

export function collectNativeClosedTabs(
	win: Window,
	trackedClosed: ClosedTabRecord[],
	plainTitle: (v: string) => string,
	openKeys: Set<string>,
): ClosedTabRecord[] {
	const out: ClosedTabRecord[] = [];
	const seen = new Set<number>();
	const pushRec = (rec: ClosedTabRecord) => {
		if (!rec.itemID || seen.has(rec.itemID) || openKeys.has(rec.key)) return;
		seen.add(rec.itemID);
		out.push(rec);
	};
	for (const rec of trackedClosed) pushRec(rec);
	const nativeClosed = (win as any).Zotero_Tabs?._recentlyClosedTabs;
	if (Array.isArray(nativeClosed)) {
		for (let i = nativeClosed.length - 1; i >= 0; i--) {
			const tab = nativeClosed[i];
			const itemID = Number(tab?.data?.itemID);
			if (!itemID || seen.has(itemID)) continue;
			const item = Zotero.Items?.get?.(itemID);
			if (!item || item.deleted) continue;
			const key = `${item.libraryID}:${item.key}`;
			const info = extractItemCardMeta(item, plainTitle);
			pushRec({
				key,
				itemID,
				title: info.title || String(tab?.title || ''),
				metaLine: info.subline,
				itemTypeLabel: info.itemTypeLabel,
				groupId: '',
				closedAt: Number(tab?.closedAt || tab?.timestamp || 0),
				isPdf: info.isPdf,
			});
		}
	}
	return out.slice(0, 6);
}

export async function fetchRecentlyAddedEntries(
	meta: Pick<ItemMetadataService, 'plainTitle'>,
	openItemIds: Set<number>,
	onOpenItem: (itemID: number) => void,
): Promise<SpotCardEntry[]> {
	const db = (Zotero as any).DB;
	const itemsApi = Zotero.Items as any;
	if (!db?.queryAsync || !itemsApi?.getAsync) return [];
	try {
		const rows = await db.queryAsync(
			'SELECT itemID FROM items WHERE itemID NOT IN (SELECT itemID FROM deletedItems) ' +
			'AND itemTypeID NOT IN (SELECT itemTypeID FROM itemTypes WHERE typeName IN ("attachment","note","annotation")) ' +
			'ORDER BY dateAdded DESC LIMIT 10',
		);
		const ids = Array.isArray(rows)
			? rows.map((r: any) => Number(r.itemID)).filter((id: number) => Number.isInteger(id) && id > 0 && !openItemIds.has(id))
			: [];
		if (!ids.length) return [];
		const items = await itemsApi.getAsync(ids.slice(0, 6));
		if (!Array.isArray(items)) return [];
		return items.filter((it: any) => it && !it.deleted).map((it: any) => {
			const info = extractItemCardMeta(it, meta.plainTitle.bind(meta));
			const ago = formatRelativeTime(info.dateAddedMs);
			return {
				label: info.title,
				subline: info.subline,
				hint: [info.itemTypeLabel, ago].filter(Boolean).join(' · '),
				iconKind: info.isPdf ? 'pdf' : 'article',
				run: () => onOpenItem(it.id),
			};
		});
	} catch {
		return [];
	}
}

export function createSpotIcon(doc: Document, kind: SpotIconKind, color?: string): Element {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '15');
	svg.setAttribute('height', '15');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('class', `ztf-spot-icon ztf-spot-icon-${kind}`);
	const p = doc.createElementNS(SVG_NS, 'path');
	if (kind === 'pdf') {
		p.setAttribute('d', 'M3.5 1.8H9.8L12.5 4.5V13.2C12.5 13.75 12.05 14.2 11.5 14.2H3.5C2.95 14.2 2.5 13.75 2.5 13.2V2.8C2.5 2.25 2.95 1.8 3.5 1.8ZM9.5 2.1V4.8H12.2M5 8H10M5 10.5H8.5');
		p.setAttribute('stroke', '#E11D2E');
	} else if (kind === 'group') {
		const dot = doc.createElementNS(SVG_NS, 'circle');
		dot.setAttribute('cx', '8'); dot.setAttribute('cy', '8'); dot.setAttribute('r', '5');
		dot.setAttribute('fill', color || '#3B82F6');
		svg.append(dot);
		return svg;
	} else {
		const d = kind === 'session'
			? 'M3 3.5A1.5 1.5 0 0 1 4.5 2h5.6L13 4.9V12.5A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-9Z'
			: kind === 'cmd'
				? 'M8 2.5L9.5 6.5L13.5 8L9.5 9.5L8 13.5L6.5 9.5L2.5 8L6.5 6.5L8 2.5Z'
				: 'M3.5 2.2H11.5C12.05 2.2 12.5 2.65 12.5 3.2V12.8C12.5 13.35 12.05 13.8 11.5 13.8H3.5C2.95 13.8 2.5 13.35 2.5 12.8V3.2C2.5 2.65 2.95 2.2 3.5 2.2ZM5 5.5H10M5 8H10M5 10.5H8';
		p.setAttribute('d', d);
		p.setAttribute('stroke', 'currentColor');
	}
	p.setAttribute('stroke-width', '1.35');
	p.setAttribute('stroke-linecap', 'round');
	p.setAttribute('stroke-linejoin', 'round');
	svg.append(p);
	return svg;
}

export function buildGroupEntries(store: TabFlowStore, onSelectGroup: (groupId: string) => void): SpotCardEntry[] {
	const counts = new Map<string, number>();
	for (const gid of Object.values(store.state.assignments)) counts.set(gid, (counts.get(gid) || 0) + 1);
	return store.orderedGroups().map((g) => ({
		label: g.name,
		hint: `${counts.get(g.id) || 0} 篇`,
		iconKind: 'group' as const,
		badge: { text: g.name, color: g.color },
		run: () => onSelectGroup(g.id),
	}));
}

export function createSpotSectionButton(
	doc: Document,
	label: string,
	isCollapsed: boolean,
	onToggle: () => void,
): HTMLButtonElement {
	const el = (tag: string, cls?: string) => {
		const n = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
		if (cls) n.className = cls;
		return n;
	};
	const secBtn = el('button', 'ztf-spot-section-btn') as HTMLButtonElement;
	secBtn.type = 'button';
	secBtn.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');
	const secTitle = el('span');
	secTitle.textContent = label;
	const chevron = doc.createElementNS(SVG_NS, 'svg');
	chevron.setAttribute('viewBox', '0 0 16 16');
	chevron.setAttribute('class', 'ztf-spot-chevron');
	chevron.setAttribute('fill', 'none');
	const cp = doc.createElementNS(SVG_NS, 'path');
	cp.setAttribute('d', 'M4.5 6L8 9.5L11.5 6');
	cp.setAttribute('stroke', 'currentColor');
	cp.setAttribute('stroke-width', '1.6');
	cp.setAttribute('stroke-linecap', 'round');
	chevron.append(cp);
	secBtn.append(secTitle, chevron);
	secBtn.onclick = onToggle;
	return secBtn;
}

export function renderSpotEntryRow(
	doc: Document,
	entry: SpotCardEntry,
	active: boolean,
	onActivate: () => void,
): HTMLButtonElement {
	const el = (tag: string, cls?: string) => {
		const n = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
		if (cls) n.className = cls;
		return n;
	};
	const btn = el('button', `ztf-spot-row${active ? ' active' : ''}`) as HTMLButtonElement;
	btn.type = 'button';
	const main = el('span', 'ztf-spot-main');
	main.textContent = entry.label;
	btn.append(main, createSpotIcon(doc, entry.iconKind || 'article', entry.badge?.color));
	if (entry.subline) {
		const sub = el('div', 'ztf-spot-sub');
		sub.textContent = entry.subline;
		btn.append(sub);
	}
	if (entry.badge || entry.hint) {
		const metaRow = el('div', 'ztf-spot-meta-row');
		if (entry.badge) {
			const b = el('span', 'ztf-spot-badge');
			b.textContent = entry.badge.text;
			if (entry.badge.color && b.style) { b.style.color = entry.badge.color; b.style.background = `${entry.badge.color}1a`; }
			metaRow.append(b);
		}
		if (entry.hint) {
			const hint = el('span', 'ztf-spot-hint');
			hint.textContent = entry.hint;
			metaRow.append(hint);
		}
		btn.append(metaRow);
	}
	btn.onclick = onActivate;
	return btn;
}
