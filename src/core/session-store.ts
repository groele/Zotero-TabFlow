import { t } from './i18n.ts';
import type {
	SessionSnapshotKind,
	TabFlowState,
	TabRemark,
	TabSessionSnapshot,
	VirtualMemberMeta,
} from './types.ts';

export const MAX_MANUAL_SESSIONS = 30;
const MAX_ROLLING_SNAPSHOTS = 3;

export function buildSessionSnapshot(
	state: TabFlowState,
	name: string,
	openKeys: readonly string[],
	kind: SessionSnapshotKind = 'manual',
): TabSessionSnapshot {
	const cleanKeys = kind === 'template' ? [] : [...new Set(openKeys)];
	const assignments = kind === 'template' ? {} : { ...state.assignments };
	const pinned = kind === 'template' ? [] : [...state.pinned];
	const virtualMembers = kind === 'template' ? [] : Object.values(state.virtualMembers)
		.map(({ itemID, parentItemID, ...portable }) => portable);
	const relevantKeys = new Set([...cleanKeys, ...Object.keys(assignments), ...pinned]);
	const remarks: Record<string, TabRemark> = {};
	if (kind !== 'template') {
		for (const key of relevantKeys) {
			if (state.remarks[key]) remarks[key] = { ...state.remarks[key] };
		}
	}
	const now = Date.now();
	return {
		id: `${kind === 'rolling' ? 'rolling' : 's'}-${now}-${Math.random().toString(36).slice(2, 6)}`,
		name: name.trim().slice(0, 60) || t('zotero-tabflow-session-default-name', '工作区会话'),
		createdAt: now,
		groups: state.groups.map((g) => ({ ...g })),
		assignments,
		pinned,
		openKeys: cleanKeys,
		virtualMembers,
		order: [...state.order],
		collapsed: [...state.collapsed],
		remarks,
		ungroupedName: state.ungroupedName,
		ungroupedColor: state.ungroupedColor,
		ungroupedHeadingHidden: state.ungroupedHeadingHidden,
		kind,
	};
}

export function sessionLayoutFingerprint(snap: TabSessionSnapshot): string {
	return JSON.stringify({
		groups: snap.groups,
		assignments: snap.assignments,
		pinned: snap.pinned,
		openKeys: snap.openKeys,
		virtualMembers: snap.virtualMembers,
		order: snap.order,
		collapsed: snap.collapsed,
		remarks: snap.remarks,
		ungroupedName: snap.ungroupedName,
		ungroupedColor: snap.ungroupedColor,
		ungroupedHeadingHidden: snap.ungroupedHeadingHidden,
	});
}

export function appendManualSession(state: TabFlowState, snap: TabSessionSnapshot): void {
	state.sessions = [snap, ...state.sessions].slice(0, MAX_MANUAL_SESSIONS);
}

export function appendRollingSnapshot(state: TabFlowState, snap: TabSessionSnapshot): boolean {
	const current = state.rollingSessions ?? [];
	if (current[0] && sessionLayoutFingerprint(current[0]) === sessionLayoutFingerprint(snap)) {
		return false;
	}
	state.rollingSessions = [snap, ...current].slice(0, MAX_ROLLING_SNAPSHOTS);
	return true;
}

export function promoteRollingSnapshot(state: TabFlowState, id: string, customName?: string): TabSessionSnapshot | null {
	const current = state.rollingSessions ?? [];
	const idx = current.findIndex((s) => s.id === id);
	if (idx < 0) return null;
	const source = current[idx];
	const nextRolling = current.filter((s) => s.id !== id);
	state.rollingSessions = nextRolling;
	const now = Date.now();
	const promoted: TabSessionSnapshot = {
		...source,
		id: `s-${now}-${Math.random().toString(36).slice(2, 6)}`,
		name: customName?.trim().slice(0, 60) || source.name,
		createdAt: now,
		kind: 'manual',
	};
	appendManualSession(state, promoted);
	return promoted;
}

export function applySessionLayout(
	state: TabFlowState, snapshot: TabSessionSnapshot, merge: boolean, virtualMembers?: readonly VirtualMemberMeta[],
): void {
	const previousAssignments = state.assignments;
	const existing = new Set(state.groups.map((g) => g.id));
	const added = snapshot.groups.filter((g) => !merge || !existing.has(g.id));
	state.groups = [...(merge ? state.groups : []), ...added.map((g) => ({ ...g }))];
	const validIds = new Set(['', ...state.groups.map((g) => g.id)]);
	const order = [...(merge ? state.order : []), ...(snapshot.order ?? [])];
	state.order = [...new Set([...order.filter((id) => validIds.has(id)), ...validIds])];

	if (merge) {
		const addedIds = new Set(added.map((g) => g.id));
		state.collapsed = [...new Set([
			...state.collapsed,
			...(snapshot.collapsed ?? []).filter((id) => addedIds.has(id)),
		])];
		if (!state.ungroupedName && snapshot.ungroupedName) state.ungroupedName = snapshot.ungroupedName;
		if (state.ungroupedColor === '#737373' && snapshot.ungroupedColor) state.ungroupedColor = snapshot.ungroupedColor;
	} else {
		state.collapsed = (snapshot.collapsed ?? []).filter((id) => validIds.has(id));
		state.ungroupedName = snapshot.ungroupedName;
		state.ungroupedColor = snapshot.ungroupedColor ?? '#737373';
		state.ungroupedHeadingHidden = snapshot.ungroupedHeadingHidden === true;
	}

	if (!merge) state.assignments = {};
	for (const [key, id] of Object.entries(snapshot.assignments)) {
		const currentGroup = state.assignments[key] && state.groups.some((g) => g.id === state.assignments[key])
			? state.assignments[key]
			: '';
		if (id && validIds.has(id) && (!merge || !currentGroup)) state.assignments[key] = id;
	}
	if (snapshot.remarks) {
		for (const [key, r] of Object.entries(snapshot.remarks)) {
			if (!merge || !state.remarks[key]?.note) state.remarks[key] = { ...r };
		}
	}
	state.pinned = [...new Set([...(merge ? state.pinned : []), ...snapshot.pinned])];
	if (!merge && snapshot.kind !== 'template') {
		state.virtualMembers = Object.fromEntries(Object.entries(state.virtualMembers).filter(([key]) =>
			virtualMembers === undefined && (previousAssignments[key] || '') === (state.assignments[key] || ''),
		));
	}
	for (const member of virtualMembers ?? []) {
		if (!merge || !Object.hasOwn(state.virtualMembers, member.key)) state.virtualMembers[member.key] = member;
	}
}

