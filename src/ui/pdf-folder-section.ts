import { getPref } from '../core/prefs.ts';

interface SectionState {
	body: HTMLElement;
	item: any | null;
	btn: HTMLButtonElement;
	meta: HTMLDivElement;
}

type SectionUpdate = { body: HTMLElement; item: any; setEnabled: (enabled: boolean) => void };
type ItemPaneSidenav = Element & { container?: { item?: any } };
const FOLDER_CLICK_INTERVAL_MS = 500;
const FOLDER_ICON = 'item-pane-sidenav .btn[data-l10n-id="zotero-tabflow-pdf-folder-sidenav"]';
const FOLDER_ACTION = `${FOLDER_ICON}, button.ztf-pdf-folder-action`;

function folderActionTarget(event: Event): Element | undefined {
	return event.composedPath().find((node): node is Element =>
		(node as Element).matches?.(FOLDER_ACTION) === true,
	);
}

export class PdfFolderSectionController {
	private sectionID: string | false = false;
	private states = new Map<HTMLElement, SectionState>();
	private listeners = new Map<Document, AbortController>();
	private openingFolders = new WeakSet<Window>();
	private recentFolder: { path: string; openedAt: number } | null = null;

	register(pluginID: string, rootURI: string): void {
		if (this.sectionID || !Zotero.ItemPaneManager?.registerSection) return;
		this.sectionID = (Zotero.ItemPaneManager.registerSection as any)({
			paneID: 'tabflow-pdf-folder',
			pluginID,
			header: { l10nID: 'zotero-tabflow-pdf-folder-title', icon: `${rootURI}pdf-folder.svg` },
			sidenav: { l10nID: 'zotero-tabflow-pdf-folder-sidenav', icon: `${rootURI}pdf-folder.svg`, orderable: true },
			onInit: ({ doc, body }: { doc: Document; body: HTMLElement }) => this.onInit(doc, body),
			onDestroy: ({ doc, body }: { doc: Document; body: HTMLElement }) => this.onDestroy(doc, body),
			onItemChange: (props: SectionUpdate) => this.renderSection(props),
			onRender: (props: SectionUpdate) => this.renderSection(props),
		});
	}

	private onInit(doc: Document, body: HTMLElement): void {
		const win = doc.defaultView;
		if (!win) return;
		win.MozXULElement?.insertFTLIfNeeded?.('zotero-tabflow.ftl');
		let controller = this.listeners.get(doc);
		if (!controller) {
			controller = new (win as Window & typeof globalThis).AbortController();
			this.listeners.set(doc, controller);
			this.bindFolderActions(doc, win, controller.signal);
		}

		body.textContent = '';
		const wrap = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		wrap.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-inline-size:0;contain:inline-size;padding:4px 0;font:12px/1.4 system-ui,sans-serif;';

		const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLDivElement;
		meta.style.cssText = 'opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		const btn = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
		btn.type = 'button';
		btn.className = 'ztf-pdf-folder-action';
		btn.setAttribute('data-l10n-id', 'zotero-tabflow-pdf-folder-open');
		btn.style.cssText = 'justify-self:start;min-inline-size:0;max-inline-size:100%;box-sizing:border-box;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;white-space:normal;overflow-wrap:anywhere;text-align:start;';
		btn.disabled = true;

		wrap.append(meta, btn);
		body.append(wrap);
		this.states.set(body, { body, item: null, btn, meta });
	}

