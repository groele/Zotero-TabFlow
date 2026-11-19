const RECENT_LAUNCH_INTERVAL_MS = 500;
const lastLaunched = new Map<string, number>();

export async function resolveFileAttachment(item: any): Promise<any | null> {
	if (!item) return null;
	if (item.isFileAttachment?.()) return item;
	const best = await item.getBestAttachment?.();
	return best?.isFileAttachment?.() ? best : null;
}

export async function openAttachmentFolder(item: any, fallbackWin?: Window | null): Promise<boolean> {
	try {
		const att = await resolveFileAttachment(item);
		if (!att) return false;
		const filePath = (await att.getFilePathAsync?.()) || att.getFilePath?.();
		const nsFile = filePath ? (Zotero.File as any)?.pathToFile?.(filePath) : null;
		const folder = nsFile?.parent?.path;
		const cacheKey = filePath || folder || String(att.id || '');
		if (cacheKey) {
			const now = Date.now();
			const prev = lastLaunched.get(cacheKey) ?? 0;
			if (now - prev < RECENT_LAUNCH_INTERVAL_MS) return true;
			lastLaunched.set(cacheKey, now);
		}
		try {
			if (nsFile && nsFile.exists?.() !== false && typeof nsFile.reveal === 'function') {
				try {
					await Promise.resolve(nsFile.reveal());
					return true;
				} catch (error) {
					Zotero.logError(error instanceof Error ? error : new Error(String(error)));
				}
			}
			const targetWin = (fallbackWin as any)?.ZoteroPane ? fallbackWin : Zotero.getMainWindow?.();
			if ((targetWin as any)?.ZoteroPane?.showAttachmentInFilesystem) {
				await (targetWin as any).ZoteroPane.showAttachmentInFilesystem(att.id);
				return true;
			}
			if (folder && (Zotero as any).launchFile) {
				await (Zotero as any).launchFile(folder);
				return true;
			}
		} catch (error) {
			if (cacheKey) lastLaunched.delete(cacheKey);
			throw error;
		}
		if (cacheKey) lastLaunched.delete(cacheKey);
	} catch (error) {
		Zotero.logError(error instanceof Error ? error : new Error(String(error)));
	}
	return false;
}

export function resetFolderLaunchCache(): void {
	lastLaunched.clear();
}
