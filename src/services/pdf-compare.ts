import { resolveAllPdfAttachments, type PdfAttachmentEntry } from './pdf-preview-renderer.ts';

export type CompareMode = 'sibling' | 'self';

export interface SameItemPdfContext {
	currentAttachmentID: number;
	entries: PdfAttachmentEntry[];
}

function isAttachmentLike(item: any): boolean {
	if (!item) return false;
	if (typeof item.isAttachment === 'function') return Boolean(item.isAttachment());
	if (typeof item.isPDFAttachment === 'function') return Boolean(item.isPDFAttachment());
	return item.itemType === 'attachment';
}

async function resolveParentItem(item: any): Promise<any> {
	if (!item || !isAttachmentLike(item)) return item;
	if (item.parentItem) return item.parentItem;
	const parentID = Number(item.parentID || item.parentItemID || 0);
	if (!parentID) return item;
	try {
		const parent = Zotero.Items?.getAsync
			? await Zotero.Items.getAsync(parentID)
			: Zotero.Items?.get?.(parentID);
		return parent || item;
	} catch {
		return item;
	}
}

export async function resolveSameItemPdfContext(item: any): Promise<SameItemPdfContext> {
	if (!item || item.deleted || item.isTrashed?.()) {
		return { currentAttachmentID: 0, entries: [] };
	}
	const currentAttachmentID = isAttachmentLike(item) ? (Number(item.id) || 0) : 0;
	const container = await resolveParentItem(item);
	const entries = await resolveAllPdfAttachments(container);
	if (!entries.length && isAttachmentLike(item)) {
		const fallback = await resolveAllPdfAttachments(item);
		return { currentAttachmentID, entries: fallback };
	}
	return { currentAttachmentID, entries };
}

export function pickCompareAttachment(
	ctx: SameItemPdfContext,
	mode: CompareMode,
	explicitAttachmentID: number | null,
): PdfAttachmentEntry | null {
	if (!ctx.entries.length) return null;
	if (ctx.entries.length === 1) return ctx.entries[0];
	if (explicitAttachmentID) {
		const exact = ctx.entries.find((e) => e.id === explicitAttachmentID);
		if (exact) return exact;
	}
	if (mode === 'self' && ctx.currentAttachmentID) {
		return ctx.entries.find((e) => e.id === ctx.currentAttachmentID) ?? ctx.entries[0];
	}
	if (ctx.currentAttachmentID) {
		return ctx.entries.find((e) => e.id !== ctx.currentAttachmentID) ?? ctx.entries[0];
	}
	return ctx.entries[0];
}
