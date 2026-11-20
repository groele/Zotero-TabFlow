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

test('horizontal inactive tabs compress to ellipsis chips while active tab stays expanded and workspace sync preserves custom names/remarks', () => {
	const { shouldCollapseHorizontalChip } = require('../src/ui/group-visibility.ts');
	assert.equal(shouldCollapseHorizontalChip('inactive', 2, false), true);
	assert.equal(shouldCollapseHorizontalChip('inactive', 2, true), false);
	assert.equal(shouldCollapseHorizontalChip('auto', 5, false), false);
	assert.equal(shouldCollapseHorizontalChip('auto', 6, false), true);
	assert.equal(shouldCollapseHorizontalChip('auto', 6, true), false);
	assert.equal(shouldCollapseHorizontalChip('auto', 10, false, false), false);
	assert.equal(shouldCollapseHorizontalChip('auto', 3, false, true), true);
	assert.equal(shouldCollapseHorizontalChip('auto', 3, true, true), false);
	assert.equal(shouldCollapseHorizontalChip('off', 12, false), false);

	const { store } = fixture();
	store.renameGroup('', 'ReS2');
	store.setRemark('1:R1', 'Raman peak');
	const snap = store.saveSession('ReS2 · 15:40', ['1:R1']);
	assert.equal(snap.ungroupedName, 'ReS2');
	assert.equal(snap.remarks['1:R1'].note, 'Raman peak');

	const target = new TabFlowStore();
	target.restoreSessionLayout(snap, true);
	assert.equal(target.state.ungroupedName, 'ReS2');
});

test('group-only session snapshot, snapshot update/rename, collapseOtherGroups, and history pruning', () => {
	const { store } = fixture();
	const { buildGroupSessionSnapshot, updateExistingSession, renameExistingSession, pruneHistory } = require('../src/core/session-store.ts');
	const g1 = store.ensureGroup('Optics');
	const g2 = store.ensureGroup('Theory');
	store.assignKey('1:A', g1.id);
	store.assignKey('1:B', g2.id);
	store.setRemark('1:A', 'Key optics paper');
	store.setRemark('1:B', 'Unrelated theory');
	store.setPinnedKeys(['1:A', '1:B'], true);

	const groupSnap = buildGroupSessionSnapshot(store.state, 'Optics Only', g1.id, ['1:A', '1:B']);
	assert.equal(groupSnap.groups.length, 1);
	assert.equal(groupSnap.groups[0].id, g1.id);
	assert.deepEqual(groupSnap.openKeys, ['1:A']);
	assert.deepEqual(groupSnap.pinned, ['1:A']);
	assert.equal(groupSnap.remarks['1:A'].note, 'Key optics paper');
	assert.equal(groupSnap.remarks['1:B'], undefined);

	const saved = store.saveGroupSession('Optics Saved', g1.id, ['1:A', '1:B']);
	assert.equal(store.state.sessions.length, 1);
	assert.equal(renameExistingSession(store.state, saved.id, 'Optics Renamed'), true);
	assert.equal(store.state.sessions[0].name, 'Optics Renamed');

	store.assignKey('1:C', g1.id);
	const updated = updateExistingSession(store.state, saved.id, ['1:A', '1:B', '1:C']);
	assert.ok(updated);
	assert.equal(updated.name, 'Optics Renamed');
	assert.deepEqual(updated.openKeys, ['1:A', '1:C']);

	const fullSaved = store.saveSession('Full Workspace', ['1:A']);
	const fullUpdated = updateExistingSession(store.state, fullSaved.id, ['1:A', '1:B', '1:C']);
	assert.deepEqual(fullUpdated.openKeys, ['1:A', '1:B', '1:C']);

	store.collapseOtherGroups(g1.id);
	assert.ok(!store.state.collapsed.includes(g1.id));
	assert.ok(store.state.collapsed.includes(g2.id));

	const now = Date.now();
	store.state.history['1:OLD_ORPHAN'] = { firstSeen: 1, lastViewed: now - 200 * 86_400_000 };
	store.state.history['1:A'] = { firstSeen: 1, lastViewed: now - 200 * 86_400_000 };
	store.state.history['1:RECENT_ORPHAN'] = { firstSeen: now - 1000, lastViewed: now - 1000 };
	const pruned = pruneHistory(store.state, ['1:X'], 500, 180 * 86_400_000, now);
	assert.equal(pruned, 1);
	assert.equal(store.state.history['1:OLD_ORPHAN'], undefined);
	assert.ok(store.state.history['1:A']);
	assert.ok(store.state.history['1:RECENT_ORPHAN']);
});

