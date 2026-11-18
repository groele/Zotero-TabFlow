import { t } from './i18n.ts';
import type {
	SessionSnapshotKind,
	TabFlowState,
	TabRemark,
	TabSessionSnapshot,
	VirtualMemberMeta,
} from './types.ts';

const MAX_MANUAL_SESSIONS = 30;
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
		ungroupedName: snap.ungroupedName,
		ungroupedColor: snap.ungroupedColor,
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
	} else {
		state.collapsed = (snapshot.collapsed ?? []).filter((id) => validIds.has(id));
		state.ungroupedName = snapshot.ungroupedName;
		state.ungroupedColor = snapshot.ungroupedColor ?? '#737373';
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
	if (!merge) {
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
