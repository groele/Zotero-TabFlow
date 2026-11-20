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

const { computeNativeTabMoveTarget, parseZoteroDraggedItemIDs } = require('../src/core/drag-utils.ts');
const { TabFlowStore } = require('../src/core/store.ts');
const { ItemMetadataService } = require('../src/services/item-metadata.ts');
const { TabActionService, isTabBusyOrProtected } = require('../src/services/tab-actions.ts');
const { bindSidebarKeyboardNavigation } = require('../src/ui/sidebar-keyboard.ts');
const { buildSidebarSection } = require('../src/ui/sidebar-status.ts');

function createFakeElement(tag, state) {
	const el = {
		tagName: tag.toUpperCase(),
		className: '',
		type: '',
		value: '',
		hidden: false,
		textContent: '',
		style: {},
		dataset: {},
		children: [],
		parentElement: null,
		listeners: new Map(),
		focused: false,
		selected: false,
		clicked: 0,
		append(...nodes) {
			for (const n of nodes) {
				if (!n || typeof n === 'string') continue;
				n.parentElement = el;
				el.children.push(n);
			}
		},
		addEventListener(type, fn) {
			const list = el.listeners.get(type) || [];
			list.push(fn);
			el.listeners.set(type, list);
		},
		dispatch(type, event = {}) {
			const ev = {
				target: el,
				isComposing: false,
				keyCode: 0,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				defaultPrevented: false,
				preventDefault() { this.defaultPrevented = true; },
				stopPropagation() {},
				...event,
			};
			let cur = el;
			while (cur) {
				for (const fn of cur.listeners.get(type) || []) fn(ev);
				cur = cur.parentElement;
			}
			return ev;
		},
		click() {
			el.clicked++;
			if (el.onclick) el.onclick({ stopPropagation() {} });
		},
		focus() {
			state.activeElement = el;
			el.focused = true;
		},
		select() {
			el.selected = true;
		},
		scrollIntoView() {},
		matches(sel) {
			return sel.split(',').some((s) => {
				const clean = s.trim();
				if (clean === 'input') return el.tagName === 'INPUT';
				if (clean.startsWith('.')) return el.className.split(/\s+/).includes(clean.slice(1));
				return false;
			});
		},
		closest(sel) {
			let cur = el;
			while (cur) {
				if (sel === '[hidden]' && cur.hidden) return cur;
				if (sel === '[data-ztf-nav]' && cur.dataset.ztfNav) return cur;
				if (sel === '.ztf-sb-group' && cur.className.split(/\s+/).includes('ztf-sb-group')) return cur;
				if (sel.includes('ztf-sb-row-action') && (cur.className.includes('ztf-sb-row-action') || cur.className.includes('ztf-batch-check'))) return cur;
				if (sel.includes('.ztf-inline-edit') && cur.className.includes('ztf-inline-edit')) return cur;
				cur = cur.parentElement;
			}
			return null;
		},
		querySelectorAll(sel) {
			const out = [];
			const walk = (node) => {
				for (const ch of node.children) {
					if (sel === '[data-ztf-nav]' && ch.dataset.ztfNav) out.push(ch);
					if ((sel.includes('ztf-sb-row') || sel.includes('data-ztf-nav="row"')) && (ch.dataset.ztfNav === 'row' || ch.dataset.ztfNav === 'virtual')) out.push(ch);
					walk(ch);
				}
			};
			walk(el);
			return out;
		},
		querySelector(sel) {
			const walk = (node) => {
				for (const ch of node.children) {
					if (sel === '.ztf-sb-group-body' && ch.className.includes('ztf-sb-group-body')) return ch;
					if (sel === '[data-ztf-nav="head"]' && ch.dataset.ztfNav === 'head') return ch;
					if ((sel.includes('ztf-sb-row') || sel.includes('data-ztf-nav="row"')) && (ch.dataset.ztfNav === 'row' || ch.dataset.ztfNav === 'virtual')) return ch;
					const nested = walk(ch);
					if (nested) return nested;
				}
				return null;
			};
			return walk(el);
		},
	};
	return el;
}

