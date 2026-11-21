const test = require('node:test');
const assert = require('node:assert/strict');

const { collectOpenReaderTabs, getAdjacentReaderTab, resolveCompareItem } = require('../src/services/pdf-compare.ts');
const { ActivityTrackerService, formatReadingProgress } = require('../src/services/activity-tracker.ts');
const { TabFlowStore } = require('../src/core/store.ts');

test('pdf-compare resolves adjacent left/right reader tabs and picked reader attachment', async () => {
	const items = new Map([
		[101, { id: 101, title: 'Paper A' }],
		[102, { id: 102, title: 'Paper B' }],
		[103, { id: 103, title: 'Paper C' }],
	]);
	globalThis.Zotero = {
		Items: { getAsync: async (id) => items.get(id) ?? null },
	};
	const win = {
		Zotero_Tabs: {
			selectedID: 't2',
			_tabs: [
				{ id: 'lib', type: 'library', title: 'My Library', data: {} },
				{ id: 't1', type: 'reader', title: 'Paper A', data: { itemID: 101 } },
				{ id: 't2', type: 'reader', title: 'Paper B', data: { itemID: 102 } },
				{ id: 't3', type: 'reader', title: 'Paper C', data: { itemID: 103 } },
			],
		},
	};

	const readers = collectOpenReaderTabs(win);
	assert.equal(readers.length, 3);
	assert.equal(readers[1].isSelected, true);
	assert.equal(getAdjacentReaderTab(win, 'left')?.attachmentID, 101);
	assert.equal(getAdjacentReaderTab(win, 'right')?.attachmentID, 103);

	const leftRes = await resolveCompareItem(win, 'left', null, items.get(102));
	assert.equal(leftRes.item?.id, 101);
	const pickRes = await resolveCompareItem(win, 'pick', 103, items.get(102));
	assert.equal(pickRes.item?.id, 103);
	const selfRes = await resolveCompareItem(win, 'self', null, items.get(102));
	assert.equal(selfRes.item?.id, 102);
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
