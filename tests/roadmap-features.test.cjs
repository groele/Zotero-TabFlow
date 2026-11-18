const test = require('node:test');
const assert = require('node:assert/strict');

const memPrefs = new Map();
globalThis.Zotero = {
	Prefs: {
		get(key) {
			return memPrefs.has(key) ? memPrefs.get(key) : undefined;
		},
		set(key, val) {
			memPrefs.set(key, val);
		},
	},
	Reader: {
		getByTabID() {
			return null;
		},
	},
	logError() {},
};

const { TabFlowStore } = require('../src/core/store.ts');
const { setPref } = require('../src/core/prefs.ts');
const { ItemMetadataService } = require('../src/services/item-metadata.ts');
const { TabActionService } = require('../src/services/tab-actions.ts');
const {
	buildPublicationGroupSuggestions,
	buildSessionRestorePlan,
	executeSessionRestorePlan,
	exportSessionsJson,
	parseAndPreviewSessionImport,
} = require('../src/services/session-restore.ts');
const { partitionPinnedOverflow } = require('../src/ui/pinned-strip.ts');
const { computeNextNavIndex, isEditableKeyboardTarget } = require('../src/ui/sidebar-keyboard.ts');
const { computeWorkspaceStatusCounts } = require('../src/ui/sidebar-status.ts');

test('session restore plan previews open, missing, reassigned, pin diffs and saves pre-replace backup', async () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const gOld = store.ensureGroup('Old');
	const gSnap = { id: 'g-snap', name: 'Target', color: '#3977d5' };
	store.assignKey('1:OPEN', gOld.id);
	store.setPinnedKeys(['1:OLD_PIN'], true);

	const snapshot = {
		id: 's-1',
		name: 'Paper Writing',
		createdAt: Date.now(),
		groups: [gSnap],
		assignments: { '1:OPEN': gSnap.id, '1:TO_OPEN': gSnap.id },
		pinned: ['1:TO_OPEN'],
		openKeys: ['1:OPEN', '1:TO_OPEN', '1:GONE'],
	};

	const fakeResolver = async (libID, itemKey) => {
		if (libID === 1 && itemKey === 'TO_OPEN') return { id: 202, deleted: false, getField: () => 'Restored Paper' };
		return null;
	};

	const mergePlan = await buildSessionRestorePlan(store, ['1:OPEN'], snapshot, true, fakeResolver);
	assert.equal(mergePlan.alreadyOpenCount, 1);
	assert.equal(mergePlan.toOpen.length, 1);
	assert.equal(mergePlan.toOpen[0].fullKey, '1:TO_OPEN');
	assert.equal(mergePlan.missing.length, 1);
	assert.equal(mergePlan.missing[0].fullKey, '1:GONE');
	assert.equal(mergePlan.reassignedCount, 1); // 1:OPEN stays gOld in merge, 1:TO_OPEN assigned gSnap
	assert.deepEqual(mergePlan.pinAdded, ['1:TO_OPEN']);
	assert.deepEqual(mergePlan.pinRemoved, []);

	const replacePlan = await buildSessionRestorePlan(store, ['1:OPEN'], snapshot, false, fakeResolver);
	assert.equal(replacePlan.reassignedCount, 2); // 1:OPEN changes gOld->gSnap and 1:TO_OPEN unassigned->gSnap
	assert.deepEqual(replacePlan.pinRemoved, ['1:OLD_PIN']);

	const openedIDs = [];
	await executeSessionRestorePlan(
		replacePlan,
		store,
		async (itemID) => { openedIDs.push(itemID); },
		['1:OPEN'],
	);
	assert.deepEqual(openedIDs, [202]);
	assert.equal(store.groupOfKey('1:OPEN'), gSnap.id);
	assert.ok(store.state.sessions.some((s) => s.kind === 'pre-replace'));
});

