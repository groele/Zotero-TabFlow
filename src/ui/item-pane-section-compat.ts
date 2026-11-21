import { t } from '../core/i18n.ts';
import { getPref } from '../core/prefs.ts';

type SectionContext = { item?: any; tabType?: string };
type SectionOwner = Element & { open?: boolean; collapsible?: boolean; empty?: boolean };

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'tabflow-pdf-preview-styles';

const PREVIEW_CSS = `
.ztf-pdf-root {
	display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;
	min-inline-size: 0; inline-size: 100%; contain: inline-size;
	font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
	padding: 2px 0 4px 0; color: var(--fill-primary, currentColor);
}
.ztf-pdf-toolbar {
	display: flex; align-items: center; justify-content: space-between;
	gap: 4px; flex-wrap: wrap; min-block-size: 24px; padding: 0 1px 4px;
	background: transparent;
	border-bottom: 1px solid var(--fill-quinary, color-mix(in srgb, currentColor 7%, transparent));
}
.ztf-pdf-att-select {
	flex: 1 1 100%; min-inline-size: 0; inline-size: 100%; block-size: 22px;
	padding: 0 6px; margin-top: 2px; border-radius: 4px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background: var(--material-background, transparent);
	color: var(--fill-primary, inherit); font: 500 11px/1.3 system-ui, sans-serif; cursor: pointer;
}
.ztf-pdf-btn-group { display: flex; align-items: center; gap: 2px; }
.ztf-pdf-btn {
	appearance: none !important; -moz-appearance: none !important; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center; gap: 4px;
	min-inline-size: 20px !important; min-block-size: 20px !important; block-size: 20px !important;
	margin: 0 !important; padding: 0 5px !important;
	border: 1px solid transparent !important; border-radius: 4px !important;
	background: transparent !important; box-shadow: none !important;
	color: var(--fill-secondary, inherit); font: 500 11.5px/1 system-ui, sans-serif;
	cursor: pointer; user-select: none;
	transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}
.ztf-pdf-btn-svg { inline-size: 12px; block-size: 12px; flex-shrink: 0; pointer-events: none; }
.ztf-pdf-btn:hover:not(:disabled) {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent)) !important;
	color: var(--fill-primary, inherit);
}
.ztf-pdf-btn:active:not(:disabled) {
	background: var(--fill-quarternary, color-mix(in srgb, currentColor 14%, transparent)) !important;
}
.ztf-pdf-btn:disabled { opacity: 0.32; cursor: default; }
.ztf-pdf-open-btn {
	padding: 0 7px !important; color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.1)) !important;
	font-weight: 500; font-size: 11px;
}
.ztf-pdf-open-btn:hover:not(:disabled) {
	background: var(--accent-blue30, rgba(64, 114, 229, 0.2)) !important;
	color: var(--accent-blue, #4072e5) !important;
}
.ztf-pdf-page-label {
	min-inline-size: 38px; padding: 2px 4px; border-radius: 4px;
	text-align: center; font-variant-numeric: tabular-nums;
	color: var(--fill-secondary, inherit); font-size: 11px;
	cursor: pointer; user-select: none;
	transition: background-color 0.12s ease, color 0.12s ease;
}
.ztf-pdf-page-label:hover {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
	color: var(--fill-primary, inherit);
}
.ztf-pdf-page-input {
	inline-size: 38px; block-size: 19px; padding: 0 3px; border-radius: 4px;
	border: 1px solid var(--accent-blue, #4072e5);
	background: var(--material-background, #fff); color: var(--fill-primary, inherit);
	font: 500 11px/1 system-ui, sans-serif; text-align: center; outline: none;
}
.ztf-pdf-status {
	padding: 12px 8px; color: var(--fill-secondary, inherit);
	font-size: 12px; text-align: center; display: none; overflow-wrap: anywhere;
}
.ztf-pdf-viewport {
	position: relative; display: flex; flex-direction: column; align-items: stretch;
	gap: 8px; max-block-size: calc(100vh - 170px);
	overflow-y: auto; overflow-x: auto; padding: 2px 0 4px; background: transparent;
	scrollbar-width: thin; outline: none;
	scrollbar-color: var(--color-scrollbar, rgba(127, 127, 127, 0.38)) transparent;
}
.ztf-pdf-page-card {
	position: relative; flex: 0 0 auto; flex-shrink: 0; display: block;
	inline-size: 100%; box-sizing: border-box; background: #fff;
	border-radius: 5px; border: 1px solid var(--fill-quarternary, rgba(0, 0, 0, 0.12));
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); overflow: hidden; cursor: pointer;
	transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.ztf-pdf-page-card:hover {
	border-color: var(--accent-blue50, rgba(64, 114, 229, 0.45));
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.09);
}
.ztf-pdf-page-card[data-unrendered="true"] {
	aspect-ratio: 1 / 1.4142; min-block-size: 320px;
	background: var(--fill-senary, rgba(0, 0, 0, 0.02));
}
.ztf-pdf-canvas { display: block; inline-size: 100%; block-size: auto; background: #fff; }
.ztf-pdf-page-badge {
	position: absolute; inset-inline-end: 6px; inset-block-end: 6px;
	padding: 1px 6px; border-radius: 999px; font: 500 10px/1.35 system-ui, sans-serif;
	font-variant-numeric: tabular-nums; background: rgba(15, 23, 42, 0.56);
	color: #fff; pointer-events: none; opacity: 0.72; transition: opacity 0.14s ease;
}
.ztf-pdf-page-card:hover .ztf-pdf-page-badge { opacity: 0.95; }
.ztf-pdf-root[data-show-badge="false"] .ztf-pdf-page-badge { display: none; }
[data-ztf-pdf-full-hidden="true"], [data-ztf-pdf-full-stack="true"] > :not([data-ztf-pdf-full-section="true"]) { display: none !important; }
[data-ztf-pdf-full-stack="true"] {
	display: flex !important; flex-direction: column !important;
	block-size: 100% !important; max-block-size: 100% !important; overflow: hidden !important;
}
[data-ztf-pdf-full-section="true"],
[data-ztf-pdf-full-section="true"] > collapsible-section,
[data-ztf-pdf-full-section="true"] > collapsible-section > [data-type="body"] {
	display: flex !important; flex-direction: column !important;
	flex: 1 1 auto !important; block-size: 100% !important; min-block-size: 0 !important;
}
[data-ztf-pdf-full-section="true"] > collapsible-section > .head { display: none !important; }
.ztf-pdf-root[data-layout-mode="full"] {
	display: flex; flex-direction: column; flex: 1 1 auto; block-size: 100%; min-block-size: 0;
}
.ztf-pdf-root[data-layout-mode="full"] .ztf-pdf-viewport {
	flex: 1 1 auto; max-block-size: calc(100vh - 96px); block-size: 100%;
}
`;

