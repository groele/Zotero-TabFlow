import type { TabFlowStore } from '../core/store.ts';
import type { TabSessionSnapshot, TrackedTab } from '../core/types.ts';

export interface SessionRestoreItemRef {
	fullKey: string;
	libraryID: number;
	itemKey: string;
	itemID?: number;
	title?: string;
}

export interface SessionRestorePlan {
	session: TabSessionSnapshot;
	merge: boolean;
	alreadyOpenCount: number;
	toOpen: SessionRestoreItemRef[];
	missing: SessionRestoreItemRef[];
	reassignedCount: number;
	pinAdded: string[];
	pinRemoved: string[];
	newGroupsCount: number;
	replacingGroupsCount: number;
}

export interface SessionImportPreview {
	sessions: TabSessionSnapshot[];
	totalEntries: number;
	resolvableCount: number;
	missing: SessionRestoreItemRef[];
}

export interface PublicationGroupSuggestion {
	venue: string;
	keys: string[];
	titles: string[];
	existingGroupId?: string;
}

export type ItemKeyResolver = (libraryID: number, itemKey: string) => Promise<{ id: number; deleted?: boolean; getField?: (f: string) => string } | null>;

const defaultResolver: ItemKeyResolver = async (libraryID, itemKey) => {
	try {
		const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
		return item || null;
	} catch {
		return null;
	}
};

export function parseItemFullKey(fullKey: string): { libraryID: number; itemKey: string } | null {
	const [libStr, itemKey] = fullKey.split(':');
	const libraryID = Number(libStr);
	if (!Number.isInteger(libraryID) || libraryID <= 0 || !itemKey) return null;
	return { libraryID, itemKey };
}

export async function buildSessionRestorePlan(
	store: TabFlowStore,
	openKeysNow: readonly string[],
	session: TabSessionSnapshot,
	merge: boolean,
	resolver: ItemKeyResolver = defaultResolver,
): Promise<SessionRestorePlan> {
	const openSet = new Set(openKeysNow);
	let alreadyOpenCount = 0;
	const toOpen: SessionRestoreItemRef[] = [];
	const missing: SessionRestoreItemRef[] = [];

	for (const fullKey of session.openKeys) {
		if (openSet.has(fullKey)) {
			alreadyOpenCount++;
			continue;
		}
		const parsed = parseItemFullKey(fullKey);
		if (!parsed) {
			missing.push({ fullKey, libraryID: 0, itemKey: fullKey });
			continue;
		}
		const item = await resolver(parsed.libraryID, parsed.itemKey);
		if (item && !item.deleted) {
			toOpen.push({ fullKey, ...parsed, itemID: item.id, title: item.getField?.('title') || fullKey });
		} else {
			missing.push({ fullKey, ...parsed });
		}
	}

	const existingGroupIds = new Set(store.state.groups.map((g) => g.id));
	const newGroupsCount = session.groups.filter((g) => !merge || !existingGroupIds.has(g.id)).length;
	const replacingGroupsCount = merge ? 0 : store.state.groups.length;
	const nextValidIds = new Set([
		'',
		...(merge ? store.state.groups : []).map((g) => g.id),
		...session.groups.map((g) => g.id),
	]);

	let reassignedCount = 0;
	const trackedKeys = new Set([...openKeysNow, ...session.openKeys, ...Object.keys(store.state.assignments), ...Object.keys(session.assignments)]);
	for (const key of trackedKeys) {
		const cur = store.groupOfKey(key);
		const snapTarget = session.assignments[key];
		const validSnap = snapTarget && nextValidIds.has(snapTarget) ? snapTarget : '';
		const next = merge ? (cur || validSnap) : validSnap;
		if (next !== cur) reassignedCount++;
	}

	const curPinned = new Set(store.state.pinned);
	const nextPinned = merge ? new Set([...curPinned, ...session.pinned]) : new Set(session.pinned);
	const pinAdded = [...nextPinned].filter((k) => !curPinned.has(k));
	const pinRemoved = [...curPinned].filter((k) => !nextPinned.has(k));

	return {
		session,
		merge,
		alreadyOpenCount,
		toOpen,
		missing,
		reassignedCount,
		pinAdded,
		pinRemoved,
		newGroupsCount,
		replacingGroupsCount,
	};
}

