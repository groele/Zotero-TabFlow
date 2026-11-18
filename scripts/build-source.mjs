import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await esbuild.build({
	entryPoints: [path.join(root, 'src/index.ts')],
	outfile: path.join(root, 'zoterotabflow.js'),
	bundle: true,
	format: 'iife',
	target: 'firefox140',
	charset: 'utf8',
	treeShaking: true,
	minify: false,
	banner: {
		js: '/* Zotero TabFlow - Unified horizontal & vertical tab workspace for Zotero 10-12. */'
	}
});

console.log('zoterotabflow.js bundled successfully.');

await esbuild.build({
	entryPoints: [path.join(root, 'src/preferences.ts')],
	outfile: path.join(root, 'zoterotabflow_prefs.js'),
	bundle: true,
	format: 'iife',
	target: 'firefox140',
	charset: 'utf8',
	treeShaking: true,
	minify: false,
	banner: {
		js: '/* Zotero TabFlow - Preferences controller. */'
	}
});

console.log('zoterotabflow_prefs.js bundled successfully.');
