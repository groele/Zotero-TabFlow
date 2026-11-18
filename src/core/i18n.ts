let syncBundle: { formatValueSync?: (id: string, args?: Record<string, string | number>) => string | null } | null = null;

function getBundle() {
	if (syncBundle) return syncBundle;
	const L10n = (globalThis as any).Localization;
	if (typeof L10n === 'function') {
		try {
			syncBundle = new L10n(['zotero-tabflow.ftl'], true);
		} catch {
			syncBundle = null;
		}
	}
	return syncBundle;
}

export function t(id: string, fallback: string, args?: Record<string, string | number>): string {
	try {
		const val = getBundle()?.formatValueSync?.(id, args);
		if (typeof val === 'string' && val.trim()) return val;
	} catch {
		// Fall back when Fluent bundle is unavailable (e.g. unit tests)
	}
	if (!args) return fallback;
	return fallback.replace(/\{\s*\$([a-zA-Z0-9_]+)\s*\}/g, (_m, k) => String(args[k] ?? ''));
}
