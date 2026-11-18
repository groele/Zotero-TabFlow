const RECENT_LAUNCH_INTERVAL_MS = 500;
const lastLaunched = new Map<string, number>();

export async function resolveFileAttachment(item: any): Promise<any | null> {
	if (!item) return null;
	if (item.isFileAttachment?.()) return item;
	const best = await item.getBestAttachment?.();
	return best?.isFileAttachment?.() ? best : null;
}

export async function openAttachmentFolder(item: any, fallbackWin?: Window | null): Promise<boolean> {
	const att = await resolveFileAttachment(item);
	if (!att) return false;
	try {
		const filePath = await att.getFilePathAsync?.();
		if (filePath && (Zotero.File as any)?.pathToFile && (Zotero as any).launchFile) {
			const folder = (Zotero.File as any).pathToFile(filePath)?.parent?.path;
			if (folder) {
				const now = Date.now();
				const prev = lastLaunched.get(folder) ?? 0;
				if (now - prev < RECENT_LAUNCH_INTERVAL_MS) return true;
				(Zotero as any).launchFile(folder);
				lastLaunched.set(folder, now);
				return true;
			}
		}
	} catch (error) {
		Zotero.logError(error instanceof Error ? error : new Error(String(error)));
	}
	const targetWin = (fallbackWin as any)?.ZoteroPane
		? fallbackWin
		: (Zotero as any).getMainWindow?.() || Services.wm.getMostRecentWindow('navigator:browser');
	if ((targetWin as any)?.ZoteroPane?.showAttachmentInFilesystem) {
		await (targetWin as any).ZoteroPane.showAttachmentInFilesystem(att.id);
		return true;
	}
	return false;
}

export function resetFolderLaunchCache(): void {
	lastLaunched.clear();
}
