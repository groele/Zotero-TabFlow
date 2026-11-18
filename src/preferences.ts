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

function updateDependencies(doc: Document): void {
	setSubtreeDisabled(doc.getElementById('tabflow-sub-compactTopBar'), !getPref('enableHorizontalGroups') || !getPref('enableVerticalSidebar'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-enableBatchSelection'), !getPref('enableVerticalSidebar'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-pinnedIconOnly'), !getPref('enablePinnedTabs'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-multiCollectionStrategy'), !getPref('enableCollectionAutoGroup'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-remarkDisplayMode'), !getPref('enableTabRemarks'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-enableRollingSnapshots'), !getPref('enableSessions'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-autoSleepMinutes'), !getPref('enableTabSleep'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-staleSuggestDays'), !getPref('enableStaleSuggestions'));
	setSubtreeDisabled(doc.getElementById('tabflow-sub-tabContextActions'), !getPref('enableTabContextMenu'));
}

const TabFlowPreferences = {
	observerIDs: [] as symbol[],

	init(win?: Window): void {
		const doc = win?.document || document;
		updateDependencies(doc);

		const pane = doc.getElementById('zotero-prefpane-zotero-tabflow');
		pane?.addEventListener('command', () => updateDependencies(doc));
		pane?.addEventListener('change', () => updateDependencies(doc));

		doc.getElementById('tabflow-reset-prefs-btn')?.addEventListener('command', () => {
			resetAllPrefs();
			updateDependencies(doc);
		});

		doc.getElementById('tabflow-clear-state-btn')?.addEventListener('command', () => {
			if (Services.prompt.confirm(win || window, t('zotero-tabflow-clear-state-heading', '清除工作区数据'), t('zotero-tabflow-clear-state-confirm', '确认清除所有分组、备注、固定标签、会话快照与访问记录？'))) {
				Zotero.Prefs.set(`${PREF_PREFIX}state`, '', true);
				(Zotero as any).zoterotabflow?.reloadState?.();
			}
		});

		if (!this.observerIDs.length) {
			this.observerIDs = ['enableHorizontalGroups', 'enableVerticalSidebar', 'enablePinnedTabs', 'enableCollectionAutoGroup', 'enableTabRemarks', 'enableSessions', 'enableTabSleep', 'enableStaleSuggestions', 'enableTabContextMenu']
				.map((key) => Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => updateDependencies(doc), true));
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
