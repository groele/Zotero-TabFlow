/* Zotero TabFlow - Unified horizontal & vertical tab workspace for Zotero 10-12. */
"use strict";
(() => {
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
    if (raw === void 0 || raw === null) return DEFAULT_PREFS[key];
    return raw;
  }
  function setPref(key, value) {
    Zotero.Prefs.set(PREF_PREFIX + key, value, true);
  }

  // src/core/color-utils.ts
  function normalizeHexColor(value) {
    const hex = String(value).trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return `#${[...hex].map((c) => c + c).join("").toLowerCase()}`;
    }
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
  }

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

  // src/core/session-store.ts
  var MAX_MANUAL_SESSIONS = 30;
  var MAX_ROLLING_SNAPSHOTS = 3;
  function buildSessionSnapshot(state, name, openKeys, kind = "manual") {
    const cleanKeys = kind === "template" ? [] : [...new Set(openKeys)];
    const assignments = kind === "template" ? {} : { ...state.assignments };
    const pinned = kind === "template" ? [] : [...state.pinned];
    const virtualMembers = kind === "template" ? [] : Object.values(state.virtualMembers).map(({ itemID, parentItemID, ...portable }) => portable);
    const relevantKeys = /* @__PURE__ */ new Set([...cleanKeys, ...Object.keys(assignments), ...pinned]);
    const remarks = {};
    if (kind !== "template") {
      for (const key of relevantKeys) {
        if (state.remarks[key]) remarks[key] = { ...state.remarks[key] };
      }
    }
    const now = Date.now();
    return {
      id: `${kind === "rolling" ? "rolling" : "s"}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim().slice(0, 60) || t("zotero-tabflow-session-default-name", "工作区会话"),
      createdAt: now,
      groups: state.groups.map((g) => ({ ...g })),
      assignments,
      pinned,
      openKeys: cleanKeys,
      virtualMembers,
      order: [...state.order],
      collapsed: [...state.collapsed],
      remarks,
      ungroupedName: state.ungroupedName,
      ungroupedColor: state.ungroupedColor,
      kind
    };
  }
  function sessionLayoutFingerprint(snap) {
    return JSON.stringify({
      groups: snap.groups,
      assignments: snap.assignments,
      pinned: snap.pinned,
      openKeys: snap.openKeys,
      virtualMembers: snap.virtualMembers,
      order: snap.order,
      ungroupedName: snap.ungroupedName,
      ungroupedColor: snap.ungroupedColor
    });
  }
  function appendManualSession(state, snap) {
    state.sessions = [snap, ...state.sessions].slice(0, MAX_MANUAL_SESSIONS);
  }
  function appendRollingSnapshot(state, snap) {
    const current = state.rollingSessions ?? [];
    if (current[0] && sessionLayoutFingerprint(current[0]) === sessionLayoutFingerprint(snap)) {
      return false;
    }
    state.rollingSessions = [snap, ...current].slice(0, MAX_ROLLING_SNAPSHOTS);
    return true;
  }
  function promoteRollingSnapshot(state, id, customName) {
    const current = state.rollingSessions ?? [];
    const idx = current.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const source = current[idx];
    const nextRolling = current.filter((s) => s.id !== id);
    state.rollingSessions = nextRolling;
    const now = Date.now();
    const promoted = {
      ...source,
      id: `s-${now}-${Math.random().toString(36).slice(2, 6)}`,
      name: customName?.trim().slice(0, 60) || source.name,
      createdAt: now,
      kind: "manual"
    };
    appendManualSession(state, promoted);
    return promoted;
  }
  function applySessionLayout(state, snapshot, merge, virtualMembers) {
    const previousAssignments = state.assignments;
    const existing = new Set(state.groups.map((g) => g.id));
    const added = snapshot.groups.filter((g) => !merge || !existing.has(g.id));
    state.groups = [...merge ? state.groups : [], ...added.map((g) => ({ ...g }))];
    const validIds = /* @__PURE__ */ new Set(["", ...state.groups.map((g) => g.id)]);
    const order = [...merge ? state.order : [], ...snapshot.order ?? []];
    state.order = [.../* @__PURE__ */ new Set([...order.filter((id) => validIds.has(id)), ...validIds])];
    if (merge) {
      const addedIds = new Set(added.map((g) => g.id));
      state.collapsed = [.../* @__PURE__ */ new Set([
        ...state.collapsed,
        ...(snapshot.collapsed ?? []).filter((id) => addedIds.has(id))
      ])];
    } else {
      state.collapsed = (snapshot.collapsed ?? []).filter((id) => validIds.has(id));
      state.ungroupedName = snapshot.ungroupedName;
      state.ungroupedColor = snapshot.ungroupedColor ?? "#737373";
    }
    if (!merge) state.assignments = {};
    for (const [key, id] of Object.entries(snapshot.assignments)) {
      const currentGroup = state.assignments[key] && state.groups.some((g) => g.id === state.assignments[key]) ? state.assignments[key] : "";
      if (id && validIds.has(id) && (!merge || !currentGroup)) state.assignments[key] = id;
    }
    if (snapshot.remarks) {
      for (const [key, r] of Object.entries(snapshot.remarks)) {
        if (!merge || !state.remarks[key]?.note) state.remarks[key] = { ...r };
      }
    }
    state.pinned = [.../* @__PURE__ */ new Set([...merge ? state.pinned : [], ...snapshot.pinned])];
    if (!merge) {
      state.virtualMembers = Object.fromEntries(Object.entries(state.virtualMembers).filter(
        ([key]) => virtualMembers === void 0 && (previousAssignments[key] || "") === (state.assignments[key] || "")
      ));
    }
    for (const member of virtualMembers ?? []) {
      if (!merge || !Object.hasOwn(state.virtualMembers, member.key)) state.virtualMembers[member.key] = member;
    }
  }
  function formatSnapshotTimestamp(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // src/core/store.ts
  var STATE_PREF = `${PREF_PREFIX}state`;
  var AUTO_COLORS = ["#3977d5", "#8b5ac7", "#21866a", "#dc8225", "#c74646", "#298c9b", "#d064a3"];
  function createEmptyState() {
    return {
      version: 1,
      groups: [],
      assignments: {},
      ungroupedColor: "#737373",
      collapsed: [],
      order: [""],
      history: {},
      remarks: {},
      groupDisplay: {},
      pinned: [],
      sleeping: [],
      virtualMembers: {},
      sessions: [],
      rollingSessions: []
    };
  }
  var TabFlowStore = class {
    state = createEmptyState();
    readOnly = false;
    listeners = /* @__PURE__ */ new Set();
    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
    notify() {
      for (const fn of this.listeners) fn();
    }
    load() {
      const raw = Zotero.Prefs.get(STATE_PREF, true);
      if (!raw || typeof raw !== "string") return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || !Array.isArray(parsed.groups)) {
          throw new Error("Invalid Zotero TabFlow state");
        }
        const groups = parsed.groups.filter(
          (g) => g && typeof g.id === "string" && g.id && typeof g.name === "string" && /^#[0-9a-f]{6}$/i.test(g.color)
        );
        const validIds = /* @__PURE__ */ new Set(["", ...groups.map((g) => g.id)]);
        this.state = {
          version: 1,
          groups,
          assignments: { ...parsed.assignments ?? {} },
          ungroupedColor: normalizeHexColor(parsed.ungroupedColor ?? "") ?? "#737373",
          ungroupedName: typeof parsed.ungroupedName === "string" && parsed.ungroupedName.trim() ? parsed.ungroupedName.trim().slice(0, 60) : void 0,
          collapsed: [...new Set((parsed.collapsed ?? []).filter((id) => validIds.has(id)))],
          order: [.../* @__PURE__ */ new Set([...(parsed.order ?? []).filter((id) => validIds.has(id)), ...validIds])],
          history: parsed.history && typeof parsed.history === "object" ? { ...parsed.history } : {},
          remarks: parsed.remarks && typeof parsed.remarks === "object" ? { ...parsed.remarks } : {},
          groupDisplay: parsed.groupDisplay && typeof parsed.groupDisplay === "object" ? { ...parsed.groupDisplay } : {},
          pinned: [...new Set(Array.isArray(parsed.pinned) ? parsed.pinned : [])],
          sleeping: [...new Set(Array.isArray(parsed.sleeping) ? parsed.sleeping : [])],
          virtualMembers: parsed.virtualMembers && typeof parsed.virtualMembers === "object" ? { ...parsed.virtualMembers } : {},
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          rollingSessions: Array.isArray(parsed.rollingSessions) ? parsed.rollingSessions : []
        };
        this.readOnly = false;
      } catch (error) {
        this.readOnly = true;
        Zotero.logError(error);
      }
    }
    save(emit = true) {
      if (this.readOnly) return;
      Zotero.Prefs.set(STATE_PREF, JSON.stringify(this.state), true);
      if (emit) this.notify();
    }
    clearAll() {
      this.readOnly = false;
      this.state = createEmptyState();
      this.save(true);
    }
    orderedGroups() {
      const byId = new Map(this.state.groups.map((group) => [group.id, group]));
      const name = this.state.ungroupedName || t("zotero-tabflow-ungrouped", "未分组");
      byId.set("", { id: "", name, color: this.state.ungroupedColor || "#737373" });
      const order = [.../* @__PURE__ */ new Set([...this.state.order || [], ...byId.keys()])];
      return order.map((id) => byId.get(id)).filter((g) => Boolean(g));
    }
    visibleGroups() {
      const groups = this.orderedGroups();
      return getPref("enableGroupHiding") ? groups.filter((group) => group.hidden !== true) : groups;
    }
    hiddenGroups() {
      return getPref("enableGroupHiding") ? this.orderedGroups().filter((group) => group.hidden === true) : [];
    }
    setGroupHidden(id, hidden, members = []) {
      const group = this.state.groups.find((candidate) => candidate.id === id);
      if (!group || group.hidden === true === hidden || this.readOnly) return;
      if (hidden) {
        group.hidden = true;
        for (const member of members) this.state.virtualMembers[member.key] = member;
      } else delete group.hidden;
      this.save();
    }
    hideUngrouped(openKeys, members = []) {
      if (this.readOnly) return;
      const originalName = this.state.ungroupedName || t("zotero-tabflow-saved-ungrouped-name", "未分组文献");
      const keys = [.../* @__PURE__ */ new Set([...openKeys, ...Object.keys(this.state.virtualMembers)])].filter((key) => !this.groupOfKey(key));
      if (!keys.length) return;
      let name = originalName;
      for (let i = 2; this.state.groups.some((g) => g.name === name); i++) {
        const suffix = ` (${i})`;
        name = originalName.slice(0, 60 - suffix.length) + suffix;
      }
      const group = this.addGroup(name, this.state.ungroupedColor);
      group.hidden = true;
      for (const key of keys) this.state.assignments[key] = group.id;
      for (const member of members) this.state.virtualMembers[member.key] = member;
      if (this.state.collapsed.includes("")) this.state.collapsed = [...this.state.collapsed.filter(Boolean), group.id];
      if (this.state.groupDisplay[""]) this.state.groupDisplay[group.id] = this.state.groupDisplay[""];
      delete this.state.ungroupedName;
      this.save();
    }
    ensureGroup(name) {
      const clean = name.trim().slice(0, 60) || t("zotero-tabflow-default-group-name", "新分组");
      const existing = this.state.groups.find((g) => g.name === clean);
      if (existing) return existing;
      const group = this.addGroup(clean, AUTO_COLORS[this.state.groups.length % AUTO_COLORS.length]);
      this.save();
      return group;
    }
    addGroup(name, color) {
      const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const group = { id, name, color };
      this.state.groups.push(group);
      this.state.order = [.../* @__PURE__ */ new Set([...this.state.order, id])];
      return group;
    }
    renameGroup(id, name) {
      const clean = name.trim().slice(0, 60);
      if (!clean) return;
      if (!id) {
        this.state.ungroupedName = clean;
        this.save();
        return;
      }
      const g = this.state.groups.find((x) => x.id === id);
      if (!g) return;
      g.name = clean;
      this.save();
    }
    dissolveGroup(id) {
      if (!id || this.readOnly || !this.state.groups.some((group) => group.id === id)) return false;
      this.state.groups = this.state.groups.filter((group) => group.id !== id);
      this.state.assignments = Object.fromEntries(Object.entries(this.state.assignments).filter(([, groupId]) => groupId !== id));
      this.state.order = this.state.order.filter((x) => x !== id);
      this.state.collapsed = this.state.collapsed.filter((x) => x !== id);
      delete this.state.groupDisplay[id];
      this.save();
      return true;
    }
    setGroupColor(id, rawColor) {
      const color = normalizeHexColor(rawColor);
      if (!color) return false;
      if (!id) this.state.ungroupedColor = color;
      else {
        const g = this.state.groups.find((x) => x.id === id);
        if (!g) return false;
        g.color = color;
      }
      this.save();
      return true;
    }
    moveGroup(id, targetId, after = false) {
      if (id === targetId) return;
      const ids = this.orderedGroups().map((g) => g.id);
      if (!ids.includes(id) || !ids.includes(targetId)) return;
      ids.splice(ids.indexOf(id), 1);
      ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, id);
      this.state.order = ids;
      this.save();
    }
    setCollapsed(id, collapsed, emit = true) {
      const set = new Set(this.state.collapsed);
      if (collapsed) set.add(id);
      else set.delete(id);
      this.state.collapsed = [...set];
      this.save(emit);
    }
    groupOfKey(key) {
      if (!key) return "";
      const id = this.state.assignments[key];
      return this.state.groups.some((g) => g.id === id) ? id : "";
    }
    assignKey(key, groupId) {
      this.assignKeys([key], groupId);
    }
    assignKeys(keys, groupId) {
      if (!keys.length) return;
      if (groupId && !this.state.groups.some((g) => g.id === groupId)) return;
      for (const key of keys) {
        if (groupId) this.state.assignments[key] = groupId;
        else delete this.state.assignments[key];
      }
      this.state.collapsed = this.state.collapsed.filter((id) => id !== groupId);
      this.save();
    }
    getRemark(key) {
      const fallbackMode = getPref("remarkDisplayMode");
      if (!key) return { note: "", mode: fallbackMode };
      const r = this.state.remarks[key];
      const groupMode = this.state.groupDisplay[this.groupOfKey(key)] || fallbackMode;
      return {
        note: typeof r?.note === "string" ? r.note : "",
        mode: r?.mode && ["original", "note", "both"].includes(r.mode) ? r.mode : groupMode
      };
    }
    setRemark(key, note, mode) {
      const clean = note.trim().slice(0, 300);
      const prev = this.getRemark(key);
      this.state.remarks[key] = { note: clean, mode: mode ?? (clean && prev.mode === "original" ? "both" : prev.mode) };
      this.save();
    }
    setDisplayMode(key, mode) {
      this.state.remarks[key] = { ...this.getRemark(key), mode };
      this.save();
    }
    isPinned(key) {
      return this.state.pinned.includes(key);
    }
    setPinnedKeys(keys, pinned) {
      if (!keys.length) return;
      const set = new Set(this.state.pinned);
      for (const key of keys) {
        if (pinned) set.add(key);
        else set.delete(key);
      }
      this.state.pinned = [...set];
      this.save();
    }
    togglePinned(key) {
      const next = !this.isPinned(key);
      this.setPinnedKeys([key], next);
      return next;
    }
    isSleeping(key) {
      return this.state.sleeping.includes(key);
    }
    setSleeping(key, sleeping) {
      const set = new Set(this.state.sleeping);
      if (sleeping) set.add(key);
      else set.delete(key);
      this.state.sleeping = [...set];
      this.save();
    }
    saveVirtualMember(meta) {
      this.state.virtualMembers[meta.key] = meta;
      this.save();
    }
    removeVirtualMember(key, emit = true) {
      if (key in this.state.virtualMembers) {
        delete this.state.virtualMembers[key];
        this.save(emit);
      }
    }
    saveSession(name, openKeys) {
      const snapshot = buildSessionSnapshot(this.state, name || t("zotero-tabflow-session-default-name", "工作区会话"), openKeys, "manual");
      appendManualSession(this.state, snapshot);
      this.save();
      return snapshot;
    }
    savePreReplaceSnapshot(openKeys) {
      const stamp = formatSnapshotTimestamp(Date.now());
      const label = `${t("zotero-tabflow-session-pre-replace-prefix", "替换前备份")} · ${stamp}`;
      const snapshot = buildSessionSnapshot(this.state, label, openKeys, "pre-replace");
      appendManualSession(this.state, snapshot);
      this.save();
      return snapshot;
    }
    saveLayoutTemplate(name) {
      const snapshot = buildSessionSnapshot(this.state, name || t("zotero-tabflow-template-default-name", "布局模板"), [], "template");
      appendManualSession(this.state, snapshot);
      this.save();
      return snapshot;
    }
    saveRollingSnapshot(openKeys) {
      if (!getPref("enableRollingSnapshots")) return null;
      const stamp = formatSnapshotTimestamp(Date.now());
      const label = `${t("zotero-tabflow-rolling-prefix", "自动快照")} · ${stamp}`;
      const snapshot = buildSessionSnapshot(this.state, label, openKeys, "rolling");
      if (!appendRollingSnapshot(this.state, snapshot)) return null;
      this.save(false);
      return snapshot;
    }
    importSessions(snapshots) {
      let count = 0;
      for (const snap of [...snapshots].reverse()) {
        if (!snap || typeof snap.name !== "string" || !Array.isArray(snap.groups)) continue;
        const copy = {
          ...snap,
          id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: snap.kind || "manual"
        };
        appendManualSession(this.state, copy);
        count++;
      }
      if (count) this.save();
      return count;
    }
    deleteSession(id) {
      this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
      if (this.state.rollingSessions?.length) {
        this.state.rollingSessions = this.state.rollingSessions.filter((s) => s.id !== id);
      }
      this.save();
    }
    restoreSessionLayout(snapshot, merge, virtualMembers) {
      applySessionLayout(this.state, snapshot, merge, virtualMembers);
      this.save();
    }
  };

  // src/services/activity-tracker.ts
  var ActivityTrackerService = class {
    store;
    meta;
    constructor(store, meta) {
      this.store = store;
      this.meta = meta;
    }
    trackActivity(previousSelected, tracked = this.meta.buildTrackedTabs()) {
      const now = Date.now();
      let changed = false;
      const selectedID = this.meta.getSelectedTabID();
      for (const { key, tab } of tracked) {
        if (key.startsWith("tab:")) continue;
        if (!this.store.state.history[key]) {
          this.store.state.history[key] = { firstSeen: now, lastViewed: null };
          changed = true;
        }
        if (previousSelected !== selectedID && (tab.id === previousSelected || tab.id === selectedID)) {
          this.store.state.history[key].lastViewed = now;
          changed = true;
        }
      }
      if (changed) this.store.save(false);
      return selectedID;
    }
    getStaleTabs(now = Date.now(), tracked) {
      if (!getPref("enableStaleSuggestions")) return [];
      const threshold = getPref("staleSuggestDays");
      const selected = this.meta.getSelectedTabID();
      const dayMs = 864e5;
      return (tracked ?? this.meta.buildTrackedTabs()).filter((t2) => !t2.pinned && t2.tab.id !== selected).map((t2) => {
        const h = this.store.state.history[t2.key];
        const since = h?.lastViewed ?? h?.firstSeen ?? now;
        return { tracked: t2, days: Math.max(0, Math.floor((now - since) / dayMs)) };
      }).filter((x) => x.days >= threshold).sort((a, b) => b.days - a.days);
    }
    getIdleTabsForSleep(now = Date.now()) {
      if (!getPref("enableTabSleep")) return [];
      const mins = Math.max(0, Number(getPref("autoSleepMinutes")) || 0);
      if (mins <= 0) return [];
      const thresholdMs = mins * 6e4;
      const selected = this.meta.getSelectedTabID();
      return this.meta.buildTrackedTabs().filter((t2) => {
        if (t2.pinned || t2.tab.id === selected || t2.status !== "active") return false;
        const h = this.store.state.history[t2.key];
        const since = h?.lastViewed ?? h?.firstSeen ?? now;
        return now - since >= thresholdMs;
      });
    }
  };

  // src/services/item-metadata.ts
  function uncategorizedCollectionLabel() {
    return t("zotero-tabflow-uncategorized-collection", "未分类集合");
  }
  var ItemMetadataService = class {
    win;
    store;
    constructor(win, store) {
      this.win = win;
      this.store = store;
    }
    getNativeTabs() {
      const tabs = this.win.Zotero_Tabs?._tabs;
      return Array.isArray(tabs) ? tabs : [];
    }
    getSelectedTabID() {
      return String(this.win.Zotero_Tabs?.selectedID || "");
    }
    tabKey(tab) {
      const itemID = tab?.data?.itemID;
      if (typeof itemID !== "number") return null;
      const item = Zotero.Items.get(itemID);
      return item ? `${item.libraryID}:${item.key}` : null;
    }
    resolvePrimaryItem(itemID) {
      if (typeof itemID !== "number") return null;
      const item = Zotero.Items.get(itemID);
      if (!item) return null;
      return item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
    }
    resolveCollectionName(item) {
      const uncategorized = uncategorizedCollectionLabel();
      if (!item) return uncategorized;
      const primary = item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
      const collectionIDs = primary.getCollections?.() || [];
      if (!collectionIDs.length) return uncategorized;
      const strategy = getPref("multiCollectionStrategy");
      if (strategy === "active") {
        const activeCol = this.win.ZoteroPane?.getSelectedCollections?.()?.find(
          (collection) => collectionIDs.includes(collection.id)
        );
        if (activeCol) {
          return String(activeCol.name || uncategorized);
        }
      }
      if (strategy === "existing") {
        for (const cid of collectionIDs) {
          const col = Zotero.Collections.get(cid);
          if (col && this.store.state.groups.some((g) => g.name === col.name)) {
            return String(col.name);
          }
        }
      }
      const first = Zotero.Collections.get(collectionIDs[0]);
      return first ? String(first.name) : uncategorized;
    }
    plainTitle(value) {
      const render = Zotero.Utilities?.Internal?.renderItemTitle;
      return typeof render === "function" ? render.call(Zotero.Utilities.Internal, value) : value.replace(/<[^>]*>/g, "");
    }
    buildTrackedTabs() {
      const enablePinned = getPref("enablePinnedTabs");
      const enableSleep = getPref("enableTabSleep");
      const { assignments, groups, pinned, sleeping } = this.store.state;
      const groupIds = new Set(groups.map((group) => group.id));
      const pinnedKeys = new Set(enablePinned ? pinned : []);
      const sleepingKeys = new Set(enableSleep ? sleeping : []);
      const collections = /* @__PURE__ */ new Map();
      return this.getNativeTabs().filter((t2) => t2.type !== "library").map((tab) => {
        const itemID = typeof tab.data?.itemID === "number" ? tab.data.itemID : null;
        const rawItem = itemID ? Zotero.Items.get(itemID) : null;
        const key = rawItem ? `${rawItem.libraryID}:${rawItem.key}` : `tab:${tab.id}`;
        const primary = rawItem?.parentItemID ? Zotero.Items.get(rawItem.parentItemID) || rawItem : rawItem;
        const title = this.plainTitle(String(primary?.getField?.("title") || tab.title || t("zotero-tabflow-untitled", "无标题")));
        const shortTitle = this.plainTitle(String(primary?.getField?.("shortTitle") || title));
        const filename = String(rawItem?.isAttachment?.() ? rawItem.attachmentFilename || title : title);
        const source = String(
          primary?.getField?.("publicationTitle") || primary?.getField?.("proceedingsTitle") || primary?.getField?.("bookTitle") || primary?.getField?.("repository") || ""
        );
        const creators = primary?.getCreators?.() || [];
        const firstAuthor = creators[0]?.lastName || creators[0]?.firstName || "";
        const year = String(primary?.getField?.("year") || "").slice(0, 4);
        const creatorYear = [firstAuthor, year].filter(Boolean).join(", ");
        const collection = collections.get(primary?.id) ?? this.resolveCollectionName(primary);
        if (primary) collections.set(primary.id, collection);
        const reader = sleepingKeys.has(key) ? Zotero.Reader?.getByTabID?.(tab.id) : null;
        const hostLoaded = Boolean(reader && reader.initialized !== false && !tab.data?.unloaded);
        return {
          tab,
          key,
          itemID,
          parentItemID: primary?.id ?? null,
          title,
          shortTitle,
          filename,
          source,
          creatorYear,
          collection,
          groupId: groupIds.has(assignments[key]) ? assignments[key] : "",
          pinned: pinnedKeys.has(key),
          status: sleepingKeys.has(key) && !hostLoaded ? "sleeping" : "active"
        };
      });
    }
    getDisplayTitle(t2) {
      const mode = getPref("verticalTabTitleMode");
      const base = mode === "shortTitle" ? t2.shortTitle : mode === "filename" ? t2.filename : t2.title;
      if (!getPref("enableTabRemarks")) return base;
      const r = this.store.getRemark(t2.key);
      if (!r.note || r.mode === "original") return base;
      return r.mode === "note" ? r.note : `${r.note} · ${base}`;
    }
    getDisplaySubtitle(tabInfo) {
      const mode = getPref("verticalTabSubtitleMode");
      if (mode === "none") return "";
      if (mode === "creatorYear") return tabInfo.creatorYear;
      if (mode === "collection") return tabInfo.collection;
      if (mode === "lastViewed" && tabInfo.key) {
        const h = this.store.state.history[tabInfo.key];
        const ts = h?.lastViewed ?? h?.firstSeen;
        if (!ts) return "";
        const mins = Math.max(0, Math.floor((Date.now() - ts) / 6e4));
        if (mins < 60) return mins < 2 ? t("zotero-tabflow-time-just-now", "刚刚") : t("zotero-tabflow-time-mins", `${mins} 分钟前`, { count: mins });
        const hours = Math.floor(mins / 60);
        if (hours < 24) return t("zotero-tabflow-time-hours", `${hours} 小时前`, { count: hours });
        const days = Math.floor(hours / 24);
        return t("zotero-tabflow-time-days", `${days} 天前`, { count: days });
      }
      return tabInfo.source;
    }
  };

  // src/core/drag-utils.ts
  function computeNativeTabMoveTarget(tabIds, draggedId, targetId, after) {
    const from = tabIds.indexOf(draggedId);
    const to = tabIds.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return -1;
    let targetIdx = after ? to + 1 : to;
    if (from < targetIdx) targetIdx -= 1;
    return Math.max(0, Math.min(tabIds.length - 1, targetIdx));
  }
  function parseZoteroDraggedItemIDs(dt) {
    if (!dt?.getData) return [];
    const raw = dt.getData("zotero/item") || "";
    if (!raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      }
    } catch {
    }
    return [...new Set(raw.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  }

  // src/services/attachment-folder.ts
  var RECENT_LAUNCH_INTERVAL_MS = 500;
  var lastLaunched = /* @__PURE__ */ new Map();
  async function resolveFileAttachment(item) {
    if (!item) return null;
    if (item.isFileAttachment?.()) return item;
    const best = await item.getBestAttachment?.();
    return best?.isFileAttachment?.() ? best : null;
  }
  async function openAttachmentFolder(item, fallbackWin) {
    const att = await resolveFileAttachment(item);
    if (!att) return false;
    try {
      const filePath = await att.getFilePathAsync?.();
      if (filePath && Zotero.File?.pathToFile && Zotero.launchFile) {
        const folder = Zotero.File.pathToFile(filePath)?.parent?.path;
        if (folder) {
          const now = Date.now();
          const prev = lastLaunched.get(folder) ?? 0;
          if (now - prev < RECENT_LAUNCH_INTERVAL_MS) return true;
          Zotero.launchFile(folder);
          lastLaunched.set(folder, now);
          return true;
        }
      }
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    }
    const targetWin = fallbackWin?.ZoteroPane ? fallbackWin : Zotero.getMainWindow?.() || Services.wm.getMostRecentWindow("navigator:browser");
    if (targetWin?.ZoteroPane?.showAttachmentInFilesystem) {
      await targetWin.ZoteroPane.showAttachmentInFilesystem(att.id);
      return true;
    }
    return false;
  }
  function resetFolderLaunchCache() {
    lastLaunched.clear();
  }

  // src/services/tab-actions.ts
  function isTabBusyOrProtected(tab, reader, options, isPinned, selectedID) {
    if (options.protectPinned && isPinned) return true;
    if (options.protectSelected && tab.id === selectedID) return true;
    if (options.protectMedia) {
      if (tab.data?.soundPlaying || reader?.soundPlaying || reader?._internalReader?.hasUnsavedChanges) {
        return true;
      }
    }
    return false;
  }
  function toVirtualMember(tab) {
    if (!tab.itemID) return null;
    const { key, itemID, parentItemID, title, shortTitle, filename, source, creatorYear, collection } = tab;
    return { key, itemID, parentItemID, title, shortTitle, filename, source, creatorYear, collection, type: tab.tab.type };
  }
  var TabActionService = class {
    win;
    store;
    meta;
    constructor(win, store, meta) {
      this.win = win;
      this.store = store;
      this.meta = meta;
    }
    selectTab(tabId) {
      const tabs = this.win.Zotero_Tabs;
      if (!tabs) return;
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const key = this.meta.tabKey(tab);
      if (key && this.store.isSleeping(key)) this.store.setSleeping(key, false);
      if (tab) {
        this.store.setCollapsed(this.store.groupOfKey(key), false);
        tabs.select(tabId);
      }
    }
    async closeTab(tabId, preserveVirtual = true) {
      await this.closeTabs([tabId], { preserveVirtual });
    }
    async closeTabs(tabIds, options = {}) {
      const tabs = this.win.Zotero_Tabs;
      if (!tabs || !tabIds.length) return 0;
      const preserveVirtual = options.preserveVirtual ?? true;
      const selectedID = this.meta.getSelectedTabID();
      const nativeMap = new Map(this.meta.getNativeTabs().map((t2) => [t2.id, t2]));
      const trackedMap = new Map(this.meta.buildTrackedTabs().map((t2) => [t2.tab.id, t2]));
      const toClose = [];
      for (const id of new Set(tabIds)) {
        const tab = nativeMap.get(id);
        if (!tab || tab.type === "library") continue;
        const tracked = trackedMap.get(id);
        const reader = Zotero.Reader?.getByTabID?.(id);
        if (isTabBusyOrProtected(tab, reader, options, Boolean(tracked?.pinned), selectedID)) continue;
        if (tracked?.groupId && preserveVirtual && getPref("enableVirtualMembers")) {
          const member = toVirtualMember(tracked);
          if (member) this.store.saveVirtualMember(member);
        }
        toClose.push(id);
      }
      if (!toClose.length) return 0;
      tabs.close(toClose.length === 1 ? toClose[0] : toClose);
      return toClose.length;
    }
    hideGroup(groupId) {
      const tabs = this.meta.buildTrackedTabs().filter((tab) => tab.groupId === groupId);
      const members = tabs.map(toVirtualMember).filter((member) => member !== null);
      if (groupId) this.store.setGroupHidden(groupId, true, members);
      else this.store.hideUngrouped(tabs.map((tab) => tab.key), members);
    }
    undoCloseTab() {
      const tabs = this.win.Zotero_Tabs;
      if (typeof tabs?.undoClose !== "function") return false;
      try {
        tabs.undoClose();
        return true;
      } catch (error) {
        Zotero.logError(error);
        return false;
      }
    }
    sleepTab(tabId) {
      if (!getPref("enableTabSleep")) return false;
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const key = this.meta.tabKey(tab);
      if (!tab || !key || this.store.isPinned(key)) return false;
      const tabs = this.win.Zotero_Tabs;
      const reader = Zotero.Reader?.getByTabID?.(tabId);
      if (isTabBusyOrProtected(tab, reader, { protectMedia: true }, false, "")) return false;
      let unloaded = false;
      if (typeof tabs?.unload === "function") {
        try {
          tabs.unload(tabId);
          unloaded = true;
        } catch {
        }
      }
      if (!unloaded && reader?.unload) {
        try {
          reader.unload();
          unloaded = true;
        } catch {
        }
      }
      this.store.setSleeping(key, true);
      return unloaded;
    }
    sleepInactiveTabs() {
      if (!getPref("enableTabSleep")) return 0;
      const selected = this.meta.getSelectedTabID();
      let count = 0;
      for (const t2 of this.meta.buildTrackedTabs()) {
        if (t2.tab.id !== selected && !t2.pinned && t2.status === "active") {
          this.sleepTab(t2.tab.id);
          count++;
        }
      }
      return count;
    }
    async openVirtualOrItem(itemID, groupId, openInBackground = false) {
      try {
        const item = Zotero.Items.get(itemID);
        if (!item || item.deleted) return false;
        const attachment = item.isAttachment() ? item : await item.getBestAttachment();
        if (!attachment || attachment.deleted) return false;
        if (attachment.isFileAttachment() && !await attachment.fileExists()) return false;
        const key = `${attachment.libraryID}:${attachment.key}`;
        const virtual = this.store.state.virtualMembers[key];
        await Zotero.Reader.open(attachment.id, void 0, { openInBackground });
        if (groupId) this.store.assignKey(key, groupId);
        const currentGroup = this.store.groupOfKey(key);
        const hidden = this.store.state.groups.some((group) => group.id === currentGroup && group.hidden === true);
        if (!hidden && virtual && this.store.state.virtualMembers[key] === virtual) this.store.removeVirtualMember(key);
        return true;
      } catch (error) {
        Zotero.logError(error);
        return false;
      }
    }
    autoGroupByCollection(onlyTabIDs) {
      let moved = 0;
      const filterSet = onlyTabIDs ? new Set(onlyTabIDs) : null;
      const hiddenNames = new Set(this.store.hiddenGroups().map((group) => group.name));
      for (const t2 of this.meta.buildTrackedTabs()) {
        if (filterSet && !filterSet.has(t2.tab.id)) continue;
        if (!t2.groupId && t2.collection && !hiddenNames.has(t2.collection) && t2.collection !== uncategorizedCollectionLabel()) {
          const group = this.store.ensureGroup(t2.collection);
          this.store.assignKey(t2.key, group.id);
          moved++;
        }
      }
      return moved;
    }
    async showInFilesystem(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const itemID = tab?.data?.itemID;
      if (typeof itemID !== "number") return;
      const item = Zotero.Items.get(itemID);
      await openAttachmentFolder(item, this.win);
    }
    showInLibrary(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
      if (primary) this.win.ZoteroPane?.selectItem?.(primary.id);
    }
    moveTabRelative(draggedTabId, targetTabId, after) {
      const tabs = this.win.Zotero_Tabs;
      if (!tabs?.move) return false;
      const ids = this.meta.getNativeTabs().map((t2) => t2.id);
      const targetIdx = computeNativeTabMoveTarget(ids, draggedTabId, targetTabId, after);
      if (targetIdx < 0) return false;
      tabs.move(draggedTabId, targetIdx);
      return true;
    }
    showCollectionInLibrary(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
      if (!primary) return false;
      const cols = primary.getCollections?.() || [];
      const pane = this.win.ZoteroPane;
      if (cols.length && pane?.collectionsView?.selectCollection) {
        pane.collectionsView.selectCollection(cols[0]);
        pane.selectItem?.(primary.id);
        return true;
      }
      pane?.selectItem?.(primary.id);
      return false;
    }
    copyReference(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
      if (primary) this.copyReferencesForItems([primary]);
    }
    copyReferencesForItems(items) {
      if (!items.length) return;
      try {
        const qc = Zotero.QuickCopy;
        if (qc?.getContentFromItems) {
          const format = Zotero.Prefs.get("export.quickCopy.setting");
          const content = qc.getContentFromItems(items, format);
          const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
          helper.copyString(content?.text || items.map((i) => i.getField?.("title")).filter(Boolean).join("\n"));
        }
      } catch (error) {
        Zotero.logError(error);
      }
    }
    async reloadTab(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const itemID = tab?.data?.itemID;
      if (!tab || typeof itemID !== "number") return;
      const item = Zotero.Items.get(itemID);
      const targetID = item?.isAttachment?.() ? item.id : (await item?.getBestAttachment?.())?.id ?? itemID;
      const tabs = this.win.Zotero_Tabs;
      tabs.close(tabId);
      await new Promise((r) => this.win.setTimeout(r, 250));
      await Zotero.Reader.open(targetID, void 0, { openInBackground: false });
    }
  };

  // src/ui/horizontal-drag.ts
  var HorizontalDragController = class {
    constructor(win, store, onRefresh, onMoveTab, onOpenItemsInGroup) {
      this.win = win;
      this.store = store;
      this.onRefresh = onRefresh;
      this.onMoveTab = onMoveTab;
      this.onOpenItemsInGroup = onOpenItemsInGroup;
    }
    draggedTabId = null;
    draggedKey = null;
    draggedGroupId = null;
    hoverTimer = null;
    bindTabDrag(node, tab) {
      node.draggable = true;
      node.ondragstart = (e) => {
        e.stopPropagation();
        this.draggedTabId = tab.tab.id;
        this.draggedKey = tab.key;
        this.draggedGroupId = null;
        e.dataTransfer?.setData("text/plain", tab.key);
      };
      node.ondragover = (e) => {
        if (!this.draggedKey || this.draggedKey === tab.key) return;
        e.preventDefault();
        node.setAttribute("data-ztf-drop", "stack");
      };
      node.ondragleave = () => node.removeAttribute("data-ztf-drop");
      node.ondrop = (e) => {
        e.preventDefault();
        node.removeAttribute("data-ztf-drop");
        if (!this.draggedKey || this.draggedKey === tab.key) return;
        const me = e;
        const rect = node.getBoundingClientRect();
        const ratio = rect.width > 0 ? (me.clientX - rect.left) / rect.width : 0.5;
        if (ratio < 0.25 || ratio > 0.75) {
          this.store.assignKey(this.draggedKey, tab.groupId);
          if (this.draggedTabId) {
            this.onMoveTab?.(this.draggedTabId, tab.tab.id, ratio > 0.75);
          }
        } else if (!tab.groupId) {
          const val = { value: tab.shortTitle.slice(0, 24) };
          if (Services.prompt.prompt(this.win, t("zotero-tabflow-stack-group-title", "叠放新建分组"), t("zotero-tabflow-stack-group-prompt", "将两篇文献合并到新分组："), val, null, {}) && val.value.trim()) {
            const g = this.store.ensureGroup(val.value);
            this.store.assignKey(tab.key, g.id);
            this.store.assignKey(this.draggedKey, g.id);
          }
        } else {
          this.store.assignKey(this.draggedKey, tab.groupId);
        }
        this.clear();
        this.onRefresh();
      };
      node.ondragend = () => this.clear();
    }
    bindGroupDrag(heading, groupId, collapsed) {
      heading.draggable = true;
      heading.ondragstart = (e) => {
        e.stopPropagation();
        this.draggedGroupId = groupId;
        this.draggedKey = null;
      };
      heading.ondragover = (e) => {
        const extItems = parseZoteroDraggedItemIDs(e.dataTransfer);
        if (!this.draggedKey && this.draggedGroupId === null && !extItems.length) return;
        e.preventDefault();
        if (this.draggedKey && collapsed && this.hoverTimer === null) {
          this.hoverTimer = this.win.setTimeout(() => {
            this.hoverTimer = null;
            this.store.setCollapsed(groupId, false);
          }, 600);
        }
      };
      heading.ondragleave = () => {
        if (this.hoverTimer !== null) {
          this.win.clearTimeout(this.hoverTimer);
          this.hoverTimer = null;
        }
      };
      heading.ondrop = (e) => {
        e.preventDefault();
        if (this.draggedGroupId !== null && this.draggedGroupId !== groupId) {
          const rect = heading.getBoundingClientRect();
          const after = rect.width > 0 ? e.clientX >= rect.left + rect.width / 2 : true;
          this.store.moveGroup(this.draggedGroupId, groupId, after);
        } else if (this.draggedKey) {
          this.store.assignKey(this.draggedKey, groupId);
        } else {
          const extItems = parseZoteroDraggedItemIDs(e.dataTransfer);
          if (extItems.length) this.onOpenItemsInGroup?.(extItems, groupId);
        }
        this.clear();
        this.onRefresh();
      };
      heading.ondragend = () => this.clear();
    }
    clear() {
      this.draggedTabId = null;
      this.draggedKey = null;
      this.draggedGroupId = null;
      if (this.hoverTimer !== null) {
        this.win.clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
    }
  };

  // src/ui/group-section.ts
  var CLICK_DELAY_MS = 210;
  var XHTML = "http://www.w3.org/1999/xhtml";
  var GroupSection = class {
    element;
    heading;
    body;
    label;
    win;
    doc;
    setCollapsed;
    rename;
    timer = null;
    cancelEdit = null;
    name = "";
    collapsed = false;
    beforeClick = null;
    constructor(win, doc, classes, setCollapsed, rename) {
      this.win = win;
      this.doc = doc;
      this.setCollapsed = setCollapsed;
      this.rename = rename;
      this.element = doc.createElementNS(XHTML, "div");
      this.element.className = classes.section;
      this.heading = doc.createElementNS(XHTML, "button");
      this.heading.type = "button";
      this.heading.className = classes.heading;
      this.label = doc.createElementNS(XHTML, "span");
      this.body = doc.createElementNS(XHTML, "div");
      this.body.className = classes.body;
      this.heading.append(this.label);
      this.element.append(this.heading, this.body);
      this.heading.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        this.cancelPendingClick();
        if (event.detail === 0) {
          this.beforeClick = null;
          this.applyCollapsed(!this.collapsed);
        } else if (event.detail === 1) {
          this.beforeClick = null;
          this.timer = this.win.setTimeout(() => {
            this.timer = null;
            if (!this.heading.isConnected || this.heading.hidden) return;
            this.beforeClick = this.collapsed;
            this.applyCollapsed(!this.collapsed);
          }, CLICK_DELAY_MS);
        }
      });
      this.heading.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button !== 0) return;
        this.cancelPendingClick();
        if (this.beforeClick !== null && this.collapsed !== this.beforeClick) {
          this.applyCollapsed(this.beforeClick);
        }
        this.beforeClick = null;
        this.edit();
      });
      this.heading.addEventListener("dragstart", () => this.resetClick());
      this.heading.addEventListener("contextmenu", () => this.resetClick());
    }
    update(group, collapsed, count) {
      this.name = group.name;
      this.collapsed = collapsed;
      const label = `${collapsed ? "▸" : "▾"} ${group.name} (${count})`;
      if (this.label.textContent !== label) this.label.textContent = label;
      this.heading.title = label;
      this.heading.setAttribute("aria-expanded", String(!collapsed));
      this.body.hidden = collapsed;
    }
    applyCollapsed(collapsed) {
      this.collapsed = collapsed;
      this.setCollapsed(collapsed);
    }
    edit() {
      if (this.cancelEdit || !this.heading.isConnected) return;
      const input = this.doc.createElementNS(XHTML, "input");
      input.type = "text";
      input.className = "ztf-inline-edit ztf-group-edit";
      input.value = this.name;
      input.setAttribute("data-l10n-id", "zotero-tabflow-rename-group-input");
      const finish = (save, focus) => {
        if (!this.cancelEdit) return;
        this.cancelEdit = null;
        input.remove();
        this.heading.hidden = false;
        const name = input.value.trim();
        if (save && name && name !== this.name) this.rename(name);
        if (focus) this.heading.focus({ preventScroll: true });
      };
      this.cancelEdit = () => finish(false, false);
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.isComposing || event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        finish(event.key === "Enter", true);
      });
      input.onblur = () => finish(true, false);
      this.heading.hidden = true;
      this.heading.after(input);
      input.focus();
      input.select();
    }
    cancelPendingClick() {
      if (this.timer !== null) this.win.clearTimeout(this.timer);
      this.timer = null;
    }
    resetClick() {
      this.cancelPendingClick();
      this.beforeClick = null;
    }
    pause() {
      this.resetClick();
      this.cancelEdit?.();
    }
    dispose() {
      this.pause();
      this.element.remove();
    }
  };
  function reconcileGroupSections(container, cached, order, end = null) {
    const visible = new Set(order);
    for (const [id, section] of cached) {
      if (visible.has(id)) continue;
      section.dispose();
      cached.delete(id);
    }
    let next = end;
    for (let i = order.length - 1; i >= 0; i--) {
      const section = cached.get(order[i]).element;
      if (section.parentElement !== container || section.nextElementSibling !== next) {
        container.insertBefore(section, next);
      }
      next = section;
    }
  }

  // src/ui/group-visibility.ts
  function shouldRenderGroupHeading(groupId, hasOpenMembers, hasVirtualMembers, hasCustomName) {
    return Boolean(groupId || hasCustomName || hasOpenMembers || hasVirtualMembers);
  }
  function indexGroupMembers(members, groupOf) {
    const groups = /* @__PURE__ */ new Map();
    for (const member of members) {
      const groupId = groupOf(member);
      const bucket = groups.get(groupId);
      if (bucket) bucket.push(member);
      else groups.set(groupId, [member]);
    }
    return groups;
  }

  // src/ui/icons.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICONS = {
    pin: [
      { tag: "path", attrs: { d: "M9.5 2.5L13.5 6.5L12 8L10.2 7.6L7.6 10.2L8 12L6.5 13.5L2.5 9.5L4 8L5.8 8.4L8.4 5.8L8 4L9.5 2.5Z" } },
      { tag: "path", attrs: { d: "M4.5 11.5L2 14" } }
    ],
    sleep: [
      { tag: "path", attrs: { d: "M12.8 9.9A5.4 5.4 0 0 1 6.1 3.2a5.5 5.5 0 1 0 6.7 6.7Z" } }
    ],
    virtual: [
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "5.5", "stroke-dasharray": "2.4 2.1" } }
    ],
    pdf: [
      { tag: "path", attrs: { d: "M4 2h5.5L13 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" } },
      { tag: "path", attrs: { d: "M9.5 2v3.5H13M5.5 8.5h5M5.5 11h3.5" } }
    ],
    note: [
      { tag: "path", attrs: { d: "M3.2 2.5h9.6a1 1 0 0 1 1 1v6.8L10.3 13.8H3.2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" } },
      { tag: "path", attrs: { d: "M10 13.8v-3.5h3.5M5 6h5.5M5 8.8h3.8" } }
    ],
    web: [
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "5.7" } },
      { tag: "ellipse", attrs: { cx: "8", cy: "8", rx: "2.5", ry: "5.7" } },
      { tag: "path", attrs: { d: "M2.4 8h11.2" } }
    ],
    folder: [
      { tag: "path", attrs: { d: "M2.2 4.2a1 1 0 0 1 1-1h3l1.2 1.3h5.4a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V4.2Z" } }
    ],
    search: [
      { tag: "circle", attrs: { cx: "7", cy: "7", r: "4.4" } },
      { tag: "path", attrs: { d: "M10.3 10.3L13.5 13.5" } }
    ],
    clock: [
      { tag: "circle", attrs: { cx: "8", cy: "8", r: "5.7" } },
      { tag: "path", attrs: { d: "M8 4.8V8l2.2 1.5" } }
    ],
    layers: [
      { tag: "path", attrs: { d: "M8 2.2L2.2 5.3 8 8.4l5.8-3.1L8 2.2ZM2.2 8.2L8 11.3l5.8-3.1M2.2 11L8 14l5.8-3" } }
    ],
    plus: [
      { tag: "path", attrs: { d: "M8 3.2v9.6M3.2 8h9.6" } }
    ],
    close: [
      { tag: "path", attrs: { d: "M4.5 4.5l7 7M11.5 4.5l-7 7" } }
    ],
    sidebar: [
      { tag: "rect", attrs: { x: "2.2", y: "2.8", width: "11.6", height: "10.4", rx: "1.6" } },
      { tag: "path", attrs: { d: "M6 2.8v10.4" } }
    ],
    topbar: [
      { tag: "rect", attrs: { x: "2.2", y: "2.8", width: "11.6", height: "10.4", rx: "1.6" } },
      { tag: "path", attrs: { d: "M2.3 6.4h11.4" } }
    ],
    workspace: [
      { tag: "rect", attrs: { x: "2.2", y: "2.8", width: "11.6", height: "10.4", rx: "1.6" } },
      { tag: "path", attrs: { d: "M2.3 6h11.4M9.4 6v7.2" } }
    ]
  };
  function createSvgIcon(doc, name, size = 14) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.35");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("ztf-icon");
    for (const def of ICONS[name]) {
      const el = doc.createElementNS(SVG_NS, def.tag);
      for (const [k, v] of Object.entries(def.attrs)) {
        el.setAttribute(k, v);
      }
      svg.append(el);
    }
    return svg;
  }

  // src/ui/pinned-strip.ts
  var XHTML2 = "http://www.w3.org/1999/xhtml";
  function partitionPinnedOverflow(chipWidths, availableWidth, moreButtonWidth = 50, gap = 4) {
    if (!chipWidths.length) return 0;
    if (availableWidth <= 0) return chipWidths.length;
    const totalWidth = chipWidths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
    if (totalWidth <= availableWidth) return chipWidths.length;
    const budget = Math.max(40, availableWidth - moreButtonWidth - gap);
    let used = 0;
    let count = 0;
    for (const w of chipWidths) {
      const next = used + (count > 0 ? gap : 0) + w;
      if (next > budget && count > 0) break;
      used = next;
      count++;
    }
    return Math.max(1, count);
  }
  function renderPinnedStrip(doc, strip, pinnedTabs, selectedID, store, meta, actions, menus) {
    strip.replaceChildren();
    strip.hidden = pinnedTabs.length === 0;
    if (!pinnedTabs.length) return;
    const iconOnly = getPref("pinnedIconOnly");
    const approxChipWidth = (tab) => {
      if (iconOnly) return 28;
      const label = store.getRemark(tab.key).note || tab.shortTitle || tab.title;
      return Math.min(116, Math.max(52, label.length * 7 + 30));
    };
    const hostWidth = strip.parentElement?.clientWidth || 900;
    const maxWidth = Math.max(160, Math.floor(hostWidth * 0.36));
    const visibleCount = partitionPinnedOverflow(pinnedTabs.map(approxChipWidth), maxWidth);
    const visible = pinnedTabs.slice(0, visibleCount);
    const overflow = pinnedTabs.slice(visibleCount);
    for (const tab of visible) {
      const chip = doc.createElementNS(XHTML2, "button");
      chip.type = "button";
      chip.className = `ztf-pinned-chip${tab.tab.id === selectedID ? " selected" : ""}${iconOnly ? " icon-only" : ""}`;
      chip.title = tab.title;
      chip.append(createSvgIcon(doc, "pin", 12));
      if (!iconOnly) {
        const span = doc.createElementNS(XHTML2, "span");
        const remark = getPref("enableTabRemarks") ? store.getRemark(tab.key).note : "";
        span.textContent = remark || tab.shortTitle || tab.title;
        chip.append(span);
      }
      chip.onclick = () => actions.selectTab(tab.tab.id);
      chip.oncontextmenu = (e) => menus.openTabMenu(e, tab);
      strip.append(chip);
    }
    if (overflow.length) {
      const moreBtn = doc.createElementNS(XHTML2, "button");
      moreBtn.type = "button";
      moreBtn.className = "ztf-pinned-more";
      moreBtn.textContent = `+${overflow.length}`;
      moreBtn.title = t("zotero-tabflow-pinned-more-tip", `更多固定标签 (${overflow.length})`, { count: overflow.length });
      moreBtn.onclick = () => openOverflowMenu(doc, moreBtn, overflow, selectedID, store, meta, actions);
      strip.append(moreBtn);
    }
  }
  function openOverflowMenu(doc, anchor, overflow, selectedID, store, meta, actions) {
    const popupset = doc.getElementById("mainPopupSet") || doc.querySelector("popupset");
    if (!popupset) return;
    const xul = (tag) => doc.createXULElement ? doc.createXULElement(tag) : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
    const popup = xul("menupopup");
    popupset.append(popup);
    popup.addEventListener("popuphidden", (e) => {
      if (e.target === popup) popup.remove();
    });
    for (const tab of overflow) {
      const mi = xul("menuitem");
      mi.setAttribute("label", `${tab.tab.id === selectedID ? "✓ " : ""}${meta.getDisplayTitle(tab) === tab.title ? tab.title : tab.title}`);
      mi.addEventListener("command", () => actions.selectTab(tab.tab.id));
      popup.append(mi);
    }
    popup.append(xul("menuseparator"));
    const unpinMenu = xul("menu");
    unpinMenu.setAttribute("label", t("zotero-tabflow-menu-unpin", "取消固定标签"));
    const unpinPop = xul("menupopup");
    unpinMenu.append(unpinPop);
    for (const tab of overflow) {
      const mi = xul("menuitem");
      mi.setAttribute("label", tab.title);
      mi.addEventListener("command", () => store.togglePinned(tab.key));
      unpinPop.append(mi);
    }
    popup.append(unpinMenu);
    const win = doc.defaultView;
    const rect = anchor.getBoundingClientRect();
    popup.openPopupAtScreen((win?.mozInnerScreenX || 0) + rect.left, (win?.mozInnerScreenY || 0) + rect.bottom, true);
  }

  // src/ui/toolbar-actions.ts
  var ToolbarActions = class {
    buttons = /* @__PURE__ */ new Map();
    render(bar, actions) {
      const doc = bar.ownerDocument;
      if (!doc) return;
      const ids = new Set(actions.map(({ id }) => id));
      for (const [id, button] of this.buttons) {
        if (!ids.has(id)) {
          button.remove();
          this.buttons.delete(id);
        }
      }
      bar.hidden = actions.length === 0;
      let next = bar.firstElementChild;
      for (const action of actions) {
        const { id, label, title, icon, count, pressed, popup } = action;
        let button = this.buttons.get(id);
        if (!button) {
          button = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
          button.type = "button";
          button.className = "ztf-tb-btn";
          button.dataset.action = id;
          const svg = createSvgIcon(doc, icon, 16);
          svg.setAttribute("aria-hidden", "true");
          const caption2 = doc.createElementNS(button.namespaceURI, "span");
          caption2.className = "ztf-tb-label";
          const badge2 = doc.createElementNS(button.namespaceURI, "span");
          badge2.className = "ztf-tb-count";
          badge2.setAttribute("aria-hidden", "true");
          button.append(svg, caption2, badge2);
          this.buttons.set(id, button);
        }
        const caption = button.children[1];
        const badge = button.children[2];
        if (caption.textContent !== label) caption.textContent = label;
        const number = count ? count > 99 ? "99+" : String(count) : "";
        if (badge.textContent !== number) badge.textContent = number;
        badge.hidden = !number;
        button.title = title ?? label;
        button.setAttribute("aria-label", title?.startsWith(label) ? title : title ? `${label} · ${title}` : label);
        if (popup) button.setAttribute("aria-haspopup", popup);
        if (pressed !== void 0) button.setAttribute("aria-pressed", String(pressed));
        button.classList.toggle("ztf-tb-icon-only", Boolean(action.iconOnly));
        button.classList.toggle("ztf-tb-attention", action.status === "attention");
        button.onclick = () => action.run(button);
        if (button !== next) bar.insertBefore(button, next);
        next = button.nextElementSibling;
      }
    }
  };

  // src/ui/workspace-hub.ts
  var XHTML3 = "http://www.w3.org/1999/xhtml";
  function computeWorkspaceHubCounts(store) {
    const sessionsEnabled = getPref("enableSessions");
    const sessions = sessionsEnabled ? store.state.sessions.length : 0;
    const rolling = sessionsEnabled ? store.state.rollingSessions?.length ?? 0 : 0;
    const hidden = store.hiddenGroups().length;
    return { sessions, hidden, rolling, total: sessions + hidden };
  }
  var WorkspaceHubController = class {
    win;
    doc;
    store;
    meta;
    actions;
    callbacks;
    overlay = null;
    bodyEl = null;
    nameInput = null;
    returnFocus = null;
    statusEl = null;
    constructor(win, doc, store, meta, actions, callbacks) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.callbacks = callbacks;
    }
    h(tag, className) {
      const el = this.doc.createElementNS(XHTML3, tag);
      if (className) el.className = className;
      return el;
    }
    btn(label, cls, onClick, disabled = false) {
      const b = this.h("button", cls);
      b.type = "button";
      b.textContent = label;
      b.disabled = disabled;
      b.onclick = onClick;
      return b;
    }
    open(anchor) {
      this.dispose();
      const host = this.doc.body || this.doc.documentElement;
      if (!host) return;
      const backdrop = this.h("div");
      backdrop.id = "ztf-hub-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      backdrop.setAttribute("aria-labelledby", "ztf-hub-title");
      const box = this.h("div", "ztf-hub-box");
      const header = this.h("div", "ztf-hub-head");
      const title = this.h("div", "ztf-hub-title");
      title.id = "ztf-hub-title";
      title.textContent = t("zotero-tabflow-hub-title", "TabFlow 工作区（会话与隐藏项目）");
      const closeBtn = this.btn("✕", "ztf-hub-close", () => this.dispose());
      closeBtn.setAttribute("aria-label", t("zotero-tabflow-toolbar-close-workspace", "关闭工作区"));
      header.append(title, closeBtn);
      const body = this.h("div", "ztf-hub-body");
      const status = this.h("div", "ztf-hub-status");
      status.setAttribute("role", "status");
      status.tabIndex = -1;
      box.append(header, body, status);
      backdrop.append(box);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) this.dispose();
      });
      backdrop.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.dispose();
        }
        if (e.key === "Tab") {
          const controls = [...backdrop.querySelectorAll("button:not([disabled]), input:not([disabled])")];
          const current = this.doc.activeElement;
          const edge = e.shiftKey ? controls[0] : controls.at(-1);
          if (!current || !controls.includes(current) || current === edge) {
            e.preventDefault();
            (e.shiftKey ? controls.at(-1) : controls[0])?.focus();
          }
        }
      });
      host.append(backdrop);
      this.overlay = backdrop;
      this.bodyEl = body;
      this.statusEl = status;
      this.returnFocus = anchor ?? null;
      this.renderContent();
      (this.nameInput ?? closeBtn).focus?.();
    }
    renderContent() {
      if (!this.bodyEl) return;
      const sessionsEnabled = getPref("enableSessions");
      const hiddenGroups = this.store.hiddenGroups();
      const sessions = this.store.state.sessions;
      const rolling = this.store.state.rollingSessions ?? [];
      const parts = [];
      if (sessionsEnabled) {
        parts.push(this.buildQuickSaveBar(sessions.length));
      }
      if (hiddenGroups.length || getPref("enableGroupHiding")) {
        parts.push(this.buildHiddenSection(hiddenGroups));
      }
      if (sessionsEnabled) {
        parts.push(this.buildSessionsSection(sessions));
        if (rolling.length) parts.push(this.buildRollingSection(rolling));
      }
      this.bodyEl.replaceChildren(...parts);
    }
    buildQuickSaveBar(sessionCount) {
      const bar = this.h("div", "ztf-hub-quickbar");
      const input = this.h("input", "ztf-hub-input");
      input.type = "text";
      input.placeholder = t("zotero-tabflow-hub-name-placeholder", "输入工作区或模板名称（留空使用当前时间）…");
      this.nameInput = input;
      const saveName = (fallbackKey, fallback) => input.value.trim() || `${t(fallbackKey, fallback)} · ${formatSnapshotTimestamp(Date.now())}`;
      const actions = this.h("div", "ztf-hub-quick-actions");
      actions.append(
        this.btn(t("zotero-tabflow-hub-save-session", "保存工作区"), "ztf-hub-btn primary", () => {
          const openKeys = this.meta.buildTrackedTabs().map((tab) => tab.key);
          this.store.saveSession(saveName("zotero-tabflow-session-default-name", "工作区会话"), openKeys);
          input.value = "";
          this.renderContent();
        }),
        this.btn(t("zotero-tabflow-hub-save-template", "存为布局模板"), "ztf-hub-btn", () => {
          this.store.saveLayoutTemplate(saveName("zotero-tabflow-template-default-name", "布局模板"));
          input.value = "";
          this.renderContent();
        }),
        this.btn(t("zotero-tabflow-hub-export", "导出 JSON"), "ztf-hub-btn", () => {
          this.dispose();
          this.callbacks.onExportSessions();
        }, sessionCount === 0),
        this.btn(t("zotero-tabflow-hub-import", "导入 JSON"), "ztf-hub-btn", () => {
          this.dispose();
          this.callbacks.onImportSessions();
        })
      );
      bar.append(input, actions);
      return bar;
    }
    buildSectionHeader(title, extraBtn) {
      const row = this.h("div", "ztf-hub-sec-head");
      const label = this.h("span", "ztf-hub-sec-title");
      label.textContent = title;
      row.append(label);
      if (extraBtn) row.append(extraBtn);
      return row;
    }
    buildHiddenSection(hiddenGroups) {
      const sec = this.h("div", "ztf-hub-section");
      sec.id = "ztf-hub-hidden-section";
      const showAll = hiddenGroups.length > 1 ? this.btn(t("zotero-tabflow-hub-show-all-hidden", "全部恢复显示"), "ztf-hub-btn", () => {
        for (const g of hiddenGroups) this.store.setGroupHidden(g.id, false);
        this.refreshHiddenFocus(0);
      }) : void 0;
      const heading = this.buildSectionHeader(t("zotero-tabflow-hub-hidden-header", `已隐藏的项目组 (${hiddenGroups.length})`, { count: hiddenGroups.length }), showAll);
      heading.tabIndex = -1;
      sec.append(heading);
      if (!hiddenGroups.length) {
        const empty = this.h("div", "ztf-hub-empty");
        empty.textContent = t("zotero-tabflow-hub-hidden-empty", "暂无隐藏分组；在标签分组标题右键「隐藏分组」可暂存于此。");
        sec.append(empty);
        return sec;
      }
      const openKeys = new Set(this.meta.buildTrackedTabs().map((tab) => tab.key));
      for (const [index, g] of hiddenGroups.entries()) {
        const virtuals = Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === g.id);
        const unopened = virtuals.filter((member) => !openKeys.has(member.key));
        const card = this.h("div", "ztf-hub-card");
        const info = this.h("div", "ztf-hub-card-info");
        const titleRow = this.h("div", "ztf-hub-card-title");
        const dot = this.h("span", "ztf-sb-dot");
        dot.style.background = g.color;
        const name = this.h("span");
        name.textContent = g.name;
        titleRow.append(dot, name);
        const meta = this.h("div", "ztf-hub-card-meta");
        meta.textContent = t("zotero-tabflow-hub-hidden-meta", `保留 ${virtuals.length} 篇文献成员`, { count: virtuals.length });
        info.append(titleRow, meta);
        const btns = this.h("div", "ztf-hub-card-actions");
        btns.append(
          this.btn(t("zotero-tabflow-hub-unhide", "恢复显示"), "ztf-hub-btn primary ztf-hub-restore", () => {
            this.store.setGroupHidden(g.id, false);
            this.refreshHiddenFocus(index);
          })
        );
        if (unopened.length) {
          btns.append(this.btn(t("zotero-tabflow-hub-restore-reopen", `恢复并补开 ${unopened.length} 篇`, { count: unopened.length }), "ztf-hub-btn", () => {
            const status = this.statusEl;
            this.store.setGroupHidden(g.id, false);
            this.refreshHiddenFocus(index);
            void (async () => {
              let opened = 0;
              let failed = 0;
              const currentKeys = new Set(this.meta.buildTrackedTabs().map((tab) => tab.key));
              for (const m of unopened) {
                if (currentKeys.has(m.key)) continue;
                if (await this.actions.openVirtualOrItem(m.itemID, void 0, true)) opened++;
                else failed++;
              }
              if (status && this.statusEl === status) {
                status.textContent = t("zotero-tabflow-hub-reopen-result", `已补开 ${opened} 篇，未能打开 ${failed} 篇`, { opened, failed });
              }
              this.callbacks.onRefresh();
            })();
          }));
        }
        btns.append(this.btn(t("zotero-tabflow-hub-dissolve", "解散"), "ztf-hub-btn danger", () => {
          if (Services.prompt.confirm(this.win, t("zotero-tabflow-dissolve-group", "解散分组"), t("zotero-tabflow-dissolve-group-confirm", `解散“${g.name}”？标签页将保留并回到未分组。`, { name: g.name }))) {
            try {
              if (!this.store.dissolveGroup(g.id)) {
                Services.prompt.alert(this.win, t("zotero-tabflow-dissolve-group", "解散分组"), t("zotero-tabflow-dissolve-group-failed", "无法解散分组：数据为只读，或分组已不存在。"));
                return;
              }
              this.refreshHiddenFocus(index);
              this.callbacks.onRefresh();
            } catch (error) {
              Zotero.logError(error);
              Services.prompt.alert(this.win, t("zotero-tabflow-dissolve-group", "解散分组"), t("zotero-tabflow-dissolve-group-failed", "无法解散分组：数据为只读，或分组已不存在。"));
            }
          }
        }));
        card.append(info, btns);
        sec.append(card);
      }
      return sec;
    }
    refreshHiddenFocus(index) {
      this.renderContent();
      const section = this.bodyEl?.querySelector?.("#ztf-hub-hidden-section");
      if (!section) return;
      const buttons = section.querySelectorAll(".ztf-hub-restore");
      (buttons[Math.min(index, buttons.length - 1)] ?? section.querySelector(".ztf-hub-sec-head"))?.focus();
    }
    buildSessionsSection(sessions) {
      const sec = this.h("div", "ztf-hub-section");
      sec.append(this.buildSectionHeader(t("zotero-tabflow-hub-sessions-header", `已保存的工作区会话 (${sessions.length})`, { count: sessions.length })));
      if (!sessions.length) {
        const empty = this.h("div", "ztf-hub-empty");
        empty.textContent = t("zotero-tabflow-sessions-empty", "暂无已保存的会话");
        sec.append(empty);
        return sec;
      }
      for (const s of sessions) sec.append(this.buildSnapshotCard(s, false));
      return sec;
    }
    buildRollingSection(rolling) {
      const sec = this.h("div", "ztf-hub-section");
      sec.append(this.buildSectionHeader(t("zotero-tabflow-rolling-header", "本地自动恢复快照")));
      for (const r of rolling) sec.append(this.buildSnapshotCard(r, true));
      return sec;
    }
    buildSnapshotCard(s, isRolling) {
      const card = this.h("div", "ztf-hub-card");
      const info = this.h("div", "ztf-hub-card-info");
      const title = this.h("div", "ztf-hub-card-title");
      const icon = s.kind === "template" ? "📐 " : s.kind === "pre-replace" ? "↩ " : isRolling ? "🕒 " : "💾 ";
      title.textContent = `${icon}${s.name}`;
      const meta = this.h("div", "ztf-hub-card-meta");
      const stamp = s.createdAt ? formatSnapshotTimestamp(s.createdAt) : "";
      meta.textContent = t("zotero-tabflow-hub-snapshot-meta", `${s.openKeys.length} 篇文献 · ${s.groups.length} 个分组${stamp ? ` · ${stamp}` : ""}`, {
        papers: s.openKeys.length,
        groups: s.groups.length,
        time: stamp
      });
      info.append(title, meta);
      const btns = this.h("div", "ztf-hub-card-actions");
      btns.append(
        this.btn(t("zotero-tabflow-hub-preview", "预览恢复"), "ztf-hub-btn primary", () => {
          this.dispose();
          this.callbacks.onPreviewRestore(s);
        }),
        this.btn(t("zotero-tabflow-hub-quick-merge", "直接合并"), "ztf-hub-btn", () => {
          this.dispose();
          this.callbacks.onQuickMerge(s);
        })
      );
      if (isRolling) {
        btns.append(this.btn(t("zotero-tabflow-hub-promote", "转存"), "ztf-hub-btn", () => {
          if (promoteRollingSnapshot(this.store.state, s.id)) {
            this.store.save();
            this.renderContent();
          }
        }));
      }
      btns.append(this.btn(t("zotero-tabflow-hub-delete", "删除"), "ztf-hub-btn danger", () => {
        this.store.deleteSession(s.id);
        this.renderContent();
      }));
      card.append(info, btns);
      return card;
    }
    dispose() {
      const anchor = this.returnFocus;
      this.returnFocus = null;
      this.overlay?.remove?.();
      this.overlay = null;
      this.bodyEl = null;
      this.nameInput = null;
      this.statusEl = null;
      if (anchor?.isConnected) anchor.focus();
    }
  };

  // src/ui/horizontal-bar.ts
  var HorizontalBarController = class {
    constructor(win, doc, store, meta, actions, tracker, menus, popovers, spotlight, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.tracker = tracker;
      this.menus = menus;
      this.popovers = popovers;
      this.spotlight = spotlight;
      this.onRefresh = onRefresh;
      this.drag = new HorizontalDragController(
        win,
        store,
        onRefresh,
        (draggedTabId, targetTabId, after) => this.actions.moveTabRelative(draggedTabId, targetTabId, after),
        (itemIDs, groupId) => {
          void (async () => {
            for (const id of itemIDs) await this.actions.openVirtualOrItem(id, groupId);
            this.onRefresh();
          })();
        }
      );
    }
    root = null;
    pinnedStrip = null;
    toolbarActions = null;
    toolbar = new ToolbarActions();
    drag;
    lastSelectedID = "";
    groupSections = /* @__PURE__ */ new Map();
    addGroupButton = null;
    h(tag, className) {
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) el.className = className;
      return el;
    }
    mount() {
      const host = this.doc.getElementById("tab-bar-container");
      const inner = host?.querySelector(".tab-bar-inner-container");
      if (!host || !inner) return;
      if (!this.root) {
        const root = this.h("div");
        root.id = "ztf-inline";
        root.setAttribute("role", "group");
        root.setAttribute("aria-label", "TabFlow");
        this.bindWheel(root);
        this.root = root;
      }
      if (this.root.parentElement !== inner) inner.insertBefore(this.root, inner.querySelector(".tabs-wrapper"));
      if (!this.pinnedStrip) {
        this.pinnedStrip = this.h("div", "ztf-pinned-strip");
        this.pinnedStrip.hidden = true;
        this.pinnedStrip.setAttribute("role", "group");
        this.pinnedStrip.setAttribute("data-l10n-id", "zotero-tabflow-pinned-strip");
        this.bindWheel(this.pinnedStrip);
      }
      if (this.pinnedStrip.parentElement !== inner) inner.insertBefore(this.pinnedStrip, this.root);
      if (!this.toolbarActions) {
        const bar = this.h("div");
        bar.id = "ztf-toolbar-actions";
        this.toolbarActions = bar;
      }
      const nativeToolbar = this.doc.getElementById("zotero-tabs-toolbar") || inner;
      if (this.toolbarActions.parentElement !== nativeToolbar) nativeToolbar.append(this.toolbarActions);
    }
    bindWheel(area) {
      area.addEventListener("wheel", (e) => {
        e.stopPropagation();
        if (e.ctrlKey || area.scrollWidth <= area.clientWidth) return;
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? area.clientWidth : 1;
        const direction = !e.deltaX && this.win.getComputedStyle(area)?.direction === "rtl" ? -1 : 1;
        area.scrollLeft += (e.deltaX || e.deltaY) * scale * direction;
      }, { passive: false });
    }
    render(snapshot) {
      const host = this.doc.getElementById("tab-bar-container");
      if (!host) return;
      this.mount();
      const sidebarHealthy = getPref("enableVerticalSidebar") && !getPref("verticalSidebarCollapsed") && Boolean(this.doc.getElementById("ztf-sidebar")?.isConnected);
      const compactMode = getPref("compactTopBar") && sidebarHealthy;
      const enabled = getPref("enableHorizontalGroups") && !compactMode;
      const mounted = enabled && Boolean(this.root?.isConnected);
      host.toggleAttribute("data-ztf-inline", mounted || compactMode);
      if (!mounted) {
        if (this.pinnedStrip) this.pinnedStrip.hidden = true;
        for (const group of this.groupSections.values()) group.pause();
      }
      if (this.root) this.root.hidden = !mounted;
      const trackedTabs = snapshot ?? (mounted || getPref("enableStaleSuggestions") ? this.meta.buildTrackedTabs() : []);
      this.renderToolbarButtons(compactMode, sidebarHealthy, trackedTabs);
      if (!mounted || !this.root || this.root.querySelector(".ztf-inline-edit")) return;
      const rawGroups = this.store.visibleGroups();
      const visibleGroupIds = new Set(rawGroups.map((group) => group.id));
      const tracked = trackedTabs.filter((tab) => visibleGroupIds.has(tab.groupId));
      const selectedID = this.meta.getSelectedTabID();
      const scroll = this.root.scrollLeft;
      const pinnedTabs = getPref("enablePinnedTabs") ? tracked.filter((t2) => t2.pinned) : [];
      if (this.pinnedStrip) {
        const strip = this.pinnedStrip;
        const pinnedScroll = strip.scrollLeft;
        renderPinnedStrip(this.doc, strip, pinnedTabs, selectedID, this.store, this.meta, this.actions, this.menus);
        strip.scrollLeft = pinnedScroll;
      }
      const unpinned = indexGroupMembers(tracked.filter((t2) => !t2.pinned), (tab) => tab.groupId);
      const openKeys = new Set(trackedTabs.map((tab) => tab.key));
      const virtualMembers = getPref("enableVirtualMembers") ? Object.values(this.store.state.virtualMembers).filter((member) => !openKeys.has(member.key)) : [];
      const virtualsByGroup = indexGroupMembers(virtualMembers, (member) => this.store.groupOfKey(member.key));
      const collapsedIds = new Set(this.store.state.collapsed);
      const groups = rawGroups.filter((g) => {
        const hasMembers = unpinned.has(g.id);
        const hasVirtuals = virtualsByGroup.has(g.id);
        return shouldRenderGroupHeading(g.id, hasMembers, hasVirtuals, Boolean(!g.id && this.store.state.ungroupedName));
      });
      for (const g of groups) {
        let section = this.groupSections.get(g.id);
        if (!section) {
          section = new GroupSection(
            this.win,
            this.doc,
            {
              section: "ztf-section",
              heading: "ztf-heading",
              body: "ztf-section-body"
            },
            (closed) => this.store.setCollapsed(g.id, closed),
            (name) => this.store.renameGroup(g.id, name)
          );
          section.heading.onmousedown = (event) => event.stopPropagation();
          this.groupSections.set(g.id, section);
        }
        section.element.style.setProperty("--ztf-color", g.color);
        const collapsed = collapsedIds.has(g.id);
        const members = unpinned.get(g.id) ?? [];
        const virtuals = virtualsByGroup.get(g.id) ?? [];
        section.update(g, collapsed, members.length + virtuals.length);
        section.heading.oncontextmenu = (e) => this.menus.openGroupMenu(e, g);
        this.drag.bindGroupDrag(section.heading, g.id, collapsed);
        if (!collapsed) {
          const nodes = this.doc.createDocumentFragment();
          for (const t2 of members) nodes.append(this.buildTabNode(t2, selectedID));
          for (const v of virtuals) {
            const vNode = this.h("button", "ztf-doc ztf-virtual");
            vNode.type = "button";
            const label = this.h("span", "ztf-doc-title");
            label.textContent = `◌ ${this.meta.getDisplayTitle(v)}`;
            vNode.append(label);
            vNode.title = t("zotero-tabflow-virtual-reload-tip", `虚拟保留成员（点击重新加载）：${v.title}`, { title: v.title });
            vNode.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id).then(this.onRefresh);
            vNode.oncontextmenu = (e) => this.menus.openVirtualMenu(e, v, g.id);
            nodes.append(vNode);
          }
          section.body.replaceChildren(nodes);
        }
      }
      if (!this.addGroupButton) {
        const addBtn = this.h("button", "ztf-add-group");
        addBtn.type = "button";
        addBtn.append(createSvgIcon(this.doc, "plus", 13));
        addBtn.title = t("zotero-tabflow-new-group-title", "新建分组");
        addBtn.onclick = () => this.beginInlineEdit(addBtn, "", (next) => this.store.ensureGroup(next), t("zotero-tabflow-new-group-placeholder", "新分组名称…"));
        this.root.append(addBtn);
        this.addGroupButton = addBtn;
      }
      reconcileGroupSections(this.root, this.groupSections, groups.map((g) => g.id), this.addGroupButton);
      this.root.scrollLeft = scroll;
      if (selectedID && selectedID !== this.lastSelectedID) {
        this.lastSelectedID = selectedID;
        this.root.querySelector(".ztf-doc.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
    beginInlineEdit(anchor, initial, onCommit, placeholder = "") {
      const input = this.h("input", "ztf-inline-edit");
      input.type = "text";
      input.value = initial;
      if (placeholder) input.placeholder = placeholder;
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        input.replaceWith(anchor);
        const clean = input.value.trim();
        if (save && clean) onCommit(clean);
        this.onRefresh();
      };
      input.onmousedown = (e) => e.stopPropagation();
      input.onclick = (e) => e.stopPropagation();
      input.onkeydown = (e) => {
        const ke = e;
        if (ke.isComposing) return;
        ke.stopPropagation();
        if (ke.key === "Enter") {
          ke.preventDefault();
          finish(true);
        } else if (ke.key === "Escape") {
          ke.preventDefault();
          finish(false);
        }
      };
      input.onblur = () => finish(true);
      anchor.replaceWith(input);
      input.focus();
      input.select();
    }
    buildTabNode(tab, selectedID) {
      const node = this.h("div", `ztf-doc${tab.tab.id === selectedID ? " selected" : ""}${tab.status === "sleeping" ? " ztf-sleeping" : ""}`);
      node.title = `${tab.title}
${t("zotero-tabflow-collection-label", "集合")}：${tab.collection}`;
      const label = this.h("span", "ztf-doc-title");
      label.textContent = `${tab.status === "sleeping" ? "💤 " : ""}${this.meta.getDisplayTitle(tab)}`;
      const closeBtn = this.h("button", "ztf-doc-close");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", t("zotero-tabflow-close-tab-aria", `关闭标签：${tab.title}`, { title: tab.title }));
      closeBtn.append(createSvgIcon(this.doc, "close", 11));
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        void this.actions.closeTab(tab.tab.id, true).then(this.onRefresh);
      };
      node.append(label, closeBtn);
      node.onclick = () => this.actions.selectTab(tab.tab.id);
      node.onauxclick = (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.actions.closeTab(tab.tab.id, true).then(this.onRefresh);
        }
      };
      node.oncontextmenu = (e) => this.menus.openTabMenu(e, tab);
      this.drag.bindTabDrag(node, tab);
      return node;
    }
    renderToolbarButtons(compactMode, sidebarHealthy, tracked) {
      if (!this.toolbarActions) return;
      const actions = [];
      if (compactMode || getPref("enableHorizontalGroups") && sidebarHealthy) {
        actions.push({
          id: "compact",
          icon: "topbar",
          iconOnly: true,
          pressed: compactMode,
          label: t("zotero-tabflow-compact-topbar", "精简顶栏"),
          title: compactMode ? t("zotero-tabflow-expand-topbar-tip", "恢复水平分组标签栏") : t("zotero-tabflow-compact-topbar-tip", "收起水平文献标签以节省顶部空间（保留文库与侧栏）"),
          run: () => {
            setPref("compactTopBar", !compactMode);
            this.onRefresh();
          }
        });
      }
      if (getPref("enableVerticalSidebar")) {
        const open = !getPref("verticalSidebarCollapsed");
        actions.push({
          id: "sidebar",
          icon: "sidebar",
          iconOnly: true,
          pressed: open,
          label: t("zotero-tabflow-toolbar-sidebar", "标签侧栏"),
          title: open ? t("zotero-tabflow-sidebar-toggle-close", "收起垂直标签侧边栏") : t("zotero-tabflow-sidebar-toggle-open", "展开垂直标签侧边栏"),
          run: () => {
            setPref("verticalSidebarCollapsed", open);
            this.onRefresh();
          }
        });
      }
      if (getPref("enableSpotlight")) {
        const shortcut = Zotero.isMac ? "⌘P" : "Ctrl+P";
        actions.push({
          id: "spotlight",
          icon: "search",
          label: t("zotero-tabflow-toolbar-spotlight", "快速查找"),
          title: t("zotero-tabflow-toolbar-spotlight-tip", `查找标签、文献和操作（${shortcut}）`, { shortcut }),
          run: (button) => this.spotlight.open(button)
        });
      }
      const hubCounts = computeWorkspaceHubCounts(this.store);
      if (getPref("enableSessions") || getPref("enableGroupHiding")) {
        actions.push({
          id: "workspace",
          icon: "workspace",
          popup: "dialog",
          count: hubCounts.hidden,
          label: t("zotero-tabflow-workspace-btn", "工作区"),
          title: t("zotero-tabflow-toolbar-workspace-tip", `隐藏项目 ${hubCounts.hidden}`, { count: hubCounts.hidden }),
          run: (button) => this.popovers.openWorkspaceHub(button)
        });
      }
      const count = this.tracker.getStaleTabs(Date.now(), tracked).length;
      if (count) {
        actions.push({
          id: "stale",
          icon: "clock",
          popup: "menu",
          count,
          status: "attention",
          label: t("zotero-tabflow-toolbar-stale", "建议关闭"),
          title: t("zotero-tabflow-stale-btn", `建议关闭 (${count})`, { count }),
          run: (button) => this.popovers.openStaleMenu(button)
        });
      }
      this.toolbar.render(this.toolbarActions, actions);
    }
    dispose() {
      for (const group of this.groupSections.values()) group.dispose();
      this.groupSections.clear();
      this.drag.clear();
      this.doc.getElementById("tab-bar-container")?.removeAttribute("data-ztf-inline");
      this.root?.remove();
      this.pinnedStrip?.remove();
      this.toolbarActions?.remove();
      this.root = null;
      this.addGroupButton = null;
      this.pinnedStrip = null;
      this.toolbarActions = null;
    }
  };

  // src/ui/item-context-menu.ts
  var ItemContextMenuController = class {
    constructor(win, doc, store, actions, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.actions = actions;
      this.onRefresh = onRefresh;
    }
    itemMenuEl = null;
    itemMenuEntry = null;
    itemSubPopup = null;
    xul(tag) {
      return this.doc.createXULElement ? this.doc.createXULElement(tag) : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
    }
    item(popup, label, action) {
      const mi = this.xul("menuitem");
      mi.setAttribute("label", label);
      mi.addEventListener("command", action);
      popup.append(mi);
      return mi;
    }
    attach() {
      const itemMenu = this.doc.getElementById("zotero-itemmenu");
      if (!itemMenu || this.itemMenuEl) return;
      const menu = this.xul("menu");
      menu.id = "ztf-item-open-group";
      menu.setAttribute("label", t("zotero-tabflow-item-open-group", "TabFlow：打开并分组"));
      const sub = this.xul("menupopup");
      menu.append(sub);
      itemMenu.append(menu);
      itemMenu.addEventListener("popupshowing", this.onItemMenuShowing);
      sub.addEventListener("popupshowing", this.onItemSubShowing);
      this.itemMenuEl = itemMenu;
      this.itemMenuEntry = menu;
      this.itemSubPopup = sub;
    }
    onItemMenuShowing = () => {
      const enabled = getPref("enableItemContextMenu");
      const items = this.win.ZoteroPane?.getSelectedItems?.() || [];
      if (this.itemMenuEntry) {
        this.itemMenuEntry.hidden = !enabled;
        if (!items.length) this.itemMenuEntry.setAttribute("disabled", "true");
        else this.itemMenuEntry.removeAttribute("disabled");
      }
    };
    onItemSubShowing = () => {
      if (!this.itemSubPopup) return;
      this.itemSubPopup.textContent = "";
      const selected = this.win.ZoteroPane?.getSelectedItems?.() || [];
      this.item(this.itemSubPopup, t("zotero-tabflow-item-open-new-group", "打开到新分组…"), () => {
        const fallback = selected[0]?.getField?.("title")?.slice(0, 30) || t("zotero-tabflow-new-group-title", "新分组");
        const val = { value: fallback };
        if (!Services.prompt.prompt(this.win, t("zotero-tabflow-item-open-new-group", "打开到新分组"), t("zotero-tabflow-new-group-prompt", "分组名称："), val, null, {}) || !val.value.trim()) return;
        const g = this.store.ensureGroup(val.value);
        void (async () => {
          for (const it of selected) await this.actions.openVirtualOrItem(it.id, g.id);
          this.onRefresh();
        })();
      });
      const groups = this.store.state.groups;
      if (groups.length) this.itemSubPopup.append(this.xul("menuseparator"));
      for (const g of groups) {
        this.item(this.itemSubPopup, g.name, () => {
          void (async () => {
            for (const it of selected) await this.actions.openVirtualOrItem(it.id, g.id);
            this.onRefresh();
          })();
        });
      }
    };
    dispose() {
      this.itemMenuEl?.removeEventListener("popupshowing", this.onItemMenuShowing);
      this.itemSubPopup?.removeEventListener("popupshowing", this.onItemSubShowing);
      this.itemMenuEntry?.remove();
      this.itemMenuEl = null;
      this.itemMenuEntry = null;
      this.itemSubPopup = null;
    }
  };

  // src/ui/pdf-folder-section.ts
  var FOLDER_ICON = 'item-pane-sidenav .btn[data-l10n-id="zotero-tabflow-pdf-folder-sidenav"]';
  var FOLDER_ACTION = `${FOLDER_ICON}, button.ztf-pdf-folder-action`;
  function folderActionTarget(event) {
    return event.composedPath().find(
      (node) => node.matches?.(FOLDER_ACTION) === true
    );
  }
  var PdfFolderSectionController = class {
    sectionID = false;
    states = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Map();
    openingFolders = /* @__PURE__ */ new WeakSet();
    register(pluginID, rootURI) {
      if (this.sectionID || !Zotero.ItemPaneManager?.registerSection) return;
      this.sectionID = Zotero.ItemPaneManager.registerSection({
        paneID: "tabflow-pdf-folder",
        pluginID,
        header: { l10nID: "zotero-tabflow-pdf-folder-title", icon: `${rootURI}pdf-folder.svg` },
        sidenav: { l10nID: "zotero-tabflow-pdf-folder-sidenav", icon: `${rootURI}pdf-folder.svg`, orderable: true },
        onInit: ({ doc, body }) => this.onInit(doc, body),
        onDestroy: ({ doc, body }) => this.onDestroy(doc, body),
        onItemChange: (props) => this.renderSection(props),
        onRender: (props) => this.renderSection(props)
      });
    }
    onInit(doc, body) {
      const win = doc.defaultView;
      if (!win) return;
      win.MozXULElement?.insertFTLIfNeeded?.("zotero-tabflow.ftl");
      let controller = this.listeners.get(doc);
      if (!controller) {
        controller = new win.AbortController();
        this.listeners.set(doc, controller);
        this.bindFolderActions(doc, win, controller.signal);
      }
      body.textContent = "";
      const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      wrap.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-inline-size:0;contain:inline-size;padding:4px 0;font:12px/1.4 system-ui,sans-serif;";
      const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      meta.style.cssText = "opacity:0.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      btn.type = "button";
      btn.className = "ztf-pdf-folder-action";
      btn.setAttribute("data-l10n-id", "zotero-tabflow-pdf-folder-open");
      btn.style.cssText = "justify-self:start;min-inline-size:0;max-inline-size:100%;box-sizing:border-box;padding:5px 10px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:transparent;color:inherit;font:inherit;white-space:normal;overflow-wrap:anywhere;text-align:start;";
      btn.disabled = true;
      wrap.append(meta, btn);
      body.append(wrap);
      this.states.set(body, { body, item: null, btn, meta });
    }
    bindFolderActions(doc, win, signal) {
      const options = { capture: true, signal };
      let pressed;
      let keyed;
      doc.addEventListener("pointerdown", (event) => {
        keyed = void 0;
        pressed = event.isTrusted && event.button === 0 ? folderActionTarget(event) : void 0;
      }, options);
      doc.addEventListener("pointercancel", () => {
        pressed = void 0;
      }, options);
      doc.addEventListener("keydown", (event) => {
        pressed = void 0;
        keyed = event.isTrusted && !event.repeat && (event.key === "Enter" || event.key === " ") ? folderActionTarget(event) : void 0;
      }, options);
      doc.addEventListener("click", (event) => {
        const target = folderActionTarget(event);
        const activated = target && (event.detail === 0 ? keyed : pressed) === target;
        keyed = pressed = void 0;
        if (!activated || !event.isTrusted || event.button !== 0 || event.detail > 1) return;
        if (!getPref("enablePdfFolderSidenav")) return;
        const sidenav = target.closest("item-pane-sidenav");
        const item = sidenav ? sidenav.container?.item : [...this.states.values()].find((state) => state.btn === target && !state.btn.disabled)?.item;
        if (item) void this.openAttachmentFolder(win, item, signal);
      }, options);
    }
    onDestroy(doc, body) {
      this.states.delete(body);
      if ([...this.states.keys()].some((other) => other.ownerDocument === doc)) return;
      this.listeners.get(doc)?.abort();
      this.listeners.delete(doc);
    }
    renderSection({ body, item, setEnabled }) {
      const enabled = getPref("enablePdfFolderSidenav") && Boolean(item);
      setEnabled(enabled);
      const state = this.states.get(body);
      if (!state) return;
      state.item = enabled ? item : null;
      void this.updateBody(state);
    }
    async updateBody(st) {
      const item = st.item;
      st.btn.disabled = true;
      st.btn.style.opacity = "0.5";
      st.meta.textContent = "";
      st.meta.removeAttribute("title");
      st.meta.removeAttribute("data-l10n-id");
      if (!item) return;
      const att = await resolveFileAttachment(item).catch(() => null);
      if (this.states.get(st.body) !== st || st.item !== item) return;
      if (!att) {
        st.meta.setAttribute("data-l10n-id", "zotero-tabflow-pdf-folder-unavailable");
        return;
      }
      st.meta.textContent = String(att.attachmentFilename || att.getField?.("title") || t("zotero-tabflow-attachment-fallback", "附件文件"));
      st.meta.title = st.meta.textContent;
      st.btn.disabled = false;
      st.btn.style.opacity = "1";
    }
    async openAttachmentFolder(win, item, signal) {
      if (signal.aborted || this.openingFolders.has(win)) return;
      this.openingFolders.add(win);
      try {
        await openAttachmentFolder(item, win);
      } finally {
        this.openingFolders.delete(win);
      }
    }
    unregister() {
      resetFolderLaunchCache();
      for (const controller of this.listeners.values()) controller.abort();
      this.listeners.clear();
      if (this.sectionID) {
        Zotero.ItemPaneManager?.unregisterSection?.(this.sectionID);
        this.sectionID = false;
      }
      this.states.clear();
    }
  };

  // src/services/session-restore.ts
  var defaultResolver = async (libraryID, itemKey) => {
    try {
      const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
      return item || null;
    } catch {
      return null;
    }
  };
  function parseItemFullKey(fullKey) {
    if (typeof fullKey !== "string") return null;
    const [libStr, itemKey, extra] = fullKey.split(":");
    const libraryID = Number(libStr);
    if (!Number.isInteger(libraryID) || libraryID <= 0 || !itemKey || extra !== void 0) return null;
    return { libraryID, itemKey };
  }
  function sessionVirtualMembers(session) {
    return session.kind !== "template" && Array.isArray(session.virtualMembers) ? session.virtualMembers.filter((member) => member && typeof member.key === "string" && typeof member.title === "string") : [];
  }
  async function buildSessionRestorePlan(store, openKeysNow, session, merge, resolver = defaultResolver) {
    const openSet = new Set(openKeysNow);
    let alreadyOpenCount = 0;
    const toOpen = [];
    const missing = [];
    const virtualMembers = Array.isArray(session.virtualMembers) || session.kind === "template" ? [] : void 0;
    const resolved = /* @__PURE__ */ new Map();
    const resolve = async (fullKey, ref) => {
      if (!resolved.has(fullKey)) resolved.set(fullKey, await resolver(ref.libraryID, ref.itemKey));
      return resolved.get(fullKey);
    };
    for (const fullKey of session.openKeys) {
      if (openSet.has(fullKey)) {
        alreadyOpenCount++;
        continue;
      }
      const parsed = parseItemFullKey(fullKey);
      if (!parsed) {
        missing.push({ fullKey, libraryID: 0, itemKey: fullKey });
        continue;
      }
      const item = await resolve(fullKey, parsed);
      if (item && !item.deleted) {
        toOpen.push({ fullKey, ...parsed, itemID: item.id, title: item.getField?.("title") || fullKey });
      } else {
        missing.push({ fullKey, ...parsed });
      }
    }
    const missingKeys = new Set(missing.map((ref) => ref.fullKey));
    const seenVirtualKeys = /* @__PURE__ */ new Set();
    for (const member of sessionVirtualMembers(session)) {
      const fullKey = member.key;
      if (seenVirtualKeys.has(fullKey)) continue;
      seenVirtualKeys.add(fullKey);
      const ref = parseItemFullKey(fullKey);
      const item = ref ? await resolve(fullKey, ref) : null;
      if (item && !item.deleted) {
        virtualMembers?.push({ ...member, itemID: item.id, parentItemID: item.parentItemID || null });
      } else if (!missingKeys.has(fullKey)) {
        missing.push({ fullKey, ...ref ?? { libraryID: 0, itemKey: fullKey }, title: member.title });
      }
    }
    const existingGroupIds = new Set(store.state.groups.map((g) => g.id));
    const newGroupsCount = session.groups.filter((g) => !merge || !existingGroupIds.has(g.id)).length;
    const replacingGroupsCount = merge ? 0 : store.state.groups.length;
    const nextValidIds = /* @__PURE__ */ new Set([
      "",
      ...(merge ? store.state.groups : []).map((g) => g.id),
      ...session.groups.map((g) => g.id)
    ]);
    let reassignedCount = 0;
    const trackedKeys = /* @__PURE__ */ new Set([...openKeysNow, ...session.openKeys, ...Object.keys(store.state.assignments), ...Object.keys(session.assignments)]);
    for (const key of trackedKeys) {
      const cur = store.groupOfKey(key);
      const snapTarget = session.assignments[key];
      const validSnap = snapTarget && nextValidIds.has(snapTarget) ? snapTarget : "";
      const next = merge ? cur || validSnap : validSnap;
      if (next !== cur) reassignedCount++;
    }
    const curPinned = new Set(store.state.pinned);
    const nextPinned = merge ? /* @__PURE__ */ new Set([...curPinned, ...session.pinned]) : new Set(session.pinned);
    const pinAdded = [...nextPinned].filter((k) => !curPinned.has(k));
    const pinRemoved = [...curPinned].filter((k) => !nextPinned.has(k));
    return {
      session,
      merge,
      alreadyOpenCount,
      toOpen,
      missing,
      virtualMembers,
      reassignedCount,
      pinAdded,
      pinRemoved,
      newGroupsCount,
      replacingGroupsCount
    };
  }
  async function executeSessionRestorePlan(plan, store, openItem, openKeysNow, isDisposed = () => false) {
    if (isDisposed()) return;
    if (!plan.merge && plan.session.kind !== "pre-replace") {
      store.savePreReplaceSnapshot([...openKeysNow]);
    }
    store.restoreSessionLayout(plan.session, plan.merge, plan.virtualMembers);
    for (const ref of plan.toOpen) {
      if (isDisposed() || !ref.itemID) return;
      try {
        await openItem(ref.itemID);
      } catch (error) {
        Zotero.logError(error);
      }
    }
  }
  function buildPublicationGroupSuggestions(store, tracked) {
    const visibleGroups = new Map(store.visibleGroups().filter((g) => g.id).map((g) => [g.name, g.id]));
    const hiddenNames = new Set(store.hiddenGroups().map((g) => g.name));
    const buckets = /* @__PURE__ */ new Map();
    for (const t2 of tracked) {
      if (t2.groupId || t2.pinned || !t2.source.trim()) continue;
      const venue = t2.source.trim().slice(0, 60);
      const bucket = buckets.get(venue) || { keys: [], titles: [] };
      if (!bucket.keys.includes(t2.key)) {
        bucket.keys.push(t2.key);
        bucket.titles.push(t2.title);
      }
      buckets.set(venue, bucket);
    }
    return [...buckets.entries()].filter(([venue, b]) => visibleGroups.has(venue) || !hiddenNames.has(venue) && b.keys.length >= 2).map(([venue, b]) => ({
      venue,
      keys: b.keys,
      titles: b.titles,
      existingGroupId: visibleGroups.get(venue)
    })).sort((a, b) => b.keys.length - a.keys.length);
  }
  function applyPublicationGroupSuggestions(store, chosen) {
    for (const suggestion of chosen) {
      const visible = store.visibleGroups().find((group2) => group2.id && group2.name === suggestion.venue);
      if (!visible && store.hiddenGroups().some((group2) => group2.name === suggestion.venue)) continue;
      const keys = suggestion.keys.filter((key) => !store.groupOfKey(key));
      if (!keys.length) continue;
      const group = visible ?? store.ensureGroup(suggestion.venue);
      store.assignKeys(keys, group.id);
    }
  }
  function exportSessionsJson(sessions, pluginVersion) {
    return JSON.stringify({
      format: "zotero-tabflow-session",
      schemaVersion: 1,
      exportedAt: Date.now(),
      sourcePluginVersion: pluginVersion || void 0,
      sessions
    }, null, 2);
  }
  async function parseAndPreviewSessionImport(jsonText, resolver = defaultResolver) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || parsed.format !== "zotero-tabflow-session" || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions)) {
      throw new Error("Invalid TabFlow session archive format");
    }
    const sessions = parsed.sessions.filter(
      (s) => Boolean(s && typeof s.name === "string" && Array.isArray(s.groups) && Array.isArray(s.openKeys))
    );
    const checked = /* @__PURE__ */ new Set();
    const missing = [];
    let resolvableCount = 0;
    for (const s of sessions) {
      for (const fullKey of [...s.openKeys, ...sessionVirtualMembers(s).map((member) => member.key)]) {
        if (checked.has(fullKey)) continue;
        checked.add(fullKey);
        const ref = parseItemFullKey(fullKey);
        if (!ref) {
          missing.push({ fullKey, libraryID: 0, itemKey: fullKey });
          continue;
        }
        const item = await resolver(ref.libraryID, ref.itemKey);
        if (item && !item.deleted) resolvableCount++;
        else missing.push({ fullKey, ...ref });
      }
    }
    return { sessions, totalEntries: checked.size, resolvableCount, missing };
  }

  // src/ui/session-preview.ts
  var XHTML4 = "http://www.w3.org/1999/xhtml";
  var SessionPreviewController = class {
    win;
    doc;
    overlay = null;
    constructor(win, doc) {
      this.win = win;
      this.doc = doc;
    }
    h(tag, className) {
      const el = this.doc.createElementNS(XHTML4, tag);
      if (className) el.className = className;
      return el;
    }
    createPanel(buildBody) {
      this.dispose();
      const host = this.doc.body || this.doc.documentElement;
      if (!host) return;
      const backdrop = this.h("div");
      backdrop.id = "ztf-preview-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      const box = this.h("div", "ztf-preview-box");
      const close = () => this.dispose();
      buildBody(box, close);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
      });
      backdrop.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      });
      backdrop.append(box);
      host.append(backdrop);
      this.overlay = backdrop;
    }
    openRestorePreview(mergePlan, replacePlan, onConfirm) {
      this.createPanel((box, close) => {
        let selectedMerge = true;
        const title = this.h("div", "ztf-pv-title");
        title.textContent = t("zotero-tabflow-preview-title", `恢复会话：${mergePlan.session.name}`, { name: mergePlan.session.name });
        const modeRow = this.h("div", "ztf-pv-modes");
        const mergeBtn = this.h("button", "ztf-pv-mode active");
        mergeBtn.type = "button";
        mergeBtn.textContent = t("zotero-tabflow-preview-mode-merge", "合并恢复（推荐）");
        const replaceBtn = this.h("button", "ztf-pv-mode");
        replaceBtn.type = "button";
        replaceBtn.textContent = t("zotero-tabflow-preview-mode-replace", "替换分组布局");
        modeRow.append(mergeBtn, replaceBtn);
        const stats = this.h("div", "ztf-pv-stats");
        const note = this.h("div", "ztf-pv-note");
        const missingList = this.h("div", "ztf-pv-missing");
        const renderPlan = () => {
          const plan = selectedMerge ? mergePlan : replacePlan;
          mergeBtn.classList.toggle("active", selectedMerge);
          replaceBtn.classList.toggle("active", !selectedMerge);
          stats.replaceChildren(
            this.statRow(t("zotero-tabflow-preview-already-open", "已打开（保留）"), String(plan.alreadyOpenCount)),
            this.statRow(t("zotero-tabflow-preview-to-open", "将后台补开"), String(plan.toOpen.length)),
            this.statRow(t("zotero-tabflow-preview-virtual-members", "保留的虚拟文献"), String(plan.virtualMembers?.length ?? 0)),
            this.statRow(t("zotero-tabflow-preview-new-groups", "将新增分组"), String(plan.newGroupsCount)),
            this.statRow(t("zotero-tabflow-preview-reassigned", "将调整分组"), String(plan.reassignedCount)),
            this.statRow(t("zotero-tabflow-preview-pins", "固定状态变化"), `+${plan.pinAdded.length} / -${plan.pinRemoved.length}`),
            this.statRow(t("zotero-tabflow-preview-missing", "无法找到条目"), String(plan.missing.length))
          );
          note.textContent = selectedMerge ? t("zotero-tabflow-preview-merge-note", "保留当前阅读标签页和已有分组，仅补开缺失文献并合并新分组。") : t("zotero-tabflow-preview-replace-note", "替换前将自动保存一份可回退快照；当前已打开的标签页继续保留。");
          missingList.replaceChildren();
          missingList.hidden = !plan.missing.length;
          if (plan.missing.length) {
            const head = this.h("div", "ztf-pv-missing-head");
            head.textContent = t("zotero-tabflow-preview-missing-head", "以下条目在当前文献库中未找到（将跳过）：");
            missingList.append(head);
            for (const m of plan.missing.slice(0, 6)) {
              const row = this.h("div", "ztf-pv-missing-item");
              row.textContent = m.fullKey;
              missingList.append(row);
            }
          }
        };
        mergeBtn.onclick = () => {
          selectedMerge = true;
          renderPlan();
        };
        replaceBtn.onclick = () => {
          selectedMerge = false;
          renderPlan();
        };
        renderPlan();
        const footer = this.h("div", "ztf-pv-footer");
        const cancelBtn = this.h("button", "ztf-pv-btn");
        cancelBtn.type = "button";
        cancelBtn.textContent = t("zotero-tabflow-cancel", "取消");
        cancelBtn.onclick = close;
        const okBtn = this.h("button", "ztf-pv-btn primary");
        okBtn.type = "button";
        okBtn.textContent = t("zotero-tabflow-preview-confirm", "确认恢复");
        okBtn.onclick = () => {
          const chosen = selectedMerge ? mergePlan : replacePlan;
          close();
          void onConfirm(chosen);
        };
        footer.append(cancelBtn, okBtn);
        box.append(title, modeRow, stats, note, missingList, footer);
        okBtn.focus?.();
      });
    }
    openImportPreview(preview, onConfirm) {
      this.createPanel((box, close) => {
        const title = this.h("div", "ztf-pv-title");
        title.textContent = t("zotero-tabflow-import-preview-title", "导入跨机会话预览");
        const stats = this.h("div", "ztf-pv-stats");
        stats.append(
          this.statRow(t("zotero-tabflow-import-sessions", "包含会话数"), String(preview.sessions.length)),
          this.statRow(t("zotero-tabflow-import-resolvable", "本机可识别条目"), String(preview.resolvableCount)),
          this.statRow(t("zotero-tabflow-import-unrecognized", "本机未找到条目"), String(preview.missing.length))
        );
        const note = this.h("div", "ztf-pv-note");
        note.textContent = t("zotero-tabflow-import-note", "将以合并方式导入会话列表，不会覆盖现有会话。");
        const missingList = this.h("div", "ztf-pv-missing");
        missingList.hidden = !preview.missing.length;
        for (const m of preview.missing.slice(0, 6)) {
          const row = this.h("div", "ztf-pv-missing-item");
          row.textContent = m.fullKey;
          missingList.append(row);
        }
        const footer = this.h("div", "ztf-pv-footer");
        const cancelBtn = this.h("button", "ztf-pv-btn");
        cancelBtn.type = "button";
        cancelBtn.textContent = t("zotero-tabflow-cancel", "取消");
        cancelBtn.onclick = close;
        const okBtn = this.h("button", "ztf-pv-btn primary");
        okBtn.type = "button";
        okBtn.textContent = t("zotero-tabflow-import-confirm", "合并导入");
        okBtn.onclick = () => {
          close();
          onConfirm();
        };
        footer.append(cancelBtn, okBtn);
        box.append(title, stats, note, missingList, footer);
        okBtn.focus?.();
      });
    }
    openPublicationSuggestPreview(suggestions, onApply) {
      this.createPanel((box, close) => {
        const checked = new Set(suggestions.map((s) => s.venue));
        const title = this.h("div", "ztf-pv-title");
        title.textContent = t("zotero-tabflow-suggest-title", "按期刊自动归组建议");
        const list = this.h("div", "ztf-pv-stats");
        for (const s of suggestions) {
          const row = this.h("label", "ztf-pv-check-row");
          const cb = this.h("input");
          cb.type = "checkbox";
          cb.checked = true;
          cb.onchange = () => {
            if (cb.checked) checked.add(s.venue);
            else checked.delete(s.venue);
          };
          const text = this.h("span");
          text.textContent = `${s.venue} (${s.keys.length})`;
          row.append(cb, text);
          list.append(row);
        }
        const footer = this.h("div", "ztf-pv-footer");
        const cancelBtn = this.h("button", "ztf-pv-btn");
        cancelBtn.type = "button";
        cancelBtn.textContent = t("zotero-tabflow-cancel", "取消");
        cancelBtn.onclick = close;
        const okBtn = this.h("button", "ztf-pv-btn primary");
        okBtn.type = "button";
        okBtn.textContent = t("zotero-tabflow-suggest-apply", "应用所选建议");
        okBtn.onclick = () => {
          close();
          onApply(suggestions.filter((s) => checked.has(s.venue)));
        };
        footer.append(cancelBtn, okBtn);
        box.append(title, list, footer);
        okBtn.focus?.();
      });
    }
    statRow(label, value) {
      const row = this.h("div", "ztf-pv-stat-row");
      const l = this.h("span", "ztf-pv-stat-label");
      l.textContent = label;
      const v = this.h("strong", "ztf-pv-stat-val");
      v.textContent = value;
      row.append(l, v);
      return row;
    }
    dispose() {
      this.overlay?.remove?.();
      this.overlay = null;
    }
  };

  // src/ui/popovers.ts
  var PopoverController = class {
    constructor(win, doc, store, meta, actions, tracker, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.tracker = tracker;
      this.onRefresh = onRefresh;
      this.preview = new SessionPreviewController(win, doc);
      this.hub = new WorkspaceHubController(win, doc, store, meta, actions, {
        onPreviewRestore: (s) => void this.previewAndRestoreSession(s),
        onQuickMerge: (s) => void this.quickMergeSession(s),
        onExportSessions: () => void this.exportSessions(),
        onImportSessions: () => void this.importSessions(),
        onRefresh
      });
    }
    activePopups = /* @__PURE__ */ new Set();
    restoring = false;
    disposed = false;
    preview;
    hub;
    xul(tag) {
      return this.doc.createXULElement ? this.doc.createXULElement(tag) : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
    }
    openPopupMenu(anchor, build) {
      const popupset = this.doc.getElementById("mainPopupSet") || this.doc.querySelector("popupset");
      if (!popupset) return;
      const popup = this.xul("menupopup");
      popupset.append(popup);
      this.activePopups.add(popup);
      popup.addEventListener("popuphidden", (e) => {
        if (e.target === popup) {
          this.activePopups.delete(popup);
          popup.remove();
        }
      });
      build(popup);
      const rect = anchor.getBoundingClientRect();
      popup.openPopupAtScreen(this.win.mozInnerScreenX + rect.right, this.win.mozInnerScreenY + rect.bottom, true);
    }
    item(popup, label, action, disabled = false) {
      const mi = this.xul("menuitem");
      mi.setAttribute("label", label);
      if (disabled) mi.setAttribute("disabled", "true");
      mi.addEventListener("command", action);
      popup.append(mi);
      return mi;
    }
    openStaleMenu(anchor) {
      if (!getPref("enableStaleSuggestions")) return;
      const stale = this.tracker.getStaleTabs();
      const threshold = getPref("staleSuggestDays");
      this.openPopupMenu(anchor, (popup) => {
        this.item(popup, t("zotero-tabflow-stale-header", `${threshold} 天未查看的文献 (${stale.length})`, { days: threshold, count: stale.length }), () => {
        }, true);
        if (!stale.length) this.item(popup, t("zotero-tabflow-stale-empty", "暂时没有建议清理的文献"), () => {
        }, true);
        for (const entry of stale) {
          const sub = this.xul("menu");
          sub.setAttribute("label", `${entry.tracked.title.slice(0, 56)} · ${entry.days}d`);
          const subPop = this.xul("menupopup");
          sub.append(subPop);
          popup.append(sub);
          this.item(subPop, t("zotero-tabflow-stale-view", "查看文献"), () => this.actions.selectTab(entry.tracked.tab.id));
          if (getPref("enableTabSleep")) {
            this.item(subPop, t("zotero-tabflow-stale-sleep", "休眠以释放内存"), () => {
              this.actions.sleepTab(entry.tracked.tab.id);
              this.onRefresh();
            });
          }
          const keepEntry = Boolean(entry.tracked.groupId) && getPref("enableVirtualMembers");
          const closeLabel = keepEntry ? t("zotero-tabflow-stale-close", "关闭标签页（保留在分组）") : t("zotero-tabflow-toolbar-close-tab", "关闭标签页");
          this.item(subPop, closeLabel, () => {
            void this.actions.closeTabs([entry.tracked.tab.id], { preserveVirtual: keepEntry, protectPinned: true, protectMedia: true }).then(this.onRefresh);
          });
        }
        popup.append(this.xul("menuseparator"));
        if (getPref("enableTabSleep")) {
          this.item(popup, t("zotero-tabflow-stale-sleep-all", "全部休眠释放内存"), () => {
            for (const s of stale) this.actions.sleepTab(s.tracked.tab.id);
            this.onRefresh();
          }, !stale.length);
        }
        this.item(popup, t("zotero-tabflow-stale-close-all", "关闭以上建议的全部标签页"), () => {
          void this.actions.closeTabs(stale.map((s) => s.tracked.tab.id), { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh);
        }, !stale.length);
        this.item(popup, t("zotero-tabflow-stale-threshold", `设置天数阈值…（当前 ${threshold} 天）`, { days: threshold }), () => {
          const val = { value: String(threshold) };
          if (Services.prompt.prompt(this.win, t("zotero-tabflow-stale-btn", "建议关闭", { count: stale.length }), t("zotero-tabflow-stale-threshold-prompt", "多少天未查看后列入建议（1–3650）："), val, null, {})) {
            const num = Number(val.value);
            if (Number.isInteger(num) && num >= 1 && num <= 3650) {
              setPref("staleSuggestDays", num);
              this.onRefresh();
            }
          }
        });
      });
    }
    openWorkspaceHub(anchor) {
      if (!getPref("enableSessions") && !getPref("enableGroupHiding")) return;
      this.hub.open(anchor);
    }
    openHiddenGroupsMenu(_anchor) {
      this.openWorkspaceHub();
    }
    openSessionsMenu(_anchor) {
      this.openWorkspaceHub();
    }
    async previewAndRestoreSession(session) {
      if (this.disposed || this.restoring) return;
      try {
        const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
        const [mergePlan, replacePlan] = await Promise.all([
          buildSessionRestorePlan(this.store, openKeys, session, true),
          buildSessionRestorePlan(this.store, openKeys, session, false)
        ]);
        if (this.disposed) return;
        this.preview.openRestorePreview(mergePlan, replacePlan, (chosen) => this.executePlan(chosen));
      } catch (error) {
        Zotero.logError(error);
        Services.prompt.alert(this.win, "Zotero TabFlow", t("zotero-tabflow-session-restore-error", "加载会话预览失败，请查看 Zotero 错误控制台。"));
      }
    }
    async quickMergeSession(session) {
      if (this.disposed || this.restoring) return;
      try {
        const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
        const mergePlan = await buildSessionRestorePlan(this.store, openKeys, session, true);
        await this.executePlan(mergePlan);
      } catch (error) {
        Zotero.logError(error);
        Services.prompt.alert(this.win, "Zotero TabFlow", t("zotero-tabflow-session-restore-error", "恢复会话失败，请查看 Zotero 错误控制台。"));
      }
    }
    async executePlan(plan) {
      if (this.disposed || this.restoring) return;
      this.restoring = true;
      try {
        const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
        await executeSessionRestorePlan(
          plan,
          this.store,
          (itemID) => this.actions.openVirtualOrItem(itemID, void 0, true),
          openKeys,
          () => this.disposed
        );
      } catch (error) {
        Zotero.logError(error);
        Services.prompt.alert(this.win, "Zotero TabFlow", t("zotero-tabflow-session-restore-error", "恢复会话失败，请查看 Zotero 错误控制台。"));
      } finally {
        this.restoring = false;
        if (!this.disposed) this.onRefresh();
      }
    }
    openPublicationSuggest() {
      const suggestions = buildPublicationGroupSuggestions(this.store, this.meta.buildTrackedTabs());
      if (!suggestions.length) {
        Services.prompt.alert(this.win, "Zotero TabFlow", t("zotero-tabflow-suggest-none", "当前未分组打开标签中没有可按期刊聚合的文献（需同一期刊 ≥2 篇或匹配已有分组）。"));
        return;
      }
      this.preview.openPublicationSuggestPreview(suggestions, (chosen) => {
        applyPublicationGroupSuggestions(this.store, chosen);
        this.onRefresh();
      });
    }
    async exportSessions() {
      try {
        const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        fp.init(this.win.browsingContext || this.win, t("zotero-tabflow-sessions-export", "导出会话到 JSON 文件"), Ci.nsIFilePicker.modeSave);
        fp.appendFilter("JSON", "*.json");
        fp.defaultString = "zotero-tabflow-sessions.json";
        const res = await new Promise((resolve) => fp.open(resolve));
        if (res !== Ci.nsIFilePicker.returnOK && res !== Ci.nsIFilePicker.returnReplace) return;
        const version = Zotero.zoterotabflow?.version;
        await Zotero.File.putContentsAsync(fp.file, exportSessionsJson(this.store.state.sessions, version), "utf-8");
      } catch (error) {
        Zotero.logError(error);
      }
    }
    async importSessions() {
      try {
        const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        fp.init(this.win.browsingContext || this.win, t("zotero-tabflow-sessions-import", "从 JSON 文件导入会话"), Ci.nsIFilePicker.modeOpen);
        fp.appendFilter("JSON", "*.json");
        const res = await new Promise((resolve) => fp.open(resolve));
        if (res !== Ci.nsIFilePicker.returnOK) return;
        const text = await Zotero.File.getContentsAsync(fp.file, "utf-8");
        const preview = await parseAndPreviewSessionImport(text);
        if (!preview.sessions.length || this.disposed) return;
        this.preview.openImportPreview(preview, () => {
          this.store.importSessions(preview.sessions);
          this.onRefresh();
        });
      } catch (error) {
        Zotero.logError(error);
        Services.prompt.alert(this.win, "Zotero TabFlow", t("zotero-tabflow-import-error", "无法解析该会话文件，请确认其为有效的 TabFlow 导出 JSON。"));
      }
    }
    dispose() {
      this.disposed = true;
      this.hub.dispose();
      this.preview.dispose();
      for (const p of this.activePopups) {
        p.hidePopup?.();
        p.remove();
      }
      this.activePopups.clear();
    }
  };

  // src/ui/spotlight.ts
  var SpotlightController = class {
    win;
    doc;
    store;
    meta;
    actions;
    popovers;
    onRefresh;
    panel = null;
    input = null;
    resultsEl = null;
    entries = [];
    activeIndex = 0;
    libraryCache = [];
    cacheTimestamp = 0;
    libraryLoading = false;
    libraryLoad = null;
    constructor(win, doc, store, meta, actions, popovers, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.popovers = popovers;
      this.onRefresh = onRefresh;
    }
    h(tag, className) {
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) el.className = className;
      return el;
    }
    init() {
      this.win.addEventListener("keydown", this.handleGlobalShortcut, true);
    }
    mount() {
      if (this.panel) return;
      const popupset = this.doc.getElementById("mainPopupSet") || this.doc.querySelector("popupset");
      if (!popupset) return;
      const xul = this.doc.createXULElement ? this.doc.createXULElement("panel") : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "panel");
      xul.id = "ztf-spotlight-panel";
      xul.setAttribute("orient", "vertical");
      const box = this.h("div", "ztf-spot-box");
      const input = this.h("input", "ztf-spot-input");
      input.type = "search";
      input.setAttribute("data-l10n-id", "zotero-tabflow-spotlight-search");
      const results = this.h("div", "ztf-spot-results");
      box.append(input, results);
      xul.append(box);
      popupset.append(xul);
      this.panel = xul;
      this.input = input;
      this.resultsEl = results;
      xul.addEventListener("popupshown", () => {
        input.focus();
        input.select();
      });
      input.addEventListener("input", () => {
        this.activeIndex = 0;
        if (input.value.trim().startsWith("@") && input.value.trim().length > 1) void this.warmLibraryCache();
        this.renderResults();
      });
      box.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          this.close();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          this.activeIndex = Math.max(0, Math.min(this.entries.length - 1, this.activeIndex + 1));
          this.highlightActive();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.activeIndex = Math.max(0, this.activeIndex - 1);
          this.highlightActive();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const item = this.entries[this.activeIndex];
          if (item) {
            item.run();
            this.close();
          }
        }
      });
    }
    handleGlobalShortcut = (e) => {
      if (!getPref("enableSpotlight")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      }
    };
    open(anchor) {
      if (!getPref("enableSpotlight")) return;
      this.mount();
      if (!this.panel || !this.input) return;
      this.input.value = "";
      this.activeIndex = 0;
      this.renderResults();
      const target = anchor || this.doc.getElementById("tab-bar-container") || this.doc.documentElement;
      this.panel.openPopup(target, "after_start", 0, 8, false, false);
    }
    warmLibraryCache() {
      if (Date.now() - this.cacheTimestamp < 3e4 && this.libraryCache.length) return Promise.resolve();
      if (this.libraryLoad) return this.libraryLoad;
      this.libraryLoading = true;
      this.libraryLoad = (async () => {
        try {
          const api = Zotero.Libraries;
          const libraries = api?.getAll?.();
          const libraryIDs = Array.isArray(libraries) ? [...new Set(libraries.map((library) => library?.libraryID).filter((id) => Number.isInteger(id) && Number(id) > 0))] : [api?.userLibraryID ?? 1];
          const byLibrary = await Promise.all(libraryIDs.map(async (libraryID) => {
            try {
              const items = await Zotero.Items?.getAll?.(libraryID, true, false, false);
              return Array.isArray(items) ? items.filter((item) => item?.isRegularItem?.()).map((item) => ({ item, libraryID })) : [];
            } catch {
              return [];
            }
          }));
          this.libraryCache = byLibrary.flatMap((entries) => entries.map(({ item, libraryID }) => {
            const title = this.meta.plainTitle(String(item.getField?.("title") || ""));
            const creators = item.getCreators?.() || [];
            const author = creators[0]?.lastName || creators[0]?.firstName || "";
            const year = String(item.getField?.("year") || "").slice(0, 4);
            const pub = String(item.getField?.("publicationTitle") || item.getField?.("proceedingsTitle") || "");
            let libraryName = "";
            try {
              libraryName = api?.getName?.(libraryID) || "";
            } catch {
            }
            return {
              id: item.id,
              fullKey: `${libraryID}:${item.key}`,
              title: title || item.key,
              metaHint: [libraryName, author, year, pub].filter(Boolean).join(" · "),
              searchText: `${title} ${author} ${year} ${pub} ${libraryName}`.toLowerCase()
            };
          }));
          this.cacheTimestamp = Date.now();
        } catch {
        } finally {
          this.libraryLoading = false;
          this.libraryLoad = null;
          if (this.input?.value.trim().startsWith("@")) this.renderResults();
        }
      })();
      return this.libraryLoad;
    }
    close() {
      this.panel?.hidePopup?.();
    }
    renderResults() {
      if (!this.resultsEl || !this.input) return;
      const q = this.input.value.trim().toLowerCase();
      const tabsMode = /^>tabs(?:\s|$)/.test(q);
      const libMode = /^@/.test(q);
      const terms = q.replace(tabsMode ? /^>tabs/ : /^([>@])/, "").split(/\s+/).filter(Boolean);
      const tabs = this.meta.buildTrackedTabs();
      const groups = this.store.orderedGroups();
      const names = new Map(groups.map((group) => [group.id, group.name]));
      const hiddenGroups = this.store.hiddenGroups();
      const hiddenIds = new Set(hiddenGroups.map((group) => group.id));
      const matches = (value) => terms.every((term) => value.toLowerCase().includes(term));
      const tabMatches = (tab) => matches(`${this.store.getRemark(tab.key).note} ${tab.title} ${tab.shortTitle} ${tab.filename} ${tab.collection} ${tab.creatorYear} ${names.get(tab.groupId) ?? ""}`);
      if (tabsMode) {
        const viewedAt = (key) => this.store.state.history[key]?.lastViewed ?? 0;
        tabs.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
      }
      const tabEntries = q.startsWith(">") && !tabsMode || libMode ? [] : tabs.filter((tab) => !hiddenIds.has(tab.groupId) && tabMatches(tab)).map((tab) => {
        const gName = names.get(tab.groupId) || t("zotero-tabflow-ungrouped", "未分组");
        const r = this.store.getRemark(tab.key).note;
        return { label: `${tab.pinned ? "📌 " : ""}${r || tab.title}`, hint: `${gName} · ${tab.collection}`, run: () => this.actions.selectTab(tab.tab.id) };
      });
      const openKeys = new Set(tabs.map((tab) => tab.key));
      const openItemIds = new Set(tabs.flatMap((tab) => [tab.itemID, tab.parentItemID]));
      const libraryEntries = !libMode && (q.startsWith(">") || q.length < 2 || tabEntries.length >= 8) || !terms.length ? [] : this.libraryCache.filter((it) => !openKeys.has(it.fullKey) && !openItemIds.has(it.id) && matches(it.searchText)).slice(0, 6).map((it) => ({
        label: `📖 ${it.title}`,
        hint: it.metaHint || t("zotero-tabflow-spot-hint-library", "文献库 · 打开"),
        run: () => void this.actions.openVirtualOrItem(it.id).then(this.onRefresh)
      }));
      const selectedID = this.meta.getSelectedTabID();
      const activeTab = tabs.find((tab) => tab.tab.id === selectedID);
      const sessionEntries = !getPref("enableSessions") || libMode ? [] : [...this.store.state.sessions, ...this.store.state.rollingSessions ?? []].map((s) => ({
        label: `💾 ${t("zotero-tabflow-spot-session-prefix", "会话")}：${s.name} (${s.openKeys.length})`,
        hint: t("zotero-tabflow-spot-session-hint", "预览并恢复"),
        run: () => this.win.setTimeout(() => void this.popovers.previewAndRestoreSession(s), 0)
      })).filter((e) => !terms.length || terms.every((term) => `${e.label} ${e.hint}`.toLowerCase().includes(term)));
      const hiddenDocuments = libMode || q.startsWith(">") && !tabsMode ? [] : [
        ...tabs.filter((tab) => hiddenIds.has(tab.groupId) && tabMatches(tab)).map((tab) => ({
          groupId: tab.groupId,
          label: this.store.getRemark(tab.key).note || tab.title,
          hint: `${names.get(tab.groupId)} · ${t("zotero-tabflow-spot-hidden-select", "仅切换至此标签")}`,
          run: () => this.actions.selectTab(tab.tab.id)
        })),
        ...!tabsMode && getPref("enableVirtualMembers") ? Object.values(this.store.state.virtualMembers).flatMap((member) => {
          const groupId = this.store.groupOfKey(member.key);
          if (openKeys.has(member.key) || !hiddenIds.has(groupId) || !matches(`${member.title} ${member.shortTitle} ${names.get(groupId)}`)) return [];
          return [{
            groupId,
            label: member.title,
            hint: `${names.get(groupId)} · ${t("zotero-tabflow-spot-hidden-open", "仅打开这篇文献")}`,
            run: () => {
              void this.actions.openVirtualOrItem(member.itemID).then((opened) => {
                if (!opened) Services.prompt.alert(this.win, member.title, t("zotero-tabflow-spot-hidden-open-failed", "未能打开这篇文献。请检查附件文件是否可用。"));
                this.onRefresh();
              });
            }
          }];
        }) : []
      ];
      const matchedHiddenIds = new Set(hiddenDocuments.map((entry) => entry.groupId));
      const restoreHint = t("zotero-tabflow-spot-hidden-hint", "恢复分组");
      const hiddenEntries = libMode ? [] : hiddenGroups.filter((g) => matchedHiddenIds.has(g.id) || !tabsMode && matches(`${g.name} ${restoreHint}`)).map((g) => ({
        label: g.name,
        hint: restoreHint,
        run: () => {
          this.store.setGroupHidden(g.id, false);
          this.onRefresh();
        }
      }));
      const cmdEntries = libMode ? [] : [
        ...getPref("enableSessions") || getPref("enableGroupHiding") ? [{
          label: `🗂️ ${t("zotero-tabflow-spot-cmd-workspace", "打开 TabFlow 工作区（会话与隐藏项目）…")}`,
          hint: t("zotero-tabflow-spot-hint-workspace", "工作区"),
          run: () => this.win.setTimeout(() => this.popovers.openWorkspaceHub(), 0)
        }] : [],
        { label: `↩ ${t("zotero-tabflow-menu-undo-close", "恢复最近关闭的标签页")}`, hint: "Ctrl+Shift+T", run: () => {
          this.actions.undoCloseTab();
          this.onRefresh();
        } },
        { label: `📂 ${t("zotero-tabflow-spot-cmd-autogroup", "按 Zotero 集合自动分组")}`, hint: t("zotero-tabflow-spot-hint-autogroup", "自动归组"), run: () => {
          this.actions.autoGroupByCollection();
          this.onRefresh();
        } },
        { label: `🗂️ ${t("zotero-tabflow-menu-suggest-venue", "按期刊自动归组建议…")}`, hint: t("zotero-tabflow-spot-hint-suggest", "归组建议"), run: () => this.win.setTimeout(() => this.popovers.openPublicationSuggest(), 0) },
        { label: `💤 ${t("zotero-tabflow-spot-cmd-sleep", "休眠所有后台非固定标签")}`, hint: t("zotero-tabflow-spot-hint-sleep", "释放内存"), run: () => {
          this.actions.sleepInactiveTabs();
          this.onRefresh();
        } },
        ...getPref("enableSessions") ? [{
          label: `💾 ${t("zotero-tabflow-spot-cmd-save-session", "保存当前工作区为会话…")}`,
          hint: t("zotero-tabflow-spot-hint-session", "会话"),
          run: () => this.win.setTimeout(() => {
            const val = { value: `${t("zotero-tabflow-session-default-name", "工作区会话")} · ${formatSnapshotTimestamp(Date.now())}` };
            if (!Services.prompt.prompt(this.win, t("zotero-tabflow-sessions-save", "保存会话快照"), t("zotero-tabflow-sessions-save-prompt", "请输入会话名称："), val, null, { value: false })) return;
            this.store.saveSession(val.value, this.meta.buildTrackedTabs().map((item) => item.key));
            this.onRefresh();
          }, 0)
        }] : [],
        ...getPref("enableVerticalSidebar") ? [{
          label: `⇄ ${t("zotero-tabflow-spot-cmd-toggle-sidebar", "展开/收起垂直标签侧边栏")}`,
          hint: t("zotero-tabflow-spot-hint-sidebar", "侧边栏"),
          run: () => {
            setPref("verticalSidebarCollapsed", !getPref("verticalSidebarCollapsed"));
            this.onRefresh();
          }
        }] : [],
        ...activeTab ? [
          ...getPref("enablePinnedTabs") ? [{
            label: `📌 ${t("zotero-tabflow-spot-cmd-toggle-pin", "固定 / 取消固定当前标签")}`,
            hint: t("zotero-tabflow-spot-hint-pin", "固定"),
            run: () => {
              this.store.togglePinned(activeTab.key);
              this.onRefresh();
            }
          }] : [],
          {
            label: `📂 ${t("zotero-tabflow-spot-cmd-pdf-folder", "打开当前 PDF 附件所在文件夹")}`,
            hint: t("zotero-tabflow-spot-hint-folder", "文件夹"),
            run: () => void this.actions.showInFilesystem(activeTab.tab.id)
          }
        ] : []
      ].filter((c) => !terms.length || terms.every((term) => `${c.label} ${c.hint}`.toLowerCase().includes(term)));
      const sections = [
        [t("zotero-tabflow-spot-section-tabs", "打开的标签"), tabEntries],
        [t("zotero-tabflow-spot-section-library", "文库文献"), libraryEntries],
        [t("zotero-tabflow-spot-section-hidden", "隐藏项目"), [...hiddenDocuments, ...hiddenEntries]],
        [t("zotero-tabflow-spot-section-sessions", "会话与快照"), tabsMode ? [] : sessionEntries],
        [t("zotero-tabflow-spot-section-actions", "操作"), tabsMode ? [] : cmdEntries]
      ];
      this.entries = sections.flatMap(([, entries]) => entries);
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.entries.length - 1));
      this.resultsEl.textContent = "";
      let index = 0;
      for (const [label, entries] of sections) {
        if (!entries.length) continue;
        const heading = this.h("div", "ztf-spot-section");
        heading.setAttribute("role", "heading");
        heading.setAttribute("aria-level", "2");
        heading.textContent = label;
        this.resultsEl.append(heading);
        for (const entry of entries) this.renderEntry(entry, index++);
      }
      if (!this.entries.length) {
        const empty = this.h("div", "ztf-spot-empty");
        empty.textContent = libMode && this.libraryLoading ? t("zotero-tabflow-spot-library-loading", "正在搜索所有文库…") : t("zotero-tabflow-spot-empty", "没有匹配的文献或命令");
        this.resultsEl.append(empty);
      }
    }
    renderEntry(entry, idx) {
      const btn = this.h("button", `ztf-spot-row${idx === this.activeIndex ? " active" : ""}`);
      btn.type = "button";
      const main = this.h("span", "ztf-spot-main");
      main.textContent = entry.label;
      const hint = this.h("span", "ztf-spot-hint");
      hint.textContent = entry.hint;
      btn.append(main, hint);
      btn.onclick = () => {
        entry.run();
        this.close();
      };
      this.resultsEl?.append(btn);
    }
    highlightActive() {
      if (!this.resultsEl) return;
      const rows = [...this.resultsEl.querySelectorAll(".ztf-spot-row")];
      rows.forEach((el, i) => el.classList.toggle("active", i === this.activeIndex));
      rows[this.activeIndex]?.scrollIntoView({ block: "nearest" });
    }
    dispose() {
      this.win.removeEventListener("keydown", this.handleGlobalShortcut, true);
      this.panel?.hidePopup?.();
      this.panel?.remove?.();
      this.panel = null;
      this.input = null;
      this.resultsEl = null;
      this.entries = [];
    }
  };

  // src/core/types.ts
  var DEFAULT_PALETTE = [
    ["蓝色", "#3977d5"],
    ["紫色", "#8b5ac7"],
    ["绿色", "#21866a"],
    ["橙色", "#dc8225"],
    ["红色", "#c74646"],
    ["青色", "#298c9b"],
    ["粉色", "#d064a3"],
    ["黄色", "#f5d547"],
    ["灰色", "#737373"]
  ];

  // src/ui/tab-context-menu.ts
  var TabContextMenuController = class {
    constructor(win, doc, store, meta, actions, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.onRefresh = onRefresh;
    }
    popups = /* @__PURE__ */ new Set();
    xul(tag) {
      return this.doc.createXULElement ? this.doc.createXULElement(tag) : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
    }
    item(popup, label, action, attrs = {}) {
      const mi = this.xul("menuitem");
      mi.setAttribute("label", label);
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== false) mi.setAttribute(k, String(v));
      }
      mi.addEventListener("command", action);
      popup.append(mi);
      return mi;
    }
    openAt(event, build) {
      const popupset = this.doc.getElementById("mainPopupSet") || this.doc.querySelector("popupset");
      if (!popupset) return;
      const popup = this.xul("menupopup");
      popupset.append(popup);
      this.popups.add(popup);
      popup.addEventListener("popuphidden", (e) => {
        if (e.target === popup) {
          this.popups.delete(popup);
          popup.remove();
        }
      });
      build(popup);
      popup.openPopupAtScreen(event.screenX, event.screenY, true);
    }
    openTabMenu(event, tracked) {
      if (!getPref("enableTabContextMenu")) return;
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        if (getPref("enablePinnedTabs")) {
          this.item(popup, tracked.pinned ? t("zotero-tabflow-menu-unpin", "取消固定标签") : `📌 ${t("zotero-tabflow-menu-pin", "固定标签（防误关）")}`, () => {
            this.store.togglePinned(tracked.key);
            this.onRefresh();
          });
        }
        if (getPref("enableTabRemarks")) {
          const remark = this.store.getRemark(tracked.key);
          this.item(popup, remark.note ? `✎ ${t("zotero-tabflow-menu-edit-remark", "编辑标签备注…")}` : `✎ ${t("zotero-tabflow-menu-set-remark", "设置标签备注…")}`, () => {
            const val = { value: remark.note };
            if (Services.prompt.prompt(this.win, t("zotero-tabflow-menu-set-remark", "设置标签备注"), t("zotero-tabflow-remark-prompt", "输入备注（≤300 字，不改原文件名）："), val, null, {})) {
              this.store.setRemark(tracked.key, val.value);
              this.onRefresh();
            }
          });
          const dispMenu = this.xul("menu");
          dispMenu.setAttribute("label", t("zotero-tabflow-menu-display-mode", "标签显示模式"));
          const dispPop = this.xul("menupopup");
          dispMenu.append(dispPop);
          popup.append(dispMenu);
          for (const [mode, label] of [
            ["both", t("zotero-tabflow-remark-mode-both", "备注 + 原标题")],
            ["note", t("zotero-tabflow-remark-mode-note", "仅显示备注")],
            ["original", t("zotero-tabflow-remark-mode-original", "仅显示原标题")]
          ]) {
            this.item(dispPop, label, () => {
              this.store.setDisplayMode(tracked.key, mode);
              this.onRefresh();
            }, { type: "radio", checked: remark.mode === mode });
          }
        }
        if (getPref("enableTabSleep") && !tracked.pinned) {
          this.item(popup, tracked.status === "sleeping" ? `⚡ ${t("zotero-tabflow-menu-wake", "唤醒标签页")}` : `💤 ${t("zotero-tabflow-menu-sleep", "休眠标签（释放内存）")}`, () => {
            if (tracked.status === "sleeping") this.actions.selectTab(tracked.tab.id);
            else this.actions.sleepTab(tracked.tab.id);
            this.onRefresh();
          });
        }
        popup.append(this.xul("menuseparator"));
        const groupMenu = this.xul("menu");
        groupMenu.setAttribute("label", t("zotero-tabflow-menu-join-group", "加入分组"));
        const groupPop = this.xul("menupopup");
        groupMenu.append(groupPop);
        popup.append(groupMenu);
        for (const g of this.store.visibleGroups().filter((x) => x.id)) {
          this.item(groupPop, g.name, () => {
            this.store.assignKey(tracked.key, g.id);
            this.onRefresh();
          }, { type: "checkbox", checked: tracked.groupId === g.id });
        }
        this.item(groupPop, t("zotero-tabflow-menu-new-group-join", "新建分组并加入…"), () => {
          const val = { value: "" };
          if (Services.prompt.prompt(this.win, t("zotero-tabflow-new-group-title", "新建分组"), t("zotero-tabflow-new-group-prompt", "分组名称："), val, null, {}) && val.value.trim()) {
            const g = this.store.ensureGroup(val.value);
            this.store.assignKey(tracked.key, g.id);
            this.onRefresh();
          }
        });
        this.item(groupPop, t("zotero-tabflow-menu-remove-group", "移出分组"), () => {
          this.store.assignKey(tracked.key, "");
          this.onRefresh();
        }, { disabled: !tracked.groupId });
        popup.append(this.xul("menuseparator"));
        this.item(popup, t("zotero-tabflow-menu-show-library", "在文献库中定位"), () => this.actions.showInLibrary(tracked.tab.id));
        this.item(popup, t("zotero-tabflow-menu-show-collection", "在集合树中定位所属集合"), () => this.actions.showCollectionInLibrary(tracked.tab.id));
        if (getPref("enableCopyReference")) this.item(popup, t("zotero-tabflow-menu-copy-ref", "复制引用到剪贴板"), () => this.actions.copyReference(tracked.tab.id));
        if (getPref("enableShowInFilesystem")) this.item(popup, t("zotero-tabflow-menu-show-fs", "在文件管理器中显示"), () => void this.actions.showInFilesystem(tracked.tab.id));
        if (getPref("enableReloadTab")) this.item(popup, t("zotero-tabflow-menu-reload", "重新加载标签页"), () => void this.actions.reloadTab(tracked.tab.id));
        popup.append(this.xul("menuseparator"));
        if (getPref("enableVirtualMembers") && tracked.groupId) {
          this.item(popup, t("zotero-tabflow-menu-close-virtual", "关闭标签（保留在分组）"), () => void this.actions.closeTab(tracked.tab.id, true).then(this.onRefresh));
        }
        this.item(popup, t("zotero-tabflow-menu-close-hard", "彻底关闭标签页"), () => void this.actions.closeTab(tracked.tab.id, false).then(this.onRefresh));
        this.item(popup, `↩ ${t("zotero-tabflow-menu-undo-close", "恢复最近关闭的标签页")}`, () => {
          this.actions.undoCloseTab();
          this.onRefresh();
        });
      });
    }
    openGroupMenu(event, group) {
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        this.item(popup, `${t("zotero-tabflow-rename-group-title", "重命名分组")}…`, () => {
          const val = { value: group.name };
          if (Services.prompt.prompt(this.win, t("zotero-tabflow-rename-group-title", "重命名分组"), t("zotero-tabflow-rename-group-prompt", "分组名称："), val, null, {}) && val.value.trim()) {
            this.store.renameGroup(group.id, val.value);
            this.onRefresh();
          }
        });
        const virtualMembers = Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === group.id);
        if (!group.id) {
          const ungroupedTabs = this.meta.buildTrackedTabs().filter((tab) => !tab.groupId);
          const ungrouped = ungroupedTabs.filter((tab) => !tab.pinned);
          if (getPref("enableGroupHiding") && (ungroupedTabs.length || virtualMembers.length)) {
            this.item(popup, t("zotero-tabflow-hide-ungrouped", "隐藏当前未分组文献"), () => this.actions.hideGroup(""));
          }
          this.item(popup, t("zotero-tabflow-menu-convert-ungrouped", `将未分组文献转为新分组… (${ungrouped.length})`, { count: ungrouped.length }), () => {
            const val = { value: "" };
            if (Services.prompt.prompt(this.win, t("zotero-tabflow-new-group-title", "新建分组"), t("zotero-tabflow-new-group-prompt", "分组名称："), val, null, {}) && val.value.trim()) {
              const g = this.store.ensureGroup(val.value);
              for (const item of ungrouped) this.store.assignKey(item.key, g.id);
              this.onRefresh();
            }
          }, { disabled: !ungrouped.length });
        } else {
          if (getPref("enableGroupHiding")) {
            this.item(popup, t("zotero-tabflow-hide-group", "隐藏分组"), () => this.actions.hideGroup(group.id));
          }
          this.item(popup, t("zotero-tabflow-dissolve-group", "解散此分组"), () => {
            if (Services.prompt.confirm(this.win, t("zotero-tabflow-dissolve-group", "解散分组"), t("zotero-tabflow-dissolve-group-confirm", `解散“${group.name}”？标签页将保留并回到未分组。`, { name: group.name }))) {
              try {
                if (!this.store.dissolveGroup(group.id)) {
                  Services.prompt.alert(this.win, t("zotero-tabflow-dissolve-group", "解散分组"), t("zotero-tabflow-dissolve-group-failed", "无法解散分组：数据为只读，或分组已不存在。"));
                  return;
                }
                this.onRefresh();
              } catch (error) {
                Zotero.logError(error);
                Services.prompt.alert(this.win, t("zotero-tabflow-dissolve-group", "解散分组"), t("zotero-tabflow-dissolve-group-failed", "无法解散分组：数据为只读，或分组已不存在。"));
              }
            }
          });
        }
        const colorMenu = this.xul("menu");
        colorMenu.setAttribute("label", t("zotero-tabflow-menu-group-color", "分组颜色"));
        const colorPop = this.xul("menupopup");
        colorMenu.append(colorPop);
        popup.append(colorMenu);
        for (const [label, hex] of DEFAULT_PALETTE) {
          this.item(colorPop, `${label} (${hex})`, () => {
            this.store.setGroupColor(group.id, hex);
            this.onRefresh();
          });
        }
        this.item(colorPop, t("zotero-tabflow-menu-custom-color", "自定义 Hex 颜色…"), () => {
          const val = { value: group.color };
          if (Services.prompt.prompt(this.win, t("zotero-tabflow-menu-custom-color", "自定义颜色"), t("zotero-tabflow-custom-color-prompt", "输入 3 位或 6 位 Hex 颜色："), val, null, {})) {
            this.store.setGroupColor(group.id, val.value);
            this.onRefresh();
          }
        });
        popup.append(this.xul("menuseparator"));
        if (virtualMembers.length) {
          this.item(popup, `▶ ${t("zotero-tabflow-menu-open-virtual-all", `打开组内全部虚拟文献 (${virtualMembers.length})`, { count: virtualMembers.length })}`, () => {
            void (async () => {
              for (const m of virtualMembers) await this.actions.openVirtualOrItem(m.itemID, group.id);
              this.onRefresh();
            })();
          });
        }
        this.item(popup, t("zotero-tabflow-menu-open-group-only", "仅打开本组（关闭其他标签）"), () => {
          const ids = this.meta.buildTrackedTabs().filter((x) => x.groupId !== group.id && !x.pinned).map((x) => x.tab.id);
          void this.actions.closeTabs(ids, { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh);
        });
        this.item(popup, t("zotero-tabflow-menu-close-group-all", "关闭组内所有已开标签"), () => {
          const ids = this.meta.buildTrackedTabs().filter((x) => x.groupId === group.id).map((x) => x.tab.id);
          void this.actions.closeTabs(ids, { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh);
        });
      });
    }
    openVirtualMenu(event, member, groupId) {
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        this.item(popup, `▶ ${t("zotero-tabflow-menu-load-virtual", "加载标签页")}`, () => void this.actions.openVirtualOrItem(member.itemID, groupId).then(this.onRefresh));
        this.item(popup, t("zotero-tabflow-menu-remove-virtual", "从分组移除虚拟成员"), () => {
          this.store.removeVirtualMember(member.key);
          this.store.assignKey(member.key, "");
          this.onRefresh();
        });
      });
    }
    dispose() {
      for (const p of this.popups) {
        p.hidePopup?.();
        p.remove();
      }
      this.popups.clear();
    }
  };

  // src/ui/sidebar-hover.ts
  var SidebarHoverCard = class {
    constructor(win, doc, store) {
      this.win = win;
      this.doc = doc;
      this.store = store;
    }
    card = null;
    mount() {
      if (this.card) return;
      const card = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      card.id = "ztf-hover-card";
      card.hidden = true;
      this.doc.documentElement?.append(card);
      this.card = card;
    }
    show(anchor, tab) {
      if (!getPref("enableHoverPreview") || !this.card) return;
      const h = this.store.state.history[tab.key];
      const last = h?.lastViewed || h?.firstSeen;
      const days = last ? Math.max(0, Math.floor((Date.now() - last) / 864e5)) : 0;
      const remark = this.store.getRemark(tab.key).note;
      const reader = Zotero.Reader?.getByTabID?.(tab.tab.id);
      const pageIdx = reader?.state?.pageIndex;
      const numPages = reader?._internalReader?._pdfDocument?.numPages;
      const pageText = typeof pageIdx === "number" && pageIdx >= 0 ? typeof numPages === "number" && numPages > 0 ? t("zotero-tabflow-hover-page-of", `第 ${pageIdx + 1} / ${numPages} 页`, { page: pageIdx + 1, total: numPages }) : t("zotero-tabflow-hover-page", `第 ${pageIdx + 1} 页`, { page: pageIdx + 1 }) : "";
      const itemObj = tab.itemID ? Zotero.Items.get(tab.itemID) : null;
      const annots = itemObj?.isAttachment?.() && typeof itemObj?.getAnnotations === "function" ? itemObj.getAnnotations()?.length : void 0;
      const annotText = typeof annots === "number" && annots >= 0 ? t("zotero-tabflow-hover-annots", `批注 ${annots} 条`, { count: annots }) : "";
      const readerMeta = [pageText, annotText].filter(Boolean).join(" · ");
      this.card.textContent = "";
      const mk = (cls, text) => {
        const d = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        d.className = cls;
        d.textContent = text;
        return d;
      };
      const lastText = days === 0 ? t("zotero-tabflow-hover-today", "今天") : t("zotero-tabflow-hover-days-ago", `${days} 天前`, { days });
      this.card.append(
        mk("ztf-hc-title", tab.title),
        mk("ztf-hc-meta", [tab.creatorYear, tab.source].filter(Boolean).join(" · ") || t("zotero-tabflow-hover-no-meta", "暂无作者/期刊元数据")),
        mk("ztf-hc-meta", t("zotero-tabflow-hover-collection-last", `集合：${tab.collection} · 上次阅读：${lastText}`, { collection: tab.collection, time: lastText }))
      );
      if (readerMeta) this.card.append(mk("ztf-hc-meta", readerMeta));
      if (remark) this.card.append(mk("ztf-hc-note", t("zotero-tabflow-hover-remark", `备注：${remark}`, { note: remark })));
      const rect = anchor.getBoundingClientRect();
      this.card.style.left = `${Math.min(rect.right + 8, this.win.innerWidth - 332)}px`;
      this.card.style.top = `${Math.min(rect.top, this.win.innerHeight - 165)}px`;
      this.card.hidden = false;
    }
    hide() {
      if (this.card) this.card.hidden = true;
    }
    dispose() {
      this.card?.remove();
      this.card = null;
    }
  };

  // src/ui/sidebar-keyboard.ts
  function isEditableKeyboardTarget(target) {
    const el = target;
    if (!el || typeof el.closest !== "function") return false;
    if (el.matches("input, textarea, select") || el.isContentEditable) return true;
    return Boolean(el.closest('.ztf-inline-edit, [contenteditable="true"]'));
  }
  function visibleSidebarNavItems(list) {
    if (!list) return [];
    return [...list.querySelectorAll("[data-ztf-nav]")].filter((el) => !el.closest("[hidden]"));
  }
  function computeNextNavIndex(current, total, key) {
    if (total <= 0) return -1;
    if (key === "Home") return 0;
    if (key === "End") return total - 1;
    if (key === "ArrowDown") return current < 0 ? 0 : Math.min(total - 1, current + 1);
    if (key === "ArrowUp") return current <= 0 ? 0 : current - 1;
    return current;
  }
  function captureSidebarFocusAnchor(doc, aside) {
    const active = doc.activeElement;
    if (!aside || !active || !aside.contains(active)) return null;
    const nav = active.closest("[data-ztf-nav]");
    if (!nav) return null;
    const type = nav.dataset.ztfNav;
    const id = nav.dataset.ztfNavId || "";
    return id || type === "head" ? { type, id } : null;
  }
  function restoreSidebarFocusAnchor(list, anchor) {
    if (!list || !anchor) return;
    for (const el of visibleSidebarNavItems(list)) {
      if (el.dataset.ztfNav === anchor.type && (el.dataset.ztfNavId || "") === anchor.id) {
        el.focus({ preventScroll: true });
        return;
      }
    }
  }
  function bindSidebarKeyboardNavigation(aside, list, searchInput, onClearSearch) {
    aside.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target;
      if (target === searchInput) {
        if (e.key === "ArrowDown") {
          const first = visibleSidebarNavItems(list)[0];
          if (first) {
            e.preventDefault();
            first.focus();
            first.scrollIntoView({ block: "nearest" });
          }
        } else if (e.key === "Escape" && searchInput.value) {
          e.preventDefault();
          onClearSearch();
        }
        return;
      }
      if (isEditableKeyboardTarget(target)) return;
      const isChildControl = Boolean(target?.closest("button.ztf-sb-row-action, input.ztf-batch-check"));
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      const items = visibleSidebarNavItems(list);
      const focusedNav = target?.closest("[data-ztf-nav]") || null;
      const idx = focusedNav ? items.indexOf(focusedNav) : -1;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        const nextIdx = computeNextNavIndex(idx, items.length, e.key);
        if (nextIdx >= 0 && items[nextIdx]) {
          e.preventDefault();
          items[nextIdx].focus();
          items[nextIdx].scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (!focusedNav) return;
      const navType = focusedNav.dataset.ztfNav;
      if (e.key === "Enter") {
        if (isChildControl) return;
        e.preventDefault();
        focusedNav.click();
        return;
      }
      if (e.key === "ArrowRight" && navType === "head") {
        e.preventDefault();
        const groupEl = focusedNav.closest(".ztf-sb-group");
        const body = groupEl?.querySelector(".ztf-sb-group-body");
        if (body?.hidden) {
          focusedNav.click();
        } else {
          const firstChild = body?.querySelector('[data-ztf-nav="row"], [data-ztf-nav="virtual"]');
          firstChild?.focus();
          firstChild?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const groupEl = focusedNav.closest(".ztf-sb-group");
        const head = groupEl?.querySelector('[data-ztf-nav="head"]');
        const body = groupEl?.querySelector(".ztf-sb-group-body");
        if (navType === "head") {
          if (body && !body.hidden) focusedNav.click();
        } else if (head) {
          head.focus();
          head.scrollIntoView({ block: "nearest" });
        }
      }
    });
  }

  // src/ui/sidebar-row.ts
  var XHTML5 = "http://www.w3.org/1999/xhtml";
  function buildSidebarVirtualRow(deps, v, groupId) {
    const row = deps.doc.createElementNS(XHTML5, "div");
    row.className = "ztf-sb-row virtual";
    row.tabIndex = -1;
    row.dataset.ztfNav = "virtual";
    row.dataset.ztfNavId = v.key;
    const ic = deps.doc.createElementNS(XHTML5, "span");
    ic.className = "ztf-sb-row-icon";
    ic.append(createSvgIcon(deps.doc, "virtual", 13));
    const txt = deps.doc.createElementNS(XHTML5, "div");
    txt.className = "ztf-sb-row-text";
    const ttl = deps.doc.createElementNS(XHTML5, "div");
    ttl.className = "ztf-sb-row-title";
    ttl.textContent = deps.meta.getDisplayTitle(v);
    txt.append(ttl);
    row.append(ic, txt);
    row.onclick = () => void deps.actions.openVirtualOrItem(v.itemID, groupId).then(deps.onRefresh);
    row.oncontextmenu = (e) => deps.menus.openVirtualMenu(e, v, groupId);
    return row;
  }
  function buildSidebarTabRow(deps, item, selectedID) {
    const h = (tag, cls) => {
      const el = deps.doc.createElementNS(XHTML5, tag);
      el.className = cls;
      return el;
    };
    const row = h("div", `ztf-sb-row${item.tab.id === selectedID ? " selected" : ""}${item.status === "sleeping" ? " sleeping" : ""}`);
    row.tabIndex = -1;
    row.dataset.ztfNav = "row";
    row.dataset.ztfNavId = item.key;
    row.draggable = true;
    const iconName = item.pinned ? "pin" : item.status === "sleeping" ? "sleep" : item.tab.type === "note" ? "note" : "pdf";
    const iconWrap = h("span", "ztf-sb-row-icon");
    iconWrap.append(createSvgIcon(deps.doc, iconName, 13));
    const textWrap = h("div", "ztf-sb-row-text");
    const title = h("div", "ztf-sb-row-title");
    title.textContent = deps.meta.getDisplayTitle(item);
    textWrap.append(title);
    const sub = deps.meta.getDisplaySubtitle(item);
    if (sub) {
      const subEl = h("div", "ztf-sb-row-sub");
      subEl.textContent = sub;
      textWrap.append(subEl);
    }
    row.append(iconWrap, textWrap);
    const folderBtn = h("button", "ztf-sb-row-action");
    folderBtn.type = "button";
    folderBtn.title = t("zotero-tabflow-open-pdf-folder-tip", "打开 PDF 附件所在文件夹");
    folderBtn.append(createSvgIcon(deps.doc, "folder", 12));
    folderBtn.onclick = (e) => {
      e.stopPropagation();
      void deps.actions.showInFilesystem(item.tab.id);
    };
    row.append(folderBtn);
    deps.selection?.addCheckbox(row, item);
    row.onclick = () => deps.actions.selectTab(item.tab.id);
    row.oncontextmenu = (e) => deps.menus.openTabMenu(e, item);
    row.onmouseenter = () => deps.hoverCard.show(row, item);
    row.onmouseleave = () => deps.hoverCard.hide();
    row.ondragstart = () => {
      deps.setDraggedKey(item.key);
      deps.setDraggedTabId(item.tab.id);
    };
    row.ondragover = (e) => {
      const dragged = deps.getDraggedKey();
      const extIds = !dragged ? parseZoteroDraggedItemIDs(e.dataTransfer) : [];
      if ((!dragged || dragged === item.key) && !extIds.length) return;
      e.preventDefault();
      if (extIds.length) {
        row.setAttribute("data-ztf-drop", "join");
        return;
      }
      const rect = row.getBoundingClientRect();
      const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
      row.setAttribute("data-ztf-drop", ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "join");
    };
    row.ondragleave = () => row.removeAttribute("data-ztf-drop");
    row.ondrop = (e) => {
      e.preventDefault();
      const zone = row.getAttribute("data-ztf-drop") || "join";
      row.removeAttribute("data-ztf-drop");
      const dragged = deps.getDraggedKey();
      const draggedTabId = deps.getDraggedTabId();
      if (dragged && dragged !== item.key) {
        deps.store.assignKey(dragged, item.groupId);
        if ((zone === "before" || zone === "after") && draggedTabId) {
          deps.actions.moveTabRelative(draggedTabId, item.tab.id, zone === "after");
        }
        deps.setDraggedKey(null);
        deps.setDraggedTabId(null);
        deps.onRefresh();
        return;
      }
      const extIds = parseZoteroDraggedItemIDs(e.dataTransfer);
      if (extIds.length) {
        void (async () => {
          for (const id of extIds) await deps.actions.openVirtualOrItem(id, item.groupId);
          deps.onRefresh();
        })();
      }
    };
    row.ondragend = () => {
      deps.setDraggedKey(null);
      deps.setDraggedTabId(null);
    };
    return row;
  }

  // src/ui/sidebar-selection.ts
  var SidebarSelection = class {
    constructor(doc, store, header, aside, list, onChange, onCloseSelected) {
      this.doc = doc;
      this.store = store;
      this.list = list;
      this.onChange = onChange;
      this.onCloseSelected = onCloseSelected;
      this.toggle = this.button("zotero-tabflow-batch-toggle", () => {
        this.active = !this.active;
        this.selected.clear();
        this.onChange();
      });
      header.prepend(this.toggle);
      this.controls = this.h("div");
      this.controls.className = "ztf-batch-controls";
      this.count = this.h("span");
      this.selectAll = this.button("zotero-tabflow-batch-select-visible", () => {
        for (const checkbox of this.visibleCheckboxes()) {
          this.selected.add(checkbox.value);
          checkbox.checked = true;
        }
        this.updateControls();
      });
      this.groups = this.h("select");
      this.groups.setAttribute("data-l10n-id", "zotero-tabflow-batch-group-label");
      this.groups.onchange = () => {
        if (this.groups.selectedIndex > 0) this.store.assignKeys(this.selectedKeys(), this.groups.value);
        this.groups.selectedIndex = 0;
      };
      this.pinButtons = [true, false].map((pinned) => this.button(
        pinned ? "zotero-tabflow-batch-pin" : "zotero-tabflow-batch-unpin",
        () => this.store.setPinnedKeys(this.selectedKeys(), pinned)
      ));
      this.closeButton = this.button("zotero-tabflow-batch-close", () => {
        const ids = [...this.selected];
        this.selected.clear();
        this.onCloseSelected?.(ids);
      });
      this.controls.append(this.count, this.selectAll, this.groups, ...this.pinButtons, this.closeButton);
      aside.insertBefore(this.controls, list);
    }
    active = false;
    selected = /* @__PURE__ */ new Set();
    tracked = [];
    toggle;
    controls;
    count;
    selectAll;
    groups;
    pinButtons;
    closeButton;
    h(tag) {
      return this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    }
    button(l10n, action) {
      const btn = this.h("button");
      btn.type = "button";
      btn.setAttribute("data-l10n-id", l10n);
      btn.onclick = action;
      return btn;
    }
    visibleCheckboxes() {
      return [...this.list.querySelectorAll(".ztf-batch-check")].filter((checkbox) => !checkbox.closest("[hidden]"));
    }
    beginRender(tracked) {
      const enabled = getPref("enableBatchSelection");
      if (!enabled) {
        this.active = false;
        this.selected.clear();
      }
      this.tracked = tracked;
      const open = new Set(tracked.map((t2) => t2.tab.id));
      for (const id of this.selected) if (!open.has(id)) this.selected.delete(id);
      this.toggle.hidden = !enabled;
      this.toggle.setAttribute("aria-pressed", String(this.active));
      this.controls.hidden = !this.active;
      if (!this.active) return;
      const placeholder = this.h("option");
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.setAttribute("data-l10n-id", "zotero-tabflow-batch-move");
      this.groups.replaceChildren(placeholder);
      for (const group of this.store.visibleGroups()) {
        const option = this.h("option");
        option.value = group.id;
        option.textContent = group.name;
        this.groups.append(option);
      }
    }
    updateControls() {
      const count = this.selected.size;
      this.count.setAttribute("data-l10n-id", "zotero-tabflow-batch-count");
      this.count.setAttribute("data-l10n-args", JSON.stringify({ count }));
      this.selectAll.disabled = !this.visibleCheckboxes().some((checkbox) => !checkbox.checked);
      this.groups.disabled = !count;
      for (const btn of this.pinButtons) {
        btn.hidden = !getPref("enablePinnedTabs");
        btn.disabled = !count;
      }
      this.closeButton.hidden = !this.onCloseSelected;
      this.closeButton.disabled = !count;
    }
    selectedKeys() {
      return [...new Set(this.tracked.filter((t2) => this.selected.has(t2.tab.id)).map((t2) => t2.key))];
    }
    addCheckbox(row, tab) {
      if (!this.active) return;
      const label = this.h("label");
      label.className = "ztf-batch-target";
      const check = this.h("input");
      check.className = "ztf-batch-check";
      check.type = "checkbox";
      check.value = tab.tab.id;
      check.checked = this.selected.has(tab.tab.id);
      check.setAttribute("aria-label", tab.title);
      check.onchange = () => {
        if (check.checked) this.selected.add(tab.tab.id);
        else this.selected.delete(tab.tab.id);
        this.updateControls();
      };
      label.onclick = (event) => event.stopPropagation();
      label.append(check);
      row.prepend(label);
    }
  };

  // src/ui/sidebar-status.ts
  var XHTML6 = "http://www.w3.org/1999/xhtml";
  function computeWorkspaceStatusCounts(tracked, store) {
    const active = tracked.filter((item) => item.status === "active").length;
    const sleeping = tracked.filter((item) => item.status === "sleeping").length;
    const openKeys = new Set(tracked.map((item) => item.key));
    const virtual = getPref("enableVirtualMembers") ? Object.keys(store.state.virtualMembers).filter((key) => !openKeys.has(key)).length : 0;
    const budget = Math.max(0, Number(getPref("activeReaderBudget")) || 0);
    return {
      active,
      sleeping,
      virtual,
      overBudget: budget > 0 && active > budget,
      budget
    };
  }
  function renderSidebarStatusBar(doc, bar, counts, onSleepInactive) {
    bar.replaceChildren();
    const summary = doc.createElementNS(XHTML6, "span");
    summary.className = "ztf-sb-status-text";
    summary.textContent = t(
      "zotero-tabflow-sidebar-status-counts",
      `活动 ${counts.active} · 已卸载 ${counts.sleeping} · 虚拟 ${counts.virtual}`,
      { active: counts.active, sleeping: counts.sleeping, virtual: counts.virtual }
    );
    bar.append(summary);
    if (counts.overBudget) {
      const warn = doc.createElementNS(XHTML6, "button");
      warn.type = "button";
      warn.className = "ztf-sb-budget-warn";
      warn.textContent = t(
        "zotero-tabflow-budget-exceeded-btn",
        `超出 ${counts.budget} 篇上限 · 休眠后台`,
        { budget: counts.budget }
      );
      warn.title = t("zotero-tabflow-budget-exceeded-tip", "点击休眠后台非固定标签页以减轻负荷");
      warn.onclick = onSleepInactive;
      bar.append(warn);
    }
  }
  function renderSidebarEmptyState(doc, list, hasQuery, hasSessions, onClearQuery, onRestoreLastSession, onFocusLibrary) {
    const box = doc.createElementNS(XHTML6, "div");
    box.className = "ztf-sb-empty";
    const msg = doc.createElementNS(XHTML6, "div");
    msg.className = "ztf-sb-empty-msg";
    const btn = doc.createElementNS(XHTML6, "button");
    btn.type = "button";
    btn.className = "ztf-sb-empty-btn";
    if (hasQuery) {
      msg.textContent = t("zotero-tabflow-empty-filter", "没有符合筛选条件的标签页");
      btn.textContent = t("zotero-tabflow-empty-clear-filter", "清除筛选");
      btn.onclick = onClearQuery;
    } else if (hasSessions) {
      msg.textContent = t("zotero-tabflow-empty-no-tabs", "当前没有打开的文献阅读标签");
      btn.textContent = t("zotero-tabflow-empty-restore-session", "恢复最近会话");
      btn.onclick = onRestoreLastSession;
    } else {
      msg.textContent = t("zotero-tabflow-empty-no-tabs", "当前没有打开的文献阅读标签");
      btn.textContent = t("zotero-tabflow-empty-open-library", "返回我的文库");
      btn.onclick = onFocusLibrary;
    }
    box.append(msg, btn);
    list.append(box);
  }
  function buildSidebarSection(doc, collapsedSet, id, title, color, count, onConvertToGroup) {
    const collapsed = collapsedSet.has(id);
    const wrap = doc.createElementNS(XHTML6, "div");
    wrap.className = "ztf-sb-group";
    const headRow = doc.createElementNS(XHTML6, "div");
    headRow.className = "ztf-sb-group-head-row";
    const head = doc.createElementNS(XHTML6, "button");
    head.type = "button";
    head.className = "ztf-sb-group-head";
    head.dataset.ztfNav = "head";
    head.dataset.ztfNavId = id;
    const arrow = doc.createElementNS(XHTML6, "span");
    arrow.className = "ztf-sb-caret";
    arrow.textContent = collapsed ? "▸" : "▾";
    const dot = doc.createElementNS(XHTML6, "span");
    dot.className = "ztf-sb-dot";
    dot.style.background = color;
    const txt = doc.createElementNS(XHTML6, "span");
    txt.className = "ztf-sb-group-title";
    txt.textContent = `${title} (${count})`;
    const body = doc.createElementNS(XHTML6, "div");
    body.className = "ztf-sb-group-body";
    body.hidden = collapsed;
    head.onclick = () => {
      const next = !collapsedSet.has(id);
      if (next) collapsedSet.add(id);
      else collapsedSet.delete(id);
      arrow.textContent = next ? "▸" : "▾";
      body.hidden = next;
    };
    head.append(arrow, dot, txt);
    headRow.append(head);
    if (onConvertToGroup) {
      const conv = doc.createElementNS(XHTML6, "button");
      conv.type = "button";
      conv.className = "ztf-sb-col-group-btn";
      conv.textContent = "+";
      conv.title = t("zotero-tabflow-collection-to-group-tip", "将该集合当前标签转为独立分组");
      conv.onclick = (e) => {
        e.stopPropagation();
        onConvertToGroup();
      };
      headRow.append(conv);
    }
    wrap.append(headRow, body);
    return wrap;
  }

  // src/ui/vertical-sidebar.ts
  var VerticalSidebarController = class {
    constructor(win, doc, store, meta, actions, menus, onRefresh, onRestoreLastSession) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.menus = menus;
      this.onRefresh = onRefresh;
      this.onRestoreLastSession = onRestoreLastSession;
      this.hoverCard = new SidebarHoverCard(win, doc, store);
    }
    sidebar = null;
    listEl = null;
    statusEl = null;
    selection = null;
    searchInput = null;
    hoverCard;
    viewMode = "groups";
    draggedKey = null;
    draggedTabId = null;
    groupSections = /* @__PURE__ */ new Map();
    collapsedSections = /* @__PURE__ */ new Set();
    h(tag, className) {
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) el.className = className;
      return el;
    }
    mount() {
      if (this.sidebar) return;
      const deck = this.win.Zotero_Tabs?.deck;
      const deckParent = deck?.parentElement;
      if (!deck || !deckParent) return;
      const aside = this.doc.createXULElement ? this.doc.createXULElement("vbox") : this.doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "vbox");
      aside.id = "ztf-sidebar";
      const header = this.h("div", "ztf-sb-header");
      const title = this.h("span", "ztf-sb-title ztf-sb-hide-collapsed");
      title.append(createSvgIcon(this.doc, "layers", 13), this.doc.createTextNode("TabFlow"));
      const mkBtn = (icon, size, tip, fn, cls = "ztf-sb-icon-btn ztf-sb-hide-collapsed") => {
        const b = this.h("button", cls);
        b.type = "button";
        b.title = tip;
        b.append(createSvgIcon(this.doc, icon, size));
        b.onclick = fn;
        return b;
      };
      const headerActions = this.h("div", "ztf-sb-header-actions");
      headerActions.append(
        mkBtn("plus", 13, t("zotero-tabflow-sidebar-new-group", "新建分组"), () => {
          const input = { value: "" };
          if (!Services.prompt.prompt(null, t("zotero-tabflow-new-group-title", "新建标签分组"), t("zotero-tabflow-new-group-prompt", "请输入新分组名称："), input, null, {})) return;
          this.store.ensureGroup(input.value);
          this.viewMode = "groups";
          this.onRefresh();
        }),
        mkBtn("folder", 13, t("zotero-tabflow-auto-group-tip", "按 Zotero 集合自动归组"), () => {
          this.actions.autoGroupByCollection();
          this.onRefresh();
        }),
        mkBtn("sleep", 13, t("zotero-tabflow-sleep-inactive-tip", "休眠后台非固定标签（释放内存）"), () => {
          this.actions.sleepInactiveTabs();
          this.onRefresh();
        }),
        mkBtn("sidebar", 14, t("zotero-tabflow-sidebar-toggle-tip", "折叠/展开侧边栏"), () => {
          setPref("verticalSidebarCollapsed", !getPref("verticalSidebarCollapsed"));
          this.render();
        }, "ztf-sb-icon-btn")
      );
      header.append(title, headerActions);
      const searchWrap = this.h("div", "ztf-sb-search-wrap ztf-sb-hide-collapsed");
      const search = this.h("input", "ztf-sb-search");
      search.type = "search";
      search.placeholder = t("zotero-tabflow-sidebar-search-placeholder", "过滤标题、备注、集合…");
      search.oninput = () => this.renderList();
      searchWrap.append(search);
      const views = this.h("div", "ztf-sb-views ztf-sb-hide-collapsed");
      for (const [mode, label] of [
        ["groups", t("zotero-tabflow-sidebar-view-groups", "分组")],
        ["collection", t("zotero-tabflow-sidebar-view-collection", "集合")],
        ["recent", t("zotero-tabflow-sidebar-view-status", "状态")]
      ]) {
        const btn = this.h("button", `ztf-sb-view-btn${this.viewMode === mode ? " active" : ""}`);
        btn.type = "button";
        btn.dataset.mode = mode;
        btn.textContent = label;
        btn.onclick = () => {
          this.viewMode = mode;
          views.querySelectorAll(".ztf-sb-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
          this.renderList();
        };
        views.append(btn);
      }
      const list = this.h("div", "ztf-sb-list ztf-sb-hide-collapsed");
      const statusBar = this.h("div", "ztf-sb-status-bar ztf-sb-hide-collapsed");
      const resizer = this.h("div", "ztf-sb-resizer ztf-sb-hide-collapsed");
      this.bindResizer(resizer, aside);
      aside.append(header, searchWrap, views, list, statusBar, resizer);
      this.selection = new SidebarSelection(
        this.doc,
        this.store,
        headerActions,
        aside,
        list,
        () => this.renderList(),
        (ids) => void this.actions.closeTabs(ids, { preserveVirtual: true, protectPinned: true, protectMedia: true }).then(this.onRefresh)
      );
      bindSidebarKeyboardNavigation(aside, list, search, () => {
        search.value = "";
        this.renderList();
      });
      deckParent.insertBefore(aside, deck);
      this.hoverCard.mount();
      this.sidebar = aside;
      this.listEl = list;
      this.statusEl = statusBar;
      this.searchInput = search;
    }
    bindResizer(resizer, aside) {
      resizer.onmousedown = (e) => {
        const me = e;
        if (me.button !== 0 || aside.classList.contains("collapsed")) return;
        me.preventDefault();
        resizer.classList.add("active");
        const startX = me.clientX;
        const startWidth = aside.getBoundingClientRect().width;
        const onMove = (ev) => {
          aside.style.setProperty("--ztf-sb-width", `${Math.min(440, Math.max(200, Math.round(startWidth + ev.clientX - startX)))}px`);
        };
        const onUp = () => {
          resizer.classList.remove("active");
          this.win.removeEventListener("mousemove", onMove, true);
          this.win.removeEventListener("mouseup", onUp, true);
          setPref("verticalSidebarWidth", Math.round(aside.getBoundingClientRect().width));
        };
        this.win.addEventListener("mousemove", onMove, true);
        this.win.addEventListener("mouseup", onUp, true);
      };
    }
    render(tracked) {
      this.mount();
      if (!this.sidebar) return;
      const enabled = getPref("enableVerticalSidebar");
      const collapsed = getPref("verticalSidebarCollapsed");
      if (!enabled || collapsed) {
        for (const group of this.groupSections.values()) group.pause();
      }
      this.sidebar.hidden = !enabled || collapsed;
      this.sidebar.classList.toggle("collapsed", collapsed);
      if (!enabled || collapsed) {
        return;
      }
      this.sidebar.style.setProperty("--ztf-sb-width", `${getPref("verticalSidebarWidth")}px`);
      this.sidebar.style.setProperty("--ztf-row-height", `${getPref("verticalTabRowHeight")}px`);
      this.sidebar.style.setProperty("--ztf-font-size", `${getPref("verticalTabFontSize")}px`);
      this.renderList(tracked);
    }
    renderList(snapshot) {
      if (!this.listEl) return;
      const focusAnchor = captureSidebarFocusAnchor(this.doc, this.sidebar);
      const q = (this.searchInput?.value || "").trim().toLowerCase();
      const selectedID = this.meta.getSelectedTabID();
      const tracked = snapshot ?? this.meta.buildTrackedTabs();
      const groups = this.store.visibleGroups();
      const visibleGroupIds = new Set(groups.map((group) => group.id));
      const visibleTabs = tracked.filter((tab) => visibleGroupIds.has(tab.groupId));
      this.selection?.beginRender(visibleTabs);
      if (this.statusEl) {
        renderSidebarStatusBar(this.doc, this.statusEl, computeWorkspaceStatusCounts(tracked, this.store), () => {
          this.actions.sleepInactiveTabs();
          this.onRefresh();
        });
      }
      const allTracked = visibleTabs.filter((t2) => !q || `${t2.title} ${t2.shortTitle} ${t2.filename} ${t2.collection} ${this.store.getRemark(t2.key).note}`.toLowerCase().includes(q));
      const openKeys = new Set(tracked.map((tab) => tab.key));
      const virtualList = getPref("enableVirtualMembers") ? Object.values(this.store.state.virtualMembers).filter((m) => !openKeys.has(m.key) && visibleGroupIds.has(this.store.groupOfKey(m.key))) : [];
      const matchingVirtuals = virtualList.filter((m) => !q || `${m.title} ${m.shortTitle} ${m.collection}`.toLowerCase().includes(q));
      let renderedGroupsCount = 1;
      if (this.viewMode === "groups") {
        if (!this.groupSections.size) this.listEl.replaceChildren();
        const tabsByGroup = indexGroupMembers(allTracked, (tab) => tab.groupId);
        const virtualsByGroup = indexGroupMembers(matchingVirtuals, (member) => this.store.groupOfKey(member.key));
        const collapsedIds = new Set(this.store.state.collapsed);
        const renderedGroups = groups.filter((g) => {
          const hasOpenMembers = tabsByGroup.has(g.id);
          const hasVirtualMembers = virtualsByGroup.has(g.id);
          return shouldRenderGroupHeading(g.id, hasOpenMembers, hasVirtualMembers, Boolean(!g.id && this.store.state.ungroupedName));
        });
        renderedGroupsCount = renderedGroups.length;
        for (const g of renderedGroups) {
          const members = tabsByGroup.get(g.id) ?? [];
          const virtuals = virtualsByGroup.get(g.id) ?? [];
          const collapsed = collapsedIds.has(g.id);
          const section = this.getGroupSection(g.id);
          section.element.style.setProperty("--ztf-group-dot", g.color);
          section.update(g, collapsed, members.length + virtuals.length);
          section.heading.oncontextmenu = (e) => this.menus.openGroupMenu(e, g);
          if (!collapsed) {
            const body = this.doc.createDocumentFragment();
            for (const t2 of members) body.append(buildSidebarTabRow(this.rowDeps(), t2, selectedID));
            for (const v of virtuals) body.append(buildSidebarVirtualRow(this.rowDeps(), v, g.id));
            section.body.replaceChildren(body);
          }
        }
        reconcileGroupSections(this.listEl, this.groupSections, renderedGroups.map((g) => g.id));
      } else {
        this.clearGroupSections();
        this.listEl.replaceChildren();
        if (this.viewMode === "collection") {
          const colors = ["#3977d5", "#21866a", "#8b5ac7", "#dc8225"];
          [...indexGroupMembers(allTracked, (tab) => tab.collection)].forEach(([col, items], i) => {
            const sec = buildSidebarSection(this.doc, this.collapsedSections, `col:${col}`, col, colors[i % colors.length], items.length, () => {
              const g = this.store.ensureGroup(col);
              this.store.assignKeys(items.map((x) => x.key), g.id);
              this.viewMode = "groups";
              this.onRefresh();
            });
            const body = sec.querySelector(".ztf-sb-group-body");
            for (const item of items) body.append(buildSidebarTabRow(this.rowDeps(), item, selectedID));
            this.listEl.append(sec);
          });
        } else if (allTracked.length) {
          for (const [id, label, color, items] of [
            ["status:active", t("zotero-tabflow-sidebar-status-active", "已加载阅读器"), "#16a34a", allTracked.filter((x) => x.status === "active")],
            ["status:sleeping", t("zotero-tabflow-sidebar-status-sleeping", "已休眠省内存"), "#d97706", allTracked.filter((x) => x.status === "sleeping")]
          ]) {
            const sec = buildSidebarSection(this.doc, this.collapsedSections, id, label, color, items.length);
            const body = sec.querySelector(".ztf-sb-group-body");
            for (const item of items) body.append(buildSidebarTabRow(this.rowDeps(), item, selectedID));
            this.listEl.append(sec);
          }
        }
      }
      const noMatches = Boolean(q) && !allTracked.length && (!matchingVirtuals.length || this.viewMode !== "groups");
      const noNonGroupRows = this.viewMode !== "groups" && !allTracked.length;
      const brandNewEmpty = !q && this.viewMode === "groups" && !allTracked.length && !virtualList.length && renderedGroupsCount <= 1;
      if (noMatches || noNonGroupRows || brandNewEmpty) {
        this.clearGroupSections();
        this.listEl.replaceChildren();
        renderSidebarEmptyState(
          this.doc,
          this.listEl,
          Boolean(q),
          Boolean(this.store.state.sessions.length || this.store.state.rollingSessions?.length),
          () => {
            if (this.searchInput) {
              this.searchInput.value = "";
              this.renderList();
            }
          },
          () => this.onRestoreLastSession?.(),
          () => {
            const lib = this.win.Zotero_Tabs?._tabs?.find((x) => x.type === "library");
            if (lib) this.win.Zotero_Tabs?.select?.(lib.id);
          }
        );
      }
      this.selection?.updateControls();
      restoreSidebarFocusAnchor(this.listEl, focusAnchor);
    }
    rowDeps() {
      return {
        doc: this.doc,
        store: this.store,
        meta: this.meta,
        actions: this.actions,
        menus: this.menus,
        hoverCard: this.hoverCard,
        selection: this.selection,
        onRefresh: this.onRefresh,
        getDraggedKey: () => this.draggedKey,
        setDraggedKey: (key) => {
          this.draggedKey = key;
        },
        getDraggedTabId: () => this.draggedTabId,
        setDraggedTabId: (id) => {
          this.draggedTabId = id;
        }
      };
    }
    getGroupSection(id) {
      const cached = this.groupSections.get(id);
      if (cached) return cached;
      const section = new GroupSection(
        this.win,
        this.doc,
        {
          section: "ztf-sb-group",
          heading: "ztf-sb-group-head",
          body: "ztf-sb-group-body"
        },
        (closed) => this.store.setCollapsed(id, closed),
        (name) => this.store.renameGroup(id, name)
      );
      section.heading.dataset.ztfNav = "head";
      section.heading.dataset.ztfNavId = id;
      section.heading.prepend(this.h("span", "ztf-sb-dot"));
      section.heading.ondragover = (e) => {
        if (this.draggedKey || parseZoteroDraggedItemIDs(e.dataTransfer).length) e.preventDefault();
      };
      section.heading.ondrop = (e) => {
        e.preventDefault();
        if (this.draggedKey) {
          this.store.assignKey(this.draggedKey, id);
          this.draggedKey = null;
          this.draggedTabId = null;
          this.onRefresh();
          return;
        }
        const extIds = parseZoteroDraggedItemIDs(e.dataTransfer);
        if (extIds.length) {
          void (async () => {
            for (const itemID of extIds) await this.actions.openVirtualOrItem(itemID, id);
            this.onRefresh();
          })();
        }
      };
      this.groupSections.set(id, section);
      return section;
    }
    clearGroupSections() {
      for (const section of this.groupSections.values()) section.dispose();
      this.groupSections.clear();
    }
    dispose() {
      this.clearGroupSections();
      this.hoverCard.dispose();
      this.sidebar?.remove();
      this.sidebar = null;
      this.listEl = null;
      this.statusEl = null;
      this.selection = null;
      this.searchInput = null;
    }
  };

  // src/ui/workspace-styles.ts
  var WORKSPACE_CSS = `
/* Zotero TabFlow - Native Zotero 10-12 Light/Dark Theme Integration */
:root {
  --ztf-surface: var(--material-sidepane, light-dark(#f7f8fa, #242528));
  --ztf-card: var(--material-background, light-dark(#ffffff, #2b2c30));
  --ztf-border: var(--material-border, light-dark(rgba(0,0,0,0.09), rgba(255,255,255,0.1)));
  --ztf-text: var(--fill-primary, light-dark(#1f2328, #e6edf3));
  --ztf-muted: var(--fill-secondary, light-dark(#6e7781, #9198a1));
  --ztf-hover: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.07));
  --ztf-accent: var(--accent-blue, light-dark(#245ac7, #6ea8fe));
  --ztf-accent-soft: color-mix(in srgb, var(--ztf-accent) 13%, transparent);
}

.ztf-icon { flex: none; display: inline-block; vertical-align: middle; }

item-pane-sidenav .btn[data-l10n-id="zotero-tabflow-pdf-folder-sidenav"] {
  background-size: 22px 22px;
}

/* Horizontal Grouped Tab Bar (must opt out of titlebar window-dragging!) */
#tab-bar-container[data-ztf-inline]:not([hidden]) { min-width: 0; overflow: hidden; }
#tab-bar-container[data-ztf-inline] > div { min-width: 0; flex: 1 1 0%; }
#tab-bar-container[data-ztf-inline] .tab-bar-inner-container {
  --ztf-tab-height: 28px;
  min-width: 0; min-height: var(--tab-min-height, 36px); align-items: center;
}
#tab-bar-container[data-ztf-inline] ~ #zotero-tabs-toolbar { flex: 0 0 auto; -moz-window-dragging: no-drag; }
#tab-bar-container[data-ztf-inline] .pinned-tabs {
  display: block; flex: 0 1 auto; min-width: 0; max-width: 42%; padding: 0;
}
#tab-bar-container[data-ztf-inline] .pinned-tabs .tabs {
  padding: 4px 1px; position: static; overflow: visible;
}
#tab-bar-container[data-ztf-inline] .pinned-tabs .tab {
  flex: 0 1 200px; min-width: 0; max-width: 200px; height: var(--ztf-tab-height);
}
#tab-bar-container[data-ztf-inline] .tabs-wrapper,
#tab-bar-container[data-ztf-inline] .scroll-start-arrow,
#tab-bar-container[data-ztf-inline] .scroll-end-arrow { display: none !important; }

#ztf-inline, #ztf-inline *, .ztf-pinned-strip, .ztf-pinned-strip *, #ztf-toolbar-actions, #ztf-toolbar-actions * {
  -moz-window-dragging: no-drag;
}

#ztf-inline {
  display: flex; align-items: center; flex: 1 1 0%; min-width: 0; min-height: var(--tab-min-height, 36px);
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; gap: 6px; padding: 0 6px;
  box-sizing: border-box; font: 12px system-ui, "Microsoft YaHei UI", sans-serif; color: var(--ztf-text);
}
#ztf-inline[hidden], .ztf-pinned-strip[hidden] { display: none !important; }
.ztf-pinned-strip {
  display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 35%;
  min-height: var(--tab-min-height, 36px); padding-inline: 4px;
  border-inline-end: 1px solid var(--ztf-border); flex: 0 1 auto;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
}
.ztf-pinned-chip {
  display: inline-flex; align-items: center; gap: 4px; height: var(--ztf-tab-height); max-width: 116px;
  padding: 0 9px; border-radius: 6px; border: 0; flex: none;
  background: color-mix(in srgb, #f59e0b 12%, transparent); color: var(--ztf-text);
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer;
}
.ztf-pinned-chip.icon-only { padding: 0 7px; max-width: 28px; }
.ztf-pinned-chip.selected { background: var(--ztf-card); box-shadow: 0 0 0 1px var(--ztf-border); font-weight: 600; }
.ztf-pinned-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ztf-pinned-more {
  height: var(--ztf-tab-height); padding: 0 7px; border-radius: 6px; border: 1px solid var(--ztf-border);
  background: var(--ztf-card); color: var(--ztf-muted); font: 11px system-ui, sans-serif; font-weight: 600;
  cursor: pointer; flex: none;
}
.ztf-pinned-more:hover { color: var(--ztf-text); background: var(--ztf-hover); }

#ztf-inline .ztf-section {
  position: relative; display: inline-flex; align-items: center; flex: none; height: var(--ztf-tab-height); gap: 4px; box-sizing: border-box;
}
#ztf-inline .ztf-section-body { display: contents; }
#ztf-inline .ztf-heading[hidden], #ztf-inline .ztf-section-body[hidden],
.ztf-sb-group-head[hidden], .ztf-sb-group-body[hidden] { display: none; }
#ztf-inline .ztf-section::after {
  content: ""; position: absolute; left: 2px; right: 2px; bottom: -3px; height: 2px; border-radius: 1px;
  background: color-mix(in srgb, var(--ztf-color, transparent) 65%, transparent); pointer-events: none;
}
#ztf-inline .ztf-heading {
  display: inline-block; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
  height: var(--ztf-tab-height); box-sizing: border-box;
  border: 0; border-radius: 6px; padding: 0 10px;
  background: transparent; color: var(--ztf-text);
  font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
}
#ztf-inline .ztf-heading:hover { background: var(--ztf-hover); }
#ztf-inline .ztf-heading:focus-visible { outline: 1px solid var(--ztf-text); outline-offset: -2px; }
#ztf-inline .ztf-doc {
  display: inline-flex; align-items: center; gap: 4px; max-width: 185px; height: var(--ztf-tab-height); box-sizing: border-box;
  padding-inline: 10px 6px; border: 0; border-radius: 6px;
  background: transparent; color: var(--ztf-muted); font: inherit; cursor: pointer; transition: background 0.12s, color 0.12s;
}
#ztf-inline .ztf-doc:hover { background: var(--ztf-hover); color: var(--ztf-text); }
#ztf-inline .ztf-doc.selected {
  background: var(--ztf-card); color: var(--ztf-text);
  box-shadow: 0 0 0 1px var(--ztf-border), 0 1px 2px rgba(0,0,0,0.06); font-weight: 600;
}
#ztf-inline .ztf-doc.ztf-sleeping { opacity: 0.65; }
#ztf-inline .ztf-doc.ztf-virtual { box-shadow: inset 0 0 0 1px var(--ztf-border); opacity: 0.62; background: transparent; }
#ztf-inline .ztf-doc[data-ztf-drop="stack"] { outline: 2px solid var(--ztf-accent); outline-offset: -2px; }
#ztf-inline .ztf-doc-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ztf-inline .ztf-doc-close {
  border: 0; background: transparent; color: var(--ztf-muted); cursor: pointer; padding: 0;
  width: 18px; height: 18px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;
  flex: none; opacity: 0; transition: opacity 0.12s, background 0.12s;
}
#ztf-inline .ztf-doc:hover .ztf-doc-close,
#ztf-inline .ztf-doc:focus-within .ztf-doc-close,
#ztf-inline .ztf-doc.selected .ztf-doc-close { opacity: 1; }
#ztf-inline .ztf-doc-close:hover { background: var(--ztf-hover); color: var(--ztf-text); }
#ztf-inline .ztf-add-group {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: var(--ztf-tab-height);
  border: 0; background: transparent; color: var(--ztf-muted);
  border-radius: 6px; cursor: pointer; flex: none;
}
#ztf-inline .ztf-add-group:hover { background: var(--ztf-hover); color: var(--ztf-text); }
.ztf-inline-edit {
  height: var(--ztf-tab-height); min-width: 84px; max-width: 180px; padding: 0 8px; box-sizing: border-box;
  border: 1.5px solid var(--ztf-accent); border-radius: 6px;
  background: var(--ztf-card); color: var(--ztf-text);
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; outline: none;
  -moz-window-dragging: no-drag;
}