test('computeNativeTabMoveTarget uses native insertion boundaries and protects the library tab', () => {
	const ids = ['library', 'a', 'b', 'c'];
	assert.equal(computeNativeTabMoveTarget(ids, 'c', 'a', false), 1);
	assert.equal(computeNativeTabMoveTarget(ids, 'a', 'b', true), 3);
	assert.equal(computeNativeTabMoveTarget(ids, 'a', 'c', true), 4);
	assert.equal(computeNativeTabMoveTarget(ids, 'library', 'b', true), -1);
	assert.equal(computeNativeTabMoveTarget(['a', 'b'], 'a', 'a', false), -1);

	assert.deepEqual(parseZoteroDraggedItemIDs({ getData: () => '12, 45, 12' }), [12, 45]);
	assert.deepEqual(parseZoteroDraggedItemIDs({ getData: () => '[7, 9, 0, -1]' }), [7, 9]);
	assert.deepEqual(parseZoteroDraggedItemIDs(null), []);
});

test('isTabBusyOrProtected and TabActionService protect playing media, unsaved readers, and move tabs cleanly', async () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const fakeTab = { id: 't-media', type: 'reader', data: { itemID: 1, soundPlaying: true } };
	assert.equal(isTabBusyOrProtected(fakeTab, null, { protectMedia: true }, false, ''), true);
	assert.equal(isTabBusyOrProtected({ id: 't-dirty', type: 'reader' }, { _internalReader: { hasUnsavedChanges: true } }, { protectMedia: true }, false, ''), true);

	const moved = [];
	const closed = [];
	const fakeWin = {
		Zotero_Tabs: {
			selectedID: 't-cur',
			_tabs: [
				{ id: 'zotero-pane', type: 'library' },
				{ id: 't-media', type: 'reader', title: 'Video', data: { itemID: 1, soundPlaying: true } },
				{ id: 't-idle', type: 'reader', title: 'Paper', data: { itemID: 2 } },
			],
			close(arg) { closed.push(arg); },
			move(id, idx) { moved.push([id, idx]); },
			unload() {},
		},
	};
	globalThis.Zotero.Items = {
		get(id) {
			return { id, libraryID: 1, key: id === 1 ? 'M' : 'I', getField: () => 'Title' };
		},
	};
	const meta = new ItemMetadataService(fakeWin, store);
	const actions = new TabActionService(fakeWin, store, meta);

	assert.equal(actions.sleepTab('t-media'), false);
	const count = await actions.closeTabs(['t-media', 't-idle'], { preserveVirtual: false, protectMedia: true });
	assert.equal(count, 1);
	assert.deepEqual(closed, ['t-idle']);
	assert.equal(actions.moveTabRelative('t-idle', 't-media', false), true);
	assert.deepEqual(moved, [['t-idle', 1]]);
});

test('bindSidebarKeyboardNavigation navigates DOM nodes, toggles groups, isolates IME/child controls, and converts collections', () => {
	const state = { activeElement: null };
	const doc = { createElementNS: (_ns, tag) => createFakeElement(tag, state) };
	const aside = createFakeElement('div', state);
	const list = createFakeElement('div', state);
	const search = createFakeElement('input', state);
	aside.append(search, list);

	let converted = 0;
	const collapsed = new Set();
	const sec1 = buildSidebarSection(doc, collapsed, 'col:AI', 'AI', '#3977d5', 1, () => { converted++; });
	const head1 = sec1.querySelector('[data-ztf-nav="head"]');
	const convBtn = sec1.children[0].children[1];
	convBtn.click();
	assert.equal(converted, 1);

	const body1 = sec1.querySelector('.ztf-sb-group-body');
	const row1 = createFakeElement('div', state);
	row1.dataset.ztfNav = 'row';
	row1.dataset.ztfNavId = '1:A';
	const folderBtn = createFakeElement('button', state);
	folderBtn.className = 'ztf-sb-row-action';
	row1.append(folderBtn);
	body1.append(row1);
	list.append(sec1);

	let cleared = 0;
	bindSidebarKeyboardNavigation(aside, list, search, () => { cleared++; });

	// `/` focuses search
	row1.focus();
	const slashEv = row1.dispatch('keydown', { key: '/' });
	assert.equal(slashEv.defaultPrevented, true);
	assert.equal(state.activeElement, search);

	// IME composition ignored
	row1.focus();
	const imeEv = row1.dispatch('keydown', { key: 'ArrowUp', isComposing: true });
	assert.equal(imeEv.defaultPrevented, false);

	// ArrowUp from row1 moves to head1
	row1.dispatch('keydown', { key: 'ArrowUp' });
	assert.equal(state.activeElement, head1);

	// ArrowLeft collapses expanded head1
	head1.dispatch('keydown', { key: 'ArrowLeft' });
	assert.equal(body1.hidden, true);

	// ArrowRight expands collapsed head1
	head1.dispatch('keydown', { key: 'ArrowRight' });
	assert.equal(body1.hidden, false);

	// ArrowRight again enters child row1
	head1.dispatch('keydown', { key: 'ArrowRight' });
	assert.equal(state.activeElement, row1);

	// Enter on row1 activates row1, whereas Enter on child folderBtn does NOT call row1.click()
	row1.dispatch('keydown', { key: 'Enter' });
	assert.equal(row1.clicked, 1);
	folderBtn.focus();
	const childEnter = folderBtn.dispatch('keydown', { key: 'Enter' });
	assert.equal(childEnter.defaultPrevented, false);
	assert.equal(row1.clicked, 1);
	assert.equal(cleared, 0);
});

