import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';
import { formatSnapshotTimestamp, promoteRollingSnapshot, renameExistingSession, updateExistingSession } from '../core/session-store.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { TabGroup, TabSessionSnapshot } from '../core/types.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';

export interface WorkspaceHubCounts {
	sessions: number;
	hidden: number;
	rolling: number;
	total: number;
}

export function computeWorkspaceHubCounts(store: TabFlowStore): WorkspaceHubCounts {
	const sessionsEnabled = getPref('enableSessions');
	const sessions = sessionsEnabled ? store.state.sessions.length : 0;
	const rolling = sessionsEnabled ? (store.state.rollingSessions?.length ?? 0) : 0;
	const hidden = store.hiddenGroups().length;
	return { sessions, hidden, rolling, total: sessions + hidden };
}

export interface WorkspaceHubCallbacks {
	onPreviewRestore: (session: TabSessionSnapshot) => void;
	onQuickMerge: (session: TabSessionSnapshot) => void;
	onExportSessions: () => void;
	onImportSessions: () => void;
	onRefresh: () => void;
}

export class WorkspaceHubController {
	private readonly win: Window;
	private readonly doc: Document;
	private readonly store: TabFlowStore;
	private readonly meta: ItemMetadataService;
	private readonly actions: TabActionService;
	private readonly callbacks: WorkspaceHubCallbacks;
	private overlay: HTMLDivElement | null = null;
	private bodyEl: HTMLDivElement | null = null;
	private nameInput: HTMLInputElement | null = null;
	private returnFocus: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(
		win: Window,
		doc: Document,
		store: TabFlowStore,
		meta: ItemMetadataService,
		actions: TabActionService,
		callbacks: WorkspaceHubCallbacks,
	) {
		this.win = win;
		this.doc = doc;
		this.store = store;
		this.meta = meta;
		this.actions = actions;
		this.callbacks = callbacks;
	}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	private btn(label: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
		const b = this.h('button', cls);
		b.type = 'button';
		b.textContent = label;
		b.disabled = disabled;
		b.onclick = onClick;
		return b;
	}