test('cross-area drag MIME helper and SidebarHoverCard below placement with showVirtual', () => {
	const { TABFLOW_DRAG_MIME, hasTabFlowDraggedTab } = require('../src/core/drag-utils.ts');
	const { SidebarHoverCard } = require('../src/ui/sidebar-hover.ts');
	assert.equal(hasTabFlowDraggedTab({ types: [TABFLOW_DRAG_MIME] }), true);
	assert.equal(hasTabFlowDraggedTab({ types: ['text/plain'] }), false);

	const { store } = fixture();
	store.setRemark('1:V1', 'Compressed note');
	const mkEl = (tag) => {
		const node = {
			tagName: tag.toUpperCase(), className: '', textContent: '', hidden: false,
			style: {}, children: [],
			append(...args) { for (const a of args) if (a && typeof a === 'object') node.children.push(a); },
			remove() {},
			getBoundingClientRect: () => ({ left: 100, right: 220, top: 20, bottom: 52, width: 200, height: 100 }),
		};
		return node;
	};
	const root = mkEl('window');
	const doc = { documentElement: root, createElementNS: (_ns, t) => mkEl(t) };
	const win = { innerWidth: 1200, innerHeight: 800, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {} };
	const card = new SidebarHoverCard(win, doc, store);
	card.mount();
	const anchor = mkEl('button');
	card.showVirtual(anchor, {
		key: '1:V1', itemID: 10, title: 'Sliding ferroelectricity',
		shortTitle: 'Sliding', filename: 'slide.pdf', creatorYear: 'Wu 2023',
		source: 'Nature', collection: 'ReS2',
	}, 'Group A', 'below');
	const cardEl = root.children[0];
	assert.equal(cardEl.hidden, false);
	assert.equal(cardEl.style.left, '100px');
	assert.equal(cardEl.style.top, '58px');
	assert.ok(cardEl.children.some((c) => c.textContent.includes('Compressed note')));
	card.hide();
	assert.equal(cardEl.hidden, true);
	card.dispose();
});

test('saving incrementally overwrites same workspace session (including legacy HH:MM suffixes) and scoped group update stays scoped', () => {
	const { store } = fixture();
	const { updateExistingSession } = require('../src/core/session-store.ts');
	const first = store.saveSession('ReS2 · 16:43', ['1:1', '1:2']);
	// Legacy second duplicate with another HH:MM timestamp (like pre-v17.6.1 saves)
	store.state.sessions.unshift({ ...first, id: 'legacy-dup', name: 'ReS2 · 17:23', openKeys: ['1:1', '1:2', '1:4'] });
	assert.equal(store.state.sessions.length, 2);

	// Saving again with clean base name overwrites AND consolidates all matching legacy ReS2 · HH:MM rows
	const updated = store.saveSession('ReS2', ['1:1', '1:2', '1:3']);
	assert.equal(store.state.sessions.length, 1);
	assert.equal(updated.name, 'ReS2');
	assert.equal(updated.openKeys.length, 3);

	// Distinct workspace names still create separate cards, and generic blank auto-names remain distinct
	store.saveSession('ReS2 - Branch', ['1:4']);
	store.saveSession('工作区会话 · 16:43', ['1:5']);
	store.saveSession('工作区会话 · 17:23', ['1:6']);
	assert.equal(store.state.sessions.length, 4);

	// Group-scoped snapshots retain scopedGroupId on updateExistingSession
	const g1 = store.ensureGroup('Optics');
	const g2 = store.ensureGroup('Other');
	store.assignKey('1:G1', g1.id);
	store.assignKey('1:G2', g2.id);
	const groupOnly = store.saveGroupSession('Optics Only', g1.id, ['1:G1', '1:G2']);
	assert.equal(groupOnly.scopedGroupId, g1.id);
	assert.deepEqual(groupOnly.openKeys, ['1:G1']);
	store.assignKey('1:G1B', g1.id);
	const refreshed = updateExistingSession(store.state, groupOnly.id, ['1:G1', '1:G1B', '1:G2']);
	assert.ok(refreshed);
	assert.deepEqual(refreshed.openKeys, ['1:G1', '1:G1B']);
	assert.equal(refreshed.scopedGroupId, g1.id);
});

