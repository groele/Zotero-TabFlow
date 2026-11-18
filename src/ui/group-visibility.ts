/** Empty default ungrouped headings add no useful context beside named groups. */
export function shouldRenderGroupHeading(
	groupId: string,
	hasOpenMembers: boolean,
	hasVirtualMembers: boolean,
	hasCustomName: boolean,
): boolean {
	return Boolean(groupId || hasCustomName || hasOpenMembers || hasVirtualMembers);
}

export function indexGroupMembers<T>(members: readonly T[], groupOf: (member: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const member of members) {
		const groupId = groupOf(member);
		const bucket = groups.get(groupId);
		if (bucket) bucket.push(member);
		else groups.set(groupId, [member]);
	}
	return groups;
}