/* TabFlow actions in the Zotero tab bar */
#ztf-toolbar-actions {
  display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto;
  margin-inline: 4px 6px; padding-inline-start: 5px;
  border-inline-start: 1px solid var(--ztf-border);
}
#ztf-toolbar-actions[hidden], .ztf-tb-count[hidden], .ztf-tb-icon-only .ztf-tb-label { display: none; }
#ztf-toolbar-actions .ztf-tb-btn {
  appearance: none; position: relative; display: inline-flex; align-items: center;
  justify-content: center; flex: none; gap: 4px; height: 28px; min-width: 28px;
  box-sizing: border-box; padding: 0 6px; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--ztf-text); font: 12px/1 system-ui, "Microsoft YaHei UI", sans-serif;
  cursor: pointer; white-space: nowrap;
}
#ztf-toolbar-actions .ztf-tb-btn:hover { background: var(--ztf-hover); }
#ztf-toolbar-actions .ztf-tb-btn:active { background: color-mix(in srgb, var(--ztf-text) 11%, transparent); }
#ztf-toolbar-actions .ztf-tb-btn:focus-visible { outline: 1px solid currentColor; outline-offset: -2px; }
.ztf-tb-btn > svg { flex: none; color: var(--ztf-muted); }
.ztf-tb-btn[aria-pressed="true"] > svg, .ztf-tb-btn:hover > svg { color: var(--ztf-text); }
.ztf-tb-btn[aria-pressed="true"]::after {
  content: ""; position: absolute; inset-inline: 8px; bottom: 2px;
  height: 1px; background: currentColor; opacity: .65; pointer-events: none;
}
.ztf-tb-count {
  min-width: 13px; padding: 1px 3px; box-sizing: border-box; border: 1px solid var(--ztf-border);
  border-radius: 4px; color: var(--ztf-muted); text-align: center;
  font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1;
}
.ztf-tb-attention .ztf-tb-count { color: var(--ztf-text); font-weight: 600; }
@media (max-width: 820px) {
  #ztf-toolbar-actions .ztf-tb-btn:not([data-action="workspace"]) .ztf-tb-label { display: none; }
  #ztf-toolbar-actions .ztf-tb-btn { padding-inline: 4px; }
}
@media (max-width: 620px) {
  #ztf-toolbar-actions .ztf-tb-label { display: none; }
}
.ztf-spot-section { padding: 7px 8px 4px; color: var(--ztf-muted); font-size: 11px; font-weight: 600; }
.ztf-hub-status:not(:empty) { padding: 8px 12px; border-top: 1px solid var(--ztf-border); color: var(--ztf-text); }