export function formatSnapshotTimestamp(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return `${hh}:${mm}`;
}

export function buildGroupSessionSnapshot(
	state: TabFlowState,
	name: string,
	groupId: string,
	openKeys: readonly string[],
): TabSessionSnapshot {
	const targetGroup = groupId
		? state.groups.find((g) => g.id === groupId)
		: { id: `g-exp-${Date.now().toString(36)}`, name: state.ungroupedName || name.trim().slice(0, 60) || t('zotero-tabflow-saved-ungrouped-name', '未分组文献'), color: state.ungroupedColor || '#737373' };
	const exportedId = targetGroup?.id || groupId;
	const validIds = new Set(state.groups.map((g) => g.id));
	const belongs = (key: string) => (groupId ? state.assignments[key] === groupId : !validIds.has(state.assignments[key] || ''));
	const scopedOpen = [...new Set(openKeys)].filter(belongs);
	const scopedVirtual = Object.values(state.virtualMembers)
		.filter((m) => belongs(m.key))
		.map(({ itemID, parentItemID, ...portable }) => portable);
	const scopedKeys = new Set([...scopedOpen, ...scopedVirtual.map((m) => m.key)]);
	for (const k of Object.keys(state.assignments)) if (belongs(k)) scopedKeys.add(k);
	const assignments = Object.fromEntries([...scopedKeys].map((k) => [k, exportedId]));
	const remarks: Record<string, TabRemark> = {};
	for (const k of scopedKeys) if (state.remarks[k]) remarks[k] = { ...state.remarks[k] };
	const now = Date.now();
	return {
		id: `s-${now}-${Math.random().toString(36).slice(2, 6)}`,
		name: name.trim().slice(0, 60) || targetGroup?.name || t('zotero-tabflow-session-default-name', '工作区会话'),
		createdAt: now,
		groups: targetGroup ? [{ ...targetGroup, hidden: undefined }] : [],
		assignments,
		pinned: state.pinned.filter((k) => scopedKeys.has(k)),
		openKeys: scopedOpen,
		virtualMembers: scopedVirtual,
		order: targetGroup ? [targetGroup.id] : [],
		collapsed: [],
		remarks,
		kind: 'manual',
	};
}

export function updateExistingSession(state: TabFlowState, id: string, openKeys: readonly string[]): TabSessionSnapshot | null {
	const idx = state.sessions.findIndex((s) => s.id === id);
	if (idx < 0) return null;
	const current = state.sessions[idx];
	const next = buildSessionSnapshot(state, current.name, openKeys, current.kind === 'template' ? 'template' : 'manual');
	const updated: TabSessionSnapshot = { ...next, id: current.id, name: current.name };
	state.sessions[idx] = updated;
	return updated;
}

export function renameExistingSession(state: TabFlowState, id: string, name: string): boolean {
	const clean = name.trim().slice(0, 60);
	const target = clean ? state.sessions.find((s) => s.id === id) : null;
	if (!target) return false;
	target.name = clean;
	return true;
}

export function pruneHistory(
	state: TabFlowState,
	openKeys: readonly string[],
	maxOrphanEntries = 500,
	maxAgeMs = 180 * 86_400_000,
	now = Date.now(),
): number {
	const keep = new Set([
		...openKeys,
		...state.pinned,
		...Object.keys(state.virtualMembers),
		...Object.keys(state.assignments),
		...Object.keys(state.remarks),
	]);
	const cutoff = now - maxAgeMs;
	const orphans: Array<[string, number]> = [];
	let removed = 0;
	for (const [key, act] of Object.entries(state.history)) {
		if (keep.has(key)) continue;
		const ts = act?.lastViewed ?? act?.firstSeen ?? 0;
		if (!ts || ts < cutoff) {
			delete state.history[key];
			removed++;
		} else {
			orphans.push([key, ts]);
		}
	}
	if (orphans.length > maxOrphanEntries) {
		orphans.sort((a, b) => b[1] - a[1]);
		for (const [key] of orphans.slice(maxOrphanEntries)) {
			delete state.history[key];
			removed++;
		}
	}
	return removed;
}
