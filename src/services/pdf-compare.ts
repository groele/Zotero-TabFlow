export type CompareMode = 'follow' | 'self' | 'left' | 'right' | 'pick';

export interface OpenReaderTab {
	tabID: string;
	attachmentID: number;
	title: string;
	isSelected: boolean;
}

export interface CompareTargetResult {
	item: any | null;
	label: string;
}

export function collectOpenReaderTabs(win: Window): OpenReaderTab[] {
	const tabsApi = (win as any).Zotero_Tabs;
	const rawTabs: any[] = Array.isArray(tabsApi?._tabs) ? tabsApi._tabs : [];
	const selectedID = String(tabsApi?.selectedID || '');
	const result: OpenReaderTab[] = [];
	for (const tab of rawTabs) {
		if (!tab || tab.type !== 'reader') continue;
		const attachmentID = Number(tab.data?.itemID || 0);
		if (!attachmentID) continue;
		result.push({
			tabID: String(tab.id || ''),
			attachmentID,
			title: String(tab.title || '').trim() || `#${attachmentID}`,
			isSelected: String(tab.id || '') === selectedID,
		});
	}
	return result;
}

export function getAdjacentReaderTab(win: Window, direction: 'left' | 'right'): OpenReaderTab | null {
	const readers = collectOpenReaderTabs(win);
	if (readers.length < 2) return null;
	const idx = readers.findIndex((r) => r.isSelected);
	if (idx < 0) return null;
	const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
	return targetIdx >= 0 && targetIdx < readers.length ? readers[targetIdx] : null;
}

export async function resolveCompareItem(
	win: Window,
	mode: CompareMode,
	pickedAttachmentID: number | null,
	fallbackItem: any | null,
): Promise<CompareTargetResult> {
	if (mode === 'follow' || mode === 'self') {
		return { item: fallbackItem, label: '' };
	}
	let targetTab: OpenReaderTab | null = null;
	if (mode === 'left' || mode === 'right') {
		targetTab = getAdjacentReaderTab(win, mode);
	} else if (mode === 'pick' && pickedAttachmentID) {
		const readers = collectOpenReaderTabs(win);
		targetTab = readers.find((r) => r.attachmentID === pickedAttachmentID) || {
			tabID: '',
			attachmentID: pickedAttachmentID,
			title: `#${pickedAttachmentID}`,
			isSelected: false,
		};
	}
	if (!targetTab) return { item: null, label: '' };
	try {
		const item = Zotero.Items?.getAsync
			? await Zotero.Items.getAsync(targetTab.attachmentID)
			: Zotero.Items?.get?.(targetTab.attachmentID) ?? null;
		return { item: item ?? null, label: targetTab.title };
	} catch {
		return { item: null, label: targetTab.title };
	}
}