test('SessionPreviewController renders modal overlay without XUL panel quirks, toggles merge/replace, and confirms chosen plan', async () => {
	const { SessionPreviewController } = require('../src/ui/session-preview.ts');
	const state = { activeElement: null };
	const root = createFakeElement('window', state);
	root.classList = { toggle() {} };
	const makeEl = (tag) => {
		const el = createFakeElement(tag, state);
		el.id = '';
		el.setAttribute = (k, v) => { el[k] = v; };
		el.remove = () => { root.children = root.children.filter((c) => c !== el); };
		el.replaceChildren = (...nodes) => { el.children = []; el.append(...nodes); };
		el.classList = {
			toggle(cls, flag) {
				const set = new Set(el.className.split(/\s+/).filter(Boolean));
				if (flag) set.add(cls);
				else set.delete(cls);
				el.className = [...set].join(' ');
			},
		};
		return el;
	};
	const doc = {
		documentElement: root,
		body: null,
		createElementNS: (_ns, tag) => makeEl(tag),
	};
	const preview = new SessionPreviewController({}, doc);
	const session = { id: 's1', name: 'Test Session', createdAt: 1, groups: [], assignments: {}, pinned: [], openKeys: ['1:A'] };
	const mergePlan = { session, merge: true, alreadyOpenCount: 1, toOpen: [], missing: [], reassignedCount: 0, pinAdded: [], pinRemoved: [], newGroupsCount: 0, replacingGroupsCount: 0 };
	const replacePlan = { session, merge: false, alreadyOpenCount: 0, toOpen: [{ fullKey: '1:A', libraryID: 1, itemKey: 'A', itemID: 1 }], missing: [], reassignedCount: 1, pinAdded: [], pinRemoved: ['1:P'], newGroupsCount: 1, replacingGroupsCount: 1 };

	let confirmed = null;
	preview.openRestorePreview(mergePlan, replacePlan, async (chosen) => { confirmed = chosen; });
	assert.equal(root.children.length, 1);
	const backdrop = root.children[0];
	assert.equal(backdrop.id, 'ztf-preview-backdrop');
	const box = backdrop.children[0];
	const replaceBtn = box.children[1].children[1];
	replaceBtn.click();
	const okBtn = box.children[5].children[1];
	okBtn.click();
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(confirmed, replacePlan);
	assert.equal(root.children.length, 0);
});