test('rolling snapshots deduplicate identical layouts, cap at 3, and templates keep structure only', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const g = store.ensureGroup('Methods');
	store.assignKey('1:A', g.id);

	const r1 = store.saveRollingSnapshot(['1:A']);
	assert.ok(r1);
	assert.equal(store.saveRollingSnapshot(['1:A']), null); // duplicate skipped
	assert.ok(store.saveRollingSnapshot(['1:A', '1:B']));
	assert.ok(store.saveRollingSnapshot(['1:A', '1:B', '1:C']));
	assert.ok(store.saveRollingSnapshot(['1:A', '1:B', '1:C', '1:D']));
	assert.equal(store.state.rollingSessions.length, 3);
	assert.equal(store.state.sessions.length, 0);

	const tpl = store.saveLayoutTemplate('Empty Layout');
	assert.equal(tpl.kind, 'template');
	assert.deepEqual(tpl.openKeys, []);
	assert.deepEqual(tpl.assignments, {});
	assert.equal(tpl.groups.length, 1);
});

test('cross-machine session export and import preview report unrecognized entries', async () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const s = store.saveSession('Desktop Sync', ['1:KEEP', '1:MISSING']);
	const raw = exportSessionsJson([s], '17.2.0');
	const preview = await parseAndPreviewSessionImport(raw, async (_lib, key) => (key === 'KEEP' ? { id: 10 } : null));
	assert.equal(preview.sessions.length, 1);
	assert.equal(preview.resolvableCount, 1);
	assert.equal(preview.missing.length, 1);
	assert.equal(preview.missing[0].fullKey, '1:MISSING');
	assert.equal(store.importSessions(preview.sessions), 1);
	assert.equal(store.state.sessions.length, 2);
});

test('TabActionService closes batches in one host call, protects pinned tabs, supports undoClose and unload', async () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const g = store.ensureGroup('Batch');
	store.assignKeys(['1:A', '1:B', '1:PIN'], g.id);
	store.setPinnedKeys(['1:PIN'], true);

	const closedCalls = [];
	const unloaded = [];
	let undoCalls = 0;
	const fakeWin = {
		Zotero_Tabs: {
			selectedID: 't-cur',
			_tabs: [
				{ id: 't-a', type: 'reader', title: 'Paper A', data: { itemID: 1 } },
				{ id: 't-b', type: 'reader', title: 'Paper B', data: { itemID: 2 } },
				{ id: 't-pin', type: 'reader', title: 'Pinned', data: { itemID: 3 } },
			],
			close(arg) { closedCalls.push(arg); },
			undoClose() { undoCalls++; },
			unload(id) { unloaded.push(id); },
		},
	};
	globalThis.Zotero.Items = {
		get(id) {
			const keys = { 1: 'A', 2: 'B', 3: 'PIN' };
			return { id, libraryID: 1, key: keys[id], getField: () => `Title ${keys[id]}` };
		},
	};

	const meta = new ItemMetadataService(fakeWin, store);
	const actions = new TabActionService(fakeWin, store, meta);

	const count = await actions.closeTabs(['t-a', 't-b', 't-pin'], { preserveVirtual: true, protectPinned: true });
	assert.equal(count, 2);
	assert.deepEqual(closedCalls, [['t-a', 't-b']]);
	assert.ok(store.state.virtualMembers['1:A']);
	assert.ok(store.state.virtualMembers['1:B']);
	assert.equal(store.state.virtualMembers['1:PIN'], undefined);

	assert.equal(actions.undoCloseTab(), true);
	assert.equal(undoCalls, 1);

	assert.equal(actions.sleepTab('t-a'), true);
	assert.deepEqual(unloaded, ['t-a']);
	assert.equal(store.isSleeping('1:A'), true);
});

