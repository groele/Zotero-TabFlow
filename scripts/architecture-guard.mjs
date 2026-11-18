import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const lines = (rel) => read(rel).trimEnd().split(/\r?\n/).length;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'output']);

function walk(relDir, extensions = ['.ts', '.tsx', '.js']) {
	const out = [];
	const visit = (dir) => {
		const fullDir = path.join(root, dir);
		if (!fs.existsSync(fullDir)) return;
		for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
			const rel = path.posix.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) visit(rel);
			} else if (extensions.some((ext) => entry.name.endsWith(ext))) {
				out.push(rel);
			}
		}
	};
	visit(relDir);
	return out.sort();
}

const baseline = readJson('scripts/architecture-baseline.json');
const MAX_LINES = baseline.maxSourceLines || 360;

test('source files respect 360-line ceiling and zero debt', () => {
	const sourceFiles = walk('src', ['.ts', '.tsx', '.js']);
	assert.ok(sourceFiles.length > 0, 'src/ must contain TypeScript files');
	const violations = [];
	for (const file of sourceFiles) {
		if (!file.endsWith('.ts') && !file.endsWith('.tsx')) {
			violations.push(`${file}: non-TS file in src/`);
		}
		const count = lines(file);
		if (count > MAX_LINES) {
			violations.push(`${file}: ${count} lines exceeds ${MAX_LINES}`);
		}
	}
	assert.equal(baseline.debtCleared, true, 'debtCleared must remain true');
	assert.deepEqual(violations, []);
});

test('version alignment across package, manifest, update.json, baseline, prefs.xhtml', () => {
	const pkg = readJson('package.json');
	const manifest = readJson('manifest.json');
	const update = readJson('update.json');
	const xhtml = read('prefs.xhtml');
	const version = pkg.version;
	assert.equal(manifest.version, version);
	assert.equal(baseline.lastReleasedVersion, version);
	const addonId = manifest.applications.zotero.id;
	assert.equal(update.addons[addonId].updates[0].version, version);
	assert.equal(manifest.applications.zotero.strict_min_version, '10.0');
	assert.equal(manifest.applications.zotero.strict_max_version, '12.*');
	assert.ok(xhtml.includes(`"version":"${version}"`), 'prefs.xhtml must include aligned version arg');
});

test('Fluent catalogues are symmetric across en-US and zh-CN', () => {
	const keysOf = (lang) => [...read(`locale/${lang}/zotero-tabflow.ftl`).matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
	const en = keysOf('en-US');
	const zh = keysOf('zh-CN');
	assert.equal(new Set(en).size, en.length, 'duplicate keys in en-US');
	assert.equal(new Set(zh).size, zh.length, 'duplicate keys in zh-CN');
	assert.deepEqual(zh.filter((k) => !en.includes(k)), [], 'extra keys in zh-CN');
	assert.deepEqual(en.filter((k) => !zh.includes(k)), [], 'missing keys in zh-CN');
});

test('all feature preferences in prefs.js are exposed in prefs.xhtml', () => {
	const prefsJs = read('prefs.js');
	const xhtml = read('prefs.xhtml');
	const ignored = new Set(['extensions.zotero.tabflow.state', 'extensions.zotero.tabflow.verticalSidebarWidth', 'extensions.zotero.tabflow.verticalSidebarCollapsed']);
	const keys = [...prefsJs.matchAll(/pref\("([^"]+)"/g)].map((m) => m[1]).filter((k) => !ignored.has(k));
	const missing = keys.filter((k) => !xhtml.includes(k));
	assert.deepEqual(missing, [], `Preferences missing in prefs.xhtml: ${missing.join(', ')}`);
});