test('WorkspaceHubController manages saved sessions, templates and rolling snapshots', async () => {
	memPrefs.clear();
	const { promoteRollingSnapshot } = require('../src/core/session-store.ts');
	const { WorkspaceHubController, computeWorkspaceHubCounts } = require('../src/ui/workspace-hub.ts');

	const store = new TabFlowStore();
	const rolling = store.saveRollingSnapshot(['1:R1']);
	assert.ok(rolling);

	assert.deepEqual(computeWorkspaceHubCounts(store), { sessions: 0, rolling: 1, total: 0 });

	const state = { activeElement: null };
	const root = createFakeElement('window', state);
	const makeEl = (tag) => {
		const el = createFakeElement(tag, state);
		el.id = '';
		el.placeholder = '';
		el.disabled = false;
		el.setAttribute = (k, v) => { el[k] = v; };
		el.remove = () => { root.children = root.children.filter((c) => c !== el); };
		el.replaceChildren = (...nodes) => { el.children = []; el.append(...nodes); };
		return el;
	};
	const doc = { documentElement: root, body: null, createElementNS: (_ns, tag) => makeEl(tag) };
	const meta = { buildTrackedTabs: () => [{ key: '1:CUR' }, { key: '1:H1' }] };
	const attempts = [];
	let refreshCalls = 0;
	let previewed = null;
	let merged = null;
	let exports = 0;
	let imports = 0;
	const hub = new WorkspaceHubController({}, doc, store, meta, {
		async openVirtualOrItem(id) { attempts.push(id); return false; },
	}, {
		onPreviewRestore(session) { previewed = session; },
		onQuickMerge(session) { merged = session; },
		onExportSessions() { exports++; },
		onImportSessions() { imports++; },
		onRefresh() { refreshCalls++; },
	});

	hub.open();
	assert.equal(root.children.length, 1);
	const box = root.children[0].children[0];
	const body = box.children[1];
	// Quick save bar + unified workspace section + Rolling section
	assert.equal(body.children.length, 3);

	// Inline save creates a manual session directly
	const quickBar = body.children[0];
	const nameInput = quickBar.children[0];
	const saveBtn = quickBar.children[1].children[0];
	nameInput.value = 'Draft Review';
	saveBtn.click();
	assert.equal(store.state.sessions.length, 1);
	assert.equal(store.state.sessions[0].name, 'Draft Review');
	const templateBar = body.children[0];
	templateBar.children[0].value = 'Reading layout';
	templateBar.children[1].children[1].click();
	assert.ok(store.state.sessions.some((session) => session.name === 'Reading layout' && session.kind === 'template'));

	// Promote rolling snapshot moves it into manual sessions
	assert.ok(promoteRollingSnapshot(store.state, rolling.id));
	assert.equal(store.state.rollingSessions.length, 0);
	assert.equal(store.state.sessions.length, 3);

	const manualSession = store.state.sessions.find((session) => session.name === 'Draft Review');
	hub.open();
	const findManualCard = () => root.children[0].children[0].children[1].children[1].children.find((child) =>
		child.className === 'ztf-hub-card' && child.children[0].children[0].textContent.includes('Draft Review'));
	let sessionCard = findManualCard();
	assert.ok(sessionCard);
	sessionCard.children[1].children[0].click();
	assert.equal(previewed, manualSession);
	hub.open();
	sessionCard = findManualCard();
	sessionCard.children[1].children[1].click();
	assert.equal(merged, manualSession);
	hub.open();
	const currentBody = root.children[0].children[0].children[1];
	const saveBar = currentBody.children[0];
	saveBar.children[1].children[2].click();
	assert.equal(exports, 1);
	hub.open();
	root.children[0].children[0].children[1].children[0].children[1].children[3].click();
	assert.equal(imports, 1);
	hub.open();
	const sessionForDeletion = findManualCard();
	sessionForDeletion.children[1].children.at(-1).click();
	assert.equal(store.state.sessions.some((session) => session.name === 'Draft Review'), false);
	const rollingForDeletion = store.saveRollingSnapshot(['1:DELETE']);
	hub.open();
	const rollingSection = root.children[0].children[0].children[1].children.at(-1);
	const rollingCard = rollingSection.children[1];
	rollingCard.children[1].children.at(-1).click();
	assert.equal(store.state.rollingSessions.some((session) => session.id === rollingForDeletion.id), false);
	hub.dispose();
});