	open(anchor?: HTMLElement): void {
		this.dispose();
		const host = this.doc.body || this.doc.documentElement;
		if (!host) return;
		const backdrop = this.h('div');
		backdrop.id = 'ztf-hub-backdrop';
		backdrop.setAttribute('role', 'dialog');
		backdrop.setAttribute('aria-modal', 'true');
		backdrop.setAttribute('aria-labelledby', 'ztf-hub-title');

		const box = this.h('div', 'ztf-hub-box');
		const header = this.h('div', 'ztf-hub-head');
		const title = this.h('div', 'ztf-hub-title');
		title.id = 'ztf-hub-title';
		title.textContent = t('zotero-tabflow-hub-title', 'TabFlow 工作区（会话与隐藏项目）');
		const closeBtn = this.btn('✕', 'ztf-hub-close', () => this.dispose());
		closeBtn.setAttribute('aria-label', t('zotero-tabflow-toolbar-close-workspace', '关闭工作区'));
		header.append(title, closeBtn);

		const body = this.h('div', 'ztf-hub-body');
		const status = this.h('div', 'ztf-hub-status');
		status.setAttribute('role', 'status');
		status.tabIndex = -1;
		box.append(header, body, status);
		backdrop.append(box);
		backdrop.addEventListener('click', (e: MouseEvent) => { if (e.target === backdrop) this.dispose(); });
		backdrop.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.dispose(); }
			if (e.key === 'Tab') {
				const controls = [...backdrop.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
				const current = this.doc.activeElement;
				const edge = e.shiftKey ? controls[0] : controls.at(-1);
				if (!current || !controls.includes(current as HTMLElement) || current === edge) {
					e.preventDefault();
					(e.shiftKey ? controls.at(-1) : controls[0])?.focus();
				}
			}
		});
		host.append(backdrop);
		this.overlay = backdrop;
		this.bodyEl = body;
		this.statusEl = status;
		this.returnFocus = anchor ?? null;
		this.renderContent();
		(this.nameInput ?? closeBtn).focus?.();
	}

	renderContent(): void {
		if (!this.bodyEl) return;
		if (this.statusEl && this.store.readOnly) this.statusEl.textContent = t('zotero-tabflow-hub-readonly-warning', '工作区数据处于只读保护状态，暂不可保存或修改。');
		const sessionsEnabled = getPref('enableSessions');
		const hiddenGroups = this.store.hiddenGroups();
		const sessions = this.store.state.sessions;
		const rolling = this.store.state.rollingSessions ?? [];
		const parts: HTMLElement[] = [];

		if (sessionsEnabled) {
			parts.push(this.buildQuickSaveBar(sessions.length));
		}
		if (hiddenGroups.length || getPref('enableGroupHiding')) {
			parts.push(this.buildHiddenSection(hiddenGroups));
		}
		if (sessionsEnabled) {
			parts.push(this.buildSessionsSection(sessions));
			if (rolling.length) parts.push(this.buildRollingSection(rolling));
		}
		this.bodyEl.replaceChildren(...parts);
	}

	private buildQuickSaveBar(sessionCount: number): HTMLElement {
		const bar = this.h('div', 'ztf-hub-quickbar');
		const input = this.h('input', 'ztf-hub-input');
		input.type = 'text';
		input.placeholder = t('zotero-tabflow-hub-name-placeholder', '输入工作区或模板名称（留空使用当前时间）…');
		this.nameInput = input;

		const saveName = (fallbackKey: string, fallback: string) =>
			input.value.trim() || `${t(fallbackKey, fallback)} · ${formatSnapshotTimestamp(Date.now())}`;

		const actions = this.h('div', 'ztf-hub-quick-actions');
		const ro = this.store.readOnly;
		actions.append(
			this.btn(t('zotero-tabflow-hub-save-session', '保存工作区'), 'ztf-hub-btn primary', () => {
				const openKeys = this.meta.buildTrackedTabs().map((tab) => tab.key);
				this.store.saveSession(saveName('zotero-tabflow-session-default-name', '工作区会话'), openKeys);
				input.value = '';
				this.renderContent();
			}, ro),
			this.btn(t('zotero-tabflow-hub-save-template', '存为布局模板'), 'ztf-hub-btn', () => {
				this.store.saveLayoutTemplate(saveName('zotero-tabflow-template-default-name', '布局模板'));
				input.value = '';
				this.renderContent();
			}, ro),
			this.btn(t('zotero-tabflow-hub-export', '导出 JSON'), 'ztf-hub-btn', () => {
				this.dispose();
				this.callbacks.onExportSessions();
			}, sessionCount === 0),
			this.btn(t('zotero-tabflow-hub-import', '导入 JSON'), 'ztf-hub-btn', () => {
				this.dispose();
				this.callbacks.onImportSessions();
			}, ro),
		);
		bar.append(input, actions);
		return bar;
	}

	private buildSectionHeader(title: string, extraBtn?: HTMLButtonElement): HTMLElement {
		const row = this.h('div', 'ztf-hub-sec-head');
		const label = this.h('span', 'ztf-hub-sec-title');
		label.textContent = title;
		row.append(label);
		if (extraBtn) row.append(extraBtn);
		return row;
	}

	private buildHiddenSection(hiddenGroups: readonly TabGroup[]): HTMLElement {
		const sec = this.h('div', 'ztf-hub-section');
		sec.id = 'ztf-hub-hidden-section';
		const ro = this.store.readOnly;
		const showAll = hiddenGroups.length > 1
			? this.btn(t('zotero-tabflow-hub-show-all-hidden', '全部恢复显示'), 'ztf-hub-btn', () => {
				for (const g of hiddenGroups) this.store.setGroupHidden(g.id, false);
				this.refreshHiddenFocus(0);
			}, ro)
			: undefined;
		const heading = this.buildSectionHeader(t('zotero-tabflow-hub-hidden-header', `已隐藏的项目组 (${hiddenGroups.length})`, { count: hiddenGroups.length }), showAll);
		heading.tabIndex = -1;
		sec.append(heading);
		if (!hiddenGroups.length) {
			const empty = this.h('div', 'ztf-hub-empty');
			empty.textContent = t('zotero-tabflow-hub-hidden-empty', '暂无隐藏分组；在标签分组标题右键「隐藏分组」可暂存于此。');
			sec.append(empty);
			return sec;
		}
		const openKeys = new Set(this.meta.buildTrackedTabs().map((tab) => tab.key));
		for (const [index, g] of hiddenGroups.entries()) {
			const virtuals = Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === g.id);
			const unopened = virtuals.filter((member) => !openKeys.has(member.key));
			const card = this.h('div', 'ztf-hub-card');
			const info = this.h('div', 'ztf-hub-card-info');
			const titleRow = this.h('div', 'ztf-hub-card-title');
			const dot = this.h('span', 'ztf-sb-dot');
			dot.style.background = g.color;
			const name = this.h('span');
			name.textContent = g.name;
			titleRow.append(dot, name);
			const meta = this.h('div', 'ztf-hub-card-meta');
			meta.textContent = t('zotero-tabflow-hub-hidden-meta', `保留 ${virtuals.length} 篇文献成员`, { count: virtuals.length });
			info.append(titleRow, meta);

			const btns = this.h('div', 'ztf-hub-card-actions');
			btns.append(
				this.btn(t('zotero-tabflow-hub-unhide', '恢复显示'), 'ztf-hub-btn primary ztf-hub-restore', () => {
					this.store.setGroupHidden(g.id, false);
					this.refreshHiddenFocus(index);
				}, ro),
			);
			if (unopened.length) {
				btns.append(this.btn(t('zotero-tabflow-hub-restore-reopen', `恢复并补开 ${unopened.length} 篇`, { count: unopened.length }), 'ztf-hub-btn', () => {
					const status = this.statusEl;
					this.store.setGroupHidden(g.id, false);
					this.refreshHiddenFocus(index);
					void (async () => {
						let opened = 0;
						let failed = 0;
						const currentKeys = new Set(this.meta.buildTrackedTabs().map((tab) => tab.key));
						for (const m of unopened) {
							if (currentKeys.has(m.key)) continue;
							if (await this.actions.openVirtualOrItem(m.itemID, undefined, true, m.key)) opened++;
							else failed++;
						}
						if (status && this.statusEl === status) {
							status.textContent = t('zotero-tabflow-hub-reopen-result', `已补开 ${opened} 篇，未能打开 ${failed} 篇`, { opened, failed });
						}
						this.callbacks.onRefresh();
					})();
				}, ro));
			}
			btns.append(this.btn(t('zotero-tabflow-hub-dissolve', '解散'), 'ztf-hub-btn danger', () => {
				if (!Services.prompt.confirm(this.win, t('zotero-tabflow-dissolve-group', '解散分组'), t('zotero-tabflow-dissolve-group-confirm', `解散“${g.name}”？标签页将保留并回到未分组。`, { name: g.name }))) return;
				const warn = () => Services.prompt.alert(this.win, t('zotero-tabflow-dissolve-group', '解散分组'), t('zotero-tabflow-dissolve-group-failed', '无法解散分组：数据为只读，或分组已不存在。'));
				try {
					if (!this.store.dissolveGroup(g.id)) { warn(); return; }
					this.refreshHiddenFocus(index);
					this.callbacks.onRefresh();
				} catch (error) { Zotero.logError(error as Error); warn(); }
			}, ro));
			card.append(info, btns);
			sec.append(card);
		}
		return sec;
	}

	private refreshHiddenFocus(index: number): void {
		this.renderContent();
		const section = this.bodyEl?.querySelector?.('#ztf-hub-hidden-section');
		if (!section) return;
		const buttons = section.querySelectorAll<HTMLElement>('.ztf-hub-restore');
		(buttons[Math.min(index, buttons.length - 1)] ?? section.querySelector<HTMLElement>('.ztf-hub-sec-head'))?.focus();
	}

	private buildSessionsSection(sessions: readonly TabSessionSnapshot[]): HTMLElement {
		const sec = this.h('div', 'ztf-hub-section');
		sec.append(this.buildSectionHeader(t('zotero-tabflow-hub-sessions-header', `已保存的工作区会话 (${sessions.length})`, { count: sessions.length })));
		if (!sessions.length) {
			const empty = this.h('div', 'ztf-hub-empty');
			empty.textContent = t('zotero-tabflow-sessions-empty', '暂无已保存的会话');
			sec.append(empty);
			return sec;
		}
		for (const s of sessions) sec.append(this.buildSnapshotCard(s, false));
		return sec;
	}

	private buildRollingSection(rolling: readonly TabSessionSnapshot[]): HTMLElement {
		const sec = this.h('div', 'ztf-hub-section');
		sec.append(this.buildSectionHeader(t('zotero-tabflow-rolling-header', '本地自动恢复快照')));
		for (const r of rolling) sec.append(this.buildSnapshotCard(r, true));
		return sec;
	}

	private buildSnapshotCard(s: TabSessionSnapshot, isRolling: boolean): HTMLElement {
		const card = this.h('div', 'ztf-hub-card');
		const info = this.h('div', 'ztf-hub-card-info');
		const title = this.h('div', 'ztf-hub-card-title');
		const icon = s.kind === 'template' ? '📐 ' : s.kind === 'pre-replace' ? '↩ ' : isRolling ? '🕒 ' : '💾 ';
		title.textContent = `${icon}${s.name}`;
		const meta = this.h('div', 'ztf-hub-card-meta');
		const stamp = s.createdAt ? formatSnapshotTimestamp(s.createdAt) : '';
		meta.textContent = t('zotero-tabflow-hub-snapshot-meta', `${s.openKeys.length} 篇文献 · ${s.groups.length} 个分组${stamp ? ` · ${stamp}` : ''}`, {
			papers: s.openKeys.length,
			groups: s.groups.length,
			time: stamp,
		});
		info.append(title, meta);

		const ro = this.store.readOnly;
		const btns = this.h('div', 'ztf-hub-card-actions');
		btns.append(
			this.btn(t('zotero-tabflow-hub-preview', '预览恢复'), 'ztf-hub-btn primary', () => { this.dispose(); this.callbacks.onPreviewRestore(s); }),
			this.btn(t('zotero-tabflow-hub-quick-merge', '直接合并'), 'ztf-hub-btn', () => { this.dispose(); this.callbacks.onQuickMerge(s); }, ro),
		);
		if (isRolling) {
			btns.append(this.btn(t('zotero-tabflow-hub-promote', '转存'), 'ztf-hub-btn', () => {
				if (promoteRollingSnapshot(this.store.state, s.id)) { this.store.save(); this.renderContent(); }
			}, ro));
		} else if (s.kind !== 'pre-replace') {
			btns.append(
				this.btn(t('zotero-tabflow-hub-update', '更新'), 'ztf-hub-btn', () => {
					const title = t('zotero-tabflow-hub-update', '更新');
					const msg = t('zotero-tabflow-hub-update-confirm', `用当前打开的文献与分组状态覆盖「${s.name}」？`, { name: s.name });
					if (!Services.prompt.confirm(this.win, title, msg)) return;
					if (updateExistingSession(this.store.state, s.id, this.meta.buildTrackedTabs().map((tab) => tab.key))) {
						this.store.save();
						this.renderContent();
					}
				}, ro),
				this.btn(t('zotero-tabflow-hub-rename', '重命名'), 'ztf-hub-btn', () => {
					const val = { value: s.name };
					if (!Services.prompt.prompt(this.win, t('zotero-tabflow-hub-rename', '重命名'), t('zotero-tabflow-hub-rename-prompt', '请输入新的会话名称：'), val, null, {})) return;
					if (renameExistingSession(this.store.state, s.id, val.value)) { this.store.save(); this.renderContent(); }
				}, ro),
			);
		}
		btns.append(this.btn(t('zotero-tabflow-hub-delete', '删除'), 'ztf-hub-btn danger', () => { this.store.deleteSession(s.id); this.renderContent(); }, ro));
		card.append(info, btns);
		return card;
	}

	dispose(): void {
		const anchor = this.returnFocus;
		this.returnFocus = null;
		this.overlay?.remove?.();
		this.overlay = null;
		this.bodyEl = null;
		this.nameInput = null;
		this.statusEl = null;
		if (anchor?.isConnected) anchor.focus();
	}
}
