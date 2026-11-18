import type {
	MultiCollectionStrategy,
	TabDisplayMode,
	VerticalSubtitleMode,
	VerticalTitleMode,
} from './types.ts';

export const PREF_PREFIX = 'extensions.zotero.tabflow.';

export interface TabFlowPrefs {
	enableHorizontalGroups: boolean;
	enableVerticalSidebar: boolean;
	enableBatchSelection: boolean;
	enablePinnedTabs: boolean;
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
	enableTabSleep: boolean;
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
	enableVerticalSidebar: true,
	enableBatchSelection: true,
	enablePinnedTabs: true,
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
	enableTabSleep: true,
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
	if (raw === undefined || raw === null) return DEFAULT_PREFS[key];
	return raw as TabFlowPrefs[K];
}

export function setPref<K extends keyof TabFlowPrefs>(key: K, value: TabFlowPrefs[K]): void {
	Zotero.Prefs.set(PREF_PREFIX + key, value, true);
}

export function resetAllPrefs(): void {
	for (const [key, value] of Object.entries(DEFAULT_PREFS)) {
		Zotero.Prefs.set(PREF_PREFIX + key, value, true);
	}
}
