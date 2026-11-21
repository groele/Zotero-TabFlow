import { t } from '../core/i18n.ts';
import {
	collectOpenReaderTabs, getAdjacentReaderTab, type CompareMode,
} from '../services/pdf-compare.ts';
import { createXhtmlEl as el } from './item-pane-section-compat.ts';

export interface CompareBarUI {
	bar: HTMLDivElement;
	selfBtn: HTMLButtonElement;
	leftBtn: HTMLButtonElement;
	rightBtn: HTMLButtonElement;
	selectEl: HTMLSelectElement;
}

export interface CompareState {
	mode: CompareMode;
	pickedAttachmentID: number | null;
	tabType: string;
}

function makeCompareBtn(doc: Document, text: string, tipKey: string, tipFallback: string): HTMLButtonElement {
	const btn = el(doc, 'button');
	btn.type = 'button';
	btn.className = 'ztf-pdf-btn ztf-pdf-compare-btn';
	btn.textContent = text;
	btn.title = t(tipKey, tipFallback);
	return btn;
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

	const selfBtn = makeCompareBtn(
		doc,
		t('zotero-tabflow-pdf-compare-self', '自身'),
		'zotero-tabflow-pdf-compare-self-tip',
		'自身对照：锁定当前文献独立翻页，方便核对附录或公式',
	);
	const leftBtn = makeCompareBtn(
		doc,
		`← ${t('zotero-tabflow-pdf-compare-left', '左邻')}`,
		'zotero-tabflow-pdf-compare-left-tip',
		'与左侧相邻标签页的 PDF 对照阅读',
	);
	const rightBtn = makeCompareBtn(
		doc,
		`${t('zotero-tabflow-pdf-compare-right', '右邻')} →`,
		'zotero-tabflow-pdf-compare-right-tip',
		'与右侧相邻标签页的 PDF 对照阅读',
	);

	const selectEl = el(doc, 'select');
	selectEl.className = 'ztf-pdf-compare-select';
	selectEl.title = t('zotero-tabflow-pdf-compare-pick-tip', '选择其他已打开的文献进行并排对照');

	const toggle = (target: 'self' | 'left' | 'right') => {
		const cur = getState();
		onChange(cur.mode === target ? 'follow' : target, null);
	};
	selfBtn.addEventListener('click', () => toggle('self'), { signal });
	leftBtn.addEventListener('click', () => toggle('left'), { signal });
	rightBtn.addEventListener('click', () => toggle('right'), { signal });
	selectEl.addEventListener('change', () => {
		const val = Number(selectEl.value || 0);
		if (!val) onChange('follow', null);
		else onChange('pick', val);
	}, { signal });

	bar.append(selfBtn, leftBtn, rightBtn, selectEl);
	return { bar, selfBtn, leftBtn, rightBtn, selectEl };
}

export function syncCompareBar(ui: CompareBarUI, win: Window, st: CompareState): void {
	const isReader = st.tabType === 'reader';
	ui.bar.style.display = isReader ? 'flex' : 'none';
	if (!isReader) return;

	const setActive = (btn: HTMLButtonElement, active: boolean) => {
		if (active) btn.setAttribute('data-active', 'true');
		else btn.removeAttribute('data-active');
	};
	setActive(ui.selfBtn, st.mode === 'self');
	setActive(ui.leftBtn, st.mode === 'left');
	setActive(ui.rightBtn, st.mode === 'right');

	ui.leftBtn.disabled = !getAdjacentReaderTab(win, 'left');
	ui.rightBtn.disabled = !getAdjacentReaderTab(win, 'right');

	const doc = ui.bar.ownerDocument;
	if (!doc) return;
	const readers = collectOpenReaderTabs(win);
	ui.selectEl.textContent = '';
	const placeholder = el(doc, 'option');
	placeholder.value = '';
	placeholder.textContent = st.mode === 'follow'
		? t('zotero-tabflow-pdf-compare-pick', '选择对照文献…')
		: t('zotero-tabflow-pdf-compare-reset', '恢复跟随当前标签');
	ui.selectEl.append(placeholder);

	for (const r of readers) {
		const opt = el(doc, 'option');
		opt.value = String(r.attachmentID);
		opt.textContent = r.isSelected ? `● ${r.title}` : r.title;
		ui.selectEl.append(opt);
	}
	ui.selectEl.value = st.mode === 'pick' && st.pickedAttachmentID ? String(st.pickedAttachmentID) : '';
}
