const assert = require('node:assert/strict');
const test = require('node:test');
const { GroupSection } = require('../src/ui/group-section.ts');

class ElementStub extends EventTarget {
	isConnected = true;
	children = [];
	append(...children) {
		this.children.push(...children);
		for (const child of children) child.parent = this;
	}
	after(child) {
		this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child);
		child.parent = this.parent;
	}
	remove() { this.isConnected = false; }
	setAttribute() {}
	focus() {}
	select() {}
}

function sectionFixture() {
	const timers = new Map();
	let id = 0;
	const win = {
		setTimeout(fn, wait) {
			assert.equal(wait, 210);
			timers.set(++id, fn);
			return id;
		},
		clearTimeout(timer) { timers.delete(timer); },
	};
	const doc = { createElementNS: () => new ElementStub() };
	const folds = [];
	const names = [];
	const view = new GroupSection(win, doc, {}, (fold) => folds.push(fold), (name) => names.push(name));
	view.update({ name: 'Original' }, false, 1);
	const click = (detail, eventType = 'click') => {
		view.heading.dispatchEvent(Object.assign(new Event(eventType), { detail, button: 0 }));
	};
	const flush = () => {
		for (const [timer, run] of timers) {
			timers.delete(timer);
			run();
		}
	};
	return { view, click, flush, folds, names };
}

test('quick double-click cancels folding and enters rename with the heading retained', () => {
	const { view, click, flush, folds } = sectionFixture();
	const heading = view.heading;
	click(1);
	click(2);
	click(2, 'dblclick');
	flush();
	assert.deepEqual(folds, []);
	assert.strictEqual(view.element.children[0], heading);
	assert.equal(heading.hidden, true);
	assert.equal(view.element.children[1].value, 'Original');
});

test('delayed double-click restores the prior fold state and disposal clears pending folds', () => {
	const { view, click, flush, folds } = sectionFixture();
	click(1);
	flush();
	assert.deepEqual(folds, [true]);
	click(2);
	click(2, 'dblclick');
	assert.deepEqual(folds, [true, false]);

	view.pause();
	click(0);
	assert.deepEqual(folds, [true, false, true]);
	click(1);
	view.dispose();
	flush();
	assert.deepEqual(folds, [true, false, true]);
});
