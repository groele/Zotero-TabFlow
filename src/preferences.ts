import { t } from './core/i18n.ts';
import { PREF_PREFIX, getPref, resetAllPrefs } from './core/prefs.ts';

function setSubtreeDisabled(el: Element | null, disabled: boolean): void {
	if (!el) return;
	el.setAttribute('data-disabled', disabled ? 'true' : 'false');
	el.querySelectorAll('checkbox, menulist, input, button').forEach((ctrl: Element) => {
		if (disabled) ctrl.setAttribute('disabled', 'true');
		else ctrl.removeAttribute('disabled');
	});
}

function syncMenulistLabels(doc: Document): void {
	doc.querySelectorAll('#zotero-prefpane-zotero-tabflow menulist').forEach((ml: Element) => {
		const selected = (ml as { selectedItem?: Element | null }).selectedItem;
		const lbl = selected?.getAttribute?.('label');
		if (lbl) ml.setAttribute('label', lbl);
	});
}

function scheduleMenulistSync(doc: Document): void {
	syncMenulistLabels(doc);
	void Promise.resolve().then(() => syncMenulistLabels(doc));
}

function updateDependencies(doc: Document): void {
	setSubtreeDisabled(doc.getElementById('tabflow-sub-horizontalCompactMode'), !getPref('enableHorizontalGroups'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-compactTopBar'), !getPref('enableHorizontalGroups') || !getPref('enableVerticalSidebar'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-enableBatchSelection'), !getPref('enableVerticalSidebar'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-pinnedIconOnly'), !getPref('enablePinnedTabs'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-multiCollectionStrategy'), getPref('newTabMode') !== 'collection');
	setSubtreeDisabled(doc.getElementById('tabflow-sub-remarkDisplayMode'), !getPref('enableTabRemarks'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-enableRollingSnapshots'), !getPref('enableSessions'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-autoSleepMinutes'), !getPref('enableTabSleep'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-staleSuggestDays'), !getPref('enableStaleSuggestions'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-tabContextActions'), !getPref('enableTabContextMenu'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-pdfPreviewSettings'), !getPref('enablePdfPreviewSidenav'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-pdfFolderSettings'), !getPref('enablePdfFolderSidenav'));
	scheduleMenulistSync(doc);
}

const TabFlowPreferences = {
	observerIDs: [] as symbol[],

	init(win?: Window): void {
		const doc = win?.document || document;
		updateDependencies(doc);
		(doc as { l10n?: { ready?: Promise<unknown> } }).l10n?.ready?.then?.(() => scheduleMenulistSync(doc));

		const pane = doc.getElementById('zotero-prefpane-zotero-tabflow');
		pane?.addEventListener('command', () => updateDependencies(doc));
		pane?.addEventListener('change', () => updateDependencies(doc));

		doc.getElementById('tabflow-reset-prefs-btn')?.addEventListener('command', () => {
			resetAllPrefs();
			updateDependencies(doc);
			(win || window).setTimeout?.(() => scheduleMenulistSync(doc), 0);
		});

		doc.getElementById('tabflow-clear-state-btn')?.addEventListener('command', () => {
			if (Services.prompt.confirm(win || window, t('zotero-tabflow-clear-state-heading', '清除工作区数据'), t('zotero-tabflow-clear-state-confirm', '确认清除所有分组、备注、固定标签、会话快照与访问记录？'))) {
				Zotero.Prefs.set(`${PREF_PREFIX}state`, '', true);
				(Zotero as any).zoterotabflow?.reloadState?.();
			}
		});

		if (!this.observerIDs.length) {
			this.observerIDs = [
				'enableHorizontalGroups', 'horizontalTabCompactMode', 'enableVerticalSidebar', 'enablePinnedTabs',
				'newTabMode', 'enableTabRemarks', 'enableSessions',
				'enableTabSleep', 'enableStaleSuggestions', 'enableTabContextMenu', 'enablePdfPreviewSidenav', 'pdfPreviewMode', 'enablePdfFolderSidenav', 'pdfFolderOpenMode',
				'multiCollectionStrategy', 'remarkDisplayMode', 'verticalTabTitleMode', 'verticalTabSubtitleMode',
			].map((key) => Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => updateDependencies(doc), true));
			(win || window).addEventListener('unload', () => {
				for (const id of this.observerIDs) Zotero.Prefs.unregisterObserver(id);
				this.observerIDs = [];
			}, { once: true });
		}
	},
};

(globalThis as any).TabFlowPreferences = TabFlowPreferences;
if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => TabFlowPreferences.init(), { once: true });
	} else {
		TabFlowPreferences.init();
	}
}