/* Vertical Sidebar (Clean Native Zotero Sidepane Aesthetic; 0px when collapsed) */
#ztf-sidebar {
  position: relative; z-index: 3; display: flex; flex-direction: column;
  width: var(--ztf-sb-width, 256px); min-width: 200px; max-width: 440px; min-height: 0;
  border-right: 1px solid var(--ztf-border); background: var(--ztf-surface); color: var(--ztf-text);
  font-family: system-ui, "Microsoft YaHei UI", sans-serif; flex-shrink: 0; overflow: hidden;
}
#ztf-sidebar[hidden], #ztf-sidebar.collapsed { display: none !important; }

.ztf-sb-resizer { position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize; z-index: 5; }
.ztf-sb-resizer:hover, .ztf-sb-resizer.active { background: var(--ztf-accent); opacity: 0.4; }

.ztf-sb-header {
  display: flex; align-items: center; justify-content: space-between; height: 34px; padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--ztf-border); font-size: 12px; font-weight: 600;
}
.ztf-sb-title { display: inline-flex; align-items: center; gap: 6px; color: var(--ztf-text); }
.ztf-sb-header-actions { display: inline-flex; align-items: center; gap: 2px; }
.ztf-sb-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: 0; background: transparent; color: var(--ztf-muted); cursor: pointer; border-radius: 5px;
}
.ztf-sb-icon-btn:hover { background: var(--ztf-hover); color: var(--ztf-text); }

