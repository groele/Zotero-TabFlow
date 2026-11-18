import { normalizeHexColor } from './color-utils.ts';
import { t } from './i18n.ts';
import { PREF_PREFIX, getPref } from './prefs.ts';
import {
	appendManualSession,
	appendRollingSnapshot,
	applySessionLayout,
	buildSessionSnapshot,
	formatSnapshotTimestamp,
} from './session-store.ts';
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
		rollingSessions: [],
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
				rollingSessions: Array.isArray(parsed.rollingSessions) ? parsed.rollingSessions : [],
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
			{ id: '', name: this.state.ungroupedName || t('zotero-tabflow-ungrouped', '未分组'), color: this.state.ungroupedColor || '#737373' },
			...this.state.groups,
		];
		const order = [...new Set([...(this.state.order || []), ...all.map((g) => g.id)])];
		return order.map((id) => all.find((g) => g.id === id)).filter((g): g is TabGroup => Boolean(g));
	}

	visibleGroups(): TabGroup[] {
		const groups = this.orderedGroups();
		return getPref('enableGroupHiding') ? groups.filter((group) => group.hidden !== true) : groups;
	}
	hiddenGroups(): TabGroup[] {
		return getPref('enableGroupHiding') ? this.orderedGroups().filter((group) => group.hidden === true) : [];
	}

	setGroupHidden(id: string, hidden: boolean, members: readonly VirtualMemberMeta[] = []): void {
		const group = this.state.groups.find((candidate) => candidate.id === id);
		if (!group || (group.hidden === true) === hidden || this.readOnly) return;
		if (hidden) {
			group.hidden = true;
			for (const member of members) this.state.virtualMembers[member.key] = member;
		} else delete group.hidden;
		this.save();
	}

	hideNamedUngrouped(openKeys: readonly string[], members: readonly VirtualMemberMeta[] = []): void {
		const originalName = this.state.ungroupedName;
		if (!originalName || this.readOnly) return;
		const keys = [...new Set([...openKeys, ...Object.keys(this.state.virtualMembers)])].filter((key) => !this.groupOfKey(key));
		if (!keys.length) return;
		let name = originalName;
		for (let i = 2; this.state.groups.some((g) => g.name === name); i++) {
			const suffix = ` (${i})`;
			name = originalName.slice(0, 60 - suffix.length) + suffix;
		}
		const group = this.addGroup(name, this.state.ungroupedColor);
		group.hidden = true;
		for (const key of keys) this.state.assignments[key] = group.id;
		for (const member of members) this.state.virtualMembers[member.key] = member;
		if (this.state.collapsed.includes('')) this.state.collapsed = [...this.state.collapsed.filter(Boolean), group.id];
		if (this.state.groupDisplay['']) this.state.groupDisplay[group.id] = this.state.groupDisplay[''];
		delete this.state.ungroupedName;
		this.save();
	}

	ensureGroup(name: string): TabGroup {
		const clean = name.trim().slice(0, 60) || t('zotero-tabflow-default-group-name', '新分组');
		const existing = this.state.groups.find((g) => g.name === clean);
		if (existing) return existing;
		const group = this.addGroup(clean, AUTO_COLORS[this.state.groups.length % AUTO_COLORS.length]);
		this.save();
		return group;
	}

	private addGroup(name: string, color: string): TabGroup {
		const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const group: TabGroup = { id, name, color };
		this.state.groups.push(group);
		this.state.order = [...new Set([...this.state.order, id])];
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
		const snapshot = buildSessionSnapshot(this.state, name || t('zotero-tabflow-session-default-name', '工作区会话'), openKeys, 'manual');
		appendManualSession(this.state, snapshot);
		this.save();
		return snapshot;
	}

	savePreReplaceSnapshot(openKeys: string[]): TabSessionSnapshot {
		const stamp = formatSnapshotTimestamp(Date.now());
		const label = `${t('zotero-tabflow-session-pre-replace-prefix', '替换前备份')} · ${stamp}`;
		const snapshot = buildSessionSnapshot(this.state, label, openKeys, 'pre-replace');
		appendManualSession(this.state, snapshot);
		this.save();
		return snapshot;
	}

	saveLayoutTemplate(name: string): TabSessionSnapshot {
		const snapshot = buildSessionSnapshot(this.state, name || t('zotero-tabflow-template-default-name', '布局模板'), [], 'template');
		appendManualSession(this.state, snapshot);
		this.save();
		return snapshot;
	}

	saveRollingSnapshot(openKeys: string[]): TabSessionSnapshot | null {
		if (!getPref('enableRollingSnapshots')) return null;
		const stamp = formatSnapshotTimestamp(Date.now());
		const label = `${t('zotero-tabflow-rolling-prefix', '自动快照')} · ${stamp}`;
		const snapshot = buildSessionSnapshot(this.state, label, openKeys, 'rolling');
		if (!appendRollingSnapshot(this.state, snapshot)) return null;
		this.save(false);
		return snapshot;
	}

	importSessions(snapshots: readonly TabSessionSnapshot[]): number {
		let count = 0;
		for (const snap of [...snapshots].reverse()) {
			if (!snap || typeof snap.name !== 'string' || !Array.isArray(snap.groups)) continue;
			const copy: TabSessionSnapshot = {
				...snap,
				id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
				kind: snap.kind || 'manual',
			};
			appendManualSession(this.state, copy);
			count++;
		}
		if (count) this.save();
		return count;
	}

	deleteSession(id: string): void {
		this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
		if (this.state.rollingSessions?.length) {
			this.state.rollingSessions = this.state.rollingSessions.filter((s) => s.id !== id);
		}
		this.save();
	}

	restoreSessionLayout(snapshot: TabSessionSnapshot, merge: boolean): void {
		applySessionLayout(this.state, snapshot, merge);
		this.save();
	}
}