	private bindFolderActions(doc: Document, win: Window, signal: AbortSignal): void {
		const options = { capture: true, signal };
		let pressed: Element | undefined;
		let keyed: Element | undefined;
		doc.addEventListener('pointerdown', (event: PointerEvent) => {
			keyed = undefined;
			pressed = event.isTrusted && event.button === 0 ? folderActionTarget(event) : undefined;
		}, options);
		doc.addEventListener('pointercancel', () => { pressed = undefined; }, options);
		doc.addEventListener('keydown', (event: KeyboardEvent) => {
			pressed = undefined;
			keyed = event.isTrusted && !event.repeat && (event.key === 'Enter' || event.key === ' ')
				? folderActionTarget(event) : undefined;
		}, options);
		doc.addEventListener('click', (event: MouseEvent) => {
			const target = folderActionTarget(event);
			const activated = target && (event.detail === 0 ? keyed : pressed) === target;
			keyed = pressed = undefined;
			if (!activated || !event.isTrusted || event.button !== 0 || event.detail > 1) return;
			if (!getPref('enablePdfFolderSidenav')) return;

			const sidenav = target.closest('item-pane-sidenav') as ItemPaneSidenav | null;
			const item = sidenav
				? sidenav.container?.item
				: [...this.states.values()].find((state) => state.btn === target && !state.btn.disabled)?.item;
			if (item) void this.openAttachmentFolder(win, item, signal);
		}, options);
	}

	private onDestroy(doc: Document, body: HTMLElement): void {
		this.states.delete(body);
		if ([...this.states.keys()].some((other) => other.ownerDocument === doc)) return;
		this.listeners.get(doc)?.abort();
		this.listeners.delete(doc);
	}

	private renderSection({ body, item, setEnabled }: SectionUpdate): void {
		const enabled = getPref('enablePdfFolderSidenav') && Boolean(item);
		setEnabled(enabled);
		const state = this.states.get(body);
		if (!state) return;
		state.item = enabled ? item : null;
		void this.updateBody(state);
	}

	private async resolveFileAttachment(item: any): Promise<any | null> {
		if (!item) return null;
		if (item.isFileAttachment?.()) return item;
		const best = await item.getBestAttachment?.();
		return best?.isFileAttachment?.() ? best : null;
	}

	private async updateBody(st: SectionState): Promise<void> {
		const item = st.item;
		st.btn.disabled = true;
		st.btn.style.opacity = '0.5';
		st.meta.textContent = '';
		st.meta.removeAttribute('title');
		st.meta.removeAttribute('data-l10n-id');
		if (!item) return;
		const att = await this.resolveFileAttachment(item).catch(() => null);
		if (this.states.get(st.body) !== st || st.item !== item) return;
		if (!att) {
			st.meta.setAttribute('data-l10n-id', 'zotero-tabflow-pdf-folder-unavailable');
			return;
		}
		st.meta.textContent = String(att.attachmentFilename || att.getField?.('title') || '附件文件');
		st.meta.title = st.meta.textContent;
		st.btn.disabled = false;
		st.btn.style.opacity = '1';
	}

	private async openAttachmentFolder(win: Window, item: any, signal: AbortSignal): Promise<void> {
		if (signal.aborted || this.openingFolders.has(win)) return;
		this.openingFolders.add(win);
		try {
			const att = await this.resolveFileAttachment(item);
			if (signal.aborted || !att) return;
			const filePath = await att.getFilePathAsync?.();
			if (signal.aborted || !filePath) return;
			const folder = Zotero.File.pathToFile(filePath).parent?.path;
			if (!folder) return;
			const now = Date.now();
			if (this.recentFolder?.path === folder && now - this.recentFolder.openedAt < FOLDER_CLICK_INTERVAL_MS) return;
			Zotero.launchFile(folder);
			this.recentFolder = { path: folder, openedAt: now };
		} catch (error) {
			Zotero.logError(error instanceof Error ? error : new Error(String(error)));
		} finally {
			this.openingFolders.delete(win);
		}
	}

	unregister(): void {
		this.recentFolder = null;
		for (const controller of this.listeners.values()) controller.abort();
		this.listeners.clear();
		if (this.sectionID) {
			Zotero.ItemPaneManager?.unregisterSection?.(this.sectionID);
			this.sectionID = false;
		}
		this.states.clear();
	}
}
