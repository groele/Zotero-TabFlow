const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal Zotero global mock for unit tests
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
	logError() {},
};

const { TabFlowStore } = require('../src/core/store.ts');
const { normalizeHexColor, contrastInk } = require('../src/core/color-utils.ts');
const { DEFAULT_PREFS, getPref, setPref, resetAllPrefs } = require('../src/core/prefs.ts');
const { ActivityTrackerService } = require('../src/services/activity-tracker.ts');
const { ItemMetadataService } = require('../src/services/item-metadata.ts');

test('session merge keeps current layout and restores missing groups without losing pins', () => {
	const store = new TabFlowStore();
	const archived = store.ensureGroup('Archived');
	const current = store.ensureGroup('Current');
	store.assignKeys(['1:A', '1:B'], archived.id);
	store.setPinnedKeys(['1:A'], true);
	store.setCollapsed(archived.id, true);
	const session = store.saveSession('Snapshot', ['1:A', '1:B']);
	store.dissolveGroup(archived.id);
	store.assignKey('1:A', current.id);
	store.setPinnedKeys(['1:A'], false);
	store.setPinnedKeys(['1:C'], true);
	store.restoreSessionLayout(session, true);

	assert.equal(store.groupOfKey('1:A'), current.id);
	assert.equal(store.groupOfKey('1:B'), archived.id);
	assert.deepEqual(store.state.pinned, ['1:C', '1:A']);
	assert.ok(store.state.collapsed.includes(archived.id));
	assert.ok(store.state.order.indexOf(current.id) < store.state.order.indexOf(archived.id));

	delete session.order;
	delete session.collapsed;
	store.restoreSessionLayout(session, false);
	assert.equal(store.groupOfKey('1:A'), archived.id);
	assert.deepEqual(store.state.pinned, ['1:A']);
});

test('TabFlowStore handles groups, remarks, pinning, sleeping, virtual members, and sessions', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const g = store.ensureGroup('综述核心');
	assert.equal(g.name, '综述核心');
	assert.ok(g.id.startsWith('g-'));

	store.assignKey('1:ABC', g.id);
	assert.equal(store.groupOfKey('1:ABC'), g.id);

	store.setRemark('1:ABC', '基线对比');
	assert.equal(store.getRemark('1:ABC').note, '基线对比');
	assert.equal(store.getRemark('1:ABC').mode, 'both');

	assert.equal(store.togglePinned('1:ABC'), true);
	assert.equal(store.isPinned('1:ABC'), true);

	store.setSleeping('1:ABC', true);
	assert.equal(store.isSleeping('1:ABC'), true);

	const snap = store.saveSession('测试会话', ['1:ABC']);
	assert.equal(store.state.sessions.length, 1);
	assert.equal(snap.name, '测试会话');

	store.dissolveGroup(g.id);
	assert.equal(store.groupOfKey('1:ABC'), '');
});

test('dissolving a group atomically clears group references while preserving virtual documents', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const group = store.ensureGroup('Archive');
	store.assignKeys(['1:OPEN', '1:CLOSED'], group.id);
	store.setCollapsed(group.id, true);
	store.state.groupDisplay[group.id] = 'note';
	store.saveVirtualMember({ key: '1:CLOSED', itemID: 12, parentItemID: null, title: 'Kept', shortTitle: 'Kept', filename: 'kept.pdf', source: '', creatorYear: '', collection: '', type: 'reader' });

	assert.equal(store.dissolveGroup(group.id), true);
	assert.equal(store.state.groups.some((candidate) => candidate.id === group.id), false);
	assert.equal(store.groupOfKey('1:OPEN'), '');
	assert.equal(store.groupOfKey('1:CLOSED'), '');
	assert.equal(store.state.virtualMembers['1:CLOSED'].itemID, 12);
	assert.equal(store.state.order.includes(group.id), false);
	assert.equal(store.state.collapsed.includes(group.id), false);
	assert.equal(store.state.groupDisplay[group.id], undefined);

	const readonly = store.ensureGroup('Read only');
	store.readOnly = true;
	assert.equal(store.dissolveGroup(readonly.id), false);
	assert.equal(store.state.groups.some((candidate) => candidate.id === readonly.id), true);
	assert.equal(store.dissolveGroup(''), false);
});

test('color normalization and contrast ink calculation', () => {
	assert.equal(normalizeHexColor('abc'), '#aabbcc');
	assert.equal(normalizeHexColor('#3977D5'), '#3977d5');
	assert.equal(normalizeHexColor('invalid'), null);
	assert.equal(contrastInk('#ffffff'), '#111111');
	assert.equal(contrastInk('#111111'), '#ffffff');
});

test('preferences defaults and resetAllPrefs', () => {
	memPrefs.clear();
	assert.equal(getPref('enableSpotlight'), DEFAULT_PREFS.enableSpotlight);
	setPref('enableSpotlight', false);
	assert.equal(getPref('enableSpotlight'), false);
	resetAllPrefs();
	assert.equal(getPref('enableSpotlight'), true);
});

