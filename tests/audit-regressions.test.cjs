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

test('hiding an active group switches Zotero to a visible tab or library and virtual fallback resolves by key', async () => {
	const { store, items, tabs, actions, meta } = fixture();
	const group = store.ensureGroup('Active');
	const other = store.ensureGroup('Visible');
	items.set(1, { id: 1, libraryID: 1, key: 'AAA', isAttachment: () => true, isFileAttachment: () => false });
	items.set(2, { id: 2, libraryID: 1, key: 'BBB', isAttachment: () => true, isFileAttachment: () => false });
	tabs._tabs.push({ id: 'tab-1', type: 'reader', data: { itemID: 1 } }, { id: 'tab-2', type: 'reader', data: { itemID: 2 } });
	tabs.selectedID = 'tab-1';
	const selectedCalls = [];
	tabs.select = (id) => { selectedCalls.push(id); tabs.selectedID = id; };
	store.assignKey('1:AAA', group.id);
	store.assignKey('1:BBB', other.id);
	actions.hideGroup(group.id);
	assert.deepEqual(selectedCalls, ['tab-2']);

	actions.hideGroup(other.id);
	assert.deepEqual(selectedCalls, ['tab-2', 'library']);

	const opened = [];
	Zotero.Items.getByLibraryAndKeyAsync = async (_lib, key) => key === 'ZZZ'
		? { id: 99, libraryID: 1, key: 'ZZZ', isNote: () => false, isAttachment: () => true, isFileAttachment: () => false }
		: null;
	Zotero.Reader.open = async (id) => { opened.push(id); };
	assert.equal(await actions.openVirtualOrItem(999, undefined, false, '1:ZZZ'), true);
	assert.deepEqual(opened, [99]);

	Zotero.Utilities = { Internal: { renderItemTitle: (v) => `<i>${v}</i>` } };
	assert.equal(meta.plainTitle('Title'), 'Title');
});

test('Spotlight includes visible virtual members, searches hidden remarks, and toggles on Ctrl+P', () => {
	const { store, win } = fixture();
	const { SpotlightController } = require('../src/ui/spotlight.ts');
	const state = { activeElement: null };
	const makeEl = (tag) => {
		const el = {
			tagName: tag.toUpperCase(),
			className: '',
			value: '',
			children: [],
			listeners: new Map(),
			append(...nodes) { for (const n of nodes) if (n) { n.parentElement = el; el.children.push(n); } },
			addEventListener(type, fn) { const list = el.listeners.get(type) || []; list.push(fn); el.listeners.set(type, list); },
			setAttribute(k, v) { el[k] = v; },
			focus() { state.activeElement = el; },
			select() {},
			remove() {},
			openPopup() { el.state = 'open'; for (const fn of el.listeners.get('popupshown') || []) fn({ target: el }); },
			hidePopup() { el.state = 'closed'; },
			querySelectorAll(sel) {
				const cls = sel.startsWith('.') ? sel.slice(1) : '';
				const out = [];
				const walk = (node) => { for (const c of node.children) { if (c.className.split(/\s+/).includes(cls)) out.push(c); walk(c); } };
				walk(el);
				return out;
			},
		};
		return el;
	};
	const popupset = makeEl('popupset');
	const doc = { createElementNS: (_ns, t) => makeEl(t), createXULElement: (t) => makeEl(t), getElementById: (id) => id === 'mainPopupSet' ? popupset : null, querySelector: () => popupset, documentElement: makeEl('html') };
	const listeners = new Map();
	Object.assign(win, { addEventListener: (t, fn) => listeners.set(t, fn), removeEventListener: (t) => listeners.delete(t), setTimeout: (fn) => { fn(); return 1; } });
	const vis = store.ensureGroup('VisibleGroup');
	const hid = store.ensureGroup('HiddenGroup');
	store.assignKey('1:VIS', vis.id);
	store.assignKey('1:HID', hid.id);
	store.setRemark('1:HID', 'TargetRemark');
	store.saveVirtualMember({ key: '1:VIS', itemID: 11, parentItemID: null, title: 'Visible Virtual', shortTitle: 'VV', filename: 'v.pdf', source: '', creatorYear: '', collection: '', type: 'reader' });
	store.setGroupHidden(hid.id, true, [{ key: '1:HID', itemID: 12, parentItemID: null, title: 'Hidden Virtual', shortTitle: 'HV', filename: 'h.pdf', source: '', creatorYear: '', collection: '', type: 'reader' }]);
	const spotlight = new SpotlightController(win, doc, store, { buildTrackedTabs: () => [], getSelectedTabID: () => '' }, { selectTab() {}, undoCloseTab() {}, autoGroupByCollection() {} }, { openWorkspaceHub() {}, openPublicationSuggest() {}, previewAndRestoreSession() {} }, () => {});
	spotlight.init();
	listeners.get('keydown')({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'p', preventDefault() {}, stopPropagation() {} });
	const panel = popupset.children[0];
	assert.equal(panel.state, 'open');
	const input = panel.children[0].children[0];
	const results = panel.children[0].children[1];
	input.value = 'Visible Virtual';
	for (const fn of input.listeners.get('input') || []) fn();
	assert.ok(results.querySelectorAll('.ztf-spot-row').some((r) => r.children[0].textContent.includes('Visible Virtual')));
	input.value = 'TargetRemark';
	for (const fn of input.listeners.get('input') || []) fn();
	assert.ok(results.querySelectorAll('.ztf-spot-row').some((r) => r.children[0].textContent.includes('TargetRemark')));
	listeners.get('keydown')({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'p', preventDefault() {}, stopPropagation() {} });
	assert.equal(panel.state, 'closed');
	spotlight.dispose();
});

