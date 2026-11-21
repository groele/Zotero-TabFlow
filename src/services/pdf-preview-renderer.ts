export interface PdfViewport {
	width: number;
	height: number;
}

export interface PdfRenderTask {
	promise: Promise<void>;
	cancel?: () => void;
}

export interface PdfPageProxy {
	getViewport(params: { scale: number }): PdfViewport;
	render(params: {
		canvasContext: CanvasRenderingContext2D;
		viewport: PdfViewport;
		transform?: number[];
	}): PdfRenderTask;
	cleanup?: () => void;
}

export interface PdfDocumentProxy {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPageProxy>;
	destroy?: () => Promise<void> | void;
}

export interface PdfJsLib {
	GlobalWorkerOptions?: { workerSrc?: string };
	getDocument(src: Record<string, unknown>): {
		promise: Promise<PdfDocumentProxy>;
		destroy?: () => Promise<void> | void;
	};
}

const PDFJS_MODULE_URL = 'resource://zotero/reader/pdf/build/pdf.mjs';
const PDFJS_WORKER_URL = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
const PDFJS_CMAP_URL = 'resource://zotero/reader/pdf/web/cmaps/';
const PDFJS_FONT_URL = 'resource://zotero/reader/pdf/web/standard_fonts/';

let customPdfJsLoader: (() => Promise<PdfJsLib | null>) | null = null;
let cachedPdfJsLib: PdfJsLib | null = null;

export function setPdfJsLoaderForTest(loader: (() => Promise<PdfJsLib | null>) | null): void {
	customPdfJsLoader = loader;
	cachedPdfJsLib = null;
}

export interface PdfAttachmentEntry {
	id: number;
	title: string;
	attachment: any;
}

function isPdfAttachment(att: any): boolean {
	if (!att || att.deleted || att.isTrashed?.()) return false;
	if (typeof att.isPDFAttachment === 'function') return Boolean(att.isPDFAttachment());
	if (att.isFileAttachment?.() === false) return false;
	const mime = String(att.attachmentContentType || '').toLowerCase();
	if (mime === 'application/pdf') return true;
	const name = String(att.attachmentFilename || att.getField?.('title') || '').toLowerCase();
	return name.endsWith('.pdf');
}

function getAttachmentTitle(att: any, index: number): string {
	const raw = String(att?.getField?.('title') || att?.attachmentFilename || '').trim();
	return raw || `PDF ${index + 1}`;
}

export async function resolveAllPdfAttachments(item: any): Promise<PdfAttachmentEntry[]> {
	if (!item || item.deleted || item.isTrashed?.()) return [];
	if (isPdfAttachment(item)) {
		return [{ id: Number(item.id) || 0, title: getAttachmentTitle(item, 0), attachment: item }];
	}
	const target = (!item.isRegularItem?.() && item.parentItem) ? item.parentItem : item;
	if (isPdfAttachment(target)) {
		return [{ id: Number(target.id) || 0, title: getAttachmentTitle(target, 0), attachment: target }];
	}
	const results: PdfAttachmentEntry[] = [];
	const seen = new Set<number>();
	const pushIfPdf = (att: any) => {
		if (!isPdfAttachment(att)) return;
		const id = Number(att.id) || results.length + 1;
		if (seen.has(id)) return;
		seen.add(id);
		results.push({ id, title: getAttachmentTitle(att, results.length), attachment: att });
	};
	const best = await target.getBestAttachment?.().catch(() => null);
	pushIfPdf(best);
	const ids: number[] = target.getAttachments?.() || [];
	if (ids.length && Zotero.Items?.getAsync) {
		const attachments = await Zotero.Items.getAsync(ids).catch(() => []);
		for (const att of attachments) pushIfPdf(att);
	}
	return results;
}

export async function resolvePdfAttachment(item: any): Promise<any | null> {
	const all = await resolveAllPdfAttachments(item);
	return all[0]?.attachment ?? null;
}

export async function resolveAttachmentPath(att: any): Promise<string | null> {
	if (!att) return null;
	const path = (await att.getFilePathAsync?.().catch(() => null)) || att.getFilePath?.();
	return typeof path === 'string' && path.trim() ? path : null;
}

function binaryStringToUint8Array(raw: string): Uint8Array {
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
	return bytes;
}

export async function readPdfBytes(filePath: string): Promise<Uint8Array> {
	const ioUtils = (globalThis as any).IOUtils || (Zotero.getMainWindow?.() as any)?.IOUtils;
	if (ioUtils?.read) {
		const data = await ioUtils.read(filePath);
		return data instanceof Uint8Array ? data : new Uint8Array(data);
	}
	if ((Zotero.File as any)?.getBinaryContentsAsync) {
		const raw = await (Zotero.File as any).getBinaryContentsAsync(filePath);
		return raw instanceof Uint8Array ? raw : binaryStringToUint8Array(String(raw || ''));
	}
	throw new Error('No file reader available for PDF preview');
}

function tryImportModule(cu: any, url: string): any {
	if (!cu?.importESModule) return null;
	for (const opts of [{ global: 'current' }, null] as const) {
		try {
			const mod = opts !== null ? cu.importESModule(url, opts) : cu.importESModule(url);
			if (mod) return mod;
		} catch {
			// continue fallback
		}
	}
	return null;
}

