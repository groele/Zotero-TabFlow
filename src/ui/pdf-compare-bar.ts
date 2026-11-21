import { t } from '../core/i18n.ts';
import type { CompareMode } from '../services/pdf-compare.ts';
import type { PdfAttachmentEntry } from '../services/pdf-preview-renderer.ts';
import { createXhtmlEl as el } from './item-pane-section-compat.ts';

export interface CompareBarUI {
	bar: HTMLDivElement;
	selfBtn: HTMLButtonElement;
	selectEl: HTMLSelectElement;
}

export interface CompareState {
	mode: CompareMode;
	pickedAttachmentID: number | null;
	currentAttachmentID: number;
	tabType: string;
}

export function createCompareBar(
	doc: Document,
	signal: AbortSignal,
	getState: () => CompareState,
	onChange: (nextMode: CompareMode, nextPickedID: number | null) => void,
): CompareBarUI {
	const bar = el(doc, 'div');
	bar.className = 'ztf-pdf-compare-bar';
	bar.style.display = 'none';

	const selfBtn = el(doc, 'button');
	selfBtn.type = 'button';
	selfBtn.className = 'ztf-pdf-btn ztf-pdf-compare-btn';
	selfBtn.textContent = t('zotero-tabflow-pdf-compare-self', '自身');
	selfBtn.title = t('zotero-tabflow-pdf-compare-self-tip', '自身对照：锁定当前文献独立翻页，方便核对附录或公式');

	const selectEl = el(doc, 'select');
	selectEl.className = 'ztf-pdf-compare-select';
	selectEl.title = t('zotero-tabflow-pdf-compare-pick-tip', '切换同条目下的其他 PDF 附件（如支撑材料）进行并排对照');

	selfBtn.addEventListener('click', () => {
		const cur = getState();
		onChange(cur.mode === 'self' ? 'sibling' : 'self', null);
	}, { signal });

	selectEl.addEventListener('change', () => {
		const val = Number(selectEl.value || 0);
		if (!val) return;
		const cur = getState();
		onChange(val === cur.currentAttachmentID ? 'self' : 'sibling', val);
	}, { signal });

	bar.append(selfBtn, selectEl);
	return { bar, selfBtn, selectEl };
}

export function syncCompareBar(
	ui: CompareBarUI,
	st: CompareState,
	entries: readonly PdfAttachmentEntry[],
	activeAttachmentID: number,
): void {
	const visible = st.tabType === 'reader' && entries.length > 1;
	ui.bar.style.display = visible ? 'flex' : 'none';
	if (!visible) return;

	const isSelf = st.mode === 'self' || (st.currentAttachmentID > 0 && activeAttachmentID === st.currentAttachmentID);
	if (isSelf) ui.selfBtn.setAttribute('data-active', 'true');
	else ui.selfBtn.removeAttribute('data-active');

	const doc = ui.bar.ownerDocument;
	if (!doc) return;
	ui.selectEl.textContent = '';
	entries.forEach((entry, idx) => {
		const opt = el(doc, 'option');
		opt.value = String(entry.id);
		const isCurrent = st.currentAttachmentID > 0 && entry.id === st.currentAttachmentID;
		opt.textContent = isCurrent ? `● ${idx + 1}. ${entry.title}` : `${idx + 1}. ${entry.title}`;
		ui.selectEl.append(opt);
	});
	if (activeAttachmentID) ui.selectEl.value = String(activeAttachmentID);
}
