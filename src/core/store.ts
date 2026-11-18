import { normalizeHexColor } from './color-utils.ts';
import { PREF_PREFIX, getPref } from './prefs.ts';
import type {
	TabDisplayMode,
	TabFlowState,
	TabGroup,
	TabRemark,
	TabSessionSnapshot,
	VirtualMemberMeta,
} from './types.ts';

const STATE_PREF = `${PREF_PREFIX}state`;
const AUTO_COLORS = ['#3977d5', '#8b5ac7', '#21866a', '#dc8225', '#c74646', '#298c9b', '#d064a3'];

export function createEmptyState(): TabFlowState {
	return {
		version: 1,
		groups: [],
		assignments: {},
		ungroupedColor: '#737373',
		collapsed: [],
		order: [''],
		history: {},
		remarks: {},
		groupDisplay: {},
		pinned: [],
		sleeping: [],
		virtualMembers: {},
		sessions: [],
	};
}

export class TabFlowStore {
	state: TabFlowState = createEmptyState();
	readOnly = false;
	private listeners = new Set<() => void>();

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private notify(): void {
		for (const fn of this.listeners) fn();
	}

	load(): void {
		const raw = Zotero.Prefs.get(STATE_PREF, true);
		if (!raw || typeof raw !== 'string') return;
		try {
			const parsed = JSON.parse(raw) as Partial<TabFlowState>;
			if (parsed.version !== 1 || !Array.isArray(parsed.groups)) {
				throw new Error('Invalid Zotero TabFlow state');
			}
			const groups = parsed.groups.filter(
				(g) => g && typeof g.id === 'string' && g.id && typeof g.name === 'string' && /^#[0-9a-f]{6}$/i.test(g.color),
			);
			const validIds = new Set(['', ...groups.map((g) => g.id)]);
			this.state = {
				version: 1,
				groups,
				assignments: { ...(parsed.assignments ?? {}) },
				ungroupedColor: normalizeHexColor(parsed.ungroupedColor ?? '') ?? '#737373',
				ungroupedName: typeof parsed.ungroupedName === 'string' && parsed.ungroupedName.trim() ? parsed.ungroupedName.trim().slice(0, 60) : undefined,
				collapsed: [...new Set((parsed.collapsed ?? []).filter((id) => validIds.has(id)))],
				order: [...new Set([...(parsed.order ?? []).filter((id) => validIds.has(id)), ...validIds])],
				history: parsed.history && typeof parsed.history === 'object' ? { ...parsed.history } : {},
				remarks: parsed.remarks && typeof parsed.remarks === 'object' ? { ...parsed.remarks } : {},
				groupDisplay: parsed.groupDisplay && typeof parsed.groupDisplay === 'object' ? { ...parsed.groupDisplay } : {},
				pinned: [...new Set(Array.isArray(parsed.pinned) ? parsed.pinned : [])],
				sleeping: [...new Set(Array.isArray(parsed.sleeping) ? parsed.sleeping : [])],
				virtualMembers: parsed.virtualMembers && typeof parsed.virtualMembers === 'object' ? { ...parsed.virtualMembers } : {},
				sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
			};
			this.readOnly = false;
		} catch (error) {
			this.readOnly = true;
			Zotero.logError(error as Error);
		}
	}

	save(emit = true): void {
		if (this.readOnly) return;
		Zotero.Prefs.set(STATE_PREF, JSON.stringify(this.state), true);
		if (emit) this.notify();
	}

	clearAll(): void {
		this.readOnly = false;
		this.state = createEmptyState();
		this.save(true);
	}

	orderedGroups(): TabGroup[] {
		const all: TabGroup[] = [
			{ id: '', name: this.state.ungroupedName || '未分组', color: this.state.ungroupedColor || '#737373' },
			...this.state.groups,
		];
		const order = [...new Set([...(this.state.order || []), ...all.map((g) => g.id)])];
		return order.map((id) => all.find((g) => g.id === id)).filter((g): g is TabGroup => Boolean(g));
	}

	ensureGroup(name: string): TabGroup {
		const clean = name.trim().slice(0, 60);
		const existing = this.state.groups.find((g) => g.name === clean);
		if (existing) return existing;
		const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const group: TabGroup = { id, name: clean, color: AUTO_COLORS[this.state.groups.length % AUTO_COLORS.length] };
		this.state.groups.push(group);
		this.state.order = [...new Set([...this.state.order, id])];
		this.save();
		return group;
	}

	renameGroup(id: string, name: string): void {
		const clean = name.trim().slice(0, 60);
		if (!clean) return;
		if (!id) {
			this.state.ungroupedName = clean;
			this.save();
			return;
		}
		const g = this.state.groups.find((x) => x.id === id);
		if (!g) return;
		g.name = clean;
		this.save();
	}

	dissolveGroup(id: string): void {
		this.state.groups = this.state.groups.filter((g) => g.id !== id);
		for (const key of Object.keys(this.state.assignments)) {
			if (this.state.assignments[key] === id) delete this.state.assignments[key];
		}
		this.state.order = this.state.order.filter((x) => x !== id);
		this.state.collapsed = this.state.collapsed.filter((x) => x !== id);
		delete this.state.groupDisplay[id];
		this.save();
	}

	setGroupColor(id: string, rawColor: string): boolean {
		const color = normalizeHexColor(rawColor);
		if (!color) return false;
		if (!id) this.state.ungroupedColor = color;
		else {
			const g = this.state.groups.find((x) => x.id === id);
			if (!g) return false;
			g.color = color;
		}
		this.save();
		return true;
	}