export async function loadPdfJsLib(win?: Window | null): Promise<PdfJsLib> {
	if (customPdfJsLoader) {
		const mocked = await customPdfJsLoader();
		if (!mocked) throw new Error('PDF.js unavailable');
		return mocked;
	}
	if (cachedPdfJsLib) return cachedPdfJsLib;

	const hostWin = (win || Zotero.getMainWindow?.()) as any;
	if (hostWin && !(globalThis as any).window) {
		try {
			(globalThis as any).window = hostWin;
			(globalThis as any).document = hostWin.document;
		} catch {
			// ignore read-only global bindings
		}
	}

	const winCu = hostWin?.ChromeUtils;
	const globalCu = (globalThis as any).ChromeUtils;
	const workerMod = tryImportModule(winCu, PDFJS_WORKER_URL) || tryImportModule(globalCu, PDFJS_WORKER_URL);
	if (workerMod) {
		try {
			(globalThis as any).pdfjsWorker = workerMod;
			if (hostWin) hostWin.pdfjsWorker = workerMod;
		} catch {
			// ignore read-only bindings
		}
	}

	let mod: PdfJsLib | null =
		(tryImportModule(winCu, PDFJS_MODULE_URL) as PdfJsLib | null) ||
		(tryImportModule(globalCu, PDFJS_MODULE_URL) as PdfJsLib | null);

	if (typeof mod?.getDocument !== 'function') {
		try {
			mod = (await import(/* @vite-ignore */ PDFJS_MODULE_URL)) as unknown as PdfJsLib;
		} catch {
			mod = null;
		}
	}
	if (typeof mod?.getDocument !== 'function') {
		throw new Error('Failed to load Zotero PDF.js module');
	}
	if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
		mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
	}
	cachedPdfJsLib = mod;
	return mod;
}

export async function openPdfDocumentFromFile(filePath: string, doc?: Document | null): Promise<PdfDocumentProxy> {
	const win = doc?.defaultView || (Zotero.getMainWindow?.() as Window | undefined);
	const ownerDocument = doc || win?.document;
	const [pdfjsLib, data] = await Promise.all([loadPdfJsLib(win), readPdfBytes(filePath)]);
	const loadingTask = pdfjsLib.getDocument({
		data,
		ownerDocument,
		isEvalSupported: false,
		useWorkerFetch: false,
		cMapUrl: PDFJS_CMAP_URL,
		cMapPacked: true,
		standardFontDataUrl: PDFJS_FONT_URL,
	});
	return await loadingTask.promise;
}

export async function renderPageToCanvas(
	pdfDoc: PdfDocumentProxy,
	pageNumber: number,
	canvas: HTMLCanvasElement,
	targetWidth: number,
	zoomRatio: number,
	dpr: number,
	isAborted: () => boolean,
	onTask?: (cancel: () => void) => void,
): Promise<{ width: number; height: number; cancel: () => void }> {
	const page = await pdfDoc.getPage(pageNumber);
	if (isAborted()) {
		page.cleanup?.();
		return { width: 0, height: 0, cancel: () => {} };
	}
	const baseViewport = page.getViewport({ scale: 1 });
	const safeWidth = Math.max(120, targetWidth);
	const cssScale = (safeWidth / Math.max(1, baseViewport.width)) * zoomRatio;
	const cssViewport = page.getViewport({ scale: cssScale });
	const pixelRatio = Math.max(1.25, Math.min(3, (dpr || 1) * 1.15));

	canvas.width = Math.max(1, Math.floor(cssViewport.width * pixelRatio));
	canvas.height = Math.max(1, Math.floor(cssViewport.height * pixelRatio));
	if (Math.abs(zoomRatio - 1) < 0.01) {
		canvas.style.width = '100%';
		canvas.style.height = 'auto';
	} else {
		canvas.style.width = `${Math.floor(cssViewport.width)}px`;
		canvas.style.height = `${Math.floor(cssViewport.height)}px`;
	}

	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	const transform = pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0];
	const task = page.render({ canvasContext: ctx, viewport: cssViewport, transform });
	const cancel = () => { try { task.cancel?.(); } catch { /* ignore */ } };
	onTask?.(cancel);
	try {
		await task.promise;
	} catch (err: any) {
		if (err?.name === 'RenderingCancelledException' || isAborted()) {
			return { width: 0, height: 0, cancel };
		}
		throw err;
	} finally {
		page.cleanup?.();
	}
	return {
		width: Math.floor(cssViewport.width),
		height: Math.floor(cssViewport.height),
		cancel,
	};
}

export async function openPdfInReader(att: any, win?: Window | null, pageNumber?: number): Promise<boolean> {
	if (!att?.id) return false;
	const location = typeof pageNumber === 'number' && pageNumber > 1 ? { pageIndex: pageNumber - 1 } : undefined;
	try {
		if ((Zotero as any).Reader?.open) {
			try {
				await (Zotero as any).Reader.open(att.id, location, { openInWindow: false });
			} catch {
				await (Zotero as any).Reader.open(att.id, undefined, { openInWindow: false });
			}
			return true;
		}
		const targetWin = (win as any)?.ZoteroPane ? win : Zotero.getMainWindow?.();
		if ((targetWin as any)?.ZoteroPane?.viewAttachment) {
			await (targetWin as any).ZoteroPane.viewAttachment([att.id]);
			return true;
		}
		if ((targetWin as any)?.ZoteroPane?.viewItems) {
			await (targetWin as any).ZoteroPane.viewItems([att]);
			return true;
		}
	} catch (error) {
		Zotero.logError(error instanceof Error ? error : new Error(String(error)));
	}
	return false;
}