test('performance caches: pref cache invalidates cleanly, scheduleSave coalesces and flushes, and ItemMetadataService invalidates on dateModified', () => {
	const { enablePrefCache, invalidatePrefCache } = require('../src/core/prefs.ts');
	const { createSvgIcon } = require('../src/ui/icons.ts');
	const { prefs, items, store, tabs, meta } = fixture();
	let prefReads = 0;
	globalThis.Zotero.Prefs = {
		get: (k) => { prefReads++; return prefs.get(k); },
		set: (k, v) => prefs.set(k, v),
	};
	try {
		enablePrefCache(true);
		assert.equal(getPref('enableTabRemarks'), true);
		assert.equal(getPref('enableTabRemarks'), true);
		assert.equal(prefReads, 1);
		prefs.set('extensions.zotero.tabflow.enableTabRemarks', false);
		assert.equal(getPref('enableTabRemarks'), true);
		invalidatePrefCache('enableTabRemarks');
		assert.equal(getPref('enableTabRemarks'), false);
		assert.equal(prefReads, 2);
	} finally {
		enablePrefCache(false);
	}

	// scheduleSave coalesces rapid writes and flushPendingSave clears the timer synchronously
	let stateWrites = 0;
	const origSet = globalThis.Zotero.Prefs.set;
	globalThis.Zotero.Prefs.set = (k, v) => { if (k.endsWith('.state')) stateWrites++; origSet(k, v); };
	store.scheduleSave(500);
	store.scheduleSave(500);
	assert.equal(stateWrites, 0);
	store.flushPendingSave();
	assert.equal(stateWrites, 1);

	// ItemMetadataService caches primary fields by dateModified and refreshes when modified
	let fieldCalls = 0;
	let titleVal = 'Initial <i>Title</i>';
	let modStamp = '2026-11-19 10:00:00';
	items.set(1, {
		id: 1, libraryID: 1, key: 'P1',
		get dateModified() { return modStamp; },
		getField: (f) => { if (f === 'title') { fieldCalls++; return titleVal; } return ''; },
		getCreators: () => [{ lastName: 'Li' }],
		getCollections: () => [],
	});
	tabs._tabs.push({ id: 't1', type: 'reader', data: { itemID: 1 } });
	assert.equal(meta.buildTrackedTabs()[0].title, 'Initial Title');
	assert.equal(meta.buildTrackedTabs()[0].title, 'Initial Title');
	assert.equal(fieldCalls, 1);
	titleVal = 'Updated Title';
	modStamp = '2026-11-19 10:05:00';
	assert.equal(meta.buildTrackedTabs()[0].title, 'Updated Title');
	assert.equal(fieldCalls, 2);

	// SVG prototype cache clones icons cleanly without rebuilding attributes every call
	let clones = 0;
	const mkSvg = () => ({
		setAttribute() {}, classList: { add() {} }, append() {},
		cloneNode() { clones++; return { cloned: true }; },
	});
	const doc = { createElementNS: () => mkSvg() };
	createSvgIcon(doc, 'pin', 12);
	const cloned = createSvgIcon(doc, 'pin', 12);
	assert.equal(clones, 2);
	assert.deepEqual(cloned, { cloned: true });
});

test('batch sleep persists once and does not record refused or duplicate tabs', () => {
	const { tabs, items, store, actions } = fixture();
	for (const id of [1, 2, 3]) {
		items.set(id, { id, key: `PAPER${id}`, libraryID: 1 });
		tabs._tabs.push({ id: `tab-${id}`, type: 'reader', data: { itemID: id } });
	}
	tabs.unload = (id) => {
		if (id !== 'tab-2') tabs._tabs.find((tab) => tab.id === id).type = 'reader-unloaded';
	};
	let writes = 0;
	const originalSet = Zotero.Prefs.set;
	Zotero.Prefs.set = (...args) => { writes++; originalSet(...args); };
	assert.equal(actions.sleepTabs(['tab-1', 'tab-1', 'tab-2', 'tab-3']), 2);
	assert.deepEqual(store.state.sleeping, ['1:PAPER1', '1:PAPER3']);
	assert.equal(writes, 1);
	assert.equal(actions.sleepTabs(['tab-1', 'tab-2']), 0);
	assert.equal(writes, 1);
});

test('reloading state cancels the deferred write from the previous state', () => {
	const { store, prefs } = fixture();
	const key = 'extensions.zotero.tabflow.state';
	store.scheduleSave(100);
	prefs.delete(key);
	store.load();
	store.flushPendingSave();
	assert.equal(prefs.has(key), false);
});

