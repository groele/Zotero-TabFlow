import { t } from '../core/i18n.ts';
import type { PublicationGroupSuggestion, SessionImportPreview, SessionRestorePlan } from '../services/session-restore.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';

export class SessionPreviewController {
	private panel: any = null;

	constructor(
		private readonly win: Window,
		private readonly doc: Document,
	) {}

	private h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
		const el = this.doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
		if (className) el.className = className;
		return el;
	}

	private createPanel(buildBody: (box: HTMLDivElement, close: () => void) => void): void {
		this.dispose();
		const popupset = this.doc.getElementById('mainPopupSet') || this.doc.querySelector('popupset');
		if (!popupset) return;
		const panel = (this.doc as any).createXULElement
			? (this.doc as any).createXULElement('panel')
			: this.doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'panel');
		panel.id = 'ztf-session-preview-panel';
		panel.setAttribute('orient', 'vertical');

		const box = this.h('div', 'ztf-preview-box');
		const close = () => this.dispose();
		buildBody(box, close);
		box.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); close(); }
		});
		panel.append(box);
		panel.addEventListener('popuphidden', () => {
			if (this.panel === panel) {
				this.panel = null;
				panel.remove();
			}
		});
		popupset.append(panel);
		this.panel = panel;
		const screenX = Math.round(((this.win as any).mozInnerScreenX || 0) + Math.max(24, (this.win.innerWidth - 440) / 2));
		const screenY = Math.round(((this.win as any).mozInnerScreenY || 0) + 74);
		panel.openPopupAtScreen(screenX, screenY, false);
	}

	openRestorePreview(
		mergePlan: SessionRestorePlan,
		replacePlan: SessionRestorePlan,
		onConfirm: (plan: SessionRestorePlan) => Promise<void>,
	): void {
		this.createPanel((box, close) => {
			let selectedMerge = true;
			const title = this.h('div', 'ztf-pv-title');
			title.textContent = t('zotero-tabflow-preview-title', `恢复会话：${mergePlan.session.name}`, { name: mergePlan.session.name });

			const modeRow = this.h('div', 'ztf-pv-modes');
			const mergeBtn = this.h('button', 'ztf-pv-mode active');
			mergeBtn.type = 'button';
			mergeBtn.textContent = t('zotero-tabflow-preview-mode-merge', '合并恢复（推荐）');
			const replaceBtn = this.h('button', 'ztf-pv-mode');
			replaceBtn.type = 'button';
			replaceBtn.textContent = t('zotero-tabflow-preview-mode-replace', '替换分组布局');
			modeRow.append(mergeBtn, replaceBtn);

			const stats = this.h('div', 'ztf-pv-stats');
			const note = this.h('div', 'ztf-pv-note');
			const missingList = this.h('div', 'ztf-pv-missing');

			const renderPlan = () => {
				const plan = selectedMerge ? mergePlan : replacePlan;
				mergeBtn.classList.toggle('active', selectedMerge);
				replaceBtn.classList.toggle('active', !selectedMerge);
				stats.replaceChildren(
					this.statRow(t('zotero-tabflow-preview-already-open', '已打开（保留）'), String(plan.alreadyOpenCount)),
					this.statRow(t('zotero-tabflow-preview-to-open', '将后台补开'), String(plan.toOpen.length)),
					this.statRow(t('zotero-tabflow-preview-virtual-members', '保留的虚拟文献'), String(plan.virtualMembers?.length ?? 0)),
					this.statRow(t('zotero-tabflow-preview-new-groups', '将新增分组'), String(plan.newGroupsCount)),
					this.statRow(t('zotero-tabflow-preview-reassigned', '将调整分组'), String(plan.reassignedCount)),
					this.statRow(t('zotero-tabflow-preview-pins', '固定状态变化'), `+${plan.pinAdded.length} / -${plan.pinRemoved.length}`),
					this.statRow(t('zotero-tabflow-preview-missing', '无法找到条目'), String(plan.missing.length)),
				);
				note.textContent = selectedMerge
					? t('zotero-tabflow-preview-merge-note', '保留当前阅读标签页和已有分组，仅补开缺失文献并合并新分组。')
					: t('zotero-tabflow-preview-replace-note', '替换前将自动保存一份可回退快照；当前已打开的标签页继续保留。');
				missingList.replaceChildren();
				missingList.hidden = !plan.missing.length;
				if (plan.missing.length) {
					const head = this.h('div', 'ztf-pv-missing-head');
					head.textContent = t('zotero-tabflow-preview-missing-head', '以下条目在当前文献库中未找到（将跳过）：');
					missingList.append(head);
					for (const m of plan.missing.slice(0, 6)) {
						const row = this.h('div', 'ztf-pv-missing-item');
						row.textContent = m.fullKey;
						missingList.append(row);
					}
				}
			};
			mergeBtn.onclick = () => { selectedMerge = true; renderPlan(); };
			replaceBtn.onclick = () => { selectedMerge = false; renderPlan(); };
			renderPlan();

			const footer = this.h('div', 'ztf-pv-footer');
			const cancelBtn = this.h('button', 'ztf-pv-btn');
			cancelBtn.type = 'button';
			cancelBtn.textContent = t('zotero-tabflow-cancel', '取消');
			cancelBtn.onclick = close;
			const okBtn = this.h('button', 'ztf-pv-btn primary');
			okBtn.type = 'button';
			okBtn.textContent = t('zotero-tabflow-preview-confirm', '确认恢复');
			okBtn.onclick = () => {
				const chosen = selectedMerge ? mergePlan : replacePlan;
				close();
				void onConfirm(chosen);
			};
			footer.append(cancelBtn, okBtn);
			box.append(title, modeRow, stats, note, missingList, footer);
			this.win.setTimeout(() => okBtn.focus(), 20);
		});
	}

	openImportPreview(preview: SessionImportPreview, onConfirm: () => void): void {
		this.createPanel((box, close) => {
			const title = this.h('div', 'ztf-pv-title');
			title.textContent = t('zotero-tabflow-import-preview-title', '导入跨机会话预览');
			const stats = this.h('div', 'ztf-pv-stats');
			stats.append(
				this.statRow(t('zotero-tabflow-import-sessions', '包含会话数'), String(preview.sessions.length)),
				this.statRow(t('zotero-tabflow-import-resolvable', '本机可识别条目'), String(preview.resolvableCount)),
				this.statRow(t('zotero-tabflow-import-unrecognized', '本机未找到条目'), String(preview.missing.length)),
			);
			const note = this.h('div', 'ztf-pv-note');
			note.textContent = t('zotero-tabflow-import-note', '将以合并方式导入会话列表，不会覆盖现有会话。');
			const missingList = this.h('div', 'ztf-pv-missing');
			missingList.hidden = !preview.missing.length;
			for (const m of preview.missing.slice(0, 6)) {
				const row = this.h('div', 'ztf-pv-missing-item');
				row.textContent = m.fullKey;
				missingList.append(row);
			}
			const footer = this.h('div', 'ztf-pv-footer');
			const cancelBtn = this.h('button', 'ztf-pv-btn');
			cancelBtn.type = 'button';
			cancelBtn.textContent = t('zotero-tabflow-cancel', '取消');
			cancelBtn.onclick = close;
			const okBtn = this.h('button', 'ztf-pv-btn primary');
			okBtn.type = 'button';
			okBtn.textContent = t('zotero-tabflow-import-confirm', '合并导入');
			okBtn.onclick = () => { close(); onConfirm(); };
			footer.append(cancelBtn, okBtn);
			box.append(title, stats, note, missingList, footer);
		});
	}

	openPublicationSuggestPreview(
		suggestions: readonly PublicationGroupSuggestion[],
		onApply: (chosen: PublicationGroupSuggestion[]) => void,
	): void {
		this.createPanel((box, close) => {
			const checked = new Set(suggestions.map((s) => s.venue));
			const title = this.h('div', 'ztf-pv-title');
			title.textContent = t('zotero-tabflow-suggest-title', '按期刊自动归组建议');
			const list = this.h('div', 'ztf-pv-stats');
			for (const s of suggestions) {
				const row = this.h('label', 'ztf-pv-check-row');
				const cb = this.h('input');
				cb.type = 'checkbox';
				cb.checked = true;
				cb.onchange = () => { if (cb.checked) checked.add(s.venue); else checked.delete(s.venue); };
				const text = this.h('span');
				text.textContent = `${s.venue} (${s.keys.length})`;
				row.append(cb, text);
				list.append(row);
			}
			const footer = this.h('div', 'ztf-pv-footer');
			const cancelBtn = this.h('button', 'ztf-pv-btn');
			cancelBtn.type = 'button';
			cancelBtn.textContent = t('zotero-tabflow-cancel', '取消');
			cancelBtn.onclick = close;
			const okBtn = this.h('button', 'ztf-pv-btn primary');
			okBtn.type = 'button';
			okBtn.textContent = t('zotero-tabflow-suggest-apply', '应用所选建议');
			okBtn.onclick = () => { close(); onApply(suggestions.filter((s) => checked.has(s.venue))); };
			footer.append(cancelBtn, okBtn);
			box.append(title, list, footer);
		});
	}

	private statRow(label: string, value: string): HTMLDivElement {
		const row = this.h('div', 'ztf-pv-stat-row');
		const l = this.h('span', 'ztf-pv-stat-label');
		l.textContent = label;
		const v = this.h('strong', 'ztf-pv-stat-val');
		v.textContent = value;
		row.append(l, v);
		return row;
	}

	dispose(): void {
		this.panel?.hidePopup?.();
		this.panel?.remove?.();
		this.panel = null;
	}
}
