/* Zotero TabFlow - Preferences controller. */
"use strict";
(() => {
  // src/core/i18n.ts
  var syncBundle = null;
  function getBundle() {
    if (syncBundle) return syncBundle;
    const L10n = globalThis.Localization;
    if (typeof L10n === "function") {
      try {
        syncBundle = new L10n(["zotero-tabflow.ftl"], true);
      } catch {
        syncBundle = null;
      }
    }
    return syncBundle;
  }
  function t(id, fallback, args) {
    try {
      const val = getBundle()?.formatValueSync?.(id, args);
      if (typeof val === "string" && val.trim()) return val;
    } catch {
    }
    if (!args) return fallback;
    return fallback.replace(/\{\s*\$([a-zA-Z0-9_]+)\s*\}/g, (_m, k) => String(args[k] ?? ""));
  }

  // src/core/prefs.ts
  var PREF_PREFIX = "extensions.zotero.tabflow.";
  var DEFAULT_PREFS = {
    enableHorizontalGroups: true,
    enableGroupHiding: true,
    compactTopBar: false,
    enableVerticalSidebar: true,
    enableBatchSelection: true,
    enablePinnedTabs: true,
    pinnedIconOnly: false,
    enableVirtualMembers: true,
    enableCollectionAutoGroup: false,
    multiCollectionStrategy: "active",
    enableTabRemarks: true,
    remarkDisplayMode: "both",
    verticalTabTitleMode: "title",
    verticalTabSubtitleMode: "source",
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
    debug: false
  };
  function getPref(key) {
    const raw = Zotero.Prefs.get(PREF_PREFIX + key, true);
    const fallback = DEFAULT_PREFS[key];
    if (typeof raw !== typeof fallback) return fallback;
    const range = NUMERIC_RANGES[key];
    if (range && typeof raw === "number") {
      if (!Number.isFinite(raw)) return fallback;
      return Math.max(range[0], Math.min(range[1], Math.trunc(raw)));
    }
    return raw;
  }
  var NUMERIC_RANGES = {
    verticalSidebarWidth: [200, 440],
    verticalTabRowHeight: [32, 80],
    verticalTabFontSize: [10, 22],
    autoSleepMinutes: [0, 1440],
    activeReaderBudget: [0, 100],
    staleSuggestDays: [1, 3650]
  };
  function resetAllPrefs() {
    for (const [key, value] of Object.entries(DEFAULT_PREFS)) {
      Zotero.Prefs.set(PREF_PREFIX + key, value, true);
    }
  }

  // src/preferences.ts
  function setSubtreeDisabled(el, disabled) {
    if (!el) return;
    el.setAttribute("data-disabled", disabled ? "true" : "false");
    el.querySelectorAll("checkbox, menulist, input, button").forEach((ctrl) => {
      if (disabled) ctrl.setAttribute("disabled", "true");
      else ctrl.removeAttribute("disabled");
    });
  }
  function syncMenulistLabels(doc) {
    doc.querySelectorAll("#zotero-prefpane-zotero-tabflow menulist").forEach((ml) => {
      const selected = ml.selectedItem;
      const lbl = selected?.getAttribute?.("label");
      if (lbl) ml.setAttribute("label", lbl);
    });
  }
  function scheduleMenulistSync(doc) {
    syncMenulistLabels(doc);
    void Promise.resolve().then(() => syncMenulistLabels(doc));
  }
  function updateDependencies(doc) {
    setSubtreeDisabled(doc.getElementById("tabflow-sub-compactTopBar"), !getPref("enableHorizontalGroups") || !getPref("enableVerticalSidebar"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-enableBatchSelection"), !getPref("enableVerticalSidebar"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-pinnedIconOnly"), !getPref("enablePinnedTabs"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-multiCollectionStrategy"), !getPref("enableCollectionAutoGroup"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-remarkDisplayMode"), !getPref("enableTabRemarks"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-enableRollingSnapshots"), !getPref("enableSessions"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-autoSleepMinutes"), !getPref("enableTabSleep"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-staleSuggestDays"), !getPref("enableStaleSuggestions"));
    setSubtreeDisabled(doc.getElementById("tabflow-sub-tabContextActions"), !getPref("enableTabContextMenu"));
    scheduleMenulistSync(doc);
  }
  var TabFlowPreferences = {
    observerIDs: [],
    init(win) {
      const doc = win?.document || document;
      updateDependencies(doc);
      doc.l10n?.ready?.then?.(() => scheduleMenulistSync(doc));
      const pane = doc.getElementById("zotero-prefpane-zotero-tabflow");
      pane?.addEventListener("command", () => updateDependencies(doc));
      pane?.addEventListener("change", () => updateDependencies(doc));
      doc.getElementById("tabflow-reset-prefs-btn")?.addEventListener("command", () => {
        resetAllPrefs();
        updateDependencies(doc);
        (win || window).setTimeout?.(() => scheduleMenulistSync(doc), 0);
      });
      doc.getElementById("tabflow-clear-state-btn")?.addEventListener("command", () => {
        if (Services.prompt.confirm(win || window, t("zotero-tabflow-clear-state-heading", "清除工作区数据"), t("zotero-tabflow-clear-state-confirm", "确认清除所有分组、备注、固定标签、会话快照与访问记录？"))) {
          Zotero.Prefs.set(`${PREF_PREFIX}state`, "", true);
          Zotero.zoterotabflow?.reloadState?.();
        }
      });
      if (!this.observerIDs.length) {
        this.observerIDs = [
          "enableHorizontalGroups",
          "enableVerticalSidebar",
          "enablePinnedTabs",
          "enableCollectionAutoGroup",
          "enableTabRemarks",
          "enableSessions",
          "enableTabSleep",
          "enableStaleSuggestions",
          "enableTabContextMenu",
          "multiCollectionStrategy",
          "remarkDisplayMode",
          "verticalTabTitleMode",
          "verticalTabSubtitleMode"
        ].map((key) => Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => updateDependencies(doc), true));
        (win || window).addEventListener("unload", () => {
          for (const id of this.observerIDs) Zotero.Prefs.unregisterObserver(id);
          this.observerIDs = [];
        }, { once: true });
      }
    }
  };
  globalThis.TabFlowPreferences = TabFlowPreferences;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => TabFlowPreferences.init(), { once: true });
    } else {
      TabFlowPreferences.init();
    }
  }
})();
