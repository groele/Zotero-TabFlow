import type { TabSessionSnapshot } from './types.ts';

function record(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isUsableSession(value: unknown): value is TabSessionSnapshot {
	if (!record(value)) return false;
	const { groups, assignments, pinned, openKeys, order, collapsed, virtualMembers, remarks } = value;
	if (typeof value.id !== 'string' || typeof value.name !== 'string' || !Number.isFinite(value.createdAt)) return false;
	if (!strings(openKeys) || !strings(pinned) || !record(assignments)) return false;
	if (!Array.isArray(groups) || !groups.every((group) => record(group) && typeof group.id === 'string' && group.id
		&& typeof group.name === 'string' && typeof group.color === 'string' && /^#[\da-f]{6}$/i.test(group.color))) return false;
	const groupIDs = new Set(groups.map((group) => group.id));
	if (groupIDs.size !== groups.length || !Object.values(assignments).every((id) => typeof id === 'string')) return false;
	if ((order !== undefined && !strings(order)) || (collapsed !== undefined && !strings(collapsed))) return false;
	if (virtualMembers !== undefined && (!Array.isArray(virtualMembers) || !virtualMembers.every((member) =>
		record(member) && ['key', 'title', 'shortTitle', 'filename', 'source', 'creatorYear', 'collection', 'type'].every((key) => typeof member[key] === 'string')))) return false;
	if (remarks !== undefined && (!record(remarks) || !Object.values(remarks).every((remark) =>
		record(remark) && typeof remark.note === 'string' && ['original', 'note', 'both'].some((mode) => mode === remark.mode)))) return false;
	return true;
}
