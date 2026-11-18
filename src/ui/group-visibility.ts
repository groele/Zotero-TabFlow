/** Empty default ungrouped headings add no useful context beside named groups. */
export function shouldRenderGroupHeading(
	groupId: string,
	hasOpenMembers: boolean,
	hasVirtualMembers: boolean,
	hasCustomName: boolean,
): boolean {
	return Boolean(groupId || hasCustomName || hasOpenMembers || hasVirtualMembers);
}
