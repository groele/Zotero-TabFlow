const assert = require('node:assert/strict');
const test = require('node:test');
const {
	resolveAllPdfAttachments,
	resolvePdfAttachment,
	setPdfJsLoaderForTest,
} = require('../src/services/pdf-preview-renderer.ts');
const { applyPreviewLayoutMode, evictDistantPageCanvases } = require('../src/ui/item-pane-section-compat.ts');
const { PdfPreviewSectionController } = require('../src/ui/pdf-preview-section.ts');

function createFakeNode(tag) {
	const attrs = new Map();
	const listeners = new Map();
	const children = [];
	const node = {
		tagName: String(tag).toUpperCase(),
		localName: String(tag).toLowerCase(),
		style: {},
		disabled: false,
		clientWidth: 260,
		scrollTop: 0,
		offsetTop: 0,
		ownerDocument: null,
		isConnected: true,
		children,
		contains: (target) => target === node || children.includes(target),
		replaceChildren: (...nodes) => {
			children.length = 0;
			children.push(...nodes);
		},
		querySelector: (selector) => selector === 'collapsible-section' ? (node.collapsibleChild || null) : null,
		closest: (selector) => {
			if (selector === 'collapsible-section') return node.closestSection || null;
			if (selector === 'item-pane-custom-section') return node.closestCustomSection || null;
			return null;
		},
		setAttribute: (k, v) => attrs.set(k, String(v)),
		getAttribute: (k) => attrs.get(k) ?? null,
		removeAttribute: (k) => attrs.delete(k),
		append: (...nodes) => {
			for (const n of nodes) {
				if (n?.isFragment) children.push(...n.children);
				else children.push(n);
			}
		},
		addEventListener: (type, fn) => {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		dispatch: (type) => {
			for (const fn of listeners.get(type) || []) fn({ target: node });
		},
		getContext: () => ({}),
		scrollIntoView: () => {},
		set textContent(v) {
			node._text = String(v);
			if (v === '') children.length = 0;
		},
		get textContent() {
			return node._text || '';
		},
	};
	return node;
}

function createFakeDoc() {
	const win = {
		AbortController,
		devicePixelRatio: 1,
		requestAnimationFrame: (fn) => { fn(); return 1; },
		MozXULElement: { insertFTLIfNeeded: () => {} },
	};
	return {
		defaultView: win,
		createElementNS: (_ns, tag) => createFakeNode(tag),
		createDocumentFragment: () => ({ isFragment: true, children: [], append: function (...ns) { this.children.push(...ns); } }),
	};
}

test('resolvePdfAttachment resolves direct PDF, skips HTML snapshots, and finds fallback PDF attachment', async () => {
	const pdfAtt = { id: 101, isPDFAttachment: () => true, isFileAttachment: () => true, attachmentContentType: 'application/pdf' };
	assert.equal(await resolvePdfAttachment(pdfAtt), pdfAtt);

	const htmlAtt = { id: 102, isPDFAttachment: () => false, isFileAttachment: () => true, attachmentContentType: 'text/html' };
	const trashedPdf = { id: 103, deleted: true, isPDFAttachment: () => true };
	globalThis.Zotero = {
		Items: { getAsync: async () => [trashedPdf, htmlAtt, pdfAtt] },
	};
	const parentItem = {
		id: 1,
		getBestAttachment: async () => htmlAtt,
		getAttachments: () => [103, 102, 101],
	};
	assert.equal(await resolvePdfAttachment(parentItem), pdfAtt);
	assert.equal(await resolvePdfAttachment({ id: 2, deleted: true }), null);

	const suppPdf = { id: 104, isPDFAttachment: () => true, getField: () => 'Supplementary.pdf' };
	globalThis.Zotero.Items.getAsync = async () => [trashedPdf, htmlAtt, pdfAtt, suppPdf];
	const allPdfs = await resolveAllPdfAttachments(parentItem);
	assert.equal(allPdfs.length, 2);
	assert.equal(allPdfs[0].id, 101);
	assert.equal(allPdfs[1].id, 104);
	assert.equal(allPdfs[1].title, 'Supplementary.pdf');
});

test('evictDistantPageCanvases releases distant canvas buffers on long documents while preserving card height', () => {
	const slots = Array.from({ length: 20 }, (_, i) => {
		const card = createFakeNode('div');
		const canvas = { width: 400, height: 600, style: {} };
		return {
			pageNumber: i + 1,
			card,
			canvas,
			renderedZoom: 1,
			rendering: false,
			lastHeight: 360,
		};
	});
	evictDistantPageCanvases(slots, 1, 8);
	assert.equal(slots[0].canvas.width, 400, 'current page remains allocated');
	assert.equal(slots[8].canvas.width, 400, 'page within radius remains allocated');
	assert.equal(slots[15].canvas.width, 0, 'distant page canvas buffer is released');
	assert.equal(slots[15].renderedZoom, null);
	assert.equal(slots[15].card.getAttribute('data-unrendered'), 'true');
	assert.equal(slots[15].card.style.minBlockSize, '360px');
});

test('PdfPreviewSectionController enables on init, clears empty state, and filters unsupported tabs', () => {
	let registeredConfig = null;
	let unregisteredId = null;
	globalThis.Zotero = {
		Prefs: { get: () => true, set: () => {} },
		logError: (err) => assert.fail(err),
		ItemPaneManager: {
			registerSection: (cfg) => {
				registeredConfig = cfg;
				return 'sec-pdf-preview-init';
			},
			unregisterSection: (id) => {
				unregisteredId = id;
			},
		},
	};

	const controller = new PdfPreviewSectionController();
	controller.register('zotero-tabflow@groele', 'chrome://tabflow/');

	const doc = createFakeDoc();
	const section = createFakeNode('collapsible-section');
	section.setAttribute('empty', '');
	const body = createFakeNode('div');
	body.ownerDocument = doc;
	body.closestSection = section;

	let initEnabled = null;
	registeredConfig.onInit({
		doc,
		body,
		item: { id: 601 },
		tabType: 'library',
		setEnabled: (value) => { initEnabled = value; },
	});
	assert.equal(initEnabled, true);
	assert.equal(section.getAttribute('empty'), null);
	assert.equal(section.open, true);

	// Regression: Zotero fires onInit before assigning `item`. Hiding the section
	// here (because item is null) leaves it permanently un-rendered. It must stay
	// enabled and visible until a real item triggers onItemChange.
	let nullItemInitEnabled = null;
	const bodyNull = createFakeNode('div');
	bodyNull.ownerDocument = doc;
	const sectionNull = createFakeNode('collapsible-section');
	sectionNull.setAttribute('empty', '');
	bodyNull.closestSection = sectionNull;
	registeredConfig.onInit({
		doc,
		body: bodyNull,
		item: null,
		tabType: 'library',
		setEnabled: (value) => { nullItemInitEnabled = value; },
	});
	assert.equal(nullItemInitEnabled, true, 'onInit with no item must keep the section enabled');
	assert.equal(sectionNull.getAttribute('empty'), null);
	assert.equal(sectionNull.open, true);

	let noteEnabled = null;
	registeredConfig.onItemChange({
		body,
		item: { id: 601 },
		tabType: 'note',
		setEnabled: (value) => { noteEnabled = value; },
	});
	assert.equal(noteEnabled, false);

	let healedEnabled = null;
	const body2 = createFakeNode('div');
	body2.ownerDocument = doc;
	const section2 = createFakeNode('collapsible-section');
	body2.closestSection = section2;
	registeredConfig.onItemChange({
		body: body2,
		item: { id: 602 },
		tabType: 'library',
		setEnabled: (value) => { healedEnabled = value; },
	});
	assert.equal(healedEnabled, true);
	assert.ok(body2.children[0], 'onItemChange must rebuild a missing preview body');
	assert.equal(section2.open, true);

	controller.unregister();
	assert.equal(unregisteredId, 'sec-pdf-preview-init');
});

test('PdfPreviewSectionController renders PDF pages, handles zoom/page nav, disposes old docs, and opens reader', async () => {
	let registeredConfig = null;
	let unregisteredId = null;
	const destroyedDocs = [];
	const renderedPages = [];
	const openedReaderIds = [];

	globalThis.IOUtils = { read: async () => new Uint8Array([37, 80, 68, 70]) };
	globalThis.Zotero = {
		Prefs: { get: () => true, set: () => {} },
		logError: (err) => assert.fail(err),
		Reader: { open: async (id) => { openedReaderIds.push(id); } },
		ItemPaneManager: {
			registerSection: (cfg) => {
				registeredConfig = cfg;
				return 'sec-pdf-preview';
			},
			unregisterSection: (id) => {
				unregisteredId = id;
			},
		},
	};

	setPdfJsLoaderForTest(async () => ({
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: 3,
				getPage: async (pageNumber) => ({
					getViewport: ({ scale }) => ({ width: 200 * scale, height: 300 * scale }),
					render: () => {
						renderedPages.push(pageNumber);
						return { promise: Promise.resolve(), cancel: () => {} };
					},
					cleanup: () => {},
				}),
				destroy: () => { destroyedDocs.push('doc'); },
			}),
		}),
	}));

	try {
		const controller = new PdfPreviewSectionController();
		controller.register('zotero-tabflow@groele', 'chrome://tabflow/');
		assert.equal(registeredConfig.paneID, 'tabflow-pdf-preview');

		const doc = createFakeDoc();
		const body = createFakeNode('div');
		registeredConfig.onInit({ doc, body });

		const item1 = {
			id: 501,
			isPDFAttachment: () => true,
			getFilePathAsync: async () => '/tmp/paper1.pdf',
		};
		let enabledFlag = false;
		registeredConfig.onItemChange({ body, item: item1, setEnabled: (v) => { enabledFlag = v; } });
		assert.equal(enabledFlag, true);

		await new Promise((r) => setTimeout(r, 20));
		assert.ok(renderedPages.includes(1));
		assert.ok(renderedPages.includes(2));

		const root = body.children[0];
		const toolbar = root.children[0];
		const navGroup = toolbar.children[0];
		const zoomGroup = toolbar.children[1];
		const pageLabel = navGroup.children[1];
		const nextBtn = navGroup.children[2];
		const zoomInBtn = zoomGroup.children[2];
		const modeBtn = zoomGroup.children[3];
		const openBtn = zoomGroup.children[4];

		assert.equal(pageLabel.textContent, '1 / 3');
		nextBtn.dispatch('click');
		assert.equal(pageLabel.textContent, '2 / 3');

		zoomInBtn.dispatch('click');
		assert.equal(zoomGroup.children[1].textContent, '120%');

		openBtn.dispatch('click');
		await new Promise((r) => setTimeout(r, 10));
		assert.deepEqual(openedReaderIds, [501]);

		const viewportEl = root.children[2];
		const secondCard = viewportEl.children[1];
		secondCard.dispatch('dblclick');
		await new Promise((r) => setTimeout(r, 10));
		assert.deepEqual(openedReaderIds, [501, 501]);

		const item2 = {
			id: 502,
			isPDFAttachment: () => true,
			getFilePathAsync: async () => '/tmp/paper2.pdf',
		};
		registeredConfig.onItemChange({ body, item: item2, setEnabled: () => {} });
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(destroyedDocs.length, 1);

		controller.unregister();
		assert.equal(unregisteredId, 'sec-pdf-preview');
		assert.equal(destroyedDocs.length, 2);
	} finally {
		setPdfJsLoaderForTest(null);
	}
});

