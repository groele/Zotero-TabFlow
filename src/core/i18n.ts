let syncBundle: { formatValueSync?: (id: string, args?: Record<string, string | number>) => string | null } | null = null;
const staticCache = new Map<string, string>();

export function resetI18nCache(): void { staticCache.clear(); syncBundle = null; }

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
	if (!args && staticCache.has(id)) return staticCache.get(id)!;
	try {
		const val = getBundle()?.formatValueSync?.(id, args);
		if (typeof val === 'string' && val.trim()) {
			if (!args && staticCache.size < 400) staticCache.set(id, val);
			return val;
		}
	} catch {
		// Fall back when Fluent bundle is unavailable (e.g. unit tests)
	}
	if (!args) return fallback;
	return fallback.replace(/\{\s*\$([a-zA-Z0-9_]+)\s*\}/g, (_m, k) => String(args[k] ?? ''));
}