test('large Spotlight indexes yield and stop indexing when the window closes', async () => {
	fixture();
	const { buildSpotlightLibraryIndex } = require('../src/services/spotlight-library.ts');
	const fetched = [];
	const items = Array.from({ length: 500 }, (_, id) => ({
		id, key: String(id), isRegularItem: () => true, getField: () => 'Title',
	}));
	Zotero.Libraries = { getAll: () => [{ libraryID: 1 }, { libraryID: 2 }] };
	Zotero.Items.getAll = async (id) => { fetched.push(id); return items; };
	let stopped = false;
	let processed = 0;
	const win = { setTimeout: (resolve) => setTimeout(() => { stopped = true; resolve(); }, 0) };
	const result = await buildSpotlightLibraryIndex(win, {
		plainTitle: (title) => { processed++; return title; },
	}, () => stopped);
	assert.equal(result, null);
	assert.equal(processed, 200);
	assert.deepEqual(fetched, [1]);
});

test('rolling snapshots merge open keys across windows and share one interval', () => {
	fixture();
	const { readFileSync } = require('node:fs');
	const { runInNewContext } = require('node:vm');
	runInNewContext(readFileSync(require.resolve('../zoterotabflow.js'), 'utf8'), { Zotero });
	const plugin = Zotero.zoterotabflow;
	const snapshots = [];
	plugin.store.saveRollingSnapshot = (keys) => snapshots.push(keys);
	plugin.windows.set({}, { getOpenKeys: () => ['1:SHARED', '1:LEFT'] });
	plugin.windows.set({}, { getOpenKeys: () => ['1:SHARED', '1:RIGHT'] });
	plugin.saveRollingIfDue();
	plugin.saveRollingIfDue();
	assert.deepEqual(snapshots.map((keys) => Array.from(keys)), [['1:SHARED', '1:LEFT', '1:RIGHT']]);
});

test('new tabs stay independent until assigned, while collection mode groups only the new batch', () => {
	const { tabs, items, store, actions, meta } = fixture();
	let collectionReads = 0;
	Zotero.Collections = { get: (id) => ({ name: `Collection ${id}` }) };
	for (const id of [1, 2, 3, 4]) {
		items.set(id, {
			id, key: `DOC${id}`, libraryID: 1,
			getCollections: () => { collectionReads++; return [id < 4 ? 1 : 2]; },
		});
		tabs._tabs.push({ id: `reader-${id}`, type: 'reader', data: { itemID: id } });
	}
	const added = new Set(['reader-1', 'reader-2', 'reader-4']);
	assert.equal(getPref('newTabMode'), 'independent');
	assert.equal(actions.autoGroupNewTabs(added), 0);
	assert.equal(collectionReads, 0);
	assert.deepEqual(store.state.assignments, {});

	const manual = store.ensureGroup('Manual');
	store.assignKey('1:DOC1', manual.id);
	assert.equal(meta.buildTrackedTabs(new Set(['reader-1']))[0].groupId, manual.id);
	collectionReads = 0;

	setPref('newTabMode', 'collection');
	let writes = 0;
	const originalSet = Zotero.Prefs.set;
	Zotero.Prefs.set = (...args) => { writes++; originalSet(...args); };
	assert.equal(actions.autoGroupNewTabs(added), 2);
	assert.equal(collectionReads, 3);
	assert.equal(writes, 1);
	assert.equal(store.groupOfKey('1:DOC1'), manual.id);
	assert.equal(store.groupOfKey('1:DOC3'), '');
	assert.notEqual(store.groupOfKey('1:DOC2'), store.groupOfKey('1:DOC4'));
	assert.ok(store.groupOfKey('1:DOC2'));
	assert.ok(store.groupOfKey('1:DOC4'));
});

test('legacy auto grouping migrates once and respects a subsequent user choice', () => {
	const { prefs } = fixture();
	const { migrateNewTabMode, PREF_PREFIX } = require('../src/core/prefs.ts');
	const previous = globalThis.Services;
	globalThis.Services = { prefs: { prefHasUserValue: (key) => prefs.has(key) } };
	try {
		prefs.set(PREF_PREFIX + 'enableCollectionAutoGroup', true);
		migrateNewTabMode();
		assert.equal(getPref('newTabMode'), 'collection');
		setPref('newTabMode', 'independent');
		migrateNewTabMode();
		assert.equal(getPref('newTabMode'), 'independent');
		prefs.set(PREF_PREFIX + 'newTabMode', 'invalid');
		assert.equal(getPref('newTabMode'), 'independent');
	} finally {
		globalThis.Services = previous;
	}
});
