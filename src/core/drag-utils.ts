export function computeNativeTabMoveTarget(
	tabIds: readonly string[],
	draggedId: string,
	targetId: string,
	after: boolean,
): number {
	const from = tabIds.indexOf(draggedId);
	const to = tabIds.indexOf(targetId);
	if (from < 1 || to < 0 || from === to) return -1;
	// Zotero.move takes a boundary in the original list and adjusts it after removal.
	return Math.max(1, to + (after ? 1 : 0));
}

export const TABFLOW_DRAG_MIME = 'application/x-zotero-tabflow-tab';

function hasMimeType(
	dt: { types?: Iterable<string> | { contains?: (type: string) => boolean } } | null | undefined,
	mime: string,
): boolean {
	const types = dt?.types as { contains?: (type: string) => boolean; [Symbol.iterator]?: () => Iterator<string> } | undefined;
	if (!types) return false;
	if (typeof types.contains === 'function' && types.contains(mime)) return true;
	return typeof types[Symbol.iterator] === 'function' && Array.from(types as Iterable<string>).includes(mime);
}

export function hasTabFlowDraggedTab(
	dt: { types?: Iterable<string> | { contains?: (type: string) => boolean }; getData?: (type: string) => string } | null | undefined,
): boolean {
	return hasMimeType(dt, TABFLOW_DRAG_MIME) || Boolean(dt?.getData?.(TABFLOW_DRAG_MIME));
}

export function hasZoteroDraggedItems(
	dt: { types?: Iterable<string> | { contains?: (type: string) => boolean }; getData?: (type: string) => string } | null | undefined,
): boolean {
	if (!dt) return false;
	if (hasMimeType(dt, 'zotero/item')) return true;
	return parseZoteroDraggedItemIDs(dt).length > 0;
}

export function parseZoteroDraggedItemIDs(dt: { getData?: (type: string) => string } | null | undefined): number[] {
	if (!dt?.getData) return [];
	const raw = dt.getData('zotero/item') || '';
	if (!raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return [...new Set(parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
		}
	} catch {
		// Fall through to comma-separated format used by Zotero item trees
	}
	return [...new Set(raw.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}
