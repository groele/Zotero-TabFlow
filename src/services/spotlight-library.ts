import type { ItemMetadataService } from './item-metadata.ts';

export interface LibraryIndexItem { id: number; fullKey: string; title: string; metaHint: string; searchText: string; }

const INDEX_BATCH_SIZE = 200;

export async function buildSpotlightLibraryIndex(
	win: Window,
	meta: Pick<ItemMetadataService, 'plainTitle'>,
	isDisposed: () => boolean,
): Promise<{ entries: LibraryIndexItem[]; complete: boolean } | null> {
	const api = Zotero.Libraries as any;
	const libraries = api?.getAll?.();
	const libraryIDs = Array.isArray(libraries)
		? [...new Set(libraries.map((library: any) => library?.libraryID).filter((id: unknown): id is number => Number.isInteger(id) && Number(id) > 0))]
		: [api?.userLibraryID ?? 1];
	const entries: LibraryIndexItem[] = [];
	let complete = true;
	for (const libraryID of libraryIDs) {
		if (isDisposed()) return null;
		try {
			const items = await (Zotero.Items as any)?.getAll?.(libraryID, true, false, false);
			if (isDisposed()) return null;
			if (!Array.isArray(items)) { complete = false; continue; }
			let libraryName = '';
			try { libraryName = api?.getName?.(libraryID) || ''; } catch { /* Optional search metadata. */ }
			for (let i = 0; i < items.length; i++) {
				if (i > 0 && i % INDEX_BATCH_SIZE === 0) {
					await new Promise<void>((resolve) => win.setTimeout(resolve, 0));
					if (isDisposed()) return null;
				}
				const item = items[i];
				if (!item?.isRegularItem?.() || item.deleted) continue;
				const title = meta.plainTitle(String(item.getField?.('title') || '')) || item.key;
				const creators = item.getCreators?.() || [];
				const author = creators[0]?.lastName || creators[0]?.firstName || '';
				const year = String(item.getField?.('year') || '').slice(0, 4);
				const pub = String(item.getField?.('publicationTitle') || item.getField?.('proceedingsTitle') || '');
				entries.push({
					id: item.id,
					fullKey: `${libraryID}:${item.key}`,
					title,
					metaHint: [libraryName, author, year, pub].filter(Boolean).join(' · '),
					searchText: `${title} ${author} ${year} ${pub} ${libraryName}`.toLowerCase(),
				});
			}
		} catch {
			complete = false;
		}
	}
	return { entries, complete };
}
