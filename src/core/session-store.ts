import { t } from './i18n.ts';
import type {
	SessionSnapshotKind,
	TabFlowState,
	TabRemark,
	TabSessionSnapshot,
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

export function applySessionLayout(state: TabFlowState, snapshot: TabSessionSnapshot, merge: boolean): void {
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
		if (snapshot.ungroupedName) state.ungroupedName = snapshot.ungroupedName;
		if (snapshot.ungroupedColor) state.ungroupedColor = snapshot.ungroupedColor;
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
}

export function formatSnapshotTimestamp(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	return `${hh}:${mm}`;
}
