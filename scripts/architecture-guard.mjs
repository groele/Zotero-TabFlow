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

test('version alignment across package, lockfile, manifest, update.json, baseline, README, prefs.xhtml', () => {
	const pkg = readJson('package.json');
	const lock = readJson('package-lock.json');
	const manifest = readJson('manifest.json');
	const update = readJson('update.json');
	const xhtml = read('prefs.xhtml');
	const readme = read('README.md');
	const version = pkg.version;
	assert.equal(lock.packages?.['']?.version, version);
	assert.equal(manifest.version, version);
	assert.equal(baseline.lastReleasedVersion, version);
	const addonId = manifest.applications.zotero.id;
	assert.equal(update.addons[addonId].updates[0].version, version);
	assert.equal(manifest.applications.zotero.strict_min_version, '10.0');
	assert.equal(manifest.applications.zotero.strict_max_version, '12.*');
	assert.ok(xhtml.includes(`"version":"${version}"`), 'prefs.xhtml must include aligned version arg');
	assert.ok(readme.includes(`v${version}`), 'README must announce the aligned version');
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

test('all Fluent keys referenced in src/ and prefs.xhtml exist in both catalogues', () => {
	const zhKeys = new Set([...read('locale/zh-CN/zotero-tabflow.ftl').matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]));
	const enKeys = new Set([...read('locale/en-US/zotero-tabflow.ftl').matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]));
	const ignoredLiterals = new Set(['zotero-tabflow-session']);
	const referenced = new Set();
	for (const rel of ['prefs.xhtml', ...walk('src', ['.ts', '.tsx'])]) {
		const content = read(rel);
		for (const m of content.matchAll(/(?:data-l10n-id=["']|['"])(zotero-tabflow-[a-z0-9-]+)["']/g)) {
			if (!ignoredLiterals.has(m[1])) referenced.add(m[1]);
		}
	}
	const missingZh = [...referenced].filter((k) => !zhKeys.has(k));
	const missingEn = [...referenced].filter((k) => !enKeys.has(k));
	assert.deepEqual(missingZh, [], `Missing zh-CN FTL keys: ${missingZh.join(', ')}`);
	assert.deepEqual(missingEn, [], `Missing en-US FTL keys: ${missingEn.join(', ')}`);
});

test('all XUL menuitems in prefs.xhtml expose Fluent .label attributes', () => {
	const xhtml = read('prefs.xhtml');
	const itemKeys = [...xhtml.matchAll(/<menuitem[^>]*data-l10n-id="([^"]+)"/g)].map((m) => m[1]);
	assert.ok(itemKeys.length > 0, 'prefs.xhtml must contain menuitem options');
	for (const lang of ['en-US', 'zh-CN']) {
		const ftl = read(`locale/${lang}/zotero-tabflow.ftl`);
		for (const key of itemKeys) {
			const blockRe = new RegExp(`^${key}\\s*=[^\\r\\n]*(?:\\r?\\n[ \\t]+\\.[a-z-]+\\s*=[^\\r\\n]*)*`, 'm');
			const match = ftl.match(blockRe);
			assert.ok(match && /\n[ \t]+\.label\s*=/m.test(match[0]), `${lang} FTL key "${key}" must define .label attribute for <menuitem>`);
		}
	}
});

test('all feature preferences in prefs.js are exposed in prefs.xhtml', () => {
	const prefsJs = read('prefs.js');
	const xhtml = read('prefs.xhtml');
	const ignored = new Set(['extensions.zotero.tabflow.state', 'extensions.zotero.tabflow.verticalSidebarWidth', 'extensions.zotero.tabflow.verticalSidebarCollapsed']);
	const keys = [...prefsJs.matchAll(/pref\("([^"]+)"/g)].map((m) => m[1]).filter((k) => !ignored.has(k));
	const missing = keys.filter((k) => !xhtml.includes(k));
	assert.deepEqual(missing, [], `Preferences missing in prefs.xhtml: ${missing.join(', ')}`);
});