	moveGroup(id: string, targetId: string, after = false): void {
		if (id === targetId) return;
		const ids = this.orderedGroups().map((g) => g.id);
		if (!ids.includes(id) || !ids.includes(targetId)) return;
		ids.splice(ids.indexOf(id), 1);
		ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, id);
		this.state.order = ids;
		this.save();
	}

	setCollapsed(id: string, collapsed: boolean, emit = true): void {
		const set = new Set(this.state.collapsed);
		if (collapsed) set.add(id);
		else set.delete(id);
		this.state.collapsed = [...set];
		this.save(emit);
	}

	groupOfKey(key: string | null): string {
		if (!key) return '';
		const id = this.state.assignments[key];
		return this.state.groups.some((g) => g.id === id) ? id : '';
	}

	assignKey(key: string, groupId: string): void {
		this.assignKeys([key], groupId);
	}

	assignKeys(keys: readonly string[], groupId: string): void {
		if (!keys.length) return;
		if (groupId && !this.state.groups.some((g) => g.id === groupId)) return;
		for (const key of keys) {
			if (groupId) this.state.assignments[key] = groupId;
			else delete this.state.assignments[key];
		}
		this.state.collapsed = this.state.collapsed.filter((id) => id !== groupId);
		this.save();
	}

	getRemark(key: string | null): TabRemark {
		const fallbackMode = getPref('remarkDisplayMode');
		if (!key) return { note: '', mode: fallbackMode };
		const r = this.state.remarks[key];
		const groupMode = this.state.groupDisplay[this.groupOfKey(key)] || fallbackMode;
		return {
			note: typeof r?.note === 'string' ? r.note : '',
			mode: r?.mode && ['original', 'note', 'both'].includes(r.mode) ? r.mode : groupMode,
		};
	}

	setRemark(key: string, note: string, mode?: TabDisplayMode): void {
		const clean = note.trim().slice(0, 300);
		const prev = this.getRemark(key);
		this.state.remarks[key] = { note: clean, mode: mode ?? (clean && prev.mode === 'original' ? 'both' : prev.mode) };
		this.save();
	}

	setDisplayMode(key: string, mode: TabDisplayMode): void {
		this.state.remarks[key] = { ...this.getRemark(key), mode };
		this.save();
	}

	isPinned(key: string): boolean { return this.state.pinned.includes(key); }

	setPinnedKeys(keys: readonly string[], pinned: boolean): void {
		if (!keys.length) return;
		const set = new Set(this.state.pinned);
		for (const key of keys) {
			if (pinned) set.add(key);
			else set.delete(key);
		}
		this.state.pinned = [...set];
		this.save();
	}

	togglePinned(key: string): boolean {
		const next = !this.isPinned(key);
		this.setPinnedKeys([key], next);
		return next;
	}

	isSleeping(key: string): boolean { return this.state.sleeping.includes(key); }
	setSleeping(key: string, sleeping: boolean): void {
		const set = new Set(this.state.sleeping);
		if (sleeping) set.add(key); else set.delete(key);
		this.state.sleeping = [...set];
		this.save();
	}

	saveVirtualMember(meta: VirtualMemberMeta): void { this.state.virtualMembers[meta.key] = meta; this.save(); }
	removeVirtualMember(key: string, emit = true): void {
		if (key in this.state.virtualMembers) { delete this.state.virtualMembers[key]; this.save(emit); }
	}

	saveSession(name: string, openKeys: string[]): TabSessionSnapshot {
		const snapshot: TabSessionSnapshot = {
			id: `s-${Date.now()}`,
			name: name.trim().slice(0, 60) || '工作区会话',
			createdAt: Date.now(),
			groups: this.state.groups.map((g) => ({ ...g })),
			assignments: { ...this.state.assignments },
			pinned: [...this.state.pinned],
			openKeys: [...new Set(openKeys)],
			order: [...this.state.order],
			collapsed: [...this.state.collapsed],
		};
		this.state.sessions = [snapshot, ...this.state.sessions].slice(0, 30);
		this.save();
		return snapshot;
	}

	deleteSession(id: string): void {
		this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
		this.save();
	}

	restoreSessionLayout(snapshot: TabSessionSnapshot, merge: boolean): void {
		const existing = new Set(this.state.groups.map((g) => g.id));
		const added = snapshot.groups.filter((g) => !merge || !existing.has(g.id));
		this.state.groups = [...(merge ? this.state.groups : []), ...added.map((g) => ({ ...g }))];
		const validIds = new Set(['', ...this.state.groups.map((g) => g.id)]);
		const order = [...(merge ? this.state.order : []), ...(snapshot.order ?? [])];
		this.state.order = [...new Set([...order.filter((id) => validIds.has(id)), ...validIds])];
		if (merge) {
			const addedIds = new Set(added.map((g) => g.id));
			this.state.collapsed = [...new Set([
				...this.state.collapsed,
				...(snapshot.collapsed ?? []).filter((id) => addedIds.has(id)),
			])];
		} else {
			this.state.collapsed = (snapshot.collapsed ?? []).filter((id) => validIds.has(id));
		}

		if (!merge) this.state.assignments = {};
		for (const [key, id] of Object.entries(snapshot.assignments)) {
			if (id && validIds.has(id) && (!merge || !this.groupOfKey(key))) this.state.assignments[key] = id;
		}
		this.state.pinned = [...new Set([...(merge ? this.state.pinned : []), ...snapshot.pinned])];
		this.save();
	}
}