export async function executeSessionRestorePlan(
	plan: SessionRestorePlan,
	store: TabFlowStore,
	openItem: (itemID: number) => Promise<void>,
	openKeysNow: readonly string[],
	isDisposed: () => boolean = () => false,
): Promise<void> {
	if (!plan.merge && plan.session.kind !== 'pre-replace') {
		store.savePreReplaceSnapshot([...openKeysNow]);
	}
	store.restoreSessionLayout(plan.session, plan.merge);
	for (const ref of plan.toOpen) {
		if (isDisposed() || !ref.itemID) return;
		try {
			await openItem(ref.itemID);
		} catch (error) {
			Zotero.logError(error as Error);
		}
	}
}

export function buildPublicationGroupSuggestions(store: TabFlowStore, tracked: readonly TrackedTab[]): PublicationGroupSuggestion[] {
	const buckets = new Map<string, { keys: string[]; titles: string[] }>();
	for (const t of tracked) {
		if (t.groupId || t.pinned || !t.source.trim()) continue;
		const venue = t.source.trim().slice(0, 60);
		const bucket = buckets.get(venue) || { keys: [], titles: [] };
		if (!bucket.keys.includes(t.key)) {
			bucket.keys.push(t.key);
			bucket.titles.push(t.title);
		}
		buckets.set(venue, bucket);
	}
	return [...buckets.entries()]
		.filter(([venue, b]) => b.keys.length >= 2 || store.state.groups.some((g) => g.name === venue))
		.map(([venue, b]) => ({
			venue,
			keys: b.keys,
			titles: b.titles,
			existingGroupId: store.state.groups.find((g) => g.name === venue)?.id,
		}))
		.sort((a, b) => b.keys.length - a.keys.length);
}

export function exportSessionsJson(sessions: readonly TabSessionSnapshot[], pluginVersion: string): string {
	return JSON.stringify({
		format: 'zotero-tabflow-session',
		schemaVersion: 1,
		exportedAt: Date.now(),
		sourcePluginVersion: pluginVersion || '17.2.0',
		sessions,
	}, null, 2);
}

export async function parseAndPreviewSessionImport(
	jsonText: string,
	resolver: ItemKeyResolver = defaultResolver,
): Promise<SessionImportPreview> {
	const parsed = JSON.parse(jsonText) as { format?: string; schemaVersion?: number; sessions?: unknown };
	if (!parsed || parsed.format !== 'zotero-tabflow-session' || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions)) {
		throw new Error('Invalid TabFlow session archive format');
	}
	const sessions = parsed.sessions.filter(
		(s): s is TabSessionSnapshot => Boolean(s && typeof (s as TabSessionSnapshot).name === 'string' && Array.isArray((s as TabSessionSnapshot).groups) && Array.isArray((s as TabSessionSnapshot).openKeys)),
	);
	const checked = new Set<string>();
	const missing: SessionRestoreItemRef[] = [];
	let resolvableCount = 0;

	for (const s of sessions) {
		for (const fullKey of s.openKeys) {
			if (checked.has(fullKey)) continue;
			checked.add(fullKey);
			const ref = parseItemFullKey(fullKey);
			if (!ref) {
				missing.push({ fullKey, libraryID: 0, itemKey: fullKey });
				continue;
			}
			const item = await resolver(ref.libraryID, ref.itemKey);
			if (item && !item.deleted) resolvableCount++;
			else missing.push({ fullKey, ...ref });
		}
	}
	return { sessions, totalEntries: checked.size, resolvableCount, missing };
}