test('ActivityTrackerService skips pinned and selected tabs and sorts stale tabs', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const now = 1_700_000_000_000;
	const day = 86_400_000;
	store.state.history['1:OLD'] = { firstSeen: now - 12 * day, lastViewed: now - 10 * day };
	store.state.history['1:PIN'] = { firstSeen: now - 20 * day, lastViewed: now - 20 * day };
	store.state.history['1:CUR'] = { firstSeen: now - 15 * day, lastViewed: now - 15 * day };
	store.togglePinned('1:PIN');

	const fakeWin = {
		Zotero_Tabs: {
			selectedID: 'tab-cur',
			_tabs: [
				{ id: 'tab-old', type: 'reader', title: 'Old Paper', data: { itemID: 1 } },
				{ id: 'tab-pin', type: 'reader', title: 'Pinned Paper', data: { itemID: 2 } },
				{ id: 'tab-cur', type: 'reader', title: 'Current Paper', data: { itemID: 3 } },
			],
		},
	};
	globalThis.Zotero.Items = {
		get(id) {
			const map = {
				1: { id: 1, libraryID: 1, key: 'OLD', getField: () => 'Old Paper' },
				2: { id: 2, libraryID: 1, key: 'PIN', getField: () => 'Pinned Paper' },
				3: { id: 3, libraryID: 1, key: 'CUR', getField: () => 'Current Paper' },
			};
			return map[id];
		},
	};
	const meta = new ItemMetadataService(fakeWin, store);
	const tracker = new ActivityTrackerService(store, meta);
	const stale = tracker.getStaleTabs(now);
	assert.equal(stale.length, 1);
	assert.equal(stale[0].tracked.key, '1:OLD');
	assert.equal(stale[0].days, 10);
});

test('ItemMetadataService formats remark display modes', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	store.setRemark('1:A', '必读基线', 'both');
	const meta = new ItemMetadataService({}, store);
	assert.equal(meta.getDisplayTitle({ key: '1:A', title: 'Attention', shortTitle: 'Attn', filename: 'a.pdf' }), '必读基线 · Attention');
	store.setDisplayMode('1:A', 'note');
	assert.equal(meta.getDisplayTitle({ key: '1:A', title: 'Attention', shortTitle: 'Attn', filename: 'a.pdf' }), '必读基线');
	store.setDisplayMode('1:A', 'original');
	assert.equal(meta.getDisplayTitle({ key: '1:A', title: 'Attention', shortTitle: 'Attn', filename: 'a.pdf' }), 'Attention');
});


test('TabFlowStore.ensureGroup falls back on whitespace name and session preserves remarks and ungrouped styling', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const emptyGroup = store.ensureGroup('   ');
	assert.equal(emptyGroup.name, '新分组');

	store.renameGroup('', '待整理');
	store.setGroupColor('', '#123456');
	store.setRemark('1:REM', '重点方法', 'note');
	const snap = store.saveSession('完整快照', ['1:REM']);
	assert.equal(snap.ungroupedName, '待整理');
	assert.equal(snap.ungroupedColor, '#123456');
	assert.deepEqual(snap.remarks?.['1:REM'], { note: '重点方法', mode: 'note' });

	store.renameGroup('', '临时名');
	store.setGroupColor('', '#abcdef');
	store.setRemark('1:REM', '');
	store.restoreSessionLayout(snap, false);
	assert.equal(store.state.ungroupedName, '待整理');
	assert.equal(store.state.ungroupedColor, '#123456');
	assert.deepEqual(store.getRemark('1:REM'), { note: '重点方法', mode: 'note' });
});

test('ActivityTrackerService.getIdleTabsForSleep respects autoSleepMinutes, pin, selection, and sleep state', () => {
	memPrefs.clear();
	const store = new TabFlowStore();
	const now = 1_700_000_000_000;
	const min = 60_000;
	store.state.history['1:IDLE'] = { firstSeen: now - 40 * min, lastViewed: now - 35 * min };
	store.state.history['1:RECENT'] = { firstSeen: now - 10 * min, lastViewed: now - 5 * min };
	store.state.history['1:PIN'] = { firstSeen: now - 60 * min, lastViewed: now - 60 * min };
	store.state.history['1:CUR'] = { firstSeen: now - 60 * min, lastViewed: now - 60 * min };
	store.state.history['1:SLEEP'] = { firstSeen: now - 60 * min, lastViewed: now - 60 * min };
	store.togglePinned('1:PIN');
	store.setSleeping('1:SLEEP', true);

	const fakeWin = {
		Zotero_Tabs: {
			selectedID: 'tab-cur',
			_tabs: [
				{ id: 'tab-idle', type: 'reader', title: 'Idle', data: { itemID: 1 } },
				{ id: 'tab-recent', type: 'reader', title: 'Recent', data: { itemID: 2 } },
				{ id: 'tab-pin', type: 'reader', title: 'Pin', data: { itemID: 3 } },
				{ id: 'tab-cur', type: 'reader', title: 'Cur', data: { itemID: 4 } },
				{ id: 'tab-sleep', type: 'reader', title: 'Sleep', data: { itemID: 5 } },
			],
		},
	};
	globalThis.Zotero.Items = {
		get(id) {
			return { id, libraryID: 1, key: ['?', 'IDLE', 'RECENT', 'PIN', 'CUR', 'SLEEP'][id], getField: () => 'Paper' };
		},
	};
	const meta = new ItemMetadataService(fakeWin, store);
	const tracker = new ActivityTrackerService(store, meta);

	assert.equal(tracker.getIdleTabsForSleep(now).length, 0);
	setPref('autoSleepMinutes', 30);
	const due = tracker.getIdleTabsForSleep(now);
	assert.deepEqual(due.map((t) => t.key), ['1:IDLE']);
	setPref('enableTabSleep', false);
	assert.equal(tracker.getIdleTabsForSleep(now).length, 0);
});