export const TOOL_SVG_PATHS: Record<string, string> = {
	prev: 'M10 3.5L5.5 8L10 12.5',
	next: 'M6 3.5L10.5 8L6 12.5',
	zoomOut: 'M3.8 8H12.2',
	zoomIn: 'M8 3.8V12.2M3.8 8H12.2',
	toggleMode: 'M2.5 5.5V2.5H5.5M10.5 2.5H13.5V5.5M13.5 10.5V13.5H10.5M5.5 13.5H2.5V10.5',
	openReader: 'M9.5 2.8H13.2V6.5M13 3L7.5 8.5M11.5 9.2V12.4C11.5 12.84 11.14 13.2 10.7 13.2H3.6C3.16 13.2 2.8 12.84 2.8 12.4V5.3C2.8 4.86 3.16 4.5 3.6 4.5H6.8',
};

export const STATUS_FALLBACKS: Record<string, string> = {
	'zotero-tabflow-pdf-preview-loading': '正在加载 PDF 预览…',
	'zotero-tabflow-pdf-preview-unavailable': '当前条目无可用的 PDF 附件',
	'zotero-tabflow-pdf-preview-missing-file': '找不到本地 PDF 文件，请先检查附件存储路径',
	'zotero-tabflow-pdf-preview-error': '无法渲染此 PDF，请尝试在阅读器中打开',
};

export function ensurePreviewStyles(doc: Document): void {
	if (!doc?.getElementById) return;
	let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
	if (!style) {
		style = createXhtmlEl(doc, 'style');
		style.id = STYLE_ID;
		(doc.head || doc.documentElement)?.append(style);
	}
	if (style.textContent !== PREVIEW_CSS) style.textContent = PREVIEW_CSS;
}

export function removePreviewStyles(doc?: Document | null): void {
	doc?.getElementById?.(STYLE_ID)?.remove?.();
}