test('Spotlight shortcut, library search, result activation, and workspace command are wired end to end', async () => {
	memPrefs.clear();
	const { SpotlightController } = require('../src/ui/spotlight.ts');
	const state = { activeElement: null };
	const makeEl = (tag) => {
		const el = createFakeElement(tag, state);
		el.namespaceURI = 'http://www.w3.org/1999/xhtml';
		let textContent = '';
		Object.defineProperty(el, 'textContent', {
			get: () => textContent,
			set: (value) => { textContent = String(value); if (!textContent) el.children = []; },
		});
		el.setAttribute = (key, value) => { el[key] = value; };
		el.remove = () => { if (el.parentElement) el.parentElement.children = el.parentElement.children.filter((child) => child !== el); };
		el.openPopup = () => { el.state = 'open'; for (const fn of el.listeners.get('popupshown') || []) fn({ target: el }); };
		el.hidePopup = () => { el.state = 'closed'; };
		el.classList = { toggle(name, enabled) {
			const values = new Set(el.className.split(/\s+/).filter(Boolean));
			if (enabled) values.add(name); else values.delete(name);
			el.className = [...values].join(' ');
		} };
		el.querySelectorAll = (selector) => {
			const cls = selector.startsWith('.') ? selector.slice(1) : '';
			const found = [];
			const walk = (node) => { for (const child of node.children) { if (child.className.split(/\s+/).filter(Boolean).includes(cls)) found.push(child); walk(child); } };
			walk(el);
			return found;
		};
		return el;
	};
	const popupset = makeEl('popupset');
	const doc = {
		createElementNS: (_ns, tag) => makeEl(tag),
		createXULElement: (tag) => makeEl(tag),
		getElementById: (id) => id === 'mainPopupSet' ? popupset : null,
		querySelector: () => popupset,
		documentElement: makeEl('html'),
	};
	const listeners = new Map();
	const win = {
		addEventListener: (type, fn) => listeners.set(type, fn),
		removeEventListener: (type) => listeners.delete(type),
		setTimeout: (fn) => { fn(); return 1; },
	};
	const store = new TabFlowStore();
	const openCalls = [];
	const selected = [];
	let workspaceOpens = 0;
	const indexedLibraryIDs = [];
	globalThis.Zotero.Libraries = { getAll: () => [{ libraryID: 1 }, { libraryID: 2 }], getName: (id) => id === 1 ? 'My Library' : 'Group Library' };
	globalThis.Zotero.Items = { getAll: async (libraryID) => {
		indexedLibraryIDs.push(libraryID);
		return [{
			id: libraryID === 1 ? 42 : 84, libraryID, key: `Q${libraryID}`, isRegularItem: () => true,
			getField: (field) => ({ title: libraryID === 1 ? 'Quantum transport' : 'Quantum phases', year: '2026', publicationTitle: 'Nano Letters' })[field] || '',
			getCreators: () => [{ lastName: 'Author' }],
		}];
	} };
	const meta = {
		buildTrackedTabs: () => [{ key: '1:OPEN', tab: { id: 'tab-open' }, itemID: 100, parentItemID: null, title: 'Open paper', shortTitle: 'Open paper', filename: 'open.pdf', collection: '', creatorYear: '', groupId: '', pinned: false }],
		getSelectedTabID: () => 'tab-open',
		plainTitle: (title) => title,
	};
	const actions = {
		selectTab: (id) => selected.push(id),
		openVirtualOrItem: async (id) => { openCalls.push(id); return true; },
		undoCloseTab() {}, autoGroupByCollection() {}, sleepInactiveTabs() {}, showInFilesystem() {},
	};
	const popovers = { openWorkspaceHub: () => { workspaceOpens++; }, previewAndRestoreSession() {} };
	const spotlight = new SpotlightController(win, doc, store, meta, actions, popovers, () => {});
	spotlight.init();
	assert.equal(listeners.has('keydown'), true);
	let prevented = false;
	listeners.get('keydown')({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'p', preventDefault() { prevented = true; }, stopPropagation() {} });
	assert.equal(prevented, true);
	const panel = popupset.children[0];
	const input = panel.children[0].children[0];
	const results = panel.children[0].children[1];
	assert.deepEqual(indexedLibraryIDs, [], 'opening Spotlight does not eagerly scan the library');
	input.value = '@Quantum';
	input.dispatch('input');
	assert.match(results.children[0].textContent, /搜索所有文库/);
	await new Promise((resolve) => setTimeout(resolve, 0));
	let rows = results.querySelectorAll('.ztf-spot-row');
	assert.equal(rows.length, 2);
	assert.deepEqual(indexedLibraryIDs.sort(), [1, 2]);
	assert.match(rows[0].children[0].textContent, /Quantum transport/);
	assert.ok(rows.some((row) => row.children[0].textContent.includes('Quantum phases')));
	rows.find((row) => row.children[0].textContent.includes('Quantum phases')).click();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(openCalls, [84]);

	spotlight.open();
	const nextInput = popupset.children[0].children[0].children[0];
	nextInput.value = '工作区';
	nextInput.dispatch('input');
	const workspaceRow = popupset.children[0].children[0].children[1].querySelectorAll('.ztf-spot-row')
		.find((row) => row.children[0].textContent.includes('工作区'));
	assert.ok(workspaceRow, 'workspace command appears in Spotlight results');
	workspaceRow.click();
	assert.equal(workspaceOpens, 1);
	assert.deepEqual(selected, []);
	spotlight.dispose();
});
