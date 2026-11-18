const assert = require('node:assert/strict');
const test = require('node:test');
const { PdfFolderSectionController } = require('../src/ui/pdf-folder-section.ts');

test('PDF folder actions require a matching pointer or keyboard activation', () => {
	globalThis.Zotero = { Prefs: { get: () => true } };
	const section = new PdfFolderSectionController();
	const listeners = new Map();
	const doc = { addEventListener: (type, listener) => listeners.set(type, listener) };
	const item = { id: 42 };
	const icon = {
		matches: () => true,
		closest: () => ({ container: { item } }),
	};
	const calls = [];
	section.openAttachmentFolder = (_win, target) => calls.push(target);
	section.bindFolderActions(doc, {}, new AbortController().signal);

	const send = (type, props = {}) => listeners.get(type)({
		isTrusted: true,
		button: 0,
		detail: 1,
		composedPath: () => [icon],
		...props,
	});
	send('click');
	send('pointerdown');
	send('pointercancel');
	send('click');
	assert.deepEqual(calls, []);

	send('pointerdown');
	send('click');
	send('click');
	send('pointerdown');
	send('click', { detail: 2 });
	assert.deepEqual(calls, [item]);

	send('keydown', { key: 'Enter' });
	send('click', { detail: 0 });
	assert.deepEqual(calls, [item, item]);
});

test('PDF folder actions coalesce launches of the same parent directory', async () => {
	const launches = [];
	globalThis.Zotero = {
		File: { pathToFile: () => ({ parent: { path: 'test-parent' } }) },
		launchFile: (path) => launches.push(path),
		logError: (error) => assert.fail(error),
	};
	const section = new PdfFolderSectionController();
	const item = { isFileAttachment: () => true, getFilePathAsync: async () => 'test-parent/test.pdf' };
	const signal = new AbortController().signal;
	await section.openAttachmentFolder({}, item, signal);
	await section.openAttachmentFolder({}, item, signal);
	assert.deepEqual(launches, ['test-parent']);
});