.ztf-sb-search-wrap { padding: 8px 8px 4px; }
.ztf-sb-search {
  width: 100%; box-sizing: border-box; height: 26px; padding: 0 8px;
  border: 1px solid var(--ztf-border); border-radius: 5px;
  background: var(--ztf-card); color: var(--ztf-text); font-size: 12px; outline: none;
}
.ztf-sb-search:focus { border-color: var(--ztf-accent); }

/* Sleek Underline View Tabs (Zotero Reader Sidebar Style) */
.ztf-sb-views {
  display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--ztf-border);
}
.ztf-sb-view-btn {
  flex: 1; border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--ztf-muted); padding: 6px 2px; font-size: 11px; font-weight: 500; cursor: pointer;
}
.ztf-sb-view-btn:hover { color: var(--ztf-text); }
.ztf-sb-view-btn.active { color: var(--ztf-accent); border-bottom-color: var(--ztf-accent); font-weight: 600; }

.ztf-sb-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 6px 10px; display: flex; flex-direction: column; gap: 4px; }
.ztf-sb-group-head {
  display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px;
  width: 100%; box-sizing: border-box; border: 0; background: transparent; text-align: start;
  font: inherit; font-size: 11px; font-weight: 600; color: var(--ztf-muted); user-select: none;
}
button.ztf-sb-group-head { cursor: pointer; }
button.ztf-sb-group-head:hover { background: var(--ztf-hover); color: var(--ztf-text); }
.ztf-sb-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ztf-group-dot); }
.ztf-sb-group > .ztf-group-edit { width: 100%; max-width: none; height: 24px; }
.ztf-sb-group-body { display: flex; flex-direction: column; gap: 1px; padding-left: 2px; }

