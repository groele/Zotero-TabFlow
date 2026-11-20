import { resetI18nCache } from './core/i18n.ts';
import { DEFAULT_PREFS, PREF_PREFIX, enablePrefCache, getPref, invalidatePrefCache, migrateNewTabMode } from './core/prefs.ts';
import { TabFlowStore } from './core/store.ts';
import type { TrackedTab } from './core/types.ts';
import { ActivityTrackerService } from './services/activity-tracker.ts';
import { ItemMetadataService } from './services/item-metadata.ts';
import { TabActionService } from './services/tab-actions.ts';
import { HorizontalBarController } from './ui/horizontal-bar.ts';
import { ItemContextMenuController } from './ui/item-context-menu.ts';
import { PdfFolderSectionController } from './ui/pdf-folder-section.ts';
import { PopoverController } from './ui/popovers.ts';
import { SidebarHoverCard } from './ui/sidebar-hover.ts';
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
	private hoverCard: SidebarHoverCard;
	private notifierID: string | null = null;
	private observer: MutationObserver | null = null;
	private refreshTimer: number | null = null;
	private resizeTimer: number | null = null;
	private ageTimer: number | null = null;
	private autoGroupTimer: number | null = null;
	private pendingAutoGroup = new Set<string>();
	private lastSelected = '';
	private disposed = false;
	private tracked: readonly TrackedTab[] = [];
	private staleCount = 0;
	private onResize = (): void => {
		if (this.disposed || this.resizeTimer !== null) return;
		this.resizeTimer = this.win.setTimeout(() => { this.resizeTimer = null; this.schedule(); }, 100);
	};

	getOpenKeys(): string[] { return this.meta.getOpenKeys(); }

	constructor(
		private readonly win: Window,
		private readonly store: TabFlowStore,
		private readonly onAgeTick: () => void,
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
		this.hoverCard = new SidebarHoverCard(win, doc, store);
		this.horizontal = new HorizontalBarController(win, doc, store, this.meta, this.actions, this.tracker, this.tabMenus, this.popovers, this.spotlight, refresh, this.hoverCard);
		this.sidebar = new VerticalSidebarController(win, doc, store, this.meta, this.actions, this.tabMenus, refresh, () => {
			if (!getPref('enableSessions')) return;
			const latest = this.store.state.sessions[0] || this.store.state.rollingSessions?.[0];
			if (latest) void this.popovers.previewAndRestoreSession(latest);
		}, this.hoverCard);
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
		this.hoverCard.mount();

		this.spotlight.init();
		this.itemMenus.attach();
		this.win.addEventListener?.('resize', this.onResize);

		this.notifierID = Zotero.Notifier.registerObserver(
			{
				notify: (event: string, type: string, ids: Array<string | number>) => {
					if (type !== 'tab') {
						if (!this.tracked.length) return;
						if (type === 'item') {
							const changed = new Set(ids.map(Number));
							if (!this.tracked.some((tab) => changed.has(tab.itemID ?? 0) || changed.has(tab.parentItemID ?? 0))) return;
							this.meta.invalidateItemFields(changed);
						}
						this.schedule();
						return;
					}
					if (event === 'add' && !this.onTabsAdded(ids)) return;
					this.schedule();
				},
			},
			['tab', 'item', 'collection'],
			'zotero-tabflow',
		);

		this.refresh();
		const host = doc.getElementById('tab-bar-container');
		if (host) {
			this.observer = new (this.win as any).MutationObserver((records: MutationRecord[]) => {
				if (this.disposed || this.refreshTimer !== null) return;
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
			const now = Date.now();
			const slept = this.actions.sleepTabs(this.tracker.getIdleTabsForSleep(now, this.tracked).map((tab) => tab.tab.id));
			const showTime = getPref('enableVerticalSidebar') && !getPref('verticalSidebarCollapsed')
				&& getPref('verticalTabSubtitleMode') === 'lastViewed';
			const staleCount = this.tracker.getStaleTabs(now, this.tracked).length;
			if (slept || (showTime && this.tracked.length) || staleCount !== this.staleCount) this.schedule();
			this.onAgeTick();
		}, 60_000);
	}

	private onTabsAdded(ids: Array<string | number>): boolean {
		const added = new Set(ids.map(String));
		const tabs = this.meta.getNativeTabs().filter((tab) => tab.type !== 'library' && added.has(tab.id));
		if (!tabs.length) return false;

		const collapsed = new Set(this.store.state.collapsed);
		if (collapsed.size) {
			const canOpenUngrouped = getPref('newTabMode') === 'collection' && !this.store.state.ungroupedHeadingHidden;
			for (const tab of tabs) {
				const groupId = this.store.groupOfKey(this.meta.tabKey(tab));
				if (groupId || canOpenUngrouped) collapsed.delete(groupId);
			}
			if (collapsed.size !== this.store.state.collapsed.length) {
				this.store.state.collapsed = [...collapsed];
				this.store.scheduleSave();
			}
		}

		if (getPref('newTabMode') === 'collection') {
			for (const tab of tabs) this.pendingAutoGroup.add(tab.id);
			this.autoGroupTimer ??= this.win.setTimeout(() => {
				this.autoGroupTimer = null;
				const pending = this.pendingAutoGroup;
				this.pendingAutoGroup = new Set();
				if (!this.disposed) this.actions.autoGroupNewTabs(pending);
			}, 80);
		}
		return true;
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
		const tracked = this.tracked = this.meta.buildTrackedTabs();
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
			if (active && (active.groupId || getPref('newTabMode') === 'collection')
				&& this.store.state.collapsed.includes(active.groupId)) {
				this.store.setCollapsed(active.groupId, false, false);
			}
		}
		this.sidebar.render(tracked);
		this.staleCount = this.horizontal.render(tracked) ?? 0;
	}

	dispose(): void {
		this.disposed = true;
		this.win.removeEventListener?.('resize', this.onResize);
		if (this.resizeTimer !== null) this.win.clearTimeout(this.resizeTimer);
		if (this.refreshTimer !== null) this.win.clearTimeout(this.refreshTimer);
		if (this.ageTimer !== null) this.win.clearInterval(this.ageTimer);
		if (this.autoGroupTimer !== null) this.win.clearTimeout(this.autoGroupTimer);
		this.pendingAutoGroup.clear();
		this.observer?.disconnect();
		if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
		this.popovers.dispose();
		this.spotlight.dispose();
		this.tabMenus.dispose();
		this.itemMenus.dispose();
		this.horizontal.dispose();
		this.sidebar.dispose();
		this.hoverCard.dispose();
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
	private nextRollingAt = 0;
	private unsubscribeStore: (() => void) | null = null;

	init(info: { id: string; version: string; rootURI: string }): void {
		this.id = info.id;
		this.version = info.version;
		this.rootURI = info.rootURI;
	}

	start(): void {
		migrateNewTabMode();
		enablePrefCache(true);
		this.store.load();
		this.nextRollingAt = Date.now() + 300_000;
		if (getPref('debug')) Zotero.debug('[TabFlow] Workspace state loaded');
		this.pdfFolderSection.register(this.id, this.rootURI);
		this.unsubscribeStore = this.store.subscribe(() => this.refreshAll());
		this.prefObserverIDs = (Object.keys(DEFAULT_PREFS) as Array<keyof typeof DEFAULT_PREFS>).map((key) =>
			Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => { invalidatePrefCache(key); this.refreshAll(); }, true),
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
		const ws = new WindowWorkspace(win, this.store, () => this.saveRollingIfDue());
		this.windows.set(win, ws);
		ws.init();
	}

	onMainWindowUnload(win: Window): void {
		const ws = this.windows.get(win);
		if (!ws) return;
		if (this.windows.size === 1) this.saveRollingIfDue(true);
		ws.dispose();
		this.windows.delete(win);
	}

	shutdown(): void {
		if (getPref('debug')) Zotero.debug('[TabFlow] Shutting down');
		this.saveRollingIfDue(true);
		enablePrefCache(false);
		resetI18nCache();
		this.pdfFolderSection.unregister();
		for (const id of this.prefObserverIDs) Zotero.Prefs.unregisterObserver(id);
		this.prefObserverIDs = [];
		this.unsubscribeStore?.();
		this.unsubscribeStore = null;
		for (const ws of this.windows.values()) ws.dispose();
		this.windows.clear();
	}

	private saveRollingIfDue(force = false): void {
		const now = Date.now();
		if (!force && now < this.nextRollingAt) return;
		this.nextRollingAt = now + 300_000;
		try {
			if (this.windows.size && getPref('enableSessions') && getPref('enableRollingSnapshots')) {
				const keys = new Set<string>();
				for (const workspace of this.windows.values()) {
					for (const key of workspace.getOpenKeys()) keys.add(key);
				}
				if (keys.size || this.store.state.groups.length) this.store.saveRollingSnapshot([...keys]);
			}
		} catch (error) {
			Zotero.logError(error as Error);
		} finally {
			if (force) {
				try { this.store.flushPendingSave(); } catch (error) { Zotero.logError(error as Error); }
			}
		}
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
