const test = require('node:test');
const assert = require('node:assert/strict');
const { TabFlowStore } = require('../src/core/store.ts');
const { getPref, setPref } = require('../src/core/prefs.ts');
const { TabActionService } = require('../src/services/tab-actions.ts');
const { ItemMetadataService } = require('../src/services/item-metadata.ts');
const { buildSessionRestorePlan, executeSessionRestorePlan, exportSessionsJson, parseAndPreviewSessionImport } = require('../src/services/session-restore.ts');

function fixture() {
	const prefs = new Map();
	const items = new Map();
	globalThis.Zotero = {
		Prefs: { get: (key) => prefs.get(key), set: (key, value) => prefs.set(key, value) },
		Items: { get: (id) => items.get(id) },
		Reader: { getByTabID: () => null },
		logError() {},
	};
	const store = new TabFlowStore();
	const tabs = { selectedID: 'library', _tabs: [{ id: 'library', type: 'library' }] };
	const win = { Zotero_Tabs: tabs };
	const meta = new ItemMetadataService(win, store);
	return { prefs, items, store, tabs, win, meta, actions: new TabActionService(win, store, meta) };
}

test('clearing the persisted workspace clears the live store and releases read-only mode', () => {
	const { store, prefs } = fixture();
	const key = 'extensions.zotero.tabflow.state';
	store.ensureGroup('Previous');
	prefs.set(key, 'broken');
	store.load();
	assert.equal(store.readOnly, true);
	assert.equal(store.state.groups.length, 1);
	prefs.set(key, '');
	store.load();
	assert.equal(store.readOnly, false);
	assert.deepEqual(store.state.groups, []);
});

test('invalid numeric and boolean settings cannot break tab sizes or deadlines', () => {
	const { prefs } = fixture();
	setPref('verticalSidebarWidth', 999);
	setPref('staleSuggestDays', -1);
	prefs.set('extensions.zotero.tabflow.enableTabSleep', 'false');
	assert.equal(getPref('verticalSidebarWidth'), 440);
	assert.equal(getPref('staleSuggestDays'), 1);
	assert.equal(getPref('enableTabSleep'), true);
});

test('refused unload and reload failures leave the current tab intact', async () => {
	const { store, items, tabs, actions, meta } = fixture();
	items.set(1, { id: 1, key: 'PAPER', libraryID: 1 });
	tabs._tabs.push({ id: 'paper', type: 'reader', data: { itemID: 1 } });
	tabs.unload = () => {};
	tabs.close = () => assert.fail('Reload must not close the tab');
	assert.equal(actions.sleepInactiveTabs(), 0);
	assert.equal(store.isSleeping('1:PAPER'), false);
	let reloads = 0;
	Zotero.Reader.getByTabID = () => ({ async reload() { reloads++; throw new Error('file missing'); } });
	await actions.reloadTab('paper');
	assert.equal(reloads, 1);
	tabs._tabs[1].type = 'reader-unloaded';
	assert.equal(meta.buildTrackedTabs()[0].status, 'sleeping');
});

test('opening an existing item in the background keeps selection and restoring a note clears its virtual entry', async () => {
	const { store, items, tabs, actions } = fixture();
	items.set(2, { id: 2, libraryID: 1, key: 'NOTE', isNote: () => true });
	const opens = [];
	Zotero.Notes = { async open(id, _location, options) { opens.push([id, options.openInBackground]); } };
	store.state.virtualMembers['1:NOTE'] = { key: '1:NOTE' };
	assert.equal(await actions.openVirtualOrItem(2, undefined, true), true);
	assert.deepEqual(opens, [[2, true]]);
	assert.equal(store.state.virtualMembers['1:NOTE'], undefined);
	tabs._tabs.push({ id: 'note', type: 'note-unloaded', data: { itemID: 2 } });
	tabs.select = () => assert.fail('Background open must not select an existing tab');
	assert.equal(await actions.openVirtualOrItem(2, undefined, true), true);
	assert.equal(opens.length, 1);
});

test('restore counts failed items, skips tabs opened since preview and preserves loose heading state', async () => {
	const { store } = fixture();
	store.dissolveGroup('');
	const snapshot = store.saveSession('Saved', ['1:A', '1:B', '1:B']);
	store.setUngroupedHeadingHidden(false);
	const resolve = async (_library, key) => ({ id: key === 'A' ? 1 : 2 });
	const plan = await buildSessionRestorePlan(store, [], snapshot, false, resolve);
	assert.equal(plan.toOpen.length, 2);
	const calls = [];
	assert.deepEqual(await executeSessionRestorePlan(plan, store, async (id) => { calls.push(id); return false; }, ['1:A']), { opened: 0, failed: 1 });
	assert.deepEqual(calls, [2]);
	assert.equal(store.state.ungroupedHeadingHidden, true);
	const invalid = { ...snapshot, assignments: null, pinned: 12 };
	await assert.rejects(parseAndPreviewSessionImport(exportSessionsJson([invalid], ''), resolve), /invalid session/);
});

test('Quick Copy accepts translator output without copying a fallback title', () => {
	const { actions } = fixture();
	const copied = [];
	globalThis.Ci = { nsIClipboardHelper: 'helper' };
	globalThis.Cc = { '@mozilla.org/widget/clipboardhelper;1': { getService: () => ({ copyString: (value) => copied.push(value) }) } };
	let done;
	Zotero.QuickCopy = { getContentFromItems(_items, _format, callback) { done = callback; return true; } };
	actions.copyReferencesForItems([{ getField: () => 'Title' }]);
	assert.deepEqual(copied, []);
	done({ string: '@article{example}' }, true);
	assert.deepEqual(copied, ['@article{example}']);
});

test('import does not evict existing sessions when capacity runs out', () => {
	const { store } = fixture();
	for (let i = 0; i < 29; i++) store.saveSession(`Existing ${i}`, []);
	const ids = store.state.sessions.map((session) => session.id);
	const source = new TabFlowStore();
	const first = source.saveSession('First imported', []);
	const second = source.saveSession('Second imported', []);
	assert.equal(store.importSessions([first, second]), 1);
	assert.equal(store.state.sessions[0].name, first.name);
	assert.deepEqual(store.state.sessions.slice(1).map((session) => session.id), ids);
});
