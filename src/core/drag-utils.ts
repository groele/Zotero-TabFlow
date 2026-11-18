export function computeNativeTabMoveTarget(
	tabIds: readonly string[],
	draggedId: string,
	targetId: string,
	after: boolean,
): number {
	const from = tabIds.indexOf(draggedId);
	const to = tabIds.indexOf(targetId);
	if (from < 0 || to < 0 || from === to) return -1;
	let targetIdx = after ? to + 1 : to;
	if (from < targetIdx) targetIdx -= 1;
	return Math.max(0, Math.min(tabIds.length - 1, targetIdx));
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
