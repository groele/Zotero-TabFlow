import { DEFAULT_PREFS, PREF_PREFIX, getPref } from './core/prefs.ts';
import { TabFlowStore } from './core/store.ts';
import { ActivityTrackerService } from './services/activity-tracker.ts';
import { ItemMetadataService } from './services/item-metadata.ts';
import { TabActionService } from './services/tab-actions.ts';
import { HorizontalBarController } from './ui/horizontal-bar.ts';
import { ItemContextMenuController } from './ui/item-context-menu.ts';
import { PdfFolderSectionController } from './ui/pdf-folder-section.ts';
import { PopoverController } from './ui/popovers.ts';
import { SpotlightController } from './ui/spotlight.ts';
import { TabContextMenuController } from './ui/tab-context-menu.ts';
import { VerticalSidebarController } from './ui/vertical-sidebar.ts';
import { WORKSPACE_CSS } from './ui/workspace-styles.ts';

class WindowWorkspace {
	private styleEl: HTMLStyleElement | null = null;
	private meta: ItemMetadataService;
	private actions: TabActionService;
	private tracker: ActivityTrackerService;
	private tabMenus: TabContextMenuController;
	private itemMenus: ItemContextMenuController;
	private popovers: PopoverController;
	private spotlight: SpotlightController;
	private horizontal: HorizontalBarController;
	private sidebar: VerticalSidebarController;
	private notifierID: string | null = null;
	private observer: MutationObserver | null = null;
	private refreshTimer: number | null = null;
	private ageTimer: number | null = null;
	private lastSelected = '';
	private disposed = false;
	private ageTickCount = 0;

	private saveRollingIfNeeded(): void {
		if (!getPref('enableSessions') || !getPref('enableRollingSnapshots')) return;
		const keys = this.meta.buildTrackedTabs().map((t) => t.key);
		if (keys.length || this.store.state.groups.length) {
			this.store.saveRollingSnapshot(keys);
		}
	}

	constructor(
		private readonly win: Window,
		private readonly store: TabFlowStore,
	) {
		const doc = win.document;
		this.meta = new ItemMetadataService(win, store);
		this.actions = new TabActionService(win, store, this.meta);
		this.tracker = new ActivityTrackerService(store, this.meta);
		const refresh = () => this.schedule();
		this.popovers = new PopoverController(win, doc, store, this.meta, this.actions, this.tracker, refresh);
		this.tabMenus = new TabContextMenuController(win, doc, store, this.meta, this.actions, refresh);
		this.itemMenus = new ItemContextMenuController(win, doc, store, this.actions, refresh);
		this.spotlight = new SpotlightController(win, doc, store, this.meta, this.actions, this.popovers, refresh);
		this.horizontal = new HorizontalBarController(win, doc, store, this.meta, this.actions, this.tracker, this.tabMenus, this.popovers, this.spotlight, refresh);
		this.sidebar = new VerticalSidebarController(win, doc, store, this.meta, this.actions, this.tabMenus, refresh, () => {
			if (!getPref('enableSessions')) return;
			const latest = this.store.state.sessions[0] || this.store.state.rollingSessions?.[0];
			if (latest) void this.popovers.previewAndRestoreSession(latest);
		});
	}