test('publication group suggestions, pinned overflow, keyboard navigation guards, subtitle lastViewed and budget counts', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const existing = store.ensureGroup('Nature');
	const suggestions = buildPublicationGroupSuggestions(store, [
		{ tab: { id: '1', type: 'reader' }, key: '1:A', itemID: 1, parentItemID: 1, title: 'T1', shortTitle: 'T1', filename: 'a.pdf', source: 'Science', creatorYear: '', collection: 'C', groupId: '', pinned: false, status: 'active' },
		{ tab: { id: '2', type: 'reader' }, key: '1:B', itemID: 2, parentItemID: 2, title: 'T2', shortTitle: 'T2', filename: 'b.pdf', source: 'Science', creatorYear: '', collection: 'C', groupId: '', pinned: false, status: 'active' },
		{ tab: { id: '3', type: 'reader' }, key: '1:C', itemID: 3, parentItemID: 3, title: 'T3', shortTitle: 'T3', filename: 'c.pdf', source: 'Nature', creatorYear: '', collection: 'C', groupId: '', pinned: false, status: 'active' },
		{ tab: { id: '4', type: 'reader' }, key: '1:D', itemID: 4, parentItemID: 4, title: 'T4', shortTitle: 'T4', filename: 'd.pdf', source: 'Cell', creatorYear: '', collection: 'C', groupId: '', pinned: false, status: 'active' },
	]);
	assert.equal(suggestions.length, 2);
	assert.equal(suggestions[0].venue, 'Science');
	assert.equal(suggestions[1].venue, 'Nature');
	assert.equal(suggestions[1].existingGroupId, existing.id);

	assert.equal(partitionPinnedOverflow([80, 80, 80], 300), 3);
	assert.equal(partitionPinnedOverflow([90, 90, 90, 90], 240, 50, 4), 2);
	assert.equal(partitionPinnedOverflow([90, 90, 90, 90], 220, 50, 4), 1);

	assert.equal(computeNextNavIndex(-1, 4, 'ArrowDown'), 0);
	assert.equal(computeNextNavIndex(1, 4, 'ArrowDown'), 2);
	assert.equal(computeNextNavIndex(0, 4, 'ArrowUp'), 0);
	assert.equal(computeNextNavIndex(2, 4, 'End'), 3);
	assert.equal(isEditableKeyboardTarget({ matches: (s) => s.includes('input'), closest: () => null }), true);
	assert.equal(isEditableKeyboardTarget({ matches: () => false, closest: () => ({}) }), true);
	assert.equal(isEditableKeyboardTarget({ matches: () => false, closest: () => null }), false);

	store.state.history['1:X'] = { firstSeen: Date.now() - 3 * 3600_000, lastViewed: Date.now() - 2 * 3600_000 };
	setPref('verticalTabSubtitleMode', 'lastViewed');
	const meta = new ItemMetadataService({}, store);
	assert.match(meta.getDisplaySubtitle({ key: '1:X', source: 'S', creatorYear: 'C', collection: 'Col' }), /2/);

	setPref('activeReaderBudget', 1);
	const counts = computeWorkspaceStatusCounts([
		{ status: 'active' },
		{ status: 'active' },
		{ status: 'sleeping' },
	], store);
	assert.equal(counts.active, 2);
	assert.equal(counts.sleeping, 1);
	assert.equal(counts.overBudget, true);
});

test('replacing with layout template also saves a pre-replace backup snapshot', async () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const g = store.ensureGroup('ActiveWork');
	store.assignKey('1:CUR', g.id);
	store.setPinnedKeys(['1:CUR'], true);
	const tpl = store.saveLayoutTemplate('Fresh Template');

	const replacePlan = await buildSessionRestorePlan(store, ['1:CUR'], tpl, false, async () => null);
	await executeSessionRestorePlan(replacePlan, store, async () => {}, ['1:CUR']);

	assert.equal(store.groupOfKey('1:CUR'), '');
	assert.deepEqual(store.state.pinned, []);
	assert.ok(store.state.sessions.some((s) => s.kind === 'pre-replace'));
});