test('applyPreviewLayoutMode toggles full-sidebar and inline section attributes cleanly', () => {
	const headerEl = createFakeNode('item-pane-header');
	const sidenavEl = createFakeNode('item-pane-sidenav');
	const stack = createFakeNode('div');
	const customSection = createFakeNode('item-pane-custom-section');
	const body = createFakeNode('div');
	const root = createFakeNode('div');
	const outer = createFakeNode('div');
	outer.children.push(headerEl, stack, sidenavEl);
	stack.parentElement = outer;
	customSection.parentElement = stack;
	body.closestCustomSection = customSection;

	applyPreviewLayoutMode(body, root, customSection, true);
	assert.equal(root.getAttribute('data-layout-mode'), 'full');
	assert.equal(customSection.getAttribute('data-ztf-pdf-full-section'), 'true');
	assert.equal(stack.getAttribute('data-ztf-pdf-full-stack'), 'true');
	assert.equal(headerEl.getAttribute('data-ztf-pdf-full-hidden'), 'true');
	assert.equal(sidenavEl.getAttribute('data-ztf-pdf-full-hidden'), null);

	applyPreviewLayoutMode(body, root, customSection, false);
	assert.equal(root.getAttribute('data-layout-mode'), 'section');
	assert.equal(customSection.getAttribute('data-ztf-pdf-full-section'), null);
	assert.equal(stack.getAttribute('data-ztf-pdf-full-stack'), null);
});