	init(): void {
		const doc = this.win.document;
		if (!(this.win as any).Zotero_Tabs) return;
		this.win.MozXULElement?.insertFTLIfNeeded?.('zotero-tabflow.ftl');

		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style') as HTMLStyleElement;
		style.id = 'ztf-workspace-style';
		style.textContent = WORKSPACE_CSS;
		doc.documentElement?.append(style);
		this.styleEl = style;

		this.spotlight.init();
		this.itemMenus.attach();

		this.notifierID = Zotero.Notifier.registerObserver(
			{
				notify: (event: string, _type: string, ids: Array<string | number>) => {
					const tabIds = ids.map(String);
					if (event === 'add') {
						if (this.store.state.collapsed.length) {
							const added = new Set(tabIds);
							for (const tab of this.meta.getNativeTabs()) {
								if (tab.type === 'library' || !added.has(tab.id)) continue;
								const groupId = this.store.groupOfKey(this.meta.tabKey(tab));
								if (this.store.state.collapsed.includes(groupId)) this.store.setCollapsed(groupId, false, false);
							}
						}
						if (getPref('enableCollectionAutoGroup')) {
							this.win.setTimeout(() => {
								if (!this.disposed) this.actions.autoGroupByCollection(tabIds);
							}, 80);
						}
					}
					this.schedule();
				},
			},
			['tab'],
			'zotero-tabflow',
		);

		this.refresh();
		const host = doc.getElementById('tab-bar-container');
		if (host) {
			this.observer = new (this.win as any).MutationObserver((records: MutationRecord[]) => {
				const inline = doc.getElementById('ztf-inline');
				const pinned = doc.querySelector('.ztf-pinned-strip');
				const actionsBar = doc.getElementById('ztf-toolbar-actions');
				const isExternal = records.some((r) => {
					const target = r.target as Node;
					return !inline?.contains(target) && !pinned?.contains(target) && !actionsBar?.contains(target);
				});
				if (isExternal) this.schedule();
			});
			this.observer!.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });
		}

		this.ageTimer = this.win.setInterval(() => {
			for (const t of this.tracker.getIdleTabsForSleep()) {
				this.actions.sleepTab(t.tab.id);
			}
			this.ageTickCount++;
			if (this.ageTickCount % 5 === 0) this.saveRollingIfNeeded();
			this.schedule();
		}, 60_000);
	}

	schedule(): void {
		if (this.disposed || this.refreshTimer !== null) return;
		this.refreshTimer = this.win.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 0);
	}

	refresh(): void {
		if (this.disposed) return;
		const prevSelected = this.lastSelected;
		const tracked = this.meta.buildTrackedTabs();
		this.lastSelected = this.tracker.trackActivity(this.lastSelected, tracked);
		const retained = this.store.state.virtualMembers;
		if (Object.keys(retained).length) {
			const hiddenIds = new Set(this.store.state.groups.filter((group) => group.hidden === true).map((group) => group.id));
			let changed = false;
			for (const tab of tracked) {
				if (!hiddenIds.has(tab.groupId) && Object.hasOwn(retained, tab.key)) {
					delete retained[tab.key];
					changed = true;
				}
			}
			if (changed) this.store.save(false);
		}
		if (this.lastSelected && this.lastSelected !== prevSelected) {
			const active = tracked.find((t) => t.tab.id === this.lastSelected);
			if (active && this.store.state.collapsed.includes(active.groupId)) {
				this.store.setCollapsed(active.groupId, false, false);
			}
		}
		this.sidebar.render(tracked);
		this.horizontal.render(tracked);
	}

	dispose(): void {
		this.disposed = true;
		try { this.saveRollingIfNeeded(); } catch { /* Best-effort snapshot on unload */ }
		if (this.refreshTimer !== null) this.win.clearTimeout(this.refreshTimer);
		if (this.ageTimer !== null) this.win.clearInterval(this.ageTimer);
		this.observer?.disconnect();
		if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
		this.popovers.dispose();
		this.spotlight.dispose();
		this.tabMenus.dispose();
		this.itemMenus.dispose();
		this.horizontal.dispose();
		this.sidebar.dispose();
		this.styleEl?.remove();
	}
}

class TabFlowPlugin {
	id = '';
	version = '';
	rootURI = '';
	_ftlRegistered = false;
	private store = new TabFlowStore();
	private windows = new Map<Window, WindowWorkspace>();
	private pdfFolderSection = new PdfFolderSectionController();
	private prefObserverIDs: symbol[] = [];
	private unsubscribeStore: (() => void) | null = null;

	init(info: { id: string; version: string; rootURI: string }): void {
		this.id = info.id;
		this.version = info.version;
		this.rootURI = info.rootURI;
	}

	start(): void {
		this.store.load();
		if (getPref('debug')) Zotero.debug('[TabFlow] Workspace state loaded');
		this.pdfFolderSection.register(this.id, this.rootURI);
		this.unsubscribeStore = this.store.subscribe(() => this.refreshAll());
		this.prefObserverIDs = Object.keys(DEFAULT_PREFS).map((key) =>
			Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => this.refreshAll(), true),
		);
		for (const win of this.getMainWindows()) this.onMainWindowLoad(win);
	}

	reloadState(): void {
		this.store.load();
		if (getPref('debug')) Zotero.debug('[TabFlow] Workspace state reloaded');
		this.refreshAll();
	}

	refreshAll(): void {
		for (const ws of this.windows.values()) ws.schedule();
	}

	onMainWindowLoad(win: Window): void {
		if (this.windows.has(win) || !(win as any).Zotero_Tabs) return;
		const ws = new WindowWorkspace(win, this.store);
		this.windows.set(win, ws);
		ws.init();
	}

	onMainWindowUnload(win: Window): void {
		const ws = this.windows.get(win);
		if (!ws) return;
		ws.dispose();
		this.windows.delete(win);
	}

	shutdown(): void {
		if (getPref('debug')) Zotero.debug('[TabFlow] Shutting down');
		this.pdfFolderSection.unregister();
		for (const id of this.prefObserverIDs) Zotero.Prefs.unregisterObserver(id);
		this.prefObserverIDs = [];
		this.unsubscribeStore?.();
		this.unsubscribeStore = null;
		for (const ws of this.windows.values()) ws.dispose();
		this.windows.clear();
	}

	private getMainWindows(): Window[] {
		if (typeof Zotero.getMainWindows === 'function') return Zotero.getMainWindows();
		const out: Window[] = [];
		const en = Services.wm.getEnumerator(null);
		while (en.hasMoreElements()) {
			const w = en.getNext();
			if (w?.Zotero_Tabs) out.push(w);
		}
		return out;
	}
}

(Zotero as any).zoterotabflow = new TabFlowPlugin();