export function createXhtmlEl<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css = ''): HTMLElementTagNameMap[K] {
	const node = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];
	if (css) node.style.cssText = css;
	return node;
}

export function createToolBtn(doc: Document, text: string, l10nId?: string, extraClass = '', iconKey?: string): HTMLButtonElement {
	const btn = createXhtmlEl(doc, 'button');
	btn.type = 'button';
	btn.className = extraClass ? `ztf-pdf-btn ${extraClass}` : 'ztf-pdf-btn';
	if (l10nId) btn.setAttribute('data-l10n-id', l10nId);
	const d = iconKey ? TOOL_SVG_PATHS[iconKey] : '';
	if (d && typeof doc.createElementNS === 'function') {
		const svg = doc.createElementNS(SVG_NS, 'svg') as unknown as SVGElement;
		for (const [k, v] of [['viewBox', '0 0 16 16'], ['width', '12'], ['height', '12'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.6'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['class', 'ztf-pdf-btn-svg']]) {
			svg.setAttribute(k, v);
		}
		const path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', d); svg.append(path); btn.append(svg);
		if (text && iconKey === 'openReader') {
			const span = createXhtmlEl(doc, 'span'); span.textContent = text; btn.append(span);
		}
	} else if (text) btn.textContent = text;
	return btn;
}

export function applyStatusMessage(statusEl: HTMLDivElement, l10nId: string): void {
	if (!l10nId) {
		statusEl.style.display = 'none'; statusEl.removeAttribute('data-l10n-id'); statusEl.textContent = '';
		return;
	}
	statusEl.style.display = 'block'; statusEl.setAttribute('data-l10n-id', l10nId);
	statusEl.textContent = t(l10nId, STATUS_FALLBACKS[l10nId] || l10nId);
}

export function logPreviewDebug(event: string, detail: Record<string, unknown> = {}): void {
	try { if (getPref('debug')) Zotero.debug?.(`[TabFlow:PDFPreview] ${event} ${JSON.stringify(detail)}`); } catch { /* ignore */ }
}

export function isSectionEnabled(context: SectionContext, prefEnabled: boolean): boolean {
	const tabType = context.tabType;
	return Boolean(prefEnabled && (!tabType || tabType === 'library' || tabType === 'reader'));
}

export function ensureSectionConnected(
	body: HTMLElement, root: HTMLElement, savedSection?: Element | null, savedCollapsible?: Element | null,
): SectionOwner | null {
	if (!body.contains(root)) body.replaceChildren(root);
	let owner = (body.closest?.('collapsible-section') ||
		(body.parentElement?.localName === 'collapsible-section' ? body.parentElement : null)) as SectionOwner | null;

	if (!owner) {
		const doc = body.ownerDocument;
		let hostSection = (body.closest?.('item-pane-custom-section') || savedSection || null) as any;
		if ((!hostSection || hostSection.isConnected === false) && doc?.querySelectorAll) {
			const candidates = Array.from(doc.querySelectorAll('item-pane-custom-section[data-pane*="tabflow-pdf-preview"]')) as any[];
			hostSection = candidates.find((c) => c._body === body) || candidates.find((c) => !c.querySelector('[data-type="body"]')) || hostSection;
		}
		const liveCollapsible = (hostSection?.querySelector?.('collapsible-section') ||
			(savedCollapsible?.isConnected ? savedCollapsible : null)) as SectionOwner | null;
		if (liveCollapsible) {
			const existingBody = liveCollapsible.querySelector?.('[data-type="body"]') as HTMLElement | null;
			if (!existingBody) liveCollapsible.append(body);
			else if (existingBody !== body) { existingBody.replaceWith(body); if (hostSection) hostSection._body = body; }
			owner = liveCollapsible;
		}
	}
	if (!owner) return null;
	owner.removeAttribute?.('empty');
	if ('empty' in owner) owner.empty = false;
	if (!owner.hasAttribute?.('data-tabflow-preview-ready')) {
		owner.setAttribute?.('data-tabflow-preview-ready', 'true'); owner.open = true;
	}
	(owner as HTMLElement).style?.setProperty?.('--open-height', 'auto');
	return owner;
}

export function ensureSectionVisible(body?: HTMLElement, _doc?: Document | null): void {
	const firstChild = body?.firstElementChild as HTMLElement | null;
	if (body && firstChild) ensureSectionConnected(body, firstChild);
}

export function applyPreviewLayoutMode(
	body: HTMLElement, root: HTMLElement, savedSection: Element | null, fullActive: boolean,
): void {
	root.setAttribute('data-layout-mode', fullActive ? 'full' : 'section');
	const hostSection = (body.closest?.('item-pane-custom-section') || savedSection) as HTMLElement | null;
	const stack = hostSection?.parentElement as HTMLElement | null;
	if (!hostSection) return;
	if (fullActive) {
		hostSection.setAttribute('data-ztf-pdf-full-section', 'true');
		stack?.setAttribute('data-ztf-pdf-full-stack', 'true');
		for (const child of Array.from(stack?.parentElement?.children || [])) {
			const tag = (child.localName || child.tagName || '').toLowerCase();
			if (child !== stack && tag !== 'item-pane-sidenav' && !child.querySelector?.('item-pane-sidenav')) {
				child.setAttribute('data-ztf-pdf-full-hidden', 'true');
			}
		}
	} else {
		hostSection.removeAttribute('data-ztf-pdf-full-section');
		stack?.removeAttribute('data-ztf-pdf-full-stack');
		body.ownerDocument?.querySelectorAll?.('[data-ztf-pdf-full-hidden]').forEach((el: Element) => el.removeAttribute('data-ztf-pdf-full-hidden'));
	}
}

export function bindPreviewSidenavClick(doc: Document, signal: AbortSignal, onFullModeChange?: (active: boolean) => void): void {
	if (typeof doc.addEventListener !== 'function') return;
	doc.addEventListener('click', (event: Event) => {
		if ((event as MouseEvent).button !== 0) return;
		const btn = (event.target as Element | null)?.closest?.('item-pane-sidenav .btn[data-pane]') as HTMLElement | null;
		const paneID = btn?.getAttribute?.('data-pane') || '';
		if (!btn || btn.hasAttribute?.('disabled')) return;
		if (!paneID.includes('tabflow-pdf-preview')) { onFullModeChange?.(false); return; }
		if (getPref('pdfPreviewMode') === 'full') onFullModeChange?.(true);
		const sidenav = btn.closest?.('item-pane-sidenav') as (Element & { container?: any }) | null;
		const container = sidenav?.container;
		const section = (container?.getEnabledPane?.(paneID) || doc.querySelector?.(`item-pane-custom-section[data-pane="${paneID}"]`)) as HTMLElement | null;
		const collapsible = section?.querySelector?.('collapsible-section') as SectionOwner | null;
		if (collapsible) {
			collapsible.removeAttribute?.('empty'); collapsible.open = true;
			(collapsible as HTMLElement).style?.setProperty?.('--open-height', 'auto');
		}
		if (container?.scrollToPane) void container.scrollToPane(paneID, 'smooth');
	}, { capture: true, signal });
}

export function openPageJumpInput(
	doc: Document, pageLabel: HTMLSpanElement, currentPage: number, numPages: number, onCommit: (page: number) => void,
): void {
	if (numPages <= 1) return;
	const input = createXhtmlEl(doc, 'input'); input.type = 'number'; input.className = 'ztf-pdf-page-input';
	input.min = '1'; input.max = String(numPages); input.value = String(currentPage || 1);
	let closed = false;
	const finish = (commit: boolean) => {
		if (closed) return;
		closed = true;
		const target = Number(input.value);
		input.replaceWith?.(pageLabel);
		if (commit && Number.isFinite(target) && target >= 1) onCommit(Math.round(target));
	};
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') { e.preventDefault?.(); finish(true); }
		else if (e.key === 'Escape') { e.preventDefault?.(); finish(false); }
	});
	input.addEventListener('blur', () => finish(true));
	pageLabel.replaceWith?.(input); input.focus?.(); input.select?.();
}

export function evictDistantPageCanvases(
	slots: Array<{ pageNumber: number; card: HTMLDivElement; canvas: HTMLCanvasElement; renderedZoom: number | null; rendering: boolean; lastHeight: number }>,
	currentPage: number, radius = 8,
): void {
	if (slots.length <= 14) return;
	for (const slot of slots) {
		if (slot.renderedZoom !== null && !slot.rendering && Math.abs(slot.pageNumber - currentPage) > radius) {
			slot.canvas.width = 0; slot.canvas.height = 0; slot.renderedZoom = null;
			slot.card.setAttribute('data-unrendered', 'true');
			if (slot.lastHeight > 0) slot.card.style.minBlockSize = `${slot.lastHeight}px`;
		}
	}
}
