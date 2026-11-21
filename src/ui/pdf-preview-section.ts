import { t } from '../core/i18n.ts';
import { PREF_PREFIX, getPref, invalidatePrefCache, setPref } from '../core/prefs.ts';
import {
	openPdfDocumentFromFile, openPdfInReader, renderPageToCanvas,
	resolveAllPdfAttachments, resolveAttachmentPath,
	type PdfAttachmentEntry, type PdfDocumentProxy,
} from '../services/pdf-preview-renderer.ts';
import {
	applyPreviewLayoutMode, applyStatusMessage, bindPreviewSidenavClick, createToolBtn as toolBtn, createXhtmlEl as el,
	ensurePreviewStyles, ensureSectionConnected, evictDistantPageCanvases,
	isSectionEnabled, logPreviewDebug, openPageJumpInput, removePreviewStyles,
} from './item-pane-section-compat.ts';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.2;

type SectionUpdate = { body: HTMLElement; item?: any; tabType?: string; setEnabled?: (enabled: boolean) => void; setSectionSummary?: (summary: string) => void };
type SectionInitProps = SectionUpdate & { doc: Document };
interface PageSlot { pageNumber: number; card: HTMLDivElement; canvas: HTMLCanvasElement; renderedZoom: number | null; rendering: boolean; lastHeight: number; cancelTask?: () => void; }
interface PreviewState {
	doc: Document; win: Window; body: HTMLElement; root: HTMLDivElement; customSection: Element | null; collapsible: Element | null;
	setSectionSummary?: (summary: string) => void; item: any | null; attachment: any | null; attachments: PdfAttachmentEntry[];
	pdfDoc: PdfDocumentProxy | null; loading: boolean; generation: number; fullActive: boolean;
	zoom: number; currentPage: number; numPages: number; lastWidth: number; resizeTimer: number | null; resizeObserver: ResizeObserver | null;
	slots: PageSlot[]; observer: IntersectionObserver | null; statusEl: HTMLDivElement; pageLabel: HTMLSpanElement; zoomLabel: HTMLButtonElement;
	prevBtn: HTMLButtonElement; nextBtn: HTMLButtonElement; openBtn: HTMLButtonElement; attSelect: HTMLSelectElement; viewportEl: HTMLDivElement;
}

export class PdfPreviewSectionController {
	private sectionID: string | false = false;
	private prefObservers: symbol[] = [];
	private states = new Map<HTMLElement, PreviewState>();
	private listeners = new Map<HTMLElement, AbortController>();