.ztf-sb-row {
  display: flex; align-items: center; gap: 7px; min-height: var(--ztf-row-height, 38px);
  padding: 4px 8px; border-radius: 5px; cursor: pointer; border-left: 2px solid transparent;
}
.ztf-sb-row:hover { background: var(--ztf-hover); }
.ztf-sb-row.selected { background: var(--ztf-accent-soft); border-left-color: var(--ztf-accent); }
.ztf-sb-row.sleeping { opacity: 0.65; }
.ztf-sb-row.virtual { opacity: 0.62; }
.ztf-sb-row[data-ztf-drop="join"] { outline: 2px solid var(--ztf-accent); outline-offset: -2px; }
.ztf-sb-row[data-ztf-drop="before"] { box-shadow: inset 0 2px 0 0 var(--ztf-accent); }
.ztf-sb-row[data-ztf-drop="after"] { box-shadow: inset 0 -2px 0 0 var(--ztf-accent); }
.ztf-sb-group-head-row { display: flex; align-items: center; gap: 2px; }
.ztf-sb-group-head-row > .ztf-sb-group-head { flex: 1; min-width: 0; }
.ztf-sb-col-group-btn { border: 0; background: transparent; color: var(--ztf-muted); cursor: pointer; padding: 2px 5px; border-radius: 4px; font-size: 12px; flex: none; }
.ztf-sb-col-group-btn:hover { background: var(--ztf-hover); color: var(--ztf-accent); }
.ztf-sb-row-icon { color: var(--ztf-muted); flex: none; display: inline-flex; }
.ztf-sb-row.selected .ztf-sb-row-icon { color: var(--ztf-accent); }
.ztf-sb-row-text { min-width: 0; flex: 1; }
.ztf-sb-row-title { font-size: var(--ztf-font-size, 13px); line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ztf-sb-row-sub { font-size: 11px; color: var(--ztf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ztf-sb-row-action {
  display: none; align-items: center; justify-content: center; width: 22px; height: 22px;
  border: 0; border-radius: 4px; background: transparent; color: var(--ztf-muted); cursor: pointer; flex: none;
}
.ztf-sb-row:hover .ztf-sb-row-action, .ztf-sb-row.selected .ztf-sb-row-action { display: inline-flex; }
.ztf-sb-row-action:hover { background: var(--ztf-hover); color: var(--ztf-accent); }

.ztf-batch-controls {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; padding: 5px 8px;
  border-bottom: 1px solid var(--ztf-border); font-size: 11px;
}
.ztf-batch-controls[hidden], .ztf-sb-header-actions button[hidden] { display: none; }
.ztf-batch-controls button, .ztf-batch-controls select, .ztf-sb-header-actions > button[data-l10n-id] {
  box-sizing: border-box; min-height: 22px; min-width: 0; max-width: 100%; padding-inline: 5px;
  border: 1px solid var(--ztf-border); border-radius: 4px;
  color: var(--ztf-text); background: var(--ztf-card); font: 11px system-ui, sans-serif;
}
.ztf-sb-header-actions button[aria-pressed="true"] { background: var(--ztf-accent-soft); }
.ztf-batch-controls :disabled { opacity: .55; }
.ztf-batch-target { display: flex; align-items: center; flex: none; cursor: pointer; }
.ztf-batch-check { margin: 0; accent-color: var(--ztf-accent); }

/* Hover Preview Card */
#ztf-hover-card {
  position: fixed; z-index: 2147483647; width: 316px; padding: 10px 12px; border-radius: 8px;
  background: var(--ztf-card); color: var(--ztf-text); border: 1px solid var(--ztf-border);
  box-shadow: 0 8px 24px rgba(0,0,0,0.16); pointer-events: none; font: 12px/1.5 system-ui, sans-serif;
}
.ztf-hc-title { font-weight: 600; margin-bottom: 3px; line-height: 1.4; }
.ztf-hc-meta { color: var(--ztf-muted); font-size: 11px; }
.ztf-hc-note { margin-top: 5px; padding: 4px 7px; border-radius: 5px; background: var(--ztf-accent-soft); color: var(--ztf-accent); font-size: 11px; }

/* Spotlight Command Palette */
.ztf-spot-box { width: 540px; max-width: calc(100vw - 32px); padding: 10px; font: 13px system-ui, sans-serif; color: var(--ztf-text); }
.ztf-spot-input { width: 100%; box-sizing: border-box; padding: 8px 11px; border: 1px solid var(--ztf-border); border-radius: 7px; background: var(--ztf-card); color: var(--ztf-text); font: inherit; margin-bottom: 8px; outline: none; }
.ztf-spot-input:focus { border-color: var(--ztf-accent); }
.ztf-spot-results { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
.ztf-spot-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; border: 1px solid transparent; background: transparent; color: var(--ztf-text); padding: 7px 10px; border-radius: 6px; cursor: pointer; text-align: start; font: inherit; }
.ztf-spot-row.active, .ztf-spot-row:hover { background: var(--ztf-accent-soft); border-color: color-mix(in srgb, var(--ztf-accent) 40%, transparent); }
.ztf-spot-main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ztf-spot-hint { color: var(--ztf-muted); font-size: 11px; flex: none; }
.ztf-spot-empty { padding: 14px; text-align: center; color: var(--ztf-muted); }

/* Sidebar Keyboard Focus, Status Footer & Empty State */
.ztf-sb-row:focus-visible, button.ztf-sb-group-head:focus-visible {
  outline: 2px solid var(--ztf-accent); outline-offset: -2px;
}
.ztf-sb-status-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;
  padding: 6px 8px; border-top: 1px solid var(--ztf-border); background: var(--ztf-surface);
  font-size: 11px; color: var(--ztf-muted);
}
.ztf-sb-budget-warn {
  border: 1px solid color-mix(in srgb, #dc2626 40%, transparent); background: color-mix(in srgb, #dc2626 10%, transparent);
  color: light-dark(#b91c1c, #fca5a5); border-radius: 4px; padding: 2px 6px; font: 11px system-ui, sans-serif; cursor: pointer;
}
.ztf-sb-empty { padding: 24px 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ztf-sb-empty-msg { font-size: 12px; color: var(--ztf-muted); }
.ztf-sb-empty-btn {
  border: 1px solid var(--ztf-border); background: var(--ztf-card); color: var(--ztf-text);
  border-radius: 6px; padding: 5px 12px; font: 12px system-ui, sans-serif; cursor: pointer;
}
.ztf-sb-empty-btn:hover { background: var(--ztf-hover); }

/* Session Restore / Workspace Hub Modal */
#ztf-preview-backdrop, #ztf-preview-backdrop *, #ztf-hub-backdrop, #ztf-hub-backdrop * { -moz-window-dragging: no-drag; }
#ztf-preview-backdrop, #ztf-hub-backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  display: flex; align-items: flex-start; justify-content: center; padding-top: 68px;
  background: light-dark(rgba(15, 23, 42, 0.28), rgba(0, 0, 0, 0.52));
}
.ztf-preview-box, .ztf-hub-box {
  width: 440px; max-width: calc(100vw - 32px); max-height: calc(100vh - 104px); overflow-y: auto;
  padding: 16px 18px; border-radius: 10px;
  background: var(--ztf-card); color: var(--ztf-text);
  border: 1px solid var(--ztf-border); box-shadow: 0 18px 46px rgba(0, 0, 0, 0.28);
  font: 13px/1.5 system-ui, "Microsoft YaHei UI", sans-serif; display: flex; flex-direction: column; gap: 10px;
}
.ztf-hub-box { width: 560px; }
.ztf-hub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ztf-hub-title { font-size: 14px; font-weight: 600; }
.ztf-hub-close { border: 0; background: transparent; color: var(--ztf-muted); cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
.ztf-hub-close:hover { background: var(--ztf-hover); color: var(--ztf-text); }
.ztf-hub-body { display: flex; flex-direction: column; gap: 12px; }
.ztf-hub-quickbar { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 8px; border: 1px solid var(--ztf-border); background: var(--ztf-surface); }
.ztf-hub-input { width: 100%; box-sizing: border-box; height: 28px; padding: 0 9px; border: 1px solid var(--ztf-border); border-radius: 6px; background: var(--ztf-card); color: var(--ztf-text); font: 12px system-ui, sans-serif; outline: none; }
.ztf-hub-input:focus { border-color: var(--ztf-accent); }
.ztf-hub-quick-actions, .ztf-hub-card-actions { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.ztf-hub-section { display: flex; flex-direction: column; gap: 6px; }
.ztf-hub-sec-head { display: flex; align-items: center; justify-content: space-between; }
.ztf-hub-sec-title { font-size: 12px; font-weight: 600; color: var(--ztf-muted); }
.ztf-hub-empty { font-size: 12px; color: var(--ztf-muted); padding: 8px 10px; border-radius: 7px; border: 1px dashed var(--ztf-border); }
.ztf-hub-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--ztf-border); background: var(--ztf-surface); }
.ztf-hub-card-info { min-width: 0; flex: 1; }
.ztf-hub-card-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ztf-hub-card-meta { font-size: 11px; color: var(--ztf-muted); }
.ztf-hub-btn { height: 25px; padding: 0 9px; border: 1px solid var(--ztf-border); border-radius: 5px; background: var(--ztf-card); color: var(--ztf-text); font: 11.5px system-ui, sans-serif; cursor: pointer; }
.ztf-hub-btn:hover:not(:disabled) { background: var(--ztf-hover); }
.ztf-hub-btn:disabled { opacity: 0.45; cursor: default; }
.ztf-hub-btn.primary { background: var(--ztf-accent); border-color: var(--ztf-accent); color: #fff; font-weight: 600; }
.ztf-hub-btn.danger:hover:not(:disabled) { color: light-dark(#b91c1c, #f87171); border-color: color-mix(in srgb, #dc2626 40%, transparent); }
.ztf-pv-title { font-size: 14px; font-weight: 600; }
.ztf-pv-modes { display: flex; gap: 6px; }
.ztf-pv-mode { flex: 1; height: 28px; border: 1px solid var(--ztf-border); border-radius: 6px; background: var(--ztf-card); color: var(--ztf-muted); font: 12px system-ui, sans-serif; cursor: pointer; }
.ztf-pv-mode.active { border-color: var(--ztf-accent); background: var(--ztf-accent-soft); color: var(--ztf-accent); font-weight: 600; }
.ztf-pv-stats { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 7px; border: 1px solid var(--ztf-border); background: var(--ztf-surface); }
.ztf-pv-stat-row { display: flex; justify-content: space-between; font-size: 12px; }
.ztf-pv-stat-label { color: var(--ztf-muted); }
.ztf-pv-note { font-size: 12px; color: var(--ztf-muted); }
.ztf-pv-missing { padding: 6px 10px; border-radius: 6px; background: color-mix(in srgb, #d97706 10%, transparent); font-size: 11px; }
.ztf-pv-missing-head { font-weight: 600; margin-bottom: 3px; }
.ztf-pv-missing-item { font-family: monospace; color: var(--ztf-muted); }
.ztf-pv-check-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; cursor: pointer; }
.ztf-pv-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
.ztf-pv-btn { height: 28px; padding: 0 12px; border: 1px solid var(--ztf-border); border-radius: 6px; background: var(--ztf-card); color: var(--ztf-text); font: 12px system-ui, sans-serif; cursor: pointer; }
.ztf-pv-btn.primary { background: var(--ztf-accent); border-color: var(--ztf-accent); color: #fff; font-weight: 600; }
`;

  // src/index.ts
  var WindowWorkspace = class {
    constructor(win, store) {
      this.win = win;
      this.store = store;
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
        const latest = this.store.state.sessions[0] || this.store.state.rollingSessions?.[0];
        if (latest) void this.popovers.previewAndRestoreSession(latest);
      });
    }
    styleEl = null;
    meta;
    actions;
    tracker;
    tabMenus;
    itemMenus;
    popovers;
    spotlight;
    horizontal;
    sidebar;
    notifierID = null;
    observer = null;
    refreshTimer = null;
    ageTimer = null;
    lastSelected = "";
    disposed = false;
    ageTickCount = 0;
    saveRollingIfNeeded() {
      if (!getPref("enableRollingSnapshots")) return;
      const keys = this.meta.buildTrackedTabs().map((t2) => t2.key);
      if (keys.length || this.store.state.groups.length) {
        this.store.saveRollingSnapshot(keys);
      }
    }
    init() {
      const doc = this.win.document;
      if (!this.win.Zotero_Tabs) return;
      this.win.MozXULElement?.insertFTLIfNeeded?.("zotero-tabflow.ftl");
      const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "ztf-workspace-style";
      style.textContent = WORKSPACE_CSS;
      doc.documentElement?.append(style);
      this.styleEl = style;
      this.spotlight.init();
      this.itemMenus.attach();
      this.notifierID = Zotero.Notifier.registerObserver(
        {
          notify: (event, _type, ids) => {
            const tabIds = ids.map(String);
            if (event === "add") {
              if (this.store.state.collapsed.length) {
                const added = new Set(tabIds);
                for (const tab of this.meta.getNativeTabs()) {
                  if (tab.type === "library" || !added.has(tab.id)) continue;
                  const groupId = this.store.groupOfKey(this.meta.tabKey(tab));
                  if (this.store.state.collapsed.includes(groupId)) this.store.setCollapsed(groupId, false, false);
                }
              }
              if (getPref("enableCollectionAutoGroup")) {
                this.win.setTimeout(() => {
                  if (!this.disposed) this.actions.autoGroupByCollection(tabIds);
                }, 80);
              }
            }
            this.schedule();
          }
        },
        ["tab"],
        "zotero-tabflow"
      );
      this.refresh();
      const host = doc.getElementById("tab-bar-container");
      if (host) {
        this.observer = new this.win.MutationObserver((records) => {
          const inline = doc.getElementById("ztf-inline");
          const pinned = doc.querySelector(".ztf-pinned-strip");
          const actionsBar = doc.getElementById("ztf-toolbar-actions");
          const isExternal = records.some((r) => {
            const target = r.target;
            return !inline?.contains(target) && !pinned?.contains(target) && !actionsBar?.contains(target);
          });
          if (isExternal) this.schedule();
        });
        this.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-id"] });
      }
      this.ageTimer = this.win.setInterval(() => {
        for (const t2 of this.tracker.getIdleTabsForSleep()) {
          this.actions.sleepTab(t2.tab.id);
        }
        this.ageTickCount++;
        if (this.ageTickCount % 5 === 0) this.saveRollingIfNeeded();
        this.schedule();
      }, 6e4);
    }
    schedule() {
      if (this.disposed || this.refreshTimer !== null) return;
      this.refreshTimer = this.win.setTimeout(() => {
        this.refreshTimer = null;
        this.refresh();
      }, 0);
    }
    refresh() {
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
        const active = tracked.find((t2) => t2.tab.id === this.lastSelected);
        if (active && this.store.state.collapsed.includes(active.groupId)) {
          this.store.setCollapsed(active.groupId, false, false);
        }
      }
      this.sidebar.render(tracked);
      this.horizontal.render(tracked);
    }
    dispose() {
      this.disposed = true;
      try {
        this.saveRollingIfNeeded();
      } catch {
      }
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
  };
  var TabFlowPlugin = class {
    id = "";
    version = "";
    rootURI = "";
    _ftlRegistered = false;
    store = new TabFlowStore();
    windows = /* @__PURE__ */ new Map();
    pdfFolderSection = new PdfFolderSectionController();
    prefObserverIDs = [];
    unsubscribeStore = null;
    init(info) {
      this.id = info.id;
      this.version = info.version;
      this.rootURI = info.rootURI;
    }
    start() {
      this.store.load();
      this.pdfFolderSection.register(this.id, this.rootURI);
      this.unsubscribeStore = this.store.subscribe(() => this.refreshAll());
      this.prefObserverIDs = Object.keys(DEFAULT_PREFS).map(
        (key) => Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => this.refreshAll(), true)
      );
      for (const win of this.getMainWindows()) this.onMainWindowLoad(win);
    }
    reloadState() {
      this.store.load();
      this.refreshAll();
    }
    refreshAll() {
      for (const ws of this.windows.values()) ws.schedule();
    }
    onMainWindowLoad(win) {
      if (this.windows.has(win) || !win.Zotero_Tabs) return;
      const ws = new WindowWorkspace(win, this.store);
      this.windows.set(win, ws);
      ws.init();
    }
    onMainWindowUnload(win) {
      const ws = this.windows.get(win);
      if (!ws) return;
      ws.dispose();
      this.windows.delete(win);
    }
    shutdown() {
      this.pdfFolderSection.unregister();
      for (const id of this.prefObserverIDs) Zotero.Prefs.unregisterObserver(id);
      this.prefObserverIDs = [];
      this.unsubscribeStore?.();
      this.unsubscribeStore = null;
      for (const ws of this.windows.values()) ws.dispose();
      this.windows.clear();
    }
    getMainWindows() {
      if (typeof Zotero.getMainWindows === "function") return Zotero.getMainWindows();
      const out = [];
      const en = Services.wm.getEnumerator(null);
      while (en.hasMoreElements()) {
        const w = en.getNext();
        if (w?.Zotero_Tabs) out.push(w);
      }
      return out;
    }
  };
  Zotero.zoterotabflow = new TabFlowPlugin();
})();
