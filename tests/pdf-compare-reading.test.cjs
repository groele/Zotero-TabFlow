const test = require('node:test');
const assert = require('node:assert/strict');

const { pickCompareAttachment, resolveSameItemPdfContext } = require('../src/services/pdf-compare.ts');
const { ActivityTrackerService, formatReadingProgress } = require('../src/services/activity-tracker.ts');
const { TabFlowStore } = require('../src/core/store.ts');

test('pdf-compare restricts comparison to sibling PDFs under the same parent item', async () => {
	const mainPdf = {
		id: 201,
		itemType: 'attachment',
		isAttachment: () => true,
		isPDFAttachment: () => true,
		attachmentContentType: 'application/pdf',
		getField: () => 'Main Article.pdf',
	};
	const siPdf = {
		id: 202,
		itemType: 'attachment',
		isAttachment: () => true,
		isPDFAttachment: () => true,
		attachmentContentType: 'application/pdf',
		getField: () => 'Supporting Information.pdf',
	};
	const parentItem = {
		id: 100,
		isRegularItem: () => true,
		getAttachments: () => [201, 202],
	};
	mainPdf.parentItem = parentItem;
	siPdf.parentItem = parentItem;

	const singlePdf = {
		id: 301,
		itemType: 'attachment',
		isAttachment: () => true,
		isPDFAttachment: () => true,
		attachmentContentType: 'application/pdf',
		getField: () => 'Solo Paper.pdf',
		parentItem: { id: 300, isRegularItem: () => true, getAttachments: () => [301] },
	};

	const attMap = new Map([[201, mainPdf], [202, siPdf], [301, singlePdf]]);
	globalThis.Zotero = {
		Items: { getAsync: async (ids) => (Array.isArray(ids) ? ids.map((id) => attMap.get(id)).filter(Boolean) : attMap.get(ids) ?? null) },
	};

	const ctx = await resolveSameItemPdfContext(mainPdf);
	assert.equal(ctx.currentAttachmentID, 201);
	assert.equal(ctx.entries.length, 2);
	assert.equal(pickCompareAttachment(ctx, 'sibling', null)?.id, 202);
	assert.equal(pickCompareAttachment(ctx, 'self', null)?.id, 201);
	assert.equal(pickCompareAttachment(ctx, 'sibling', 201)?.id, 201);

	const soloCtx = await resolveSameItemPdfContext(singlePdf);
	assert.equal(soloCtx.entries.length, 1);
	assert.equal(pickCompareAttachment(soloCtx, 'sibling', null)?.id, 301);
});

test('ActivityTrackerService.trackReadingProgress accumulates foreground reader seconds and page progress', () => {
	const store = new TabFlowStore();
	const meta = {
		getSelectedTabID: () => 't2',
		buildTrackedTabs: () => [
			{ key: 'att:102', tab: { id: 't2', type: 'reader', title: 'Paper B', data: { itemID: 102 } }, status: 'active', pinned: false, groupId: '' },
		],
	};
	globalThis.Zotero = {
		Prefs: { get: () => '', set: () => {} },
		Reader: {
			getByTabID: (id) => (id === 't2' ? { _iframeWindow: { PDFViewerApplication: { page: 5, pagesCount: 20 } } } : null),
		},
	};
	const tracker = new ActivityTrackerService(store, meta);
	const win = { document: { hasFocus: () => true } };

	assert.equal(tracker.trackReadingProgress(win, 60), true);
	assert.equal(tracker.trackReadingProgress(win, 60), true);
	const formatted = formatReadingProgress(store.state.history['att:102']);
	assert.equal(formatted.text, '2m · p.5/20');
	assert.equal(formatted.ratio, 0.25);

	const unfocusedWin = { document: { hasFocus: () => false } };
	assert.equal(tracker.trackReadingProgress(unfocusedWin, 60), false);
	assert.equal(store.state.history['att:102'].readSeconds, 120);
	store.flushPendingSave();
});
