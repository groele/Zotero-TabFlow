import type { TabFlowStore } from '../core/store.ts';
import { isUsableSession } from '../core/session-validation.ts';
import type { TabSessionSnapshot, TrackedTab, VirtualMemberMeta } from '../core/types.ts';

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
	virtualMembers?: VirtualMemberMeta[];
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

export type ItemKeyResolver = (libraryID: number, itemKey: string) => Promise<{ id: number; parentItemID?: number | false | null; deleted?: boolean; getField?: (f: string) => string } | null>;

const SESSION_LOOKUP_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const worker = async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await map(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

const defaultResolver: ItemKeyResolver = async (libraryID, itemKey) => {
	try {
		const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
		return item || null;
	} catch {
		return null;
	}
};

export function parseItemFullKey(fullKey: string): { libraryID: number; itemKey: string } | null {
	if (typeof fullKey !== 'string') return null;
	const [libStr, itemKey, extra] = fullKey.split(':');
	const libraryID = Number(libStr);
	if (!Number.isInteger(libraryID) || libraryID <= 0 || !itemKey || extra !== undefined) return null;
	return { libraryID, itemKey };
}

function sessionVirtualMembers(session: TabSessionSnapshot) {
	return session.kind !== 'template' && Array.isArray(session.virtualMembers)
		? session.virtualMembers.filter((member) => member && typeof member.key === 'string' && typeof member.title === 'string')
		: [];
}

export async function buildSessionRestorePlan(
	store: TabFlowStore,
	openKeysNow: readonly string[],
	session: TabSessionSnapshot,
	merge: boolean,
	resolver: ItemKeyResolver = defaultResolver,
	onProgress?: (completed: number, total: number) => void,
	signal?: AbortSignal,
): Promise<SessionRestorePlan> {
	const openSet = new Set(openKeysNow);
	let alreadyOpenCount = 0;
	const toOpen: SessionRestoreItemRef[] = [];
	const missing: SessionRestoreItemRef[] = [];
	const virtualMembers: VirtualMemberMeta[] | undefined =
		Array.isArray(session.virtualMembers) || session.kind === 'template' ? [] : undefined;
	const resolved = new Map<string, Awaited<ReturnType<ItemKeyResolver>>>();
	const openEntries = [...new Set(session.openKeys)];
	alreadyOpenCount = openEntries.filter((key) => openSet.has(key)).length;
	const members = sessionVirtualMembers(session);
	const total = openEntries.filter((key) => !openSet.has(key)).length
		+ [...new Set(members.map((member) => member.key))].filter((key) => !openEntries.includes(key)).length;
	let completed = 0;
	onProgress?.(completed, total);
	const lookupEntries = openEntries.filter((key) => !openSet.has(key));
	const resolvedOpen = await mapWithConcurrency(lookupEntries, SESSION_LOOKUP_CONCURRENCY, async (fullKey) => {
		if (signal?.aborted) throw new DOMException('Session restore planning canceled', 'AbortError');
		const parsed = parseItemFullKey(fullKey);
		const item = parsed ? await resolver(parsed.libraryID, parsed.itemKey) : null;
		resolved.set(fullKey, item);
		completed++;
		onProgress?.(completed, total);
		return { fullKey, parsed, item };
	});
	for (const { fullKey, parsed, item } of resolvedOpen) {
		if (!parsed) {
			missing.push({ fullKey, libraryID: 0, itemKey: fullKey });
			continue;
		}
		if (item && !item.deleted) {
			toOpen.push({ fullKey, ...parsed, itemID: item.id, title: item.getField?.('title') || fullKey });
		} else {
			missing.push({ fullKey, ...parsed });
		}
	}
	const missingKeys = new Set(missing.map((ref) => ref.fullKey));
	const seenVirtualKeys = new Set<string>();
	const memberKeys = new Set<string>();
	const uniqueMembers = members.filter((member) => {
		if (memberKeys.has(member.key)) return false;
		memberKeys.add(member.key);
		return true;
	});
	const resolvedMembers = await mapWithConcurrency(uniqueMembers, SESSION_LOOKUP_CONCURRENCY, async (member) => {
		if (signal?.aborted) throw new DOMException('Session restore planning canceled', 'AbortError');
		if (resolved.has(member.key)) return { member, ref: parseItemFullKey(member.key), item: resolved.get(member.key) };
		const ref = parseItemFullKey(member.key);
		const item = ref ? await resolver(ref.libraryID, ref.itemKey) : null;
		resolved.set(member.key, item);
		completed++;
		onProgress?.(completed, total);
		return { member, ref, item };
	});
	for (const { member, ref, item } of resolvedMembers) {
		const fullKey = member.key;
		if (seenVirtualKeys.has(fullKey)) continue;
		seenVirtualKeys.add(fullKey);
		if (item && !item.deleted) {
			virtualMembers?.push({ ...member, itemID: item.id, parentItemID: item.parentItemID || null });
		} else if (!missingKeys.has(fullKey)) {
			missing.push({ fullKey, ...(ref ?? { libraryID: 0, itemKey: fullKey }), title: member.title });
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
		virtualMembers,
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
	openItem: (itemID: number) => Promise<void | boolean>,
	openKeysNow: readonly string[],
	isDisposed: () => boolean = () => false,
): Promise<{ opened: number; failed: number }> {
	const result = { opened: 0, failed: 0 };
	if (isDisposed()) return result;
	if (store.readOnly) throw new Error('TabFlow state is read-only');
	const openKeys = new Set(openKeysNow);
	if (!plan.merge && plan.session.kind !== 'pre-replace') {
		store.savePreReplaceSnapshot([...openKeysNow]);
	}
	store.restoreSessionLayout(plan.session, plan.merge, plan.virtualMembers);
	for (const ref of plan.toOpen) {
		if (isDisposed()) break;
		if (!ref.itemID || openKeys.has(ref.fullKey)) continue;
		try {
			if (await openItem(ref.itemID) === false) result.failed++;
			else result.opened++;
		} catch (error) {
			result.failed++;
			Zotero.logError(error as Error);
		}
	}
	return result;
}

export function buildPublicationGroupSuggestions(store: TabFlowStore, tracked: readonly TrackedTab[]): PublicationGroupSuggestion[] {
	const visibleGroups = new Map(store.visibleGroups().filter((g) => g.id).map((g) => [g.name, g.id]));
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
		.filter(([venue, b]) => visibleGroups.has(venue) || b.keys.length >= 2)
		.map(([venue, b]) => ({
			venue,
			keys: b.keys,
			titles: b.titles,
			existingGroupId: visibleGroups.get(venue),
		}))
		.sort((a, b) => b.keys.length - a.keys.length);
}

export function applyPublicationGroupSuggestions(store: TabFlowStore, chosen: readonly PublicationGroupSuggestion[]): void {
	for (const suggestion of chosen) {
		const visible = store.visibleGroups().find((group) => group.id && group.name === suggestion.venue);
		const keys = suggestion.keys.filter((key) => !store.groupOfKey(key));
		if (!keys.length) continue;
		const group = visible ?? store.ensureGroup(suggestion.venue);
		store.assignKeys(keys, group.id);
	}
}

export function exportSessionsJson(sessions: readonly TabSessionSnapshot[], pluginVersion: string): string {
	return JSON.stringify({
		format: 'zotero-tabflow-session',
		schemaVersion: 1,
		exportedAt: Date.now(),
		sourcePluginVersion: pluginVersion || undefined,
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
	if (!parsed.sessions.length || !parsed.sessions.every(isUsableSession)) {
		throw new Error('Session archive is empty or contains an invalid session');
	}
	const sessions = parsed.sessions;
	const checked = new Set<string>();
	const missing: SessionRestoreItemRef[] = [];
	let resolvableCount = 0;

	for (const s of sessions) {
		for (const fullKey of [...s.openKeys, ...sessionVirtualMembers(s).map((member) => member.key)]) {
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
