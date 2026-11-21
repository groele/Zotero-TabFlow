import type {
	HorizontalTabCompactMode,
	MultiCollectionStrategy,
	TabDisplayMode,
	VerticalSubtitleMode,
	VerticalTitleMode,
} from './types.ts';

export const PREF_PREFIX = 'extensions.zotero.tabflow.';

export type NewTabMode = 'independent' | 'collection';
export type PdfPreviewMode = 'section' | 'full';
export type PdfFolderOpenMode = 'reveal' | 'folder';

export interface TabFlowPrefs {
	enableHorizontalGroups: boolean;
	horizontalTabCompactMode: HorizontalTabCompactMode;
	compactTopBar: boolean;
	enableVerticalSidebar: boolean;
	enableBatchSelection: boolean;
	enablePinnedTabs: boolean;
	pinnedIconOnly: boolean;
	enableVirtualMembers: boolean;
	newTabMode: NewTabMode;
	multiCollectionStrategy: MultiCollectionStrategy;
	enableTabRemarks: boolean;
	remarkDisplayMode: TabDisplayMode;
	verticalTabTitleMode: VerticalTitleMode;
	verticalTabSubtitleMode: VerticalSubtitleMode;
	verticalTabRowHeight: number;
	verticalTabFontSize: number;
	verticalSidebarWidth: number;
	verticalSidebarCollapsed: boolean;
	enableHoverPreview: boolean;
	enableSpotlight: boolean;
	enableSessions: boolean;
	enableRollingSnapshots: boolean;
	enableTabSleep: boolean;
	autoSleepMinutes: number;
	activeReaderBudget: number;
	enableStaleSuggestions: boolean;
	staleSuggestDays: number;
	enableTabContextMenu: boolean;
	enableItemContextMenu: boolean;
	enableCopyReference: boolean;
	enableShowInFilesystem: boolean;
	enablePdfFolderSidenav: boolean;
	pdfFolderOpenMode: PdfFolderOpenMode;
	enablePdfPreviewSidenav: boolean;
	pdfPreviewMode: PdfPreviewMode;
	pdfPreviewDefaultZoom: number;
	pdfPreviewDoubleClickOpen: boolean;
	pdfPreviewShowPageBadge: boolean;
	enableReloadTab: boolean;
	debug: boolean;
}

export const DEFAULT_PREFS: TabFlowPrefs = {
	enableHorizontalGroups: true,
	horizontalTabCompactMode: 'auto',
	compactTopBar: false,
	enableVerticalSidebar: true,
	enableBatchSelection: true,
	enablePinnedTabs: true,
	pinnedIconOnly: false,
	enableVirtualMembers: true,
	newTabMode: 'independent',
	multiCollectionStrategy: 'active',
	enableTabRemarks: true,
	remarkDisplayMode: 'both',
	verticalTabTitleMode: 'title',
	verticalTabSubtitleMode: 'source',
	verticalTabRowHeight: 42,
	verticalTabFontSize: 13,
	verticalSidebarWidth: 276,
	verticalSidebarCollapsed: false,
	enableHoverPreview: true,
	enableSpotlight: true,
	enableSessions: true,
	enableRollingSnapshots: true,
	enableTabSleep: true,
	autoSleepMinutes: 0,
	activeReaderBudget: 0,
	enableStaleSuggestions: true,
	staleSuggestDays: 7,
	enableTabContextMenu: true,
	enableItemContextMenu: true,
	enableCopyReference: true,
	enableShowInFilesystem: true,
	enablePdfFolderSidenav: true,
	pdfFolderOpenMode: 'reveal',
	enablePdfPreviewSidenav: true,
	pdfPreviewMode: 'section',
	pdfPreviewDefaultZoom: 100,
	pdfPreviewDoubleClickOpen: true,
	pdfPreviewShowPageBadge: true,
	enableReloadTab: true,
	debug: false,
};

let prefCacheEnabled = false;
const prefCache = new Map<keyof TabFlowPrefs, TabFlowPrefs[keyof TabFlowPrefs]>();

export function enablePrefCache(active: boolean): void {
	prefCacheEnabled = active;
	prefCache.clear();
}

export function invalidatePrefCache(key?: keyof TabFlowPrefs): void {
	if (key) prefCache.delete(key);
	else prefCache.clear();
}

export function getPref<K extends keyof TabFlowPrefs>(key: K): TabFlowPrefs[K] {
	if (prefCacheEnabled && prefCache.has(key)) return prefCache.get(key) as TabFlowPrefs[K];
	const raw = (Zotero as any)?.Prefs?.get?.(PREF_PREFIX + key, true);
	const fallback = DEFAULT_PREFS[key];
	let val: TabFlowPrefs[K] = typeof raw !== typeof fallback ? fallback : (raw as TabFlowPrefs[K]);
	if (key === 'newTabMode' && raw !== 'collection' && raw !== 'independent') val = fallback;
	if (key === 'pdfPreviewMode' && raw !== 'section' && raw !== 'full') val = fallback;
	if (key === 'pdfFolderOpenMode' && raw !== 'reveal' && raw !== 'folder') val = fallback;
	const range = NUMERIC_RANGES[key];
	if (range && typeof raw === 'number') {
		val = (Number.isFinite(raw) ? Math.max(range[0], Math.min(range[1], Math.trunc(raw))) : fallback) as TabFlowPrefs[K];
	}
	if (prefCacheEnabled) prefCache.set(key, val);
	return val;
}

const NUMERIC_RANGES: Partial<Record<keyof TabFlowPrefs, [number, number]>> = {
	verticalSidebarWidth: [200, 440],
	verticalTabRowHeight: [32, 80],
	verticalTabFontSize: [10, 22],
	autoSleepMinutes: [0, 1440],
	activeReaderBudget: [0, 100],
	staleSuggestDays: [1, 3650],
	pdfPreviewDefaultZoom: [60, 200],
};

export function setPref<K extends keyof TabFlowPrefs>(key: K, value: TabFlowPrefs[K]): void {
	prefCache.delete(key);
	Zotero.Prefs.set(PREF_PREFIX + key, value, true);
}

export function migrateNewTabMode(): void {
	const key = PREF_PREFIX + 'newTabMode';
	if (!Services.prefs.prefHasUserValue(key) && Zotero.Prefs.get(PREF_PREFIX + 'enableCollectionAutoGroup', true) === true) {
		setPref('newTabMode', 'collection');
	}
}

export function resetAllPrefs(): void {
	prefCache.clear();
	for (const [key, value] of Object.entries(DEFAULT_PREFS)) {
		Zotero.Prefs.set(PREF_PREFIX + key, value, true);
	}
}