	register(pluginID: string, rootURI: string): void {
		logPreviewDebug('register', { pluginID, rootURI, hasAPI: Boolean(Zotero.ItemPaneManager?.registerSection) });
		if (this.sectionID || !Zotero.ItemPaneManager?.registerSection) return;
		this.sectionID = (Zotero.ItemPaneManager.registerSection as any)({
			paneID: 'tabflow-pdf-preview',
			pluginID,
			header: { l10nID: 'zotero-tabflow-pdf-preview-title', icon: `${rootURI}pdf-preview.svg` },
			sidenav: { l10nID: 'zotero-tabflow-pdf-preview-sidenav', icon: `${rootURI}pdf-preview-sidenav.svg`, orderable: true },
			onInit: (props: SectionInitProps) => this.onInit(props),
			onDestroy: ({ body }: { body: HTMLElement }) => this.onDestroy(body),
			onItemChange: (props: SectionUpdate) => this.renderSection(props),
			onRender: (props: SectionUpdate) => this.renderSection(props),
			onToggle: (props: SectionUpdate) => this.renderSection(props),
		});
		if (Zotero.Prefs?.registerObserver && !this.prefObservers.length) {
			for (const key of ['pdfPreviewMode', 'enablePdfPreviewSidenav', 'pdfPreviewDefaultZoom', 'pdfPreviewShowPageBadge'] as const) {
				this.prefObservers.push(Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => {
					invalidatePrefCache(key);
					const isFull = getPref('pdfPreviewMode') === 'full' && getPref('enablePdfPreviewSidenav');
					const showBadge = getPref('pdfPreviewShowPageBadge');
					const defaultZoom = Math.round(getPref('pdfPreviewDefaultZoom')) / 100;
					for (const st of this.states.values()) {
						st.fullActive = isFull; st.root.setAttribute('data-show-badge', showBadge ? 'true' : 'false');
						if (key === 'pdfPreviewDefaultZoom') st.zoom = defaultZoom;
						applyPreviewLayoutMode(st.body, st.root, st.customSection, isFull);
						this.syncControls(st); this.invalidateAndRenderVisible(st);
					}
				}, true));
			}
		}
	}

	private onInit(props: SectionInitProps): void {
		const { body, item, tabType, setEnabled, setSectionSummary } = props;
		const doc = props.doc || body?.ownerDocument;
		const win = doc?.defaultView || (Zotero.getMainWindow?.() as Window | undefined);
		if (!win || !doc || !body) return;
		try {
			const customSection = body.closest?.('item-pane-custom-section') || null, collapsible = body.closest?.('collapsible-section') || null;
			setEnabled?.(isSectionEnabled({ item, tabType }, getPref('enablePdfPreviewSidenav')));
			win.MozXULElement?.insertFTLIfNeeded?.('zotero-tabflow.ftl');
			ensurePreviewStyles(doc);
			this.listeners.get(body)?.abort();
			const controller = new (win as Window & typeof globalThis).AbortController();
			this.listeners.set(body, controller); body.textContent = '';

			const root = el(doc, 'div'); root.className = 'ztf-pdf-root';
			const toolbar = el(doc, 'div'); toolbar.className = 'ztf-pdf-toolbar';
			const navGroup = el(doc, 'div'); navGroup.className = 'ztf-pdf-btn-group';
			const prevBtn = toolBtn(doc, '‹', 'zotero-tabflow-pdf-preview-prev', '', 'prev');
			const pageLabel = el(doc, 'span'); pageLabel.className = 'ztf-pdf-page-label'; pageLabel.textContent = '0 / 0';
			const nextBtn = toolBtn(doc, '›', 'zotero-tabflow-pdf-preview-next', '', 'next');
			navGroup.append(prevBtn, pageLabel, nextBtn);

			const zoomGroup = el(doc, 'div'); zoomGroup.className = 'ztf-pdf-btn-group';
			const zoomOutBtn = toolBtn(doc, '−', 'zotero-tabflow-pdf-preview-zoom-out', '', 'zoomOut');
			const zoomLabel = toolBtn(doc, '100%');
			const zoomInBtn = toolBtn(doc, '+', 'zotero-tabflow-pdf-preview-zoom-in', '', 'zoomIn');
			const modeBtn = toolBtn(doc, '', 'zotero-tabflow-pdf-preview-toggle-mode', '', 'toggleMode');
			const openBtn = toolBtn(doc, t('zotero-tabflow-pdf-preview-open-reader', '在阅读器中打开'), 'zotero-tabflow-pdf-preview-open-reader', 'ztf-pdf-open-btn', 'openReader');
			zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);
			const attSelect = el(doc, 'select', 'display:none'); attSelect.className = 'ztf-pdf-att-select';
			toolbar.append(navGroup, zoomGroup, attSelect);

			const statusEl = el(doc, 'div'); statusEl.className = 'ztf-pdf-status';
			const viewportEl = el(doc, 'div'); viewportEl.className = 'ztf-pdf-viewport'; viewportEl.setAttribute('tabindex', '0');
			root.append(toolbar, statusEl, viewportEl); body.append(root);

			const state: PreviewState = {
				doc, win, body, root, customSection, collapsible, setSectionSummary,
				item: null, attachment: null, attachments: [], pdfDoc: null, loading: false, generation: 0,
				fullActive: getPref('pdfPreviewMode') === 'full', zoom: Math.round(getPref('pdfPreviewDefaultZoom')) / 100,
				currentPage: 0, numPages: 0, lastWidth: 0, resizeTimer: null, resizeObserver: null,
				slots: [], observer: null, statusEl, pageLabel, zoomLabel, prevBtn, nextBtn, openBtn, attSelect, viewportEl,
			};
			root.setAttribute('data-show-badge', getPref('pdfPreviewShowPageBadge') ? 'true' : 'false');
			this.states.set(body, state);
			ensureSectionConnected(body, root, customSection, collapsible);
			applyPreviewLayoutMode(body, root, customSection, state.fullActive);
			bindPreviewSidenavClick(doc, controller.signal, (active) => {
				state.fullActive = active; applyPreviewLayoutMode(state.body, state.root, state.customSection, active);
			});
			this.bindToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, controller.signal);
			this.setupResizeObserver(state); this.syncControls(state); this.renderSection(props);
		} catch (error) { Zotero.logError(error instanceof Error ? error : new Error(String(error))); }
	}

	private bindToolbar(state: PreviewState, zoomOutBtn: HTMLButtonElement, zoomInBtn: HTMLButtonElement, modeBtn: HTMLButtonElement, signal: AbortSignal): void {
		const opts = { signal };
		state.prevBtn.addEventListener('click', () => this.jumpToPage(state, state.currentPage - 1), opts);
		state.nextBtn.addEventListener('click', () => this.jumpToPage(state, state.currentPage + 1), opts);
		zoomOutBtn.addEventListener('click', () => this.setZoom(state, state.zoom - ZOOM_STEP), opts);
		zoomInBtn.addEventListener('click', () => this.setZoom(state, state.zoom + ZOOM_STEP), opts);
		state.zoomLabel.addEventListener('click', () => this.setZoom(state, 1), opts);
		modeBtn.addEventListener('click', () => {
			const next = getPref('pdfPreviewMode') === 'full' ? 'section' : 'full';
			setPref('pdfPreviewMode', next); state.fullActive = next === 'full';
			applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive); this.invalidateAndRenderVisible(state);
		}, opts);
		state.openBtn.addEventListener('click', () => state.attachment && void openPdfInReader(state.attachment, state.win, state.currentPage || 1), opts);
		state.attSelect.addEventListener('change', () => {
			const chosen = state.attachments.find((entry) => String(entry.id) === state.attSelect.value);
			if (chosen && chosen.attachment !== state.attachment) void this.loadAttachmentDocument(state, chosen.attachment);
		}, opts);
		state.pageLabel.addEventListener('click', () => openPageJumpInput(state.doc, state.pageLabel, state.currentPage, state.numPages, (p) => this.jumpToPage(state, p)), opts);
		state.viewportEl.addEventListener('scroll', () => this.updateCurrentPageFromScroll(state), opts);
		state.viewportEl.addEventListener('dblclick', (event: MouseEvent) => {
			if (!state.attachment || !getPref('pdfPreviewDoubleClickOpen')) return;
			event.preventDefault?.(); event.stopPropagation?.();
			const card = (event.target as Element | null)?.closest?.('[data-page-number]');
			void openPdfInReader(state.attachment, state.win, Number(card?.getAttribute?.('data-page-number')) || state.currentPage || 1);
		}, opts);
		state.viewportEl.addEventListener('keydown', (event: KeyboardEvent) => {
			if (!state.numPages) return;
			const k = event.key;
			if (k === 'PageDown' || k === 'ArrowRight') { event.preventDefault?.(); this.jumpToPage(state, state.currentPage + 1); }
			else if (k === 'PageUp' || k === 'ArrowLeft') { event.preventDefault?.(); this.jumpToPage(state, state.currentPage - 1); }
			else if (k === 'Home' || k === 'End') { event.preventDefault?.(); this.jumpToPage(state, k === 'Home' ? 1 : state.numPages); }
			else if ((event.ctrlKey || event.metaKey) && k === '0') { event.preventDefault?.(); this.setZoom(state, 1); }
		}, opts);
		state.viewportEl.addEventListener('wheel', (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.setZoom(state, state.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); } }, opts);
	}

	private setupResizeObserver(state: PreviewState): void {
		const RO = (state.win as Window & typeof globalThis).ResizeObserver;
		if (!RO) return;
		state.resizeObserver = new RO(() => {
			const width = state.viewportEl.clientWidth || state.body.clientWidth || 0;
			if (!width || !state.pdfDoc || Math.abs(width - state.lastWidth) < 8) return;
			state.lastWidth = width;
			if (state.resizeTimer !== null) state.win.clearTimeout(state.resizeTimer);
			state.resizeTimer = state.win.setTimeout(() => { state.resizeTimer = null; this.invalidateAndRenderVisible(state); }, 120);
		});
		state.resizeObserver.observe(state.viewportEl);
	}

	private invalidateAndRenderVisible(state: PreviewState): void {
		for (const slot of state.slots) { slot.cancelTask?.(); slot.renderedZoom = null; }
		const startIdx = Math.max(0, state.currentPage - 1);
		for (let i = startIdx; i < Math.min(state.slots.length, startIdx + 2); i++) void this.renderSlot(state, state.slots[i], state.generation);
	}

	private onDestroy(body: HTMLElement): void {
		const state = this.states.get(body);
		if (state) {
			if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
			state.resizeObserver?.disconnect(); applyPreviewLayoutMode(state.body, state.root, state.customSection, false); this.disposeDocument(state, true);
		}
		this.states.delete(body); this.listeners.get(body)?.abort(); this.listeners.delete(body);
	}

	private renderSection({ body, item, tabType, setEnabled, setSectionSummary }: SectionUpdate): void {
		const enabled = isSectionEnabled({ item, tabType }, getPref('enablePdfPreviewSidenav'));
		setEnabled?.(enabled);
		let state = this.states.get(body);
		if (!state) {
			const doc = body?.ownerDocument;
			if (!doc) return;
			this.onInit({ doc, body, item, tabType, setEnabled, setSectionSummary });
			state = this.states.get(body);
			if (!state) return;
		}
		if (setSectionSummary) state.setSectionSummary = setSectionSummary;
		ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
		if (!enabled) {
			state.item = null; applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
			this.disposeDocument(state, true); applyStatusMessage(state.statusEl, ''); return;
		}
		applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive && getPref('pdfPreviewMode') === 'full');
		if (item && state.item === item && (state.pdfDoc || state.loading)) return;
		state.item = item ?? null; void this.loadItemPreview(state, state.item);
	}

	private disposeDocument(state: PreviewState, clearAttachments = false): void {
		state.generation += 1; state.loading = false;
		state.observer?.disconnect(); state.observer = null;
		for (const slot of state.slots) { slot.cancelTask?.(); slot.canvas.width = 0; slot.canvas.height = 0; }
		state.slots = []; state.viewportEl.textContent = '';
		state.currentPage = 0; state.numPages = 0; state.attachment = null;
		if (clearAttachments) { state.attachments = []; state.attSelect.textContent = ''; state.attSelect.style.display = 'none'; }
		const oldDoc = state.pdfDoc; state.pdfDoc = null;
		if (oldDoc?.destroy) void Promise.resolve(oldDoc.destroy()).catch(() => {});
		this.syncControls(state);
	}

	private syncControls(state: PreviewState): void {
		const hasDoc = state.numPages > 0;
		const pageText = hasDoc ? `${state.currentPage} / ${state.numPages}` : '0 / 0';
		state.pageLabel.textContent = pageText; state.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
		state.setSectionSummary?.(hasDoc ? pageText : '');
		state.prevBtn.disabled = !hasDoc || state.currentPage <= 1;
		state.nextBtn.disabled = !hasDoc || state.currentPage >= state.numPages;
		state.openBtn.disabled = !state.attachment;
	}

	private async loadItemPreview(state: PreviewState, item: any): Promise<void> {
		this.disposeDocument(state, true);
		const gen = state.generation;
		if (!item) { applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-unavailable'); return; }
		state.loading = true; applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-loading');
		const entries = await resolveAllPdfAttachments(item);
		if (state.generation !== gen) return;
		state.attachments = entries;
		if (entries.length > 1) {
			state.attSelect.textContent = '';
			entries.forEach((entry, idx) => {
				const opt = el(state.doc, 'option'); opt.value = String(entry.id); opt.textContent = `${idx + 1}. ${entry.title}`;
				state.attSelect.append(opt);
			});
			state.attSelect.style.display = 'block';
		} else state.attSelect.style.display = 'none';
		if (!entries.length) {
			state.loading = false; ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
			applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-unavailable'); return;
		}
		await this.loadAttachmentDocument(state, entries[0].attachment);
	}

	private async loadAttachmentDocument(state: PreviewState, att: any): Promise<void> {
		this.disposeDocument(state, false);
		const gen = state.generation;
		state.loading = true; state.attachment = att; this.syncControls(state);
		applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-loading');
		try {
			const filePath = await resolveAttachmentPath(att);
			if (state.generation !== gen) return;
			if (!filePath) { state.loading = false; applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-missing-file'); return; }
			const pdfDoc = await openPdfDocumentFromFile(filePath, state.doc);
			if (state.generation !== gen) { void Promise.resolve(pdfDoc.destroy?.()).catch(() => {}); return; }
			state.loading = false; state.pdfDoc = pdfDoc;
			state.numPages = Math.max(0, pdfDoc.numPages || 0); state.currentPage = state.numPages > 0 ? 1 : 0;
			ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
			if (!state.numPages) { applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-unavailable'); return; }
			applyStatusMessage(state.statusEl, ''); this.buildPageSlots(state, gen); this.syncControls(state);
		} catch (error) {
			if (state.generation !== gen) return;
			state.loading = false; Zotero.logError(error instanceof Error ? error : new Error(String(error)));
			applyStatusMessage(state.statusEl, 'zotero-tabflow-pdf-preview-error');
		}
	}

	private buildPageSlots(state: PreviewState, gen: number): void {
		state.viewportEl.textContent = ''; state.slots = [];
		const frag = state.doc.createDocumentFragment();
		for (let p = 1; p <= state.numPages; p++) {
			const card = el(state.doc, 'div'); card.className = 'ztf-pdf-page-card';
			card.setAttribute('data-unrendered', 'true'); card.setAttribute('data-page-number', String(p));
			const canvas = el(state.doc, 'canvas'); canvas.className = 'ztf-pdf-canvas';
			const badge = el(state.doc, 'span'); badge.className = 'ztf-pdf-page-badge'; badge.textContent = String(p);
			card.addEventListener('dblclick', (e: MouseEvent) => { if (state.attachment && getPref('pdfPreviewDoubleClickOpen')) { e.preventDefault?.(); e.stopPropagation?.(); void openPdfInReader(state.attachment, state.win, p); } });
			card.append(canvas, badge); frag.append(card);
			state.slots.push({ pageNumber: p, card, canvas, renderedZoom: null, rendering: false, lastHeight: 0 });
		}
		state.viewportEl.append(frag);
		const Observer = (state.win as Window & typeof globalThis).IntersectionObserver;
		if (Observer) {
			state.observer = new Observer((entries) => {
				if (state.generation !== gen) return;
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const slot = state.slots.find((s) => s.card === entry.target);
					if (slot) void this.renderSlot(state, slot, gen);
				}
			}, { root: state.viewportEl, rootMargin: '320px 0px', threshold: 0.01 });
			for (const slot of state.slots) state.observer.observe(slot.card);
		}
		void this.renderSlot(state, state.slots[0], gen);
		if (state.slots[1]) void this.renderSlot(state, state.slots[1], gen);
	}

	private async renderSlot(state: PreviewState, slot: PageSlot, gen: number): Promise<void> {
		if (!state.pdfDoc || state.generation !== gen || slot.rendering || slot.renderedZoom === state.zoom) return;
		slot.rendering = true;
		try {
			const w = Math.max(180, (state.viewportEl.clientWidth || state.body.clientWidth || 260) - 2);
			state.lastWidth = state.viewportEl.clientWidth || state.body.clientWidth || state.lastWidth;
			const m = await renderPageToCanvas(state.pdfDoc, slot.pageNumber, slot.canvas, w, state.zoom, state.win.devicePixelRatio || 1, () => state.generation !== gen, (c) => { slot.cancelTask = c; });
			if (state.generation === gen && m.height > 0) { slot.lastHeight = m.height; slot.card.removeAttribute('data-unrendered'); slot.card.style.minBlockSize = '0'; slot.renderedZoom = state.zoom; }
		} catch (error) {
			if (state.generation === gen) Zotero.logError(error instanceof Error ? error : new Error(String(error)));
		} finally { slot.rendering = false; slot.cancelTask = undefined; }
	}

	private jumpToPage(state: PreviewState, pageNumber: number): void {
		if (!state.numPages) return;
		const target = Math.max(1, Math.min(state.numPages, pageNumber));
		state.currentPage = target; this.syncControls(state);
		const slot = state.slots[target - 1];
		if (!slot) return;
		state.viewportEl.scrollTop = Math.max(0, slot.card.offsetTop - (state.slots[0]?.card.offsetTop || 0));
		void this.renderSlot(state, slot, state.generation); evictDistantPageCanvases(state.slots, state.currentPage);
	}

	private setZoom(state: PreviewState, nextZoom: number): void {
		const clamped = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)) * 100) / 100;
		if (clamped === state.zoom) return;
		state.zoom = clamped; this.syncControls(state); this.invalidateAndRenderVisible(state);
	}

	private updateCurrentPageFromScroll(state: PreviewState): void {
		if (!state.slots.length) return;
		const top = state.viewportEl.scrollTop + (state.slots[0]?.card.offsetTop || 0);
		let best = 1, bestDist = Infinity;
		for (const slot of state.slots) {
			const dist = Math.abs(slot.card.offsetTop - top);
			if (dist < bestDist) { bestDist = dist; best = slot.pageNumber; }
		}
		if (best !== state.currentPage) { state.currentPage = best; this.syncControls(state); evictDistantPageCanvases(state.slots, state.currentPage); }
	}

	unregister(): void {
		for (const obs of this.prefObservers.splice(0)) Zotero.Prefs?.unregisterObserver?.(obs);
		for (const state of this.states.values()) {
			if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
			state.resizeObserver?.disconnect(); applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
			this.disposeDocument(state, true); removePreviewStyles(state.doc);
		}
		for (const controller of this.listeners.values()) controller.abort();
		this.listeners.clear(); this.states.clear();
		if (this.sectionID) { Zotero.ItemPaneManager?.unregisterSection?.(this.sectionID); this.sectionID = false; }
	}
}
