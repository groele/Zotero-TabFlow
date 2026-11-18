import { t } from '../core/i18n.ts';
import { getPref, setPref } from '../core/prefs.ts';
import type { TabFlowStore } from '../core/store.ts';
import type { ItemMetadataService } from '../services/item-metadata.ts';
import type { TabActionService } from '../services/tab-actions.ts';
import type { PopoverController } from './popovers.ts';

interface SpotEntry { label: string; hint: string; run: () => void; }

export class SpotlightController {
	private panel: any = null;
	private input: HTMLInputElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private entries: SpotEntry[] = [];
	private activeIndex = 0;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
		private readonly store: TabFlowStore,
		private readonly meta: ItemMetadataService,
		private readonly actions: TabActionService,
		private readonly popovers: PopoverController,
		private readonly onRefresh: () => void,
	) {}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	init(): void {
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const xul = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('panel')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'panel');
		xul.id = 'ztf-spotlight-panel';
		xul.setAttribute('orient', 'vertical');

		const box = this.h('div', 'ztf-spot-box');
		const input = this.h('input', 'ztf-spot-input');
		input.type = 'search';
		input.setAttribute('data-l10n-id', 'zotero-tabflow-spotlight-search');
		const results = this.h('div', 'ztf-spot-results');
		box.append(input, results);
		xul.append(box);
		popupset.append(xul);

		this.panel = xul;
		this.input = input;
		this.resultsEl = results;

		xul.addEventListener('popupshown', () => { input.focus(); input.select(); });
		input.addEventListener('input', () => { this.activeIndex = 0; this.renderResults(); });
		box.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.isComposing) return;
			if (e.key === 'Escape') { e.preventDefault(); this.close(); }
			else if (e.key === 'ArrowDown') { e.preventDefault(); this.activeIndex = Math.max(0, Math.min(this.entries.length - 1, this.activeIndex + 1)); this.highlightActive(); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); this.activeIndex = Math.max(0, this.activeIndex - 1); this.highlightActive(); }
			else if (e.key === 'Enter') { e.preventDefault(); const item = this.entries[this.activeIndex]; if (item) { item.run(); this.close(); } }
		});
		this.win.addEventListener('keydown', this.handleGlobalShortcut, true);
	}

	private handleGlobalShortcut = (e: KeyboardEvent): void => {
		if (!getPref('enableSpotlight')) return;
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
			e.preventDefault();
			e.stopPropagation();
			this.open();
		}
	};

	open(anchor?: Element): void {
		if (!getPref('enableSpotlight') || !this.panel || !this.input) return;
		this.input.value = '';
		this.activeIndex = 0;
		this.renderResults();
		const target = anchor || this.doc.getElementById('tab-bar-container') || this.doc.documentElement;
		this.panel.openPopup(target, 'after_start', 0, 8, false, false);
	}

	close(): void { this.panel?.hidePopup?.(); }

	private renderResults(): void {
		if (!this.resultsEl || !this.input) return;
		const q = this.input.value.trim().toLowerCase();
		const tabsMode = /^>tabs(?:\s|$)/.test(q);
		const terms = q.replace(tabsMode ? /^>tabs/ : /^>/, '').split(/\s+/).filter(Boolean);
		const tabs = this.meta.buildTrackedTabs();
		const groups = this.store.orderedGroups();
		const names = new Map(groups.map((group) => [group.id, group.name]));
		if (tabsMode) {
			const viewedAt = (key: string) => this.store.state.history[key]?.lastViewed ?? 0;
			tabs.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
		}

		const tabEntries: SpotEntry[] = q.startsWith('>') && !tabsMode ? [] : tabs
			.filter((tab) => {
				const r = this.store.getRemark(tab.key).note;
				const searchable = `${r} ${tab.title} ${tab.shortTitle} ${tab.filename} ${tab.collection} ${tab.creatorYear} ${names.get(tab.groupId) ?? ''}`.toLowerCase();
				return terms.every((term) => searchable.includes(term));
			})
			.map((tab) => {
				const gName = names.get(tab.groupId) || t('zotero-tabflow-ungrouped', '未分组');
				const r = this.store.getRemark(tab.key).note;
				return { label: `${tab.pinned ? '📌 ' : ''}${r || tab.title}`, hint: `${gName} · ${tab.collection}`, run: () => this.actions.selectTab(tab.tab.id) };
			});

		const selectedID = this.meta.getSelectedTabID();
		const activeTab = tabs.find((tab) => tab.tab.id === selectedID);
		const sessionEntries: SpotEntry[] = !getPref('enableSessions') ? [] : [...this.store.state.sessions, ...(this.store.state.rollingSessions ?? [])]
			.map((s) => ({
				label: `💾 ${t('zotero-tabflow-spot-session-prefix', '会话')}：${s.name} (${s.openKeys.length})`,
				hint: t('zotero-tabflow-spot-session-hint', '预览并恢复'),
				run: () => void this.popovers.previewAndRestoreSession(s),
			}))
			.filter((e) => !terms.length || terms.every((term) => `${e.label} ${e.hint}`.toLowerCase().includes(term)));

		const cmdEntries: SpotEntry[] = [
			{ label: `↩ ${t('zotero-tabflow-menu-undo-close', '恢复最近关闭的标签页')}`, hint: 'Ctrl+Shift+T', run: () => { this.actions.undoCloseTab(); this.onRefresh(); } },
			{ label: `📂 ${t('zotero-tabflow-spot-cmd-autogroup', '按 Zotero 集合自动分组')}`, hint: 'Auto-Group', run: () => { this.actions.autoGroupByCollection(); this.onRefresh(); } },
			{ label: `🗂️ ${t('zotero-tabflow-menu-suggest-venue', '按期刊自动归组建议…')}`, hint: 'Suggest', run: () => this.popovers.openPublicationSuggest() },
			{ label: `💤 ${t('zotero-tabflow-spot-cmd-sleep', '休眠所有后台非固定标签')}`, hint: 'Memory Saver', run: () => { this.actions.sleepInactiveTabs(); this.onRefresh(); } },
			...(getPref('enableSessions') ? [{
				label: `💾 ${t('zotero-tabflow-spot-cmd-save-session', '保存当前工作区为会话…')}`,
				hint: 'Session',
				run: () => {
					const val = { value: '' };
					if (!Services.prompt.prompt(this.win, t('zotero-tabflow-sessions-save', '保存会话快照'), t('zotero-tabflow-sessions-save-prompt', '请输入会话名称：'), val, null, {})) return;
					this.store.saveSession(val.value, tabs.map((item) => item.key));
					this.onRefresh();
				},
			}] : []),
			...(getPref('enableVerticalSidebar') ? [{
				label: `⇄ ${t('zotero-tabflow-spot-cmd-toggle-sidebar', '展开/收起垂直标签侧边栏')}`,
				hint: 'Sidebar',
				run: () => { setPref('verticalSidebarCollapsed', !getPref('verticalSidebarCollapsed')); this.onRefresh(); },
			}] : []),
			...(activeTab ? [
				...(getPref('enablePinnedTabs') ? [{
					label: `📌 ${t('zotero-tabflow-spot-cmd-toggle-pin', '固定 / 取消固定当前标签')}`,
					hint: 'Pin',
					run: () => { this.store.togglePinned(activeTab.key); this.onRefresh(); },
				}] : []),
				{
					label: `📂 ${t('zotero-tabflow-spot-cmd-pdf-folder', '打开当前 PDF 附件所在文件夹')}`,
					hint: 'Folder',
					run: () => void this.actions.showInFilesystem(activeTab.tab.id),
				},
			] : []),
		].filter((c) => !terms.length || terms.every((term) => `${c.label} ${c.hint}`.toLowerCase().includes(term)));

		this.entries = tabsMode ? tabEntries : [...tabEntries, ...sessionEntries, ...cmdEntries];
		this.resultsEl.textContent = '';
		this.entries.forEach((entry, idx) => {
			const btn = this.h('button', `ztf-spot-row${idx === this.activeIndex ? ' active' : ''}`);
			btn.type = 'button';
			const main = this.h('span', 'ztf-spot-main');
			main.textContent = entry.label;
			const hint = this.h('span', 'ztf-spot-hint');
			hint.textContent = entry.hint;
			btn.append(main, hint);
			btn.onclick = () => { entry.run(); this.close(); };
			this.resultsEl!.append(btn);
		});
		if (!this.entries.length) {
			const empty = this.h('div', 'ztf-spot-empty');
			empty.textContent = t('zotero-tabflow-spot-empty', '没有匹配的文献或命令');
			this.resultsEl.append(empty);
		}
	}

	private highlightActive(): void {
		if (!this.resultsEl) return;
		const rows = [...this.resultsEl.querySelectorAll('.ztf-spot-row')];
		rows.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
		rows[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
	}

	dispose(): void {
		this.win.removeEventListener('keydown', this.handleGlobalShortcut, true);
		this.panel?.hidePopup?.();
		this.panel?.remove?.();
		this.panel = null;
	}
}