test('hasZoteroDraggedItems detects dragover payloads without getData and WorkspaceHub locks write actions in readOnly mode', () => {
	const { hasZoteroDraggedItems } = require('../src/core/drag-utils.ts');
	assert.equal(hasZoteroDraggedItems({ types: ['text/plain', 'zotero/item'], getData: () => '' }), true);
	assert.equal(hasZoteroDraggedItems({ types: { contains: (t) => t === 'zotero/item' }, getData: () => '' }), true);
	assert.equal(hasZoteroDraggedItems({ types: ['text/plain'], getData: () => '' }), false);

	const { WorkspaceHubController } = require('../src/ui/workspace-hub.ts');
	const { store, meta, actions } = fixture();
	store.ensureGroup('Locked');
	store.readOnly = true;
	const makeEl = (tag) => {
		const el = {
			tagName: tag.toUpperCase(),
			className: '',
			disabled: false,
			value: '',
			textContent: '',
			children: [],
			listeners: new Map(),
			append(...nodes) { for (const n of nodes) if (n) { n.parentElement = el; el.children.push(n); } },
			replaceChildren(...nodes) { el.children = []; el.append(...nodes); },
			addEventListener(type, fn) { const list = el.listeners.get(type) || []; list.push(fn); el.listeners.set(type, list); },
			setAttribute(k, v) { el[k] = v; },
			focus() {},
			remove() {},
			querySelectorAll(sel) {
				const out = [];
				const walk = (n) => { for (const c of n.children) { if (c.tagName === 'BUTTON' && !c.disabled && sel.includes('button')) out.push(c); walk(c); } };
				walk(el);
				return out;
			},
		};
		return el;
	};
	const body = makeEl('body');
	const doc = { createElementNS: (_ns, t) => makeEl(t), body };
	const hub = new WorkspaceHubController({}, doc, store, meta, actions, {
		onPreviewRestore() {}, onQuickMerge() {}, onExportSessions() {}, onImportSessions() {}, onRefresh() {},
	});
	hub.open();
	const box = body.children[0].children[0];
	const quickActions = box.children[1].children[0].children[1];
	assert.equal(quickActions.children[0].disabled, true);
	assert.equal(quickActions.children[1].disabled, true);
	assert.equal(quickActions.children[3].disabled, true);
	assert.ok(box.children[2].textContent.includes('只读'));
	hub.dispose();
});
