import type {
	HorizontalTabCompactMode,
	MultiCollectionStrategy,
	TabDisplayMode,
	VerticalSubtitleMode,
	VerticalTitleMode,
} from './types.ts';

export const PREF_PREFIX = 'extensions.zotero.tabflow.';

export interface TabFlowPrefs {
	enableHorizontalGroups: boolean;
	horizontalTabCompactMode: HorizontalTabCompactMode;
	enableGroupHiding: boolean;
	compactTopBar: boolean;
	enableVerticalSidebar: boolean;
	enableBatchSelection: boolean;
	enablePinnedTabs: boolean;
	pinnedIconOnly: boolean;
	enableVirtualMembers: boolean;
	enableCollectionAutoGroup: boolean;
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
	enableReloadTab: boolean;
	debug: boolean;
}

export const DEFAULT_PREFS: TabFlowPrefs = {
	enableHorizontalGroups: true,
	horizontalTabCompactMode: 'auto',
	enableGroupHiding: true,
	compactTopBar: false,
	enableVerticalSidebar: true,
	enableBatchSelection: true,
	enablePinnedTabs: true,
	pinnedIconOnly: false,
	enableVirtualMembers: true,
	enableCollectionAutoGroup: false,
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
	enableReloadTab: true,
	debug: false,
};

export function getPref<K extends keyof TabFlowPrefs>(key: K): TabFlowPrefs[K] {
	const raw = Zotero.Prefs.get(PREF_PREFIX + key, true);
	const fallback = DEFAULT_PREFS[key];
	if (typeof raw !== typeof fallback) return fallback;
	const range = NUMERIC_RANGES[key];
	if (range && typeof raw === 'number') {
		if (!Number.isFinite(raw)) return fallback;
		return Math.max(range[0], Math.min(range[1], Math.trunc(raw))) as TabFlowPrefs[K];
	}
	return raw as TabFlowPrefs[K];
}

const NUMERIC_RANGES: Partial<Record<keyof TabFlowPrefs, [number, number]>> = {
	verticalSidebarWidth: [200, 440],
	verticalTabRowHeight: [32, 80],
	verticalTabFontSize: [10, 22],
	autoSleepMinutes: [0, 1440],
	activeReaderBudget: [0, 100],
	staleSuggestDays: [1, 3650],
};

export function setPref<K extends keyof TabFlowPrefs>(key: K, value: TabFlowPrefs[K]): void {
	Zotero.Prefs.set(PREF_PREFIX + key, value, true);
}

export function resetAllPrefs(): void {
	for (const [key, value] of Object.entries(DEFAULT_PREFS)) {
		Zotero.Prefs.set(PREF_PREFIX + key, value, true);
	}
}
