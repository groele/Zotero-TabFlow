/* Zotero TabFlow - Unified horizontal & vertical tab workspace for Zotero 10-12. */
"use strict";
(() => {
  // src/core/i18n.ts
  var syncBundle = null;
  var staticCache = /* @__PURE__ */ new Map();
  function resetI18nCache() {
    staticCache.clear();
    syncBundle = null;
  }
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
    if (!args && staticCache.has(id)) return staticCache.get(id);
    try {
      const val = getBundle()?.formatValueSync?.(id, args);
      if (typeof val === "string" && val.trim()) {
        if (!args && staticCache.size < 400) staticCache.set(id, val);
        return val;
      }
    } catch {
    }
    if (!args) return fallback;
    return fallback.replace(/\{\s*\$([a-zA-Z0-9_]+)\s*\}/g, (_m, k) => String(args[k] ?? ""));
  }

  // src/core/prefs.ts
  var PREF_PREFIX = "extensions.zotero.tabflow.";
  var DEFAULT_PREFS = {
    enableHorizontalGroups: true,
    horizontalTabCompactMode: "auto",
    compactTopBar: false,
    enableVerticalSidebar: true,
    enableBatchSelection: true,
    enablePinnedTabs: true,
    pinnedIconOnly: false,
    enableVirtualMembers: true,
    newTabMode: "independent",
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
    pdfFolderOpenMode: "reveal",
    enablePdfPreviewSidenav: true,
    pdfPreviewMode: "section",
    pdfPreviewDefaultZoom: 100,
    pdfPreviewDoubleClickOpen: true,
    pdfPreviewShowPageBadge: true,
    enableReloadTab: true,
    debug: false
  };
  var prefCacheEnabled = false;
  var prefCache = /* @__PURE__ */ new Map();
  function enablePrefCache(active) {
    prefCacheEnabled = active;
    prefCache.clear();
  }
  function invalidatePrefCache(key) {
    if (key) prefCache.delete(key);
    else prefCache.clear();
  }
  function getPref(key) {
    if (prefCacheEnabled && prefCache.has(key)) return prefCache.get(key);
    const raw = Zotero?.Prefs?.get?.(PREF_PREFIX + key, true);
    const fallback = DEFAULT_PREFS[key];
    let val = typeof raw !== typeof fallback ? fallback : raw;
    if (key === "newTabMode" && raw !== "collection" && raw !== "independent") val = fallback;
    if (key === "pdfPreviewMode" && raw !== "section" && raw !== "full") val = fallback;
    if (key === "pdfFolderOpenMode" && raw !== "reveal" && raw !== "folder") val = fallback;
    const range = NUMERIC_RANGES[key];
    if (range && typeof raw === "number") {
      val = Number.isFinite(raw) ? Math.max(range[0], Math.min(range[1], Math.trunc(raw))) : fallback;
    }
    if (prefCacheEnabled) prefCache.set(key, val);
    return val;
  }
  var NUMERIC_RANGES = {
    verticalSidebarWidth: [200, 440],
    verticalTabRowHeight: [32, 80],
    verticalTabFontSize: [10, 22],
    autoSleepMinutes: [0, 1440],
    activeReaderBudget: [0, 100],
    staleSuggestDays: [1, 3650],
    pdfPreviewDefaultZoom: [60, 200]
  };
  function setPref(key, value) {
    prefCache.delete(key);
    Zotero.Prefs.set(PREF_PREFIX + key, value, true);
  }
  function migrateNewTabMode() {
    const key = PREF_PREFIX + "newTabMode";
    if (!Services.prefs.prefHasUserValue(key) && Zotero.Prefs.get(PREF_PREFIX + "enableCollectionAutoGroup", true) === true) {
      setPref("newTabMode", "collection");
    }
  }

  // src/core/color-utils.ts
  function normalizeHexColor(value) {
    const hex = String(value).trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return `#${[...hex].map((c) => c + c).join("").toLowerCase()}`;
    }
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
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
      ungroupedHeadingHidden: state.ungroupedHeadingHidden,
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
      collapsed: snap.collapsed,
      remarks: snap.remarks,
      ungroupedName: snap.ungroupedName,
      ungroupedColor: snap.ungroupedColor,
      ungroupedHeadingHidden: snap.ungroupedHeadingHidden
    });
  }
  function appendManualSession(state, snap) {
    state.sessions = [snap, ...state.sessions].slice(0, MAX_MANUAL_SESSIONS);
  }
  function stripSessionTimestamp(name) {
    return name.trim().replace(/\s*·\s*\d{2}:\d{2}$/, "").trim();
  }
  function isMatchingSession(s, name, kind) {
    const normKind = s.kind || "manual";
    if (normKind !== kind) return false;
    const trimmed = name.trim();
    if (s.name.trim() === trimmed) return true;
    const base = stripSessionTimestamp(trimmed);
    if (!base || ["工作区会话", "Workspace Session", "布局模板", "Layout Template"].includes(base)) return false;
    return stripSessionTimestamp(s.name) === base;
  }
  function findMatchingSessionIndex(state, name, kind = "manual") {
    const trimmed = name.trim();
    const exact = state.sessions.findIndex((s) => (s.kind || "manual") === kind && s.name.trim() === trimmed);
    return exact >= 0 ? exact : state.sessions.findIndex((s) => isMatchingSession(s, trimmed, kind));
  }
  function upsertManualSession(state, snap) {
    const kind = snap.kind || "manual";
    const idx = findMatchingSessionIndex(state, snap.name, kind);
    const next = idx >= 0 ? { ...snap, id: state.sessions[idx].id } : snap;
    const rest = idx >= 0 ? state.sessions.filter((s) => !isMatchingSession(s, snap.name, kind)) : state.sessions;
    state.sessions = [next, ...rest].slice(0, MAX_MANUAL_SESSIONS);
    return next;
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
      if (!state.ungroupedName && snapshot.ungroupedName) state.ungroupedName = snapshot.ungroupedName;
      if (state.ungroupedColor === "#737373" && snapshot.ungroupedColor) state.ungroupedColor = snapshot.ungroupedColor;
    } else {
      state.collapsed = (snapshot.collapsed ?? []).filter((id) => validIds.has(id));
      state.ungroupedName = snapshot.ungroupedName;
      state.ungroupedColor = snapshot.ungroupedColor ?? "#737373";
      state.ungroupedHeadingHidden = snapshot.ungroupedHeadingHidden === true;
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
    if (!merge && snapshot.kind !== "template") {
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
  function buildGroupSessionSnapshot(state, name, groupId, openKeys) {
    const targetGroup = groupId ? state.groups.find((g) => g.id === groupId) : { id: `g-exp-${Date.now().toString(36)}`, name: state.ungroupedName || name.trim().slice(0, 60) || t("zotero-tabflow-saved-ungrouped-name", "未分组文献"), color: state.ungroupedColor || "#737373" };
    const exportedId = targetGroup?.id || groupId;
    const validIds = new Set(state.groups.map((g) => g.id));
    const belongs = (key) => groupId ? state.assignments[key] === groupId : !validIds.has(state.assignments[key] || "");
    const scopedOpen = [...new Set(openKeys)].filter(belongs);
    const scopedVirtual = Object.values(state.virtualMembers).filter((m) => belongs(m.key)).map(({ itemID, parentItemID, ...portable }) => portable);
    const scopedKeys = /* @__PURE__ */ new Set([...scopedOpen, ...scopedVirtual.map((m) => m.key)]);
    for (const k of Object.keys(state.assignments)) if (belongs(k)) scopedKeys.add(k);
    const assignments = Object.fromEntries([...scopedKeys].map((k) => [k, exportedId]));
    const remarks = {};
    for (const k of scopedKeys) if (state.remarks[k]) remarks[k] = { ...state.remarks[k] };
    const now = Date.now();
    return {
      id: `s-${now}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim().slice(0, 60) || targetGroup?.name || t("zotero-tabflow-session-default-name", "工作区会话"),
      createdAt: now,
      groups: targetGroup ? [{ ...targetGroup }] : [],
      assignments,
      pinned: state.pinned.filter((k) => scopedKeys.has(k)),
      openKeys: scopedOpen,
      virtualMembers: scopedVirtual,
      order: targetGroup ? [targetGroup.id] : [],
      collapsed: [],
      remarks,
      kind: "manual",
      scopedGroupId: groupId
    };
  }
  function updateExistingSession(state, id, openKeys) {
    const idx = state.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return null;
    const current = state.sessions[idx];
    const next = current.scopedGroupId !== void 0 ? buildGroupSessionSnapshot(state, current.name, current.scopedGroupId, openKeys) : buildSessionSnapshot(state, current.name, openKeys, current.kind === "template" ? "template" : "manual");
    const updated = { ...next, id: current.id, name: current.name, scopedGroupId: current.scopedGroupId };
    state.sessions[idx] = updated;
    return updated;
  }
  function renameExistingSession(state, id, name) {
    const clean = name.trim().slice(0, 60);
    const target = clean ? state.sessions.find((s) => s.id === id) : null;
    if (!target) return false;
    target.name = clean;
    return true;
  }
  function pruneHistory(state, openKeys, maxOrphanEntries = 500, maxAgeMs = 180 * 864e5, now = Date.now()) {
    const keep = /* @__PURE__ */ new Set([
      ...openKeys,
      ...state.pinned,
      ...Object.keys(state.virtualMembers),
      ...Object.keys(state.assignments),
      ...Object.keys(state.remarks)
    ]);
    const cutoff = now - maxAgeMs;
    const orphans = [];
    let removed = 0;
    for (const [key, act] of Object.entries(state.history)) {
      if (keep.has(key)) continue;
      const ts = act?.lastViewed ?? act?.firstSeen ?? 0;
      if (!ts || ts < cutoff) {
        delete state.history[key];
        removed++;
      } else {
        orphans.push([key, ts]);
      }
    }
    if (orphans.length > maxOrphanEntries) {
      orphans.sort((a, b) => b[1] - a[1]);
      for (const [key] of orphans.slice(maxOrphanEntries)) {
        delete state.history[key];
        removed++;
      }
    }
    return removed;
  }

  // src/core/types.ts
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

  // src/core/store.ts
  var STATE_PREF = `${PREF_PREFIX}state`;
  var AUTO_COLORS = ["#3977d5", "#8b5ac7", "#21866a", "#dc8225", "#c74646", "#298c9b", "#d064a3"];
  var TabFlowStore = class {
    state = createEmptyState();
    readOnly = false;
    listeners = /* @__PURE__ */ new Set();
    saveTimer = null;
    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
    notify() {
      for (const fn of this.listeners) fn();
    }
    load() {
      if (this.saveTimer !== null) {
        globalThis.clearTimeout?.(this.saveTimer);
        this.saveTimer = null;
      }
      const raw = Zotero.Prefs.get(STATE_PREF, true);
      if (raw === "" || raw == null) {
        this.state = createEmptyState();
        this.readOnly = false;
        return;
      }
      try {
        if (typeof raw !== "string") throw new Error("Invalid Zotero TabFlow preference type");
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
          ungroupedHeadingHidden: parsed.ungroupedHeadingHidden === true,
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
      if (this.saveTimer !== null) {
        globalThis.clearTimeout?.(this.saveTimer);
        this.saveTimer = null;
      }
      if (this.readOnly) return;
      Zotero.Prefs.set(STATE_PREF, JSON.stringify(this.state), true);
      if (emit) this.notify();
    }
    scheduleSave(delayMs = 1200) {
      if (this.readOnly || this.saveTimer !== null) return;
      const st = globalThis.setTimeout;
      if (typeof st !== "function" || delayMs <= 0) {
        this.save(false);
        return;
      }
      this.saveTimer = st(() => {
        this.saveTimer = null;
        this.save(false);
      }, delayMs);
    }
    flushPendingSave() {
      if (this.saveTimer !== null) this.save(false);
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
      return this.orderedGroups();
    }
    ensureGroup(name, persist = true) {
      const clean = name.trim().slice(0, 60) || t("zotero-tabflow-default-group-name", "新分组");
      const existing = this.state.groups.find((g) => g.name === clean);
      if (existing) return existing;
      const group = this.addGroup(clean, AUTO_COLORS[this.state.groups.length % AUTO_COLORS.length]);
      if (persist) this.save();
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
      if (!id) return this.setUngroupedHeadingHidden(true);
      if (this.readOnly || !this.state.groups.some((group) => group.id === id)) return false;
      this.state.groups = this.state.groups.filter((group) => group.id !== id);
      this.state.assignments = Object.fromEntries(Object.entries(this.state.assignments).filter(([, groupId]) => groupId !== id));
      this.state.order = this.state.order.filter((x) => x !== id);
      this.state.collapsed = this.state.collapsed.filter((x) => x !== id);
      delete this.state.groupDisplay[id];
      this.save();
      return true;
    }
    setUngroupedHeadingHidden(hidden) {
      if (this.readOnly || Boolean(this.state.ungroupedHeadingHidden) === hidden) return false;
      this.state.ungroupedHeadingHidden = hidden;
      this.setCollapsed("", false);
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
    collapseOtherGroups(keepId) {
      const others = this.visibleGroups().filter((g) => g.id !== keepId).map((g) => g.id);
      this.state.collapsed = [.../* @__PURE__ */ new Set([...others])];
      this.save();
    }
    groupOfKey(key) {
      if (!key) return "";
      const id = this.state.assignments[key];
      return this.state.groups.some((g) => g.id === id) ? id : "";
    }
    assignKey(key, groupId) {
      this.assignKeys([key], groupId);
    }
    assignKeys(keys, groupId, persist = true) {
      if (!keys.length) return;
      if (groupId && !this.state.groups.some((g) => g.id === groupId)) return;
      for (const key of keys) {
        if (groupId) this.state.assignments[key] = groupId;
        else delete this.state.assignments[key];
      }
      this.state.collapsed = this.state.collapsed.filter((id) => id !== groupId);
      if (persist) this.save();
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
      for (const item of typeof key === "string" ? [key] : key) {
        if (sleeping) set.add(item);
        else set.delete(item);
      }
      if (set.size === this.state.sleeping.length) return;
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
      const saved = upsertManualSession(this.state, snapshot);
      this.save();
      return saved;
    }
    saveGroupSession(name, groupId, openKeys) {
      const snapshot = buildGroupSessionSnapshot(this.state, name, groupId, openKeys);
      const saved = upsertManualSession(this.state, snapshot);
      this.save();
      return saved;
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
      const saved = upsertManualSession(this.state, snapshot);
      this.save();
      return saved;
    }
    saveRollingSnapshot(openKeys) {
      if (this.readOnly || !getPref("enableSessions") || !getPref("enableRollingSnapshots")) return null;
      const pruned = pruneHistory(this.state, openKeys);
      const stamp = formatSnapshotTimestamp(Date.now());
      const label = `${t("zotero-tabflow-rolling-prefix", "自动快照")} · ${stamp}`;
      const snapshot = buildSessionSnapshot(this.state, label, openKeys, "rolling");
      if (!appendRollingSnapshot(this.state, snapshot)) {
        if (pruned > 0) this.scheduleSave();
        return null;
      }
      this.save(false);
      return snapshot;
    }
    importSessions(snapshots) {
      if (this.readOnly) return 0;
      let count = 0;
      const available = Math.max(0, MAX_MANUAL_SESSIONS - this.state.sessions.length);
      for (const snap of snapshots.slice(0, available).reverse()) {
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
      if (changed) this.store.scheduleSave();
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
    getIdleTabsForSleep(now = Date.now(), tracked) {
      if (!getPref("enableTabSleep")) return [];
      const mins = Math.max(0, Number(getPref("autoSleepMinutes")) || 0);
      if (mins <= 0) return [];
      const thresholdMs = mins * 6e4;
      const selected = this.meta.getSelectedTabID();
      return (tracked ?? this.meta.buildTrackedTabs()).filter((t2) => {
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
  var MAX_CACHE_ENTRIES = 600;
  var ItemMetadataService = class {
    win;
    store;
    titleCache = /* @__PURE__ */ new Map();
    itemFields = /* @__PURE__ */ new Map();
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
    invalidateItemFields(ids) {
      for (const id of ids) this.itemFields.delete(id);
    }
    getOpenKeys() {
      return this.getNativeTabs().filter((tab) => tab.type !== "library").map((tab) => this.tabKey(tab) ?? `tab:${tab.id}`);
    }
    resolvePrimaryItem(itemID) {
      if (typeof itemID !== "number") return null;
      const item = Zotero.Items.get(itemID);
      if (!item) return null;
      return item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
    }
    resolveCollectionName(item, activeIds, groupNames, uncategorized = uncategorizedCollectionLabel()) {
      if (!item) return uncategorized;
      const primary = item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
      const collectionIDs = primary.getCollections?.() || [];
      if (!collectionIDs.length) return uncategorized;
      const strategy = getPref("multiCollectionStrategy");
      if (strategy === "active") {
        if (activeIds) {
          for (const cid of collectionIDs) {
            if (activeIds.has(cid)) {
              const col = Zotero.Collections.get(cid);
              if (col) return String(col.name || uncategorized);
            }
          }
        } else {
          const activeCol = this.win.ZoteroPane?.getSelectedCollections?.()?.find(
            (collection) => collectionIDs.includes(collection.id)
          );
          if (activeCol) return String(activeCol.name || uncategorized);
        }
      }
      if (strategy === "existing") {
        const names = groupNames ?? new Set(this.store.state.groups.map((g) => g.name));
        for (const cid of collectionIDs) {
          const col = Zotero.Collections.get(cid);
          if (col && names.has(col.name)) return String(col.name);
        }
      }
      const first = Zotero.Collections.get(collectionIDs[0]);
      return first ? String(first.name) : uncategorized;
    }
    plainTitle(value) {
      const cached = this.titleCache.get(value);
      if (cached !== void 0) return cached;
      const render = Zotero.Utilities?.Internal?.renderItemTitle;
      let out;
      if (typeof render !== "function") {
        out = value.replace(/<[^>]*>/g, "");
      } else {
        const rendered = render.call(Zotero.Utilities.Internal, value);
        const text = typeof rendered === "string" ? rendered : String(rendered?.textContent ?? value);
        out = text.replace(/<[^>]*>/g, "");
      }
      if (this.titleCache.size >= MAX_CACHE_ENTRIES) this.titleCache.clear();
      this.titleCache.set(value, out);
      return out;
    }
    extractPrimaryFields(primary, fallbackTitle) {
      const stamp = typeof primary?.dateModified === "string" ? primary.dateModified : "";
      const id = typeof primary?.id === "number" ? primary.id : 0;
      const hit = id && stamp ? this.itemFields.get(id) : void 0;
      if (hit && hit.stamp === stamp) return hit;
      const rawTitle = primary?.getField?.("title");
      const title = this.plainTitle(String(rawTitle || fallbackTitle));
      const shortTitle = this.plainTitle(String(primary?.getField?.("shortTitle") || title));
      const source = String(
        primary?.getField?.("publicationTitle") || primary?.getField?.("proceedingsTitle") || primary?.getField?.("bookTitle") || primary?.getField?.("repository") || ""
      );
      const creators = primary?.getCreators?.() || [];
      const firstAuthor = creators[0]?.lastName || creators[0]?.firstName || "";
      const year = String(primary?.getField?.("year") || "").slice(0, 4);
      const fields = { stamp, title, shortTitle, source, creatorYear: [firstAuthor, year].filter(Boolean).join(", ") };
      if (id && stamp && rawTitle) {
        if (this.itemFields.size >= MAX_CACHE_ENTRIES) this.itemFields.clear();
        this.itemFields.set(id, fields);
      }
      return fields;
    }
    buildTrackedTabs(onlyTabIDs) {
      const enablePinned = getPref("enablePinnedTabs");
      const enableSleep = getPref("enableTabSleep");
      const strategy = getPref("multiCollectionStrategy");
      const { assignments, groups, pinned, sleeping } = this.store.state;
      const groupIds = new Set(groups.map((group) => group.id));
      const groupNames = strategy === "existing" ? new Set(groups.map((group) => group.name)) : void 0;
      const activeColIds = strategy === "active" ? new Set((this.win.ZoteroPane?.getSelectedCollections?.() || []).map((c) => c.id)) : void 0;
      const uncategorized = uncategorizedCollectionLabel();
      const pinnedKeys = new Set(enablePinned ? pinned : []);
      const sleepingKeys = new Set(enableSleep ? sleeping : []);
      const collections = /* @__PURE__ */ new Map();
      const untitled = t("zotero-tabflow-untitled", "无标题");
      return this.getNativeTabs().filter((t2) => t2.type !== "library" && (!onlyTabIDs || onlyTabIDs.has(t2.id))).map((tab) => {
        const itemID = typeof tab.data?.itemID === "number" ? tab.data.itemID : null;
        const rawItem = itemID ? Zotero.Items.get(itemID) : null;
        const key = rawItem ? `${rawItem.libraryID}:${rawItem.key}` : `tab:${tab.id}`;
        const primary = rawItem?.parentItemID ? Zotero.Items.get(rawItem.parentItemID) || rawItem : rawItem;
        const fields = this.extractPrimaryFields(primary, tab.title || untitled);
        const filename = String(rawItem?.isAttachment?.() ? rawItem.attachmentFilename || fields.title : fields.title);
        const collection = collections.get(primary?.id) ?? this.resolveCollectionName(primary, activeColIds, groupNames, uncategorized);
        if (primary) collections.set(primary.id, collection);
        const reader = sleepingKeys.has(key) ? Zotero.Reader?.getByTabID?.(tab.id) : null;
        const hostLoaded = Boolean(reader && reader.initialized !== false && !tab.data?.unloaded);
        return {
          tab,
          key,
          itemID,
          parentItemID: primary?.id ?? null,
          title: fields.title,
          shortTitle: fields.shortTitle,
          filename,
          source: fields.source,
          creatorYear: fields.creatorYear,
          collection,
          groupId: groupIds.has(assignments[key]) ? assignments[key] : "",
          pinned: pinnedKeys.has(key),
          status: tab.type.endsWith("-unloaded") || sleepingKeys.has(key) && !hostLoaded ? "sleeping" : "active"
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
    if (from < 1 || to < 0 || from === to) return -1;
    return Math.max(1, to + (after ? 1 : 0));
  }
  var TABFLOW_DRAG_MIME = "application/x-zotero-tabflow-tab";
  function hasMimeType(dt, mime) {
    const types = dt?.types;
    if (!types) return false;
    if (typeof types.contains === "function" && types.contains(mime)) return true;
    return typeof types[Symbol.iterator] === "function" && Array.from(types).includes(mime);
  }
  function hasTabFlowDraggedTab(dt) {
    return hasMimeType(dt, TABFLOW_DRAG_MIME) || Boolean(dt?.getData?.(TABFLOW_DRAG_MIME));
  }
  function hasZoteroDraggedItems(dt) {
    if (!dt) return false;
    if (hasMimeType(dt, "zotero/item")) return true;
    return parseZoteroDraggedItemIDs(dt).length > 0;
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
    try {
      const att = await resolveFileAttachment(item);
      if (!att) return false;
      const filePath = await att.getFilePathAsync?.() || att.getFilePath?.();
      const nsFile = filePath ? Zotero.File?.pathToFile?.(filePath) : null;
      const folder = nsFile?.parent?.path;
      const cacheKey = filePath || folder || String(att.id || "");
      if (cacheKey) {
        const now = Date.now();
        const prev = lastLaunched.get(cacheKey) ?? 0;
        if (now - prev < RECENT_LAUNCH_INTERVAL_MS) return true;
        lastLaunched.set(cacheKey, now);
      }
      try {
        const openMode = getPref("pdfFolderOpenMode");
        if (openMode === "folder" && folder && Zotero.launchFile) {
          await Zotero.launchFile(folder);
          return true;
        }
        if (nsFile && nsFile.exists?.() !== false && typeof nsFile.reveal === "function") {
          try {
            await Promise.resolve(nsFile.reveal());
            return true;
          } catch (error) {
            Zotero.logError(error instanceof Error ? error : new Error(String(error)));
          }
        }
        const targetWin = fallbackWin?.ZoteroPane ? fallbackWin : Zotero.getMainWindow?.();
        if (targetWin?.ZoteroPane?.showAttachmentInFilesystem) {
          await targetWin.ZoteroPane.showAttachmentInFilesystem(att.id);
          return true;
        }
        if (folder && Zotero.launchFile) {
          await Zotero.launchFile(folder);
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
  function resetFolderLaunchCache() {
    lastLaunched.clear();
  }

  // src/core/session-validation.ts
  function record(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
  function strings(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
  function isUsableSession(value) {
    if (!record(value)) return false;
    const { groups, assignments, pinned, openKeys, order, collapsed, virtualMembers, remarks } = value;
    if (typeof value.id !== "string" || typeof value.name !== "string" || !Number.isFinite(value.createdAt)) return false;
    if (!strings(openKeys) || !strings(pinned) || !record(assignments)) return false;
    if (!Array.isArray(groups) || !groups.every((group) => record(group) && typeof group.id === "string" && group.id && typeof group.name === "string" && typeof group.color === "string" && /^#[\da-f]{6}$/i.test(group.color))) return false;
    const groupIDs = new Set(groups.map((group) => group.id));
    if (groupIDs.size !== groups.length || !Object.values(assignments).every((id) => typeof id === "string")) return false;
    if (order !== void 0 && !strings(order) || collapsed !== void 0 && !strings(collapsed)) return false;
    if (virtualMembers !== void 0 && (!Array.isArray(virtualMembers) || !virtualMembers.every((member) => record(member) && ["key", "title", "shortTitle", "filename", "source", "creatorYear", "collection", "type"].every((key) => typeof member[key] === "string")))) return false;
    if (remarks !== void 0 && (!record(remarks) || !Object.values(remarks).every((remark) => record(remark) && typeof remark.note === "string" && ["original", "note", "both"].some((mode) => mode === remark.mode)))) return false;
    return true;
  }

  // src/services/session-restore.ts
  var SESSION_LOOKUP_CONCURRENCY = 6;
  async function mapWithConcurrency(items, limit, map) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await map(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }
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
  async function buildSessionRestorePlan(store, openKeysNow, session, merge, resolver = defaultResolver, onProgress, signal) {
    const openSet = new Set(openKeysNow);
    let alreadyOpenCount = 0;
    const toOpen = [];
    const missing = [];
    const virtualMembers = Array.isArray(session.virtualMembers) || session.kind === "template" ? [] : void 0;
    const resolved = /* @__PURE__ */ new Map();
    const openEntries = [...new Set(session.openKeys)];
    alreadyOpenCount = openEntries.filter((key) => openSet.has(key)).length;
    const members = sessionVirtualMembers(session);
    const total = openEntries.filter((key) => !openSet.has(key)).length + [...new Set(members.map((member) => member.key))].filter((key) => !openEntries.includes(key)).length;
    let completed = 0;
    onProgress?.(completed, total);
    const lookupEntries = openEntries.filter((key) => !openSet.has(key));
    const resolvedOpen = await mapWithConcurrency(lookupEntries, SESSION_LOOKUP_CONCURRENCY, async (fullKey) => {
      if (signal?.aborted) throw new DOMException("Session restore planning canceled", "AbortError");
      const parsed = parseItemFullKey(fullKey);
      const item = parsed ? await resolver(parsed.libraryID, parsed.itemKey) : null;
      resolved.set(fullKey, item);
      completed++;
      onProgress?.(completed, total);
      return { fullKey, parsed, item };
    });
    for (const { fullKey, parsed, item } of resolvedOpen) {
      if (!parsed) {
        missing.push({ fullKey, libraryID: 0, itemKey: fullKey });
        continue;
      }
      if (item && !item.deleted) {
        toOpen.push({ fullKey, ...parsed, itemID: item.id, title: item.getField?.("title") || fullKey });
      } else {
        missing.push({ fullKey, ...parsed });
      }
    }
    const missingKeys = new Set(missing.map((ref) => ref.fullKey));
    const seenVirtualKeys = /* @__PURE__ */ new Set();
    const memberKeys = /* @__PURE__ */ new Set();
    const uniqueMembers = members.filter((member) => {
      if (memberKeys.has(member.key)) return false;
      memberKeys.add(member.key);
      return true;
    });
    const resolvedMembers = await mapWithConcurrency(uniqueMembers, SESSION_LOOKUP_CONCURRENCY, async (member) => {
      if (signal?.aborted) throw new DOMException("Session restore planning canceled", "AbortError");
      if (resolved.has(member.key)) return { member, ref: parseItemFullKey(member.key), item: resolved.get(member.key) };
      const ref = parseItemFullKey(member.key);
      const item = ref ? await resolver(ref.libraryID, ref.itemKey) : null;
      resolved.set(member.key, item);
      completed++;
      onProgress?.(completed, total);
      return { member, ref, item };
    });
    for (const { member, ref, item } of resolvedMembers) {
      const fullKey = member.key;
      if (seenVirtualKeys.has(fullKey)) continue;
      seenVirtualKeys.add(fullKey);
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
    const result = { opened: 0, failed: 0 };
    if (isDisposed()) return result;
    if (store.readOnly) throw new Error("TabFlow state is read-only");
    const openKeys = new Set(openKeysNow);
    if (!plan.merge && plan.session.kind !== "pre-replace") {
      store.savePreReplaceSnapshot([...openKeysNow]);
    }
    store.restoreSessionLayout(plan.session, plan.merge, plan.virtualMembers);
    for (const ref of plan.toOpen) {
      if (isDisposed()) break;
      if (!ref.itemID || openKeys.has(ref.fullKey)) continue;
      try {
        if (await openItem(ref.itemID) === false) result.failed++;
        else result.opened++;
      } catch (error) {
        result.failed++;
        Zotero.logError(error);
      }
    }
    return result;
  }
  function buildPublicationGroupSuggestions(store, tracked) {
    const visibleGroups = new Map(store.visibleGroups().filter((g) => g.id).map((g) => [g.name, g.id]));
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
    return [...buckets.entries()].filter(([venue, b]) => visibleGroups.has(venue) || b.keys.length >= 2).map(([venue, b]) => ({
      venue,
      keys: b.keys,
      titles: b.titles,
      existingGroupId: visibleGroups.get(venue)
    })).sort((a, b) => b.keys.length - a.keys.length);
  }
  function applyPublicationGroupSuggestions(store, chosen) {
    for (const suggestion of chosen) {
      const visible = store.visibleGroups().find((group2) => group2.id && group2.name === suggestion.venue);
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
    if (!parsed.sessions.length || !parsed.sessions.every(isUsableSession)) {
      throw new Error("Session archive is empty or contains an invalid session");
    }
    const sessions = parsed.sessions;
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

  // src/services/tab-actions.ts
  function isTabBusyOrProtected(tab, reader, options, isPinned, selectedID) {
    if (options.protectPinned && isPinned) return true;
    if (options.protectSelected && tab.id === selectedID) return true;
    if (options.protectMedia) {
      if (tab.audioStatus?.active && !tab.audioStatus.paused || tab.data?.soundPlaying || reader?.soundPlaying || reader?._internalReader?.hasUnsavedChanges) {
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
  var TabActionService = class _TabActionService {
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
        const groupId = this.store.groupOfKey(key);
        if (this.store.state.collapsed.includes(groupId)) this.store.setCollapsed(groupId, false);
        void Promise.resolve(tabs.select(tabId)).catch((error) => Zotero.logError(error));
      }
    }
    async closeTab(tabId, preserveVirtual = true) {
      await this.closeTabs([tabId], { preserveVirtual, protectPinned: true, protectMedia: true });
    }
    async closeTabs(tabIds, options = {}) {
      const tabs = this.win.Zotero_Tabs;
      if (!tabs || !tabIds.length) return 0;
      const preserveVirtual = options.preserveVirtual ?? true;
      const selectedID = this.meta.getSelectedTabID();
      const nativeMap = new Map(this.meta.getNativeTabs().map((t2) => [t2.id, t2]));
      const trackedMap = new Map(this.meta.buildTrackedTabs().map((t2) => [t2.tab.id, t2]));
      const toClose = [];
      const backups = [];
      for (const id of new Set(tabIds)) {
        const tab = nativeMap.get(id);
        if (!tab || tab.type === "library") continue;
        const tracked = trackedMap.get(id);
        const reader = Zotero.Reader?.getByTabID?.(id);
        if (isTabBusyOrProtected(tab, reader, options, Boolean(tracked?.pinned), selectedID)) continue;
        if (tracked?.groupId && preserveVirtual && getPref("enableVirtualMembers")) {
          const member = toVirtualMember(tracked);
          if (member) backups.push(member);
        }
        toClose.push(id);
      }
      if (!toClose.length) return 0;
      try {
        tabs.close(toClose.length === 1 ? toClose[0] : toClose);
      } catch (error) {
        Zotero.logError(error);
        return 0;
      }
      if (backups.length) {
        for (const member of backups) this.store.state.virtualMembers[member.key] = member;
        this.store.save();
      }
      return toClose.length;
    }
    async archiveGroup(groupId, name) {
      if (this.store.readOnly || groupId && !this.store.state.groups.some((group) => group.id === groupId)) {
        throw new Error("Workspace cannot be archived");
      }
      if (this.store.state.sessions.length >= MAX_MANUAL_SESSIONS && findMatchingSessionIndex(this.store.state, name.trim().slice(0, 60), "manual") < 0) {
        throw new Error("Workspace capacity reached");
      }
      const windows = groupId ? [this.win, ...Zotero.getMainWindows?.() ?? []] : [this.win];
      const targets = [...new Set(windows)].map((win) => {
        const meta = win === this.win ? this.meta : new ItemMetadataService(win, this.store);
        const actions = win === this.win ? this : new _TabActionService(win, this.store, meta);
        return { meta, actions, tabs: meta.buildTrackedTabs().filter((tab) => tab.groupId === groupId) };
      });
      const members = Object.values(this.store.state.virtualMembers).filter((member) => this.store.groupOfKey(member.key) === groupId);
      const prior = this.store.state.sessions.find((session) => session.scopedGroupId === groupId && session.name === name.trim().slice(0, 60));
      this.store.saveGroupSession(name, groupId, [
        ...targets.flatMap(({ tabs }) => tabs.map((tab) => tab.key)),
        ...members.map((member) => member.key),
        ...prior?.openKeys ?? []
      ]);
      for (const { actions, tabs } of targets) {
        await actions.closeTabs(tabs.map((tab) => tab.tab.id), { preserveVirtual: false, protectMedia: true });
      }
      const remaining = targets.reduce((count, { meta }) => count + meta.buildTrackedTabs().filter((tab) => tab.groupId === groupId).length, 0);
      if (remaining) return remaining;
      for (const member of members) {
        if (this.store.state.virtualMembers[member.key] === member) delete this.store.state.virtualMembers[member.key];
      }
      if (groupId) this.store.dissolveGroup(groupId);
      else if (members.length) this.store.save();
      return 0;
    }
    undoCloseTab() {
      const tabs = this.win.Zotero_Tabs;
      if (typeof tabs?.undoClose !== "function") return false;
      try {
        void Promise.resolve(tabs.undoClose()).catch((error) => Zotero.logError(error));
        return true;
      } catch (error) {
        Zotero.logError(error);
        return false;
      }
    }
    sleepTab(tabId) {
      return this.sleepTabs([tabId]) > 0;
    }
    sleepTabs(tabIds) {
      if (!tabIds.length || !getPref("enableTabSleep")) return 0;
      const keys = [];
      for (const tabId of new Set(tabIds)) {
        const key = this.unloadTab(tabId);
        if (key) keys.push(key);
      }
      if (keys.length) this.store.setSleeping(keys, true);
      return keys.length;
    }
    unloadTab(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const key = this.meta.tabKey(tab);
      if (!tab || !key || tabId === this.meta.getSelectedTabID() || tab.type.endsWith("-unloaded")) return false;
      if (getPref("enablePinnedTabs") && this.store.isPinned(key)) return false;
      const tabs = this.win.Zotero_Tabs;
      try {
        const reader = Zotero.Reader?.getByTabID?.(tabId);
        if (typeof tabs?.unload !== "function" || tabs.canUnload?.(tabId) === false || isTabBusyOrProtected(tab, reader, { protectMedia: true }, false, "")) return false;
        tabs.unload(tabId);
      } catch (error) {
        Zotero.logError(error);
        return false;
      }
      const unloaded = this.meta.getNativeTabs().find((candidate) => candidate.id === tabId)?.type.endsWith("-unloaded") === true;
      return unloaded ? key : false;
    }
    sleepInactiveTabs() {
      if (!getPref("enableTabSleep")) return 0;
      const selected = this.meta.getSelectedTabID();
      return this.sleepTabs(this.meta.buildTrackedTabs().filter((t2) => t2.tab.id !== selected && !t2.pinned && t2.status === "active").map((t2) => t2.tab.id));
    }
    async openVirtualOrItem(itemID, groupId, openInBackground = false, keyFallback) {
      try {
        let item = itemID ? Zotero.Items.get(itemID) : null;
        if ((!item || item.deleted) && keyFallback) {
          const parsed = parseItemFullKey(keyFallback);
          if (parsed && typeof Zotero.Items.getByLibraryAndKeyAsync === "function") {
            item = await Zotero.Items.getByLibraryAndKeyAsync(parsed.libraryID, parsed.itemKey);
          }
        }
        if (!item || item.deleted) return false;
        const isNote = item.isNote?.() === true;
        const target = isNote || item.isAttachment() ? item : await item.getBestAttachment();
        if (!target || target.deleted) return false;
        const key = `${target.libraryID}:${target.key}`;
        const virtual = this.store.state.virtualMembers[key];
        const existing = this.meta.getNativeTabs().find((tab) => tab.data?.itemID === target.id);
        if (existing) {
          if (!openInBackground) this.selectTab(existing.id);
        } else if (isNote) {
          await Zotero.Notes.open(target.id, void 0, { openInBackground });
        } else {
          if (target.isFileAttachment() && !await target.fileExists()) return false;
          await Zotero.Reader.open(target.id, void 0, { openInBackground });
        }
        if (groupId !== void 0) this.store.assignKey(key, groupId);
        if (virtual && this.store.state.virtualMembers[key] === virtual) this.store.removeVirtualMember(key);
        return true;
      } catch (error) {
        Zotero.logError(error);
        return false;
      }
    }
    autoGroupNewTabs(tabIds) {
      return getPref("newTabMode") === "collection" && tabIds.size ? this.autoGroupByCollection(tabIds) : 0;
    }
    autoGroupByCollection(onlyTabIDs) {
      if (this.store.readOnly) return 0;
      const uncategorized = uncategorizedCollectionLabel();
      const byCollection = /* @__PURE__ */ new Map();
      for (const tab of this.meta.buildTrackedTabs(onlyTabIDs)) {
        const name = tab.collection.trim().slice(0, 60);
        if (!name || tab.groupId || tab.pinned || tab.key.startsWith("tab:") || name === uncategorized) continue;
        if (!byCollection.has(name)) byCollection.set(name, /* @__PURE__ */ new Set());
        byCollection.get(name).add(tab.key);
      }
      let moved = 0;
      for (const [name, keys] of byCollection) {
        const group = this.store.ensureGroup(name, false);
        this.store.assignKeys([...keys], group.id, false);
        moved += keys.size;
      }
      if (moved) this.store.save();
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
    async showCollectionInLibrary(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
      if (!primary) return false;
      const cols = primary.getCollections?.() || [];
      const pane = this.win.ZoteroPane;
      if (cols.length && pane?.collectionsView?.selectCollection) {
        const tabs = this.win.Zotero_Tabs;
        if (tabs && tabs.selectedID !== "zotero-pane") await tabs.select("zotero-pane");
        await pane.collectionsView.selectCollection(cols[0]);
        return Boolean(await pane.selectItem?.(primary.id));
      }
      await pane?.selectItem?.(primary.id);
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
          const format = qc.getFormatFromURL?.(qc.lastActiveURL) || Zotero.Prefs.get("export.quickCopy.setting");
          const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
          const content = qc.getContentFromItems(items, format, (translation, worked) => {
            if (worked && translation.string) helper.copyString(translation.string);
          });
          if (content?.text) helper.copyString(content.text);
        }
      } catch (error) {
        Zotero.logError(error);
      }
    }
    async reloadTab(tabId) {
      const tab = this.meta.getNativeTabs().find((t2) => t2.id === tabId);
      if (!tab || !tab.type.startsWith("reader")) return;
      if (tab.type === "reader-unloaded") {
        this.selectTab(tabId);
        return;
      }
      const reader = Zotero.Reader.getByTabID(tabId);
      if (isTabBusyOrProtected(tab, reader, { protectMedia: true }, false, "")) return;
      try {
        if (typeof reader?.reload === "function") await Reflect.apply(reader.reload, reader, []);
      } catch (error) {
        Zotero.logError(error);
      }
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
        const dt = e.dataTransfer;
        dt?.setData(TABFLOW_DRAG_MIME, tab.key);
        dt?.setData("text/plain", tab.key);
      };
      node.ondragover = (e) => {
        const dt = e.dataTransfer;
        if (!this.draggedKey && !hasTabFlowDraggedTab(dt)) return;
        if (this.draggedKey === tab.key) return;
        e.preventDefault();
        node.setAttribute("data-ztf-drop", "stack");
      };
      node.ondragleave = () => node.removeAttribute("data-ztf-drop");
      node.ondrop = (e) => {
        e.preventDefault();
        node.removeAttribute("data-ztf-drop");
        const draggedKey = this.draggedKey || e.dataTransfer?.getData(TABFLOW_DRAG_MIME) || "";
        if (!draggedKey || draggedKey === tab.key) return;
        const me = e;
        const rect = node.getBoundingClientRect();
        const ratio = rect.width > 0 ? (me.clientX - rect.left) / rect.width : 0.5;
        if (ratio < 0.25 || ratio > 0.75) {
          this.store.assignKey(draggedKey, tab.groupId);
          if (this.draggedTabId) {
            this.onMoveTab?.(this.draggedTabId, tab.tab.id, ratio > 0.75);
          }
        } else if (!tab.groupId) {
          const val = { value: tab.shortTitle.slice(0, 24) };
          if (Services.prompt.prompt(this.win, t("zotero-tabflow-stack-group-title", "叠放新建分组"), t("zotero-tabflow-stack-group-prompt", "将两篇文献合并到新分组："), val, null, {}) && val.value.trim()) {
            const g = this.store.ensureGroup(val.value, false);
            this.store.assignKeys([tab.key, draggedKey], g.id);
          }
        } else {
          this.store.assignKey(draggedKey, tab.groupId);
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
        e.dataTransfer?.setData("application/x-zotero-tabflow-group", groupId || "ungrouped");
      };
      heading.ondragover = (e) => {
        const dt = e.dataTransfer;
        if (!this.draggedKey && this.draggedGroupId === null && !hasTabFlowDraggedTab(dt) && !hasZoteroDraggedItems(dt)) return;
        e.preventDefault();
        if ((this.draggedKey || hasTabFlowDraggedTab(dt)) && collapsed && this.hoverTimer === null) {
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
        const dt = e.dataTransfer;
        const droppedKey = this.draggedKey || dt?.getData(TABFLOW_DRAG_MIME) || "";
        if (this.draggedGroupId !== null && this.draggedGroupId !== groupId) {
          const rect = heading.getBoundingClientRect();
          const after = rect.width > 0 ? e.clientX >= rect.left + rect.width / 2 : true;
          this.store.moveGroup(this.draggedGroupId, groupId, after);
        } else if (droppedKey) {
          this.store.assignKey(droppedKey, groupId);
        } else {
          const extItems = parseZoteroDraggedItemIDs(dt);
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
    update(group, collapsed, count, showHeading = true) {
      if (!showHeading) this.pause();
      if (!this.cancelEdit) this.heading.hidden = !showHeading;
      this.element.toggleAttribute("data-ztf-loose-tabs", !showHeading);
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
  function shouldCollapseHorizontalChip(mode, totalChips, isSelected, overflowed) {
    if (isSelected || mode === "off") return false;
    if (mode === "inactive") return true;
    return overflowed ?? totalChips > 5;
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
  var docIconCache = /* @__PURE__ */ new WeakMap();
  function createSvgIcon(doc, name, size = 14) {
    let cache = docIconCache.get(doc);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      docIconCache.set(doc, cache);
    }
    const key = `${name}:${size}`;
    let proto = cache.get(key);
    if (!proto) {
      proto = doc.createElementNS(SVG_NS, "svg");
      proto.setAttribute("viewBox", "0 0 16 16");
      proto.setAttribute("width", String(size));
      proto.setAttribute("height", String(size));
      proto.setAttribute("fill", "none");
      proto.setAttribute("stroke", "currentColor");
      proto.setAttribute("stroke-width", "1.35");
      proto.setAttribute("stroke-linecap", "round");
      proto.setAttribute("stroke-linejoin", "round");
      proto.setAttribute("aria-hidden", "true");
      proto.classList.add("ztf-icon");
      for (const def of ICONS[name]) {
        const el = doc.createElementNS(SVG_NS, def.tag);
        for (const [k, v] of Object.entries(def.attrs)) el.setAttribute(k, v);
        proto.append(el);
      }
      cache.set(key, proto);
    }
    return typeof proto.cloneNode === "function" ? proto.cloneNode(true) : (() => {
      const copy = doc.createElementNS(SVG_NS, "svg");
      for (const def of ICONS[name]) {
        const el = doc.createElementNS(SVG_NS, def.tag);
        for (const [k, v] of Object.entries(def.attrs)) el.setAttribute(k, v);
        copy.append(el);
      }
      return copy;
    })();
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
    if (!pinnedTabs.length) {
      if (!strip.hidden) strip.replaceChildren();
      strip.hidden = true;
      if (strip.dataset) strip.dataset.ztfSig = "";
      return;
    }
    strip.hidden = false;
    const iconOnly = getPref("pinnedIconOnly");
    const showRemarks = getPref("enableTabRemarks");
    const remarks = pinnedTabs.map((tab) => showRemarks ? store.getRemark(tab.key).note : "");
    const approxChipWidth = (tab, index) => {
      if (iconOnly) return 28;
      const label = remarks[index] || tab.shortTitle || tab.title;
      return Math.min(116, Math.max(52, label.length * 7 + 30));
    };
    const hostWidth = strip.parentElement?.clientWidth || 900;
    const maxWidth = Math.max(160, Math.floor(hostWidth * 0.36));
    const visibleCount = partitionPinnedOverflow(pinnedTabs.map(approxChipWidth), maxWidth);
    const sig = `${selectedID}|${iconOnly}|${maxWidth}|${visibleCount}|${pinnedTabs.map((t2, i) => `${t2.key}:${remarks[i] || t2.shortTitle || t2.title}`).join(",")}`;
    if (strip.dataset?.ztfSig === sig) return;
    if (strip.dataset) strip.dataset.ztfSig = sig;
    strip.replaceChildren();
    const visible = pinnedTabs.slice(0, visibleCount);
    const overflow = pinnedTabs.slice(visibleCount);
    visible.forEach((tab, idx) => {
      const chip = doc.createElementNS(XHTML2, "button");
      chip.type = "button";
      chip.className = `ztf-pinned-chip${tab.tab.id === selectedID ? " selected" : ""}${iconOnly ? " icon-only" : ""}`;
      chip.title = tab.title;
      chip.append(createSvgIcon(doc, "pin", 12));
      if (!iconOnly) {
        const span = doc.createElementNS(XHTML2, "span");
        span.textContent = remarks[idx] || tab.shortTitle || tab.title;
        chip.append(span);
      }
      chip.onclick = () => actions.selectTab(tab.tab.id);
      chip.oncontextmenu = (e) => menus.openTabMenu(e, tab);
      strip.append(chip);
    });
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
      mi.setAttribute("label", `${tab.tab.id === selectedID ? "✓ " : ""}${meta.getDisplayTitle(tab)}`);
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
    return { sessions, rolling, total: sessions };
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
      title.textContent = t("zotero-tabflow-hub-title", "TabFlow 工作区");
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
      if (this.statusEl && this.store.readOnly) this.statusEl.textContent = t("zotero-tabflow-hub-readonly-warning", "工作区数据处于只读保护状态，暂不可保存或修改。");
      const sessionsEnabled = getPref("enableSessions");
      const sessions = this.store.state.sessions;
      const rolling = this.store.state.rollingSessions ?? [];
      const parts = [];
      if (sessionsEnabled) {
        parts.push(this.buildQuickSaveBar(sessions.length));
      }
      if (sessionsEnabled) {
        parts.push(this.buildSessionsSection(sessions));
        if (sessionsEnabled && rolling.length) parts.push(this.buildRollingSection(rolling));
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
      const ro = this.store.readOnly;
      actions.append(
        this.btn(t("zotero-tabflow-hub-save-session", "保存工作区"), "ztf-hub-btn primary", () => {
          const openKeys = this.meta.buildTrackedTabs().map((tab) => tab.key);
          this.store.saveSession(saveName("zotero-tabflow-session-default-name", "工作区会话"), openKeys);
          input.value = "";
          this.renderContent();
        }, ro),
        this.btn(t("zotero-tabflow-hub-save-template", "存为布局模板"), "ztf-hub-btn", () => {
          this.store.saveLayoutTemplate(saveName("zotero-tabflow-template-default-name", "布局模板"));
          input.value = "";
          this.renderContent();
        }, ro),
        this.btn(t("zotero-tabflow-hub-export", "导出 JSON"), "ztf-hub-btn", () => {
          this.dispose();
          this.callbacks.onExportSessions();
        }, sessionCount === 0),
        this.btn(t("zotero-tabflow-hub-import", "导入 JSON"), "ztf-hub-btn", () => {
          this.dispose();
          this.callbacks.onImportSessions();
        }, ro)
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
      const ro = this.store.readOnly;
      const btns = this.h("div", "ztf-hub-card-actions");
      btns.append(
        this.btn(t("zotero-tabflow-hub-preview", "预览恢复"), "ztf-hub-btn primary", () => {
          this.dispose();
          this.callbacks.onPreviewRestore(s);
        }),
        this.btn(t("zotero-tabflow-hub-quick-merge", "直接合并"), "ztf-hub-btn", () => {
          this.dispose();
          this.callbacks.onQuickMerge(s);
        }, ro)
      );
      if (isRolling) {
        btns.append(this.btn(t("zotero-tabflow-hub-promote", "转存"), "ztf-hub-btn", () => {
          if (promoteRollingSnapshot(this.store.state, s.id)) {
            this.store.save();
            this.renderContent();
          }
        }, ro));
      } else if (s.kind !== "pre-replace") {
        btns.append(
          this.btn(t("zotero-tabflow-hub-update", "更新"), "ztf-hub-btn", () => {
            const title2 = t("zotero-tabflow-hub-update", "更新");
            const msg = t("zotero-tabflow-hub-update-confirm", `用当前打开的文献与分组状态覆盖「${s.name}」？`, { name: s.name });
            if (!Services.prompt.confirm(this.win, title2, msg)) return;
            if (updateExistingSession(this.store.state, s.id, this.meta.buildTrackedTabs().map((tab) => tab.key))) {
              this.store.save();
              this.renderContent();
            }
          }, ro || s.scopedGroupId !== void 0 && !this.store.state.groups.some((group) => group.id === s.scopedGroupId)),
          this.btn(t("zotero-tabflow-hub-rename", "重命名"), "ztf-hub-btn", () => {
            const val = { value: s.name };
            if (!Services.prompt.prompt(this.win, t("zotero-tabflow-hub-rename", "重命名"), t("zotero-tabflow-hub-rename-prompt", "请输入新的会话名称："), val, null, {})) return;
            if (renameExistingSession(this.store.state, s.id, val.value)) {
              this.store.save();
              this.renderContent();
            }
          }, ro)
        );
      }
      btns.append(this.btn(t("zotero-tabflow-hub-delete", "删除"), "ztf-hub-btn danger", () => {
        this.store.deleteSession(s.id);
        this.renderContent();
      }, ro));
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
    constructor(win, doc, store, meta, actions, tracker, menus, popovers, spotlight, onRefresh, hoverCard) {
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
      this.hoverCard = hoverCard;
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
    addGroupButton = null;
    lastSelectedID = "";
    layoutRetry = false;
    groupSections = /* @__PURE__ */ new Map();
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
        this.hoverCard?.hide();
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
      const compactMode = getPref("enableHorizontalGroups") && getPref("compactTopBar") && sidebarHealthy;
      const enabled = getPref("enableHorizontalGroups") && !compactMode;
      const mounted = enabled && Boolean(this.root?.isConnected);
      host.toggleAttribute("data-ztf-inline", mounted || compactMode);
      if (!mounted) {
        if (this.pinnedStrip) this.pinnedStrip.hidden = true;
        for (const group of this.groupSections.values()) group.pause();
      }
      if (this.root) this.root.hidden = !mounted;
      const trackedTabs = snapshot ?? (mounted || getPref("enableStaleSuggestions") ? this.meta.buildTrackedTabs() : []);
      const staleCount = this.renderToolbarButtons(compactMode, sidebarHealthy, trackedTabs);
      if (!mounted || !this.root || this.root.querySelector(".ztf-inline-edit")) return staleCount;
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
      const compactPref = getPref("horizontalTabCompactMode");
      const totalInlineChips = tracked.filter((t2) => !t2.pinned).length + virtualMembers.filter((m) => visibleGroupIds.has(this.store.groupOfKey(m.key))).length;
      const measureAuto = compactPref === "auto" && this.root.clientWidth > 0;
      const autoCandidates = [];
      const preCollapse = (isSelected) => measureAuto ? false : shouldCollapseHorizontalChip(compactPref, totalInlineChips, isSelected);
      const showUngrouped = getPref("newTabMode") === "collection" && !this.store.state.ungroupedHeadingHidden;
      const groups = rawGroups.filter((g) => {
        const hasMembers = unpinned.has(g.id);
        const hasVirtuals = virtualsByGroup.has(g.id);
        const hasCustomHeading = showUngrouped && Boolean(this.store.state.ungroupedName);
        return shouldRenderGroupHeading(g.id, hasMembers, hasVirtuals, hasCustomHeading);
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
        const showHeading = Boolean(g.id) || showUngrouped;
        const collapsed = showHeading && collapsedIds.has(g.id);
        const members = unpinned.get(g.id) ?? [];
        const virtuals = virtualsByGroup.get(g.id) ?? [];
        section.update(g, collapsed, members.length + virtuals.length, showHeading);
        section.heading.oncontextmenu = (e) => this.menus.openGroupMenu(e, g);
        this.drag.bindGroupDrag(section.heading, g.id, collapsed);
        if (!collapsed) {
          const nodes = this.doc.createDocumentFragment();
          for (const t2 of members) {
            const selected = t2.tab.id === selectedID;
            const chip = this.buildTabNode(t2, selectedID, preCollapse(selected));
            const lbl = measureAuto && !selected ? chip.querySelector(".ztf-doc-title") : null;
            if (lbl) autoCandidates.push({ node: chip, label: lbl });
            nodes.append(chip);
          }
          const collapseVirtual = preCollapse(false);
          for (const v of virtuals) {
            const vNode = this.h("button", `ztf-doc ztf-virtual${collapseVirtual ? " ztf-chip-collapsed" : ""}`);
            vNode.type = "button";
            const label = this.h("span", "ztf-doc-title");
            label.textContent = collapseVirtual ? "···" : `◌ ${this.meta.getDisplayTitle(v)}`;
            vNode.append(label);
            if (measureAuto) autoCandidates.push({ node: vNode, label });
            vNode.setAttribute("aria-label", v.title);
            vNode.title = t("zotero-tabflow-virtual-reload-tip", `虚拟保留成员（点击重新加载）：${v.title}`, { title: v.title });
            vNode.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id, false, v.key).then((opened) => {
              if (!opened) Services.prompt.alert(this.win, v.title, t("zotero-tabflow-spot-hidden-open-failed", "未能打开这篇文献。请检查附件文件是否可用。"));
              this.onRefresh();
            });
            vNode.oncontextmenu = (e) => this.menus.openVirtualMenu(e, v, g.id);
            vNode.onmouseenter = () => this.hoverCard?.scheduleShow(() => this.hoverCard?.showVirtual(vNode, v, g.name, "below"));
            vNode.onmouseleave = () => this.hoverCard?.hide();
            vNode.onmousedown = () => this.hoverCard?.hide();
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
      if (this.root.clientWidth > 0) this.layoutRetry = false;
      if (measureAuto && autoCandidates.length && this.root.scrollWidth > this.root.clientWidth + 2) {
        for (const item of autoCandidates) {
          item.node.classList.add("ztf-chip-collapsed");
          item.label.textContent = "···";
        }
      } else if (compactPref === "auto" && this.root.clientWidth === 0 && !this.layoutRetry && typeof this.win?.requestAnimationFrame === "function") {
        this.layoutRetry = true;
        const root = this.root;
        this.win.requestAnimationFrame(() => {
          if (this.root === root) this.onRefresh();
        });
      }
      this.root.scrollLeft = scroll;
      if (selectedID && selectedID !== this.lastSelectedID) {
        this.lastSelectedID = selectedID;
        this.root.querySelector(".ztf-doc.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      return staleCount;
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
    buildTabNode(tab, selectedID, compactChip = false) {
      const selected = tab.tab.id === selectedID;
      const node = this.h("div", `ztf-doc${selected ? " selected" : ""}${tab.status === "sleeping" ? " ztf-sleeping" : ""}${compactChip ? " ztf-chip-collapsed" : ""}`);
      const remark = getPref("enableTabRemarks") ? this.store.getRemark(tab.key).note : "";
      node.title = `${remark ? `[${remark}] ` : ""}${tab.title}
${t("zotero-tabflow-collection-label", "集合")}：${tab.collection}`;
      node.setAttribute("aria-label", tab.title);
      const label = this.h("span", "ztf-doc-title");
      label.textContent = compactChip ? "···" : `${tab.status === "sleeping" ? "💤 " : ""}${this.meta.getDisplayTitle(tab)}`;
      const closeBtn = this.h("button", "ztf-doc-close");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", t("zotero-tabflow-close-tab-aria", `关闭标签：${tab.title}`, { title: tab.title }));
      closeBtn.append(createSvgIcon(this.doc, "close", 11));
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        void this.actions.closeTab(tab.tab.id, true).then(this.onRefresh);
      };
      node.append(label, closeBtn);
      node.onclick = () => {
        this.hoverCard?.hide();
        this.actions.selectTab(tab.tab.id);
      };
      node.onmouseenter = () => this.hoverCard?.scheduleShow(() => this.hoverCard?.show(node, tab, "below"));
      node.onmouseleave = () => this.hoverCard?.hide();
      node.onmousedown = () => this.hoverCard?.hide();
      node.onauxclick = (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.actions.closeTab(tab.tab.id, true).then(this.onRefresh);
        }
      };
      node.oncontextmenu = (e) => {
        this.hoverCard?.hide();
        this.menus.openTabMenu(e, tab);
      };
      this.drag.bindTabDrag(node, tab);
      node.addEventListener("dragstart", () => this.hoverCard?.hide());
      return node;
    }
    renderToolbarButtons(compactMode, sidebarHealthy, tracked) {
      if (!this.toolbarActions) return 0;
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
      if (getPref("enableSessions")) {
        actions.push({
          id: "workspace",
          icon: "workspace",
          popup: "dialog",
          count: hubCounts.total,
          label: t("zotero-tabflow-workspace-btn", "工作区"),
          title: t("zotero-tabflow-toolbar-workspace-tip", `已保存的工作区 ${hubCounts.total}`, { count: hubCounts.total }),
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
      return count;
    }
    dispose() {
      this.hoverCard?.hide();
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
        const openDialog = () => {
          const fallback = selected[0]?.getField?.("title")?.slice(0, 30) || t("zotero-tabflow-new-group-title", "新分组");
          const val = { value: fallback };
          if (!Services.prompt.prompt(this.win, t("zotero-tabflow-item-open-new-group", "打开到新分组"), t("zotero-tabflow-new-group-prompt", "分组名称："), val, null, {}) || !val.value.trim()) return;
          const g = this.store.ensureGroup(val.value);
          void (async () => {
            for (const it of selected) await this.actions.openVirtualOrItem(it.id, g.id);
            this.onRefresh();
          })();
        };
        if (typeof this.win?.setTimeout === "function") this.win.setTimeout(openDialog, 0);
        else openDialog();
      });
      const groups = this.store.visibleGroups().filter((group) => group.id);
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

  // src/services/pdf-preview-renderer.ts
  var PDFJS_MODULE_URL = "resource://zotero/reader/pdf/build/pdf.mjs";
  var PDFJS_WORKER_URL = "resource://zotero/reader/pdf/build/pdf.worker.mjs";
  var PDFJS_CMAP_URL = "resource://zotero/reader/pdf/web/cmaps/";
  var PDFJS_FONT_URL = "resource://zotero/reader/pdf/web/standard_fonts/";
  var customPdfJsLoader = null;
  var cachedPdfJsLib = null;
  function isPdfAttachment(att) {
    if (!att || att.deleted || att.isTrashed?.()) return false;
    if (typeof att.isPDFAttachment === "function") return Boolean(att.isPDFAttachment());
    if (att.isFileAttachment?.() === false) return false;
    const mime = String(att.attachmentContentType || "").toLowerCase();
    if (mime === "application/pdf") return true;
    const name = String(att.attachmentFilename || att.getField?.("title") || "").toLowerCase();
    return name.endsWith(".pdf");
  }
  function getAttachmentTitle(att, index) {
    const raw = String(att?.getField?.("title") || att?.attachmentFilename || "").trim();
    return raw || `PDF ${index + 1}`;
  }
  async function resolveAllPdfAttachments(item) {
    if (!item || item.deleted || item.isTrashed?.()) return [];
    if (isPdfAttachment(item)) {
      return [{ id: Number(item.id) || 0, title: getAttachmentTitle(item, 0), attachment: item }];
    }
    const target = !item.isRegularItem?.() && item.parentItem ? item.parentItem : item;
    if (isPdfAttachment(target)) {
      return [{ id: Number(target.id) || 0, title: getAttachmentTitle(target, 0), attachment: target }];
    }
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const pushIfPdf = (att) => {
      if (!isPdfAttachment(att)) return;
      const id = Number(att.id) || results.length + 1;
      if (seen.has(id)) return;
      seen.add(id);
      results.push({ id, title: getAttachmentTitle(att, results.length), attachment: att });
    };
    const best = await target.getBestAttachment?.().catch(() => null);
    pushIfPdf(best);
    const ids = target.getAttachments?.() || [];
    if (ids.length && Zotero.Items?.getAsync) {
      const attachments = await Zotero.Items.getAsync(ids).catch(() => []);
      for (const att of attachments) pushIfPdf(att);
    }
    return results;
  }
  async function resolveAttachmentPath(att) {
    if (!att) return null;
    const path = await att.getFilePathAsync?.().catch(() => null) || att.getFilePath?.();
    return typeof path === "string" && path.trim() ? path : null;
  }
  function binaryStringToUint8Array(raw) {
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
    return bytes;
  }
  async function readPdfBytes(filePath) {
    const ioUtils = globalThis.IOUtils || Zotero.getMainWindow?.()?.IOUtils;
    if (ioUtils?.read) {
      const data = await ioUtils.read(filePath);
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    }
    if (Zotero.File?.getBinaryContentsAsync) {
      const raw = await Zotero.File.getBinaryContentsAsync(filePath);
      return raw instanceof Uint8Array ? raw : binaryStringToUint8Array(String(raw || ""));
    }
    throw new Error("No file reader available for PDF preview");
  }
  function tryImportModule(cu, url) {
    if (!cu?.importESModule) return null;
    for (const opts of [{ global: "current" }, null]) {
      try {
        const mod = opts !== null ? cu.importESModule(url, opts) : cu.importESModule(url);
        if (mod) return mod;
      } catch {
      }
    }
    return null;
  }
  async function loadPdfJsLib(win) {
    if (customPdfJsLoader) {
      const mocked = await customPdfJsLoader();
      if (!mocked) throw new Error("PDF.js unavailable");
      return mocked;
    }
    if (cachedPdfJsLib) return cachedPdfJsLib;
    const hostWin = win || Zotero.getMainWindow?.();
    if (hostWin && !globalThis.window) {
      try {
        globalThis.window = hostWin;
        globalThis.document = hostWin.document;
      } catch {
      }
    }
    const winCu = hostWin?.ChromeUtils;
    const globalCu = globalThis.ChromeUtils;
    const workerMod = tryImportModule(winCu, PDFJS_WORKER_URL) || tryImportModule(globalCu, PDFJS_WORKER_URL);
    if (workerMod) {
      try {
        globalThis.pdfjsWorker = workerMod;
        if (hostWin) hostWin.pdfjsWorker = workerMod;
      } catch {
      }
    }
    let mod = tryImportModule(winCu, PDFJS_MODULE_URL) || tryImportModule(globalCu, PDFJS_MODULE_URL);
    if (typeof mod?.getDocument !== "function") {
      try {
        mod = await import(
          /* @vite-ignore */
          PDFJS_MODULE_URL
        );
      } catch {
        mod = null;
      }
    }
    if (typeof mod?.getDocument !== "function") {
      throw new Error("Failed to load Zotero PDF.js module");
    }
    if (mod.GlobalWorkerOptions && !mod.GlobalWorkerOptions.workerSrc) {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    }
    cachedPdfJsLib = mod;
    return mod;
  }
  async function openPdfDocumentFromFile(filePath, doc) {
    const win = doc?.defaultView || Zotero.getMainWindow?.();
    const ownerDocument = doc || win?.document;
    const [pdfjsLib, data] = await Promise.all([loadPdfJsLib(win), readPdfBytes(filePath)]);
    const loadingTask = pdfjsLib.getDocument({
      data,
      ownerDocument,
      isEvalSupported: false,
      useWorkerFetch: false,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_FONT_URL
    });
    return await loadingTask.promise;
  }
  async function renderPageToCanvas(pdfDoc, pageNumber, canvas, targetWidth, zoomRatio, dpr, isAborted, onTask) {
    const page = await pdfDoc.getPage(pageNumber);
    if (isAborted()) {
      page.cleanup?.();
      return { width: 0, height: 0, cancel: () => {
      } };
    }
    const baseViewport = page.getViewport({ scale: 1 });
    const safeWidth = Math.max(120, targetWidth);
    const cssScale = safeWidth / Math.max(1, baseViewport.width) * zoomRatio;
    const cssViewport = page.getViewport({ scale: cssScale });
    const pixelRatio = Math.max(1.25, Math.min(3, (dpr || 1) * 1.15));
    canvas.width = Math.max(1, Math.floor(cssViewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(cssViewport.height * pixelRatio));
    if (Math.abs(zoomRatio - 1) < 0.01) {
      canvas.style.width = "100%";
      canvas.style.height = "auto";
    } else {
      canvas.style.width = `${Math.floor(cssViewport.width)}px`;
      canvas.style.height = `${Math.floor(cssViewport.height)}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    const transform = pixelRatio === 1 ? void 0 : [pixelRatio, 0, 0, pixelRatio, 0, 0];
    const task = page.render({ canvasContext: ctx, viewport: cssViewport, transform });
    const cancel = () => {
      try {
        task.cancel?.();
      } catch {
      }
    };
    onTask?.(cancel);
    try {
      await task.promise;
    } catch (err) {
      if (err?.name === "RenderingCancelledException" || isAborted()) {
        return { width: 0, height: 0, cancel };
      }
      throw err;
    } finally {
      page.cleanup?.();
    }
    return {
      width: Math.floor(cssViewport.width),
      height: Math.floor(cssViewport.height),
      cancel
    };
  }
  async function openPdfInReader(att, win, pageNumber) {
    if (!att?.id) return false;
    const location = typeof pageNumber === "number" && pageNumber > 1 ? { pageIndex: pageNumber - 1 } : void 0;
    try {
      if (Zotero.Reader?.open) {
        try {
          await Zotero.Reader.open(att.id, location, { openInWindow: false });
        } catch {
          await Zotero.Reader.open(att.id, void 0, { openInWindow: false });
        }
        return true;
      }
      const targetWin = win?.ZoteroPane ? win : Zotero.getMainWindow?.();
      if (targetWin?.ZoteroPane?.viewAttachment) {
        await targetWin.ZoteroPane.viewAttachment([att.id]);
        return true;
      }
      if (targetWin?.ZoteroPane?.viewItems) {
        await targetWin.ZoteroPane.viewItems([att]);
        return true;
      }
    } catch (error) {
      Zotero.logError(error instanceof Error ? error : new Error(String(error)));
    }
    return false;
  }

  // src/ui/item-pane-section-compat.ts
  var XHTML_NS = "http://www.w3.org/1999/xhtml";
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var STYLE_ID = "tabflow-pdf-preview-styles";
  var PREVIEW_CSS = `
.ztf-pdf-root {
	display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;
	min-inline-size: 0; inline-size: 100%; contain: inline-size;
	font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
	padding: 2px 0 4px 0; color: var(--fill-primary, currentColor);
}
.ztf-pdf-toolbar {
	display: flex; align-items: center; justify-content: space-between;
	gap: 4px; flex-wrap: wrap; min-block-size: 24px; padding: 0 1px 4px;
	background: transparent;
	border-bottom: 1px solid var(--fill-quinary, color-mix(in srgb, currentColor 7%, transparent));
}
.ztf-pdf-att-select {
	flex: 1 1 100%; min-inline-size: 0; inline-size: 100%; block-size: 22px;
	padding: 0 6px; margin-top: 2px; border-radius: 4px;
	border: 1px solid var(--fill-quarternary, rgba(127, 127, 127, 0.22));
	background: var(--material-background, transparent);
	color: var(--fill-primary, inherit); font: 500 11px/1.3 system-ui, sans-serif; cursor: pointer;
}
.ztf-pdf-btn-group { display: flex; align-items: center; gap: 2px; }
.ztf-pdf-btn {
	appearance: none !important; -moz-appearance: none !important; box-sizing: border-box;
	display: inline-flex; align-items: center; justify-content: center; gap: 4px;
	min-inline-size: 20px !important; min-block-size: 20px !important; block-size: 20px !important;
	margin: 0 !important; padding: 0 5px !important;
	border: 1px solid transparent !important; border-radius: 4px !important;
	background: transparent !important; box-shadow: none !important;
	color: var(--fill-secondary, inherit); font: 500 11.5px/1 system-ui, sans-serif;
	cursor: pointer; user-select: none;
	transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}
.ztf-pdf-btn-svg { inline-size: 12px; block-size: 12px; flex-shrink: 0; pointer-events: none; }
.ztf-pdf-btn:hover:not(:disabled) {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent)) !important;
	color: var(--fill-primary, inherit);
}
.ztf-pdf-btn:active:not(:disabled) {
	background: var(--fill-quarternary, color-mix(in srgb, currentColor 14%, transparent)) !important;
}
.ztf-pdf-btn:disabled { opacity: 0.32; cursor: default; }
.ztf-pdf-open-btn {
	padding: 0 7px !important; color: var(--accent-blue, #4072e5) !important;
	background: var(--accent-blue10, rgba(64, 114, 229, 0.1)) !important;
	font-weight: 500; font-size: 11px;
}
.ztf-pdf-open-btn:hover:not(:disabled) {
	background: var(--accent-blue30, rgba(64, 114, 229, 0.2)) !important;
	color: var(--accent-blue, #4072e5) !important;
}
.ztf-pdf-page-label {
	min-inline-size: 38px; padding: 2px 4px; border-radius: 4px;
	text-align: center; font-variant-numeric: tabular-nums;
	color: var(--fill-secondary, inherit); font-size: 11px;
	cursor: pointer; user-select: none;
	transition: background-color 0.12s ease, color 0.12s ease;
}
.ztf-pdf-page-label:hover {
	background: var(--fill-quinary, color-mix(in srgb, currentColor 8%, transparent));
	color: var(--fill-primary, inherit);
}
.ztf-pdf-page-input {
	inline-size: 38px; block-size: 19px; padding: 0 3px; border-radius: 4px;
	border: 1px solid var(--accent-blue, #4072e5);
	background: var(--material-background, #fff); color: var(--fill-primary, inherit);
	font: 500 11px/1 system-ui, sans-serif; text-align: center; outline: none;
}
.ztf-pdf-status {
	padding: 12px 8px; color: var(--fill-secondary, inherit);
	font-size: 12px; text-align: center; display: none; overflow-wrap: anywhere;
}
.ztf-pdf-viewport {
	position: relative; display: flex; flex-direction: column; align-items: stretch;
	gap: 8px; max-block-size: calc(100vh - 170px);
	overflow-y: auto; overflow-x: auto; padding: 2px 0 4px; background: transparent;
	scrollbar-width: thin; outline: none;
	scrollbar-color: var(--color-scrollbar, rgba(127, 127, 127, 0.38)) transparent;
}
.ztf-pdf-page-card {
	position: relative; flex: 0 0 auto; flex-shrink: 0; display: block;
	inline-size: 100%; box-sizing: border-box; background: #fff;
	border-radius: 5px; border: 1px solid var(--fill-quarternary, rgba(0, 0, 0, 0.12));
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); overflow: hidden; cursor: pointer;
	transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.ztf-pdf-page-card:hover {
	border-color: var(--accent-blue50, rgba(64, 114, 229, 0.45));
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.09);
}
.ztf-pdf-page-card[data-unrendered="true"] {
	aspect-ratio: 1 / 1.4142; min-block-size: 320px;
	background: var(--fill-senary, rgba(0, 0, 0, 0.02));
}
.ztf-pdf-canvas { display: block; inline-size: 100%; block-size: auto; background: #fff; }
.ztf-pdf-page-badge {
	position: absolute; inset-inline-end: 6px; inset-block-end: 6px;
	padding: 1px 6px; border-radius: 999px; font: 500 10px/1.35 system-ui, sans-serif;
	font-variant-numeric: tabular-nums; background: rgba(15, 23, 42, 0.56);
	color: #fff; pointer-events: none; opacity: 0.72; transition: opacity 0.14s ease;
}
.ztf-pdf-page-card:hover .ztf-pdf-page-badge { opacity: 0.95; }
.ztf-pdf-root[data-show-badge="false"] .ztf-pdf-page-badge { display: none; }
[data-ztf-pdf-full-hidden="true"], [data-ztf-pdf-full-stack="true"] > :not([data-ztf-pdf-full-section="true"]) { display: none !important; }
[data-ztf-pdf-full-stack="true"] {
	display: flex !important; flex-direction: column !important;
	block-size: 100% !important; max-block-size: 100% !important; overflow: hidden !important;
}
[data-ztf-pdf-full-section="true"],
[data-ztf-pdf-full-section="true"] > collapsible-section,
[data-ztf-pdf-full-section="true"] > collapsible-section > [data-type="body"] {
	display: flex !important; flex-direction: column !important;
	flex: 1 1 auto !important; block-size: 100% !important; min-block-size: 0 !important;
}
[data-ztf-pdf-full-section="true"] > collapsible-section > .head { display: none !important; }
.ztf-pdf-root[data-layout-mode="full"] {
	display: flex; flex-direction: column; flex: 1 1 auto; block-size: 100%; min-block-size: 0;
}
.ztf-pdf-root[data-layout-mode="full"] .ztf-pdf-viewport {
	flex: 1 1 auto; max-block-size: calc(100vh - 96px); block-size: 100%;
}
`;
  var TOOL_SVG_PATHS = {
    prev: "M10 3.5L5.5 8L10 12.5",
    next: "M6 3.5L10.5 8L6 12.5",
    zoomOut: "M3.8 8H12.2",
    zoomIn: "M8 3.8V12.2M3.8 8H12.2",
    toggleMode: "M2.5 5.5V2.5H5.5M10.5 2.5H13.5V5.5M13.5 10.5V13.5H10.5M5.5 13.5H2.5V10.5",
    openReader: "M9.5 2.8H13.2V6.5M13 3L7.5 8.5M11.5 9.2V12.4C11.5 12.84 11.14 13.2 10.7 13.2H3.6C3.16 13.2 2.8 12.84 2.8 12.4V5.3C2.8 4.86 3.16 4.5 3.6 4.5H6.8"
  };
  var STATUS_FALLBACKS = {
    "zotero-tabflow-pdf-preview-loading": "正在加载 PDF 预览…",
    "zotero-tabflow-pdf-preview-unavailable": "当前条目无可用的 PDF 附件",
    "zotero-tabflow-pdf-preview-missing-file": "找不到本地 PDF 文件，请先检查附件存储路径",
    "zotero-tabflow-pdf-preview-error": "无法渲染此 PDF，请尝试在阅读器中打开"
  };
  function ensurePreviewStyles(doc) {
    if (!doc?.getElementById) return;
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = createXhtmlEl(doc, "style");
      style.id = STYLE_ID;
      (doc.head || doc.documentElement)?.append(style);
    }
    if (style.textContent !== PREVIEW_CSS) style.textContent = PREVIEW_CSS;
  }
  function removePreviewStyles(doc) {
    doc?.getElementById?.(STYLE_ID)?.remove?.();
  }
  function createXhtmlEl(doc, tag, css = "") {
    const node = doc.createElementNS(XHTML_NS, tag);
    if (css) node.style.cssText = css;
    return node;
  }
  function createToolBtn(doc, text, l10nId, extraClass = "", iconKey) {
    const btn = createXhtmlEl(doc, "button");
    btn.type = "button";
    btn.className = extraClass ? `ztf-pdf-btn ${extraClass}` : "ztf-pdf-btn";
    if (l10nId) btn.setAttribute("data-l10n-id", l10nId);
    const d = iconKey ? TOOL_SVG_PATHS[iconKey] : "";
    if (d && typeof doc.createElementNS === "function") {
      const svg = doc.createElementNS(SVG_NS2, "svg");
      for (const [k, v] of [["viewBox", "0 0 16 16"], ["width", "12"], ["height", "12"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.6"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["class", "ztf-pdf-btn-svg"]]) {
        svg.setAttribute(k, v);
      }
      const path = doc.createElementNS(SVG_NS2, "path");
      path.setAttribute("d", d);
      svg.append(path);
      btn.append(svg);
      if (text && iconKey === "openReader") {
        const span = createXhtmlEl(doc, "span");
        span.textContent = text;
        btn.append(span);
      }
    } else if (text) btn.textContent = text;
    return btn;
  }
  function applyStatusMessage(statusEl, l10nId) {
    if (!l10nId) {
      statusEl.style.display = "none";
      statusEl.removeAttribute("data-l10n-id");
      statusEl.textContent = "";
      return;
    }
    statusEl.style.display = "block";
    statusEl.setAttribute("data-l10n-id", l10nId);
    statusEl.textContent = t(l10nId, STATUS_FALLBACKS[l10nId] || l10nId);
  }
  function logPreviewDebug(event, detail = {}) {
    try {
      if (getPref("debug")) Zotero.debug?.(`[TabFlow:PDFPreview] ${event} ${JSON.stringify(detail)}`);
    } catch {
    }
  }
  function isSectionEnabled(context, prefEnabled) {
    const tabType = context.tabType;
    return Boolean(prefEnabled && (!tabType || tabType === "library" || tabType === "reader"));
  }
  function ensureSectionConnected(body, root, savedSection, savedCollapsible) {
    if (!body.contains(root)) body.replaceChildren(root);
    let owner = body.closest?.("collapsible-section") || (body.parentElement?.localName === "collapsible-section" ? body.parentElement : null);
    if (!owner) {
      const doc = body.ownerDocument;
      let hostSection = body.closest?.("item-pane-custom-section") || savedSection || null;
      if ((!hostSection || hostSection.isConnected === false) && doc?.querySelectorAll) {
        const candidates = Array.from(doc.querySelectorAll('item-pane-custom-section[data-pane*="tabflow-pdf-preview"]'));
        hostSection = candidates.find((c) => c._body === body) || candidates.find((c) => !c.querySelector('[data-type="body"]')) || hostSection;
      }
      const liveCollapsible = hostSection?.querySelector?.("collapsible-section") || (savedCollapsible?.isConnected ? savedCollapsible : null);
      if (liveCollapsible) {
        const existingBody = liveCollapsible.querySelector?.('[data-type="body"]');
        if (!existingBody) liveCollapsible.append(body);
        else if (existingBody !== body) {
          existingBody.replaceWith(body);
          if (hostSection) hostSection._body = body;
        }
        owner = liveCollapsible;
      }
    }
    if (!owner) return null;
    owner.removeAttribute?.("empty");
    if ("empty" in owner) owner.empty = false;
    if (!owner.hasAttribute?.("data-tabflow-preview-ready")) {
      owner.setAttribute?.("data-tabflow-preview-ready", "true");
      owner.open = true;
    }
    owner.style?.setProperty?.("--open-height", "auto");
    return owner;
  }
  function applyPreviewLayoutMode(body, root, savedSection, fullActive) {
    root.setAttribute("data-layout-mode", fullActive ? "full" : "section");
    const hostSection = body.closest?.("item-pane-custom-section") || savedSection;
    const stack = hostSection?.parentElement;
    if (!hostSection) return;
    if (fullActive) {
      hostSection.setAttribute("data-ztf-pdf-full-section", "true");
      stack?.setAttribute("data-ztf-pdf-full-stack", "true");
      for (const child of Array.from(stack?.parentElement?.children || [])) {
        const tag = (child.localName || child.tagName || "").toLowerCase();
        if (child !== stack && tag !== "item-pane-sidenav" && !child.querySelector?.("item-pane-sidenav")) {
          child.setAttribute("data-ztf-pdf-full-hidden", "true");
        }
      }
    } else {
      hostSection.removeAttribute("data-ztf-pdf-full-section");
      stack?.removeAttribute("data-ztf-pdf-full-stack");
      body.ownerDocument?.querySelectorAll?.("[data-ztf-pdf-full-hidden]").forEach((el) => el.removeAttribute("data-ztf-pdf-full-hidden"));
    }
  }
  function bindPreviewSidenavClick(doc, signal, onFullModeChange) {
    if (typeof doc.addEventListener !== "function") return;
    doc.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      const btn = event.target?.closest?.("item-pane-sidenav .btn[data-pane]");
      const paneID = btn?.getAttribute?.("data-pane") || "";
      if (!btn || btn.hasAttribute?.("disabled")) return;
      if (!paneID.includes("tabflow-pdf-preview")) {
        onFullModeChange?.(false);
        return;
      }
      if (getPref("pdfPreviewMode") === "full") onFullModeChange?.(true);
      const sidenav = btn.closest?.("item-pane-sidenav");
      const container = sidenav?.container;
      const section = container?.getEnabledPane?.(paneID) || doc.querySelector?.(`item-pane-custom-section[data-pane="${paneID}"]`);
      const collapsible = section?.querySelector?.("collapsible-section");
      if (collapsible) {
        collapsible.removeAttribute?.("empty");
        collapsible.open = true;
        collapsible.style?.setProperty?.("--open-height", "auto");
      }
      if (container?.scrollToPane) void container.scrollToPane(paneID, "smooth");
    }, { capture: true, signal });
  }
  function openPageJumpInput(doc, pageLabel, currentPage, numPages, onCommit) {
    if (numPages <= 1) return;
    const input = createXhtmlEl(doc, "input");
    input.type = "number";
    input.className = "ztf-pdf-page-input";
    input.min = "1";
    input.max = String(numPages);
    input.value = String(currentPage || 1);
    let closed = false;
    const finish = (commit) => {
      if (closed) return;
      closed = true;
      const target = Number(input.value);
      input.replaceWith?.(pageLabel);
      if (commit && Number.isFinite(target) && target >= 1) onCommit(Math.round(target));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault?.();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault?.();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    pageLabel.replaceWith?.(input);
    input.focus?.();
    input.select?.();
  }
  function evictDistantPageCanvases(slots, currentPage, radius = 8) {
    if (slots.length <= 14) return;
    for (const slot of slots) {
      if (slot.renderedZoom !== null && !slot.rendering && Math.abs(slot.pageNumber - currentPage) > radius) {
        slot.canvas.width = 0;
        slot.canvas.height = 0;
        slot.renderedZoom = null;
        slot.card.setAttribute("data-unrendered", "true");
        if (slot.lastHeight > 0) slot.card.style.minBlockSize = `${slot.lastHeight}px`;
      }
    }
  }

  // src/ui/pdf-preview-section.ts
  var MIN_ZOOM = 0.6;
  var MAX_ZOOM = 2;
  var ZOOM_STEP = 0.2;
  var PdfPreviewSectionController = class {
    sectionID = false;
    prefObservers = [];
    states = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Map();
    register(pluginID, rootURI) {
      logPreviewDebug("register", { pluginID, rootURI, hasAPI: Boolean(Zotero.ItemPaneManager?.registerSection) });
      if (this.sectionID || !Zotero.ItemPaneManager?.registerSection) return;
      this.sectionID = Zotero.ItemPaneManager.registerSection({
        paneID: "tabflow-pdf-preview",
        pluginID,
        header: { l10nID: "zotero-tabflow-pdf-preview-title", icon: `${rootURI}pdf-preview.svg` },
        sidenav: { l10nID: "zotero-tabflow-pdf-preview-sidenav", icon: `${rootURI}pdf-preview-sidenav.svg`, orderable: true },
        onInit: (props) => this.onInit(props),
        onDestroy: ({ body }) => this.onDestroy(body),
        onItemChange: (props) => this.renderSection(props),
        onRender: (props) => this.renderSection(props),
        onToggle: (props) => this.renderSection(props)
      });
      if (Zotero.Prefs?.registerObserver && !this.prefObservers.length) {
        for (const key of ["pdfPreviewMode", "enablePdfPreviewSidenav", "pdfPreviewDefaultZoom", "pdfPreviewShowPageBadge"]) {
          this.prefObservers.push(Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => {
            invalidatePrefCache(key);
            const isFull = getPref("pdfPreviewMode") === "full" && getPref("enablePdfPreviewSidenav");
            const showBadge = getPref("pdfPreviewShowPageBadge");
            const defaultZoom = Math.round(getPref("pdfPreviewDefaultZoom")) / 100;
            for (const st of this.states.values()) {
              st.fullActive = isFull;
              st.root.setAttribute("data-show-badge", showBadge ? "true" : "false");
              if (key === "pdfPreviewDefaultZoom") st.zoom = defaultZoom;
              applyPreviewLayoutMode(st.body, st.root, st.customSection, isFull);
              this.syncControls(st);
              this.invalidateAndRenderVisible(st);
            }
          }, true));
        }
      }
    }
    onInit(props) {
      const { body, item, tabType, setEnabled, setSectionSummary } = props;
      const doc = props.doc || body?.ownerDocument;
      const win = doc?.defaultView || Zotero.getMainWindow?.();
      if (!win || !doc || !body) return;
      try {
        const customSection = body.closest?.("item-pane-custom-section") || null, collapsible = body.closest?.("collapsible-section") || null;
        setEnabled?.(isSectionEnabled({ item, tabType }, getPref("enablePdfPreviewSidenav")));
        win.MozXULElement?.insertFTLIfNeeded?.("zotero-tabflow.ftl");
        ensurePreviewStyles(doc);
        this.listeners.get(body)?.abort();
        const controller = new win.AbortController();
        this.listeners.set(body, controller);
        body.textContent = "";
        const root = createXhtmlEl(doc, "div");
        root.className = "ztf-pdf-root";
        const toolbar = createXhtmlEl(doc, "div");
        toolbar.className = "ztf-pdf-toolbar";
        const navGroup = createXhtmlEl(doc, "div");
        navGroup.className = "ztf-pdf-btn-group";
        const prevBtn = createToolBtn(doc, "‹", "zotero-tabflow-pdf-preview-prev", "", "prev");
        const pageLabel = createXhtmlEl(doc, "span");
        pageLabel.className = "ztf-pdf-page-label";
        pageLabel.textContent = "0 / 0";
        const nextBtn = createToolBtn(doc, "›", "zotero-tabflow-pdf-preview-next", "", "next");
        navGroup.append(prevBtn, pageLabel, nextBtn);
        const zoomGroup = createXhtmlEl(doc, "div");
        zoomGroup.className = "ztf-pdf-btn-group";
        const zoomOutBtn = createToolBtn(doc, "−", "zotero-tabflow-pdf-preview-zoom-out", "", "zoomOut");
        const zoomLabel = createToolBtn(doc, "100%");
        const zoomInBtn = createToolBtn(doc, "+", "zotero-tabflow-pdf-preview-zoom-in", "", "zoomIn");
        const modeBtn = createToolBtn(doc, "", "zotero-tabflow-pdf-preview-toggle-mode", "", "toggleMode");
        const openBtn = createToolBtn(doc, t("zotero-tabflow-pdf-preview-open-reader", "在阅读器中打开"), "zotero-tabflow-pdf-preview-open-reader", "ztf-pdf-open-btn", "openReader");
        zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn, modeBtn, openBtn);
        const attSelect = createXhtmlEl(doc, "select", "display:none");
        attSelect.className = "ztf-pdf-att-select";
        toolbar.append(navGroup, zoomGroup, attSelect);
        const statusEl = createXhtmlEl(doc, "div");
        statusEl.className = "ztf-pdf-status";
        const viewportEl = createXhtmlEl(doc, "div");
        viewportEl.className = "ztf-pdf-viewport";
        viewportEl.setAttribute("tabindex", "0");
        root.append(toolbar, statusEl, viewportEl);
        body.append(root);
        const state = {
          doc,
          win,
          body,
          root,
          customSection,
          collapsible,
          setSectionSummary,
          item: null,
          attachment: null,
          attachments: [],
          pdfDoc: null,
          loading: false,
          generation: 0,
          fullActive: getPref("pdfPreviewMode") === "full",
          zoom: Math.round(getPref("pdfPreviewDefaultZoom")) / 100,
          currentPage: 0,
          numPages: 0,
          lastWidth: 0,
          resizeTimer: null,
          resizeObserver: null,
          slots: [],
          observer: null,
          statusEl,
          pageLabel,
          zoomLabel,
          prevBtn,
          nextBtn,
          openBtn,
          attSelect,
          viewportEl
        };
        root.setAttribute("data-show-badge", getPref("pdfPreviewShowPageBadge") ? "true" : "false");
        this.states.set(body, state);
        ensureSectionConnected(body, root, customSection, collapsible);
        applyPreviewLayoutMode(body, root, customSection, state.fullActive);
        bindPreviewSidenavClick(doc, controller.signal, (active) => {
          state.fullActive = active;
          applyPreviewLayoutMode(state.body, state.root, state.customSection, active);
        });
        this.bindToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, controller.signal);
        this.setupResizeObserver(state);
        this.syncControls(state);
        this.renderSection(props);
      } catch (error) {
        Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    bindToolbar(state, zoomOutBtn, zoomInBtn, modeBtn, signal) {
      const opts = { signal };
      state.prevBtn.addEventListener("click", () => this.jumpToPage(state, state.currentPage - 1), opts);
      state.nextBtn.addEventListener("click", () => this.jumpToPage(state, state.currentPage + 1), opts);
      zoomOutBtn.addEventListener("click", () => this.setZoom(state, state.zoom - ZOOM_STEP), opts);
      zoomInBtn.addEventListener("click", () => this.setZoom(state, state.zoom + ZOOM_STEP), opts);
      state.zoomLabel.addEventListener("click", () => this.setZoom(state, 1), opts);
      modeBtn.addEventListener("click", () => {
        const next = getPref("pdfPreviewMode") === "full" ? "section" : "full";
        setPref("pdfPreviewMode", next);
        state.fullActive = next === "full";
        applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive);
        this.invalidateAndRenderVisible(state);
      }, opts);
      state.openBtn.addEventListener("click", () => state.attachment && void openPdfInReader(state.attachment, state.win, state.currentPage || 1), opts);
      state.attSelect.addEventListener("change", () => {
        const chosen = state.attachments.find((entry) => String(entry.id) === state.attSelect.value);
        if (chosen && chosen.attachment !== state.attachment) void this.loadAttachmentDocument(state, chosen.attachment);
      }, opts);
      state.pageLabel.addEventListener("click", () => openPageJumpInput(state.doc, state.pageLabel, state.currentPage, state.numPages, (p) => this.jumpToPage(state, p)), opts);
      state.viewportEl.addEventListener("scroll", () => this.updateCurrentPageFromScroll(state), opts);
      state.viewportEl.addEventListener("dblclick", (event) => {
        if (!state.attachment || !getPref("pdfPreviewDoubleClickOpen")) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        const card = event.target?.closest?.("[data-page-number]");
        void openPdfInReader(state.attachment, state.win, Number(card?.getAttribute?.("data-page-number")) || state.currentPage || 1);
      }, opts);
      state.viewportEl.addEventListener("keydown", (event) => {
        if (!state.numPages) return;
        const k = event.key;
        if (k === "PageDown" || k === "ArrowRight") {
          event.preventDefault?.();
          this.jumpToPage(state, state.currentPage + 1);
        } else if (k === "PageUp" || k === "ArrowLeft") {
          event.preventDefault?.();
          this.jumpToPage(state, state.currentPage - 1);
        } else if (k === "Home" || k === "End") {
          event.preventDefault?.();
          this.jumpToPage(state, k === "Home" ? 1 : state.numPages);
        } else if ((event.ctrlKey || event.metaKey) && k === "0") {
          event.preventDefault?.();
          this.setZoom(state, 1);
        }
      }, opts);
      state.viewportEl.addEventListener("wheel", (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.setZoom(state, state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        }
      }, opts);
    }
    setupResizeObserver(state) {
      const RO = state.win.ResizeObserver;
      if (!RO) return;
      state.resizeObserver = new RO(() => {
        const width = state.viewportEl.clientWidth || state.body.clientWidth || 0;
        if (!width || !state.pdfDoc || Math.abs(width - state.lastWidth) < 8) return;
        state.lastWidth = width;
        if (state.resizeTimer !== null) state.win.clearTimeout(state.resizeTimer);
        state.resizeTimer = state.win.setTimeout(() => {
          state.resizeTimer = null;
          this.invalidateAndRenderVisible(state);
        }, 120);
      });
      state.resizeObserver.observe(state.viewportEl);
    }
    invalidateAndRenderVisible(state) {
      for (const slot of state.slots) {
        slot.cancelTask?.();
        slot.renderedZoom = null;
      }
      const startIdx = Math.max(0, state.currentPage - 1);
      for (let i = startIdx; i < Math.min(state.slots.length, startIdx + 2); i++) void this.renderSlot(state, state.slots[i], state.generation);
    }
    onDestroy(body) {
      const state = this.states.get(body);
      if (state) {
        if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
        state.resizeObserver?.disconnect();
        applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
        this.disposeDocument(state, true);
      }
      this.states.delete(body);
      this.listeners.get(body)?.abort();
      this.listeners.delete(body);
    }
    renderSection({ body, item, tabType, setEnabled, setSectionSummary }) {
      const enabled = isSectionEnabled({ item, tabType }, getPref("enablePdfPreviewSidenav"));
      setEnabled?.(enabled);
      let state = this.states.get(body);
      if (!state) {
        const doc = body?.ownerDocument;
        if (!doc) return;
        this.onInit({ doc, body, item, tabType, setEnabled, setSectionSummary });
        state = this.states.get(body);
        if (!state) return;
      }
      if (setSectionSummary) state.setSectionSummary = setSectionSummary;
      ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
      if (!enabled) {
        state.item = null;
        applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
        this.disposeDocument(state, true);
        applyStatusMessage(state.statusEl, "");
        return;
      }
      applyPreviewLayoutMode(state.body, state.root, state.customSection, state.fullActive && getPref("pdfPreviewMode") === "full");
      if (item && state.item === item && (state.pdfDoc || state.loading)) return;
      state.item = item ?? null;
      void this.loadItemPreview(state, state.item);
    }
    disposeDocument(state, clearAttachments = false) {
      state.generation += 1;
      state.loading = false;
      state.observer?.disconnect();
      state.observer = null;
      for (const slot of state.slots) {
        slot.cancelTask?.();
        slot.canvas.width = 0;
        slot.canvas.height = 0;
      }
      state.slots = [];
      state.viewportEl.textContent = "";
      state.currentPage = 0;
      state.numPages = 0;
      state.attachment = null;
      if (clearAttachments) {
        state.attachments = [];
        state.attSelect.textContent = "";
        state.attSelect.style.display = "none";
      }
      const oldDoc = state.pdfDoc;
      state.pdfDoc = null;
      if (oldDoc?.destroy) void Promise.resolve(oldDoc.destroy()).catch(() => {
      });
      this.syncControls(state);
    }
    syncControls(state) {
      const hasDoc = state.numPages > 0;
      const pageText = hasDoc ? `${state.currentPage} / ${state.numPages}` : "0 / 0";
      state.pageLabel.textContent = pageText;
      state.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
      state.setSectionSummary?.(hasDoc ? pageText : "");
      state.prevBtn.disabled = !hasDoc || state.currentPage <= 1;
      state.nextBtn.disabled = !hasDoc || state.currentPage >= state.numPages;
      state.openBtn.disabled = !state.attachment;
    }
    async loadItemPreview(state, item) {
      this.disposeDocument(state, true);
      const gen = state.generation;
      if (!item) {
        applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-unavailable");
        return;
      }
      state.loading = true;
      applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-loading");
      const entries = await resolveAllPdfAttachments(item);
      if (state.generation !== gen) return;
      state.attachments = entries;
      if (entries.length > 1) {
        state.attSelect.textContent = "";
        entries.forEach((entry, idx) => {
          const opt = createXhtmlEl(state.doc, "option");
          opt.value = String(entry.id);
          opt.textContent = `${idx + 1}. ${entry.title}`;
          state.attSelect.append(opt);
        });
        state.attSelect.style.display = "block";
      } else state.attSelect.style.display = "none";
      if (!entries.length) {
        state.loading = false;
        ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
        applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-unavailable");
        return;
      }
      await this.loadAttachmentDocument(state, entries[0].attachment);
    }
    async loadAttachmentDocument(state, att) {
      this.disposeDocument(state, false);
      const gen = state.generation;
      state.loading = true;
      state.attachment = att;
      this.syncControls(state);
      applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-loading");
      try {
        const filePath = await resolveAttachmentPath(att);
        if (state.generation !== gen) return;
        if (!filePath) {
          state.loading = false;
          applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-missing-file");
          return;
        }
        const pdfDoc = await openPdfDocumentFromFile(filePath, state.doc);
        if (state.generation !== gen) {
          void Promise.resolve(pdfDoc.destroy?.()).catch(() => {
          });
          return;
        }
        state.loading = false;
        state.pdfDoc = pdfDoc;
        state.numPages = Math.max(0, pdfDoc.numPages || 0);
        state.currentPage = state.numPages > 0 ? 1 : 0;
        ensureSectionConnected(state.body, state.root, state.customSection, state.collapsible);
        if (!state.numPages) {
          applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-unavailable");
          return;
        }
        applyStatusMessage(state.statusEl, "");
        this.buildPageSlots(state, gen);
        this.syncControls(state);
      } catch (error) {
        if (state.generation !== gen) return;
        state.loading = false;
        Zotero.logError(error instanceof Error ? error : new Error(String(error)));
        applyStatusMessage(state.statusEl, "zotero-tabflow-pdf-preview-error");
      }
    }
    buildPageSlots(state, gen) {
      state.viewportEl.textContent = "";
      state.slots = [];
      const frag = state.doc.createDocumentFragment();
      for (let p = 1; p <= state.numPages; p++) {
        const card = createXhtmlEl(state.doc, "div");
        card.className = "ztf-pdf-page-card";
        card.setAttribute("data-unrendered", "true");
        card.setAttribute("data-page-number", String(p));
        const canvas = createXhtmlEl(state.doc, "canvas");
        canvas.className = "ztf-pdf-canvas";
        const badge = createXhtmlEl(state.doc, "span");
        badge.className = "ztf-pdf-page-badge";
        badge.textContent = String(p);
        card.addEventListener("dblclick", (e) => {
          if (state.attachment && getPref("pdfPreviewDoubleClickOpen")) {
            e.preventDefault?.();
            e.stopPropagation?.();
            void openPdfInReader(state.attachment, state.win, p);
          }
        });
        card.append(canvas, badge);
        frag.append(card);
        state.slots.push({ pageNumber: p, card, canvas, renderedZoom: null, rendering: false, lastHeight: 0 });
      }
      state.viewportEl.append(frag);
      const Observer = state.win.IntersectionObserver;
      if (Observer) {
        state.observer = new Observer((entries) => {
          if (state.generation !== gen) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const slot = state.slots.find((s) => s.card === entry.target);
            if (slot) void this.renderSlot(state, slot, gen);
          }
        }, { root: state.viewportEl, rootMargin: "320px 0px", threshold: 0.01 });
        for (const slot of state.slots) state.observer.observe(slot.card);
      }
      void this.renderSlot(state, state.slots[0], gen);
      if (state.slots[1]) void this.renderSlot(state, state.slots[1], gen);
    }
    async renderSlot(state, slot, gen) {
      if (!state.pdfDoc || state.generation !== gen || slot.rendering || slot.renderedZoom === state.zoom) return;
      slot.rendering = true;
      try {
        const w = Math.max(180, (state.viewportEl.clientWidth || state.body.clientWidth || 260) - 2);
        state.lastWidth = state.viewportEl.clientWidth || state.body.clientWidth || state.lastWidth;
        const m = await renderPageToCanvas(state.pdfDoc, slot.pageNumber, slot.canvas, w, state.zoom, state.win.devicePixelRatio || 1, () => state.generation !== gen, (c) => {
          slot.cancelTask = c;
        });
        if (state.generation === gen && m.height > 0) {
          slot.lastHeight = m.height;
          slot.card.removeAttribute("data-unrendered");
          slot.card.style.minBlockSize = "0";
          slot.renderedZoom = state.zoom;
        }
      } catch (error) {
        if (state.generation === gen) Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        slot.rendering = false;
        slot.cancelTask = void 0;
      }
    }
    jumpToPage(state, pageNumber) {
      if (!state.numPages) return;
      const target = Math.max(1, Math.min(state.numPages, pageNumber));
      state.currentPage = target;
      this.syncControls(state);
      const slot = state.slots[target - 1];
      if (!slot) return;
      state.viewportEl.scrollTop = Math.max(0, slot.card.offsetTop - (state.slots[0]?.card.offsetTop || 0));
      void this.renderSlot(state, slot, state.generation);
      evictDistantPageCanvases(state.slots, state.currentPage);
    }
    setZoom(state, nextZoom) {
      const clamped = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom)) * 100) / 100;
      if (clamped === state.zoom) return;
      state.zoom = clamped;
      this.syncControls(state);
      this.invalidateAndRenderVisible(state);
    }
    updateCurrentPageFromScroll(state) {
      if (!state.slots.length) return;
      const top = state.viewportEl.scrollTop + (state.slots[0]?.card.offsetTop || 0);
      let best = 1, bestDist = Infinity;
      for (const slot of state.slots) {
        const dist = Math.abs(slot.card.offsetTop - top);
        if (dist < bestDist) {
          bestDist = dist;
          best = slot.pageNumber;
        }
      }
      if (best !== state.currentPage) {
        state.currentPage = best;
        this.syncControls(state);
        evictDistantPageCanvases(state.slots, state.currentPage);
      }
    }
    unregister() {
      for (const obs of this.prefObservers.splice(0)) Zotero.Prefs?.unregisterObserver?.(obs);
      for (const state of this.states.values()) {
        if (state.resizeTimer !== null) state.win.clearTimeout?.(state.resizeTimer);
        state.resizeObserver?.disconnect();
        applyPreviewLayoutMode(state.body, state.root, state.customSection, false);
        this.disposeDocument(state, true);
        removePreviewStyles(state.doc);
      }
      for (const controller of this.listeners.values()) controller.abort();
      this.listeners.clear();
      this.states.clear();
      if (this.sectionID) {
        Zotero.ItemPaneManager?.unregisterSection?.(this.sectionID);
        this.sectionID = false;
      }
    }
  };

  // src/ui/session-preview.ts
  var XHTML4 = "http://www.w3.org/1999/xhtml";
  var SessionPreviewController = class {
    win;
    doc;
    overlay = null;
    restoreProgress = null;
    constructor(win, doc) {
      this.win = win;
      this.doc = doc;
    }
    h(tag, className) {
      const el = this.doc.createElementNS(XHTML4, tag);
      if (className) el.className = className;
      return el;
    }
    createPanel(buildBody, onClose) {
      this.dispose();
      const host = this.doc.body || this.doc.documentElement;
      if (!host) return;
      const backdrop = this.h("div");
      backdrop.id = "ztf-preview-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      const box = this.h("div", "ztf-preview-box");
      const close = () => {
        onClose?.();
        this.dispose();
      };
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
    openRestoreProgress(sessionName, onCancel) {
      this.createPanel((box, close) => {
        const title = this.h("div", "ztf-pv-title");
        title.textContent = t("zotero-tabflow-restore-progress-title", `正在准备恢复：${sessionName}`, { name: sessionName });
        const status = this.h("div", "ztf-pv-note");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.textContent = t("zotero-tabflow-restore-progress", "正在检查会话中的文献…");
        const progress = this.h("progress");
        progress.max = 1;
        progress.value = 0;
        progress.style.width = "100%";
        const footer = this.h("div", "ztf-pv-footer");
        const cancel = this.h("button", "ztf-pv-btn");
        cancel.type = "button";
        cancel.textContent = t("zotero-tabflow-cancel", "取消");
        cancel.onclick = close;
        footer.append(cancel);
        box.append(title, status, progress, footer);
        this.restoreProgress = status;
        cancel.focus?.();
      }, onCancel);
    }
    updateRestoreProgress(completed, total) {
      if (!this.restoreProgress) return;
      this.restoreProgress.textContent = t("zotero-tabflow-restore-progress-count", `正在检查文献：${completed} / ${total}`, { completed, total });
      const progress = this.overlay?.querySelector("progress");
      if (progress) {
        progress.max = Math.max(1, total);
        progress.value = completed;
      }
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
      this.restoreProgress = null;
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
          const ask = () => {
            if (this.disposed) return;
            const val = { value: String(threshold) };
            if (Services.prompt.prompt(this.win, t("zotero-tabflow-stale-btn", "建议关闭", { count: stale.length }), t("zotero-tabflow-stale-threshold-prompt", "多少天未查看后列入建议（1–3650）："), val, null, {})) {
              const num = Number(val.value);
              if (Number.isInteger(num) && num >= 1 && num <= 3650) {
                setPref("staleSuggestDays", num);
                this.onRefresh();
              }
            }
          };
          if (typeof this.win?.setTimeout === "function") this.win.setTimeout(ask, 0);
          else ask();
        });
      });
    }
    openWorkspaceHub(anchor) {
      if (!getPref("enableSessions")) return;
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
      const controller = new AbortController();
      const progressByPlan = [{ completed: 0, total: 0 }, { completed: 0, total: 0 }];
      const resolved = /* @__PURE__ */ new Map();
      const resolver = (libraryID, itemKey) => {
        const key = `${libraryID}:${itemKey}`;
        let pending = resolved.get(key);
        if (!pending) {
          pending = Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey).then((item) => item || null).catch(() => null);
          resolved.set(key, pending);
        }
        return pending ?? Promise.resolve(null);
      };
      this.preview.openRestoreProgress(session.name, () => controller.abort());
      try {
        const openKeys = this.meta.buildTrackedTabs().map((item) => item.key);
        const [mergePlan, replacePlan] = await Promise.all([
          buildSessionRestorePlan(this.store, openKeys, session, true, resolver, (completed, total) => {
            progressByPlan[0] = { completed, total };
            this.preview.updateRestoreProgress(progressByPlan.reduce((n, p) => n + p.completed, 0), progressByPlan.reduce((n, p) => n + p.total, 0));
          }, controller.signal),
          buildSessionRestorePlan(this.store, openKeys, session, false, resolver, (completed, total) => {
            progressByPlan[1] = { completed, total };
            this.preview.updateRestoreProgress(progressByPlan.reduce((n, p) => n + p.completed, 0), progressByPlan.reduce((n, p) => n + p.total, 0));
          }, controller.signal)
        ]);
        if (this.disposed || controller.signal.aborted) return;
        this.preview.openRestorePreview(mergePlan, replacePlan, (chosen) => this.executePlan(chosen));
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        this.preview.dispose();
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
        const result = await executeSessionRestorePlan(
          plan,
          this.store,
          (itemID) => this.actions.openVirtualOrItem(itemID, void 0, true),
          openKeys,
          () => this.disposed
        );
        if (!this.disposed && (result.failed || plan.missing.length)) {
          const missing = plan.missing.length;
          Services.prompt.alert(this.win, "Zotero TabFlow", t(
            "zotero-tabflow-session-restore-partial",
            `工作区已应用。已打开 ${result.opened} 项，打开失败 ${result.failed} 项，未找到 ${missing} 项。`,
            { ...result, missing }
          ));
        }
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
        if (this.disposed || res !== Ci.nsIFilePicker.returnOK && res !== Ci.nsIFilePicker.returnReplace) return;
        const version = Zotero.zoterotabflow?.version;
        await Zotero.File.putContentsAsync(fp.file, exportSessionsJson(this.store.state.sessions, version), "utf-8");
      } catch (error) {
        Zotero.logError(error);
        if (!this.disposed) Services.prompt.alert(this.win, "Zotero TabFlow", t("zotero-tabflow-export-error", "无法写入会话文件。请检查保存位置和文件权限。"));
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
          const imported = this.store.importSessions(preview.sessions);
          if (imported < preview.sessions.length) {
            const skipped = preview.sessions.length - imported;
            Services.prompt.alert(this.win, "Zotero TabFlow", t(
              "zotero-tabflow-import-partial",
              `已导入 ${imported} 个会话，未导入 ${skipped} 个。请检查可用会话容量及工作区是否可写。`,
              { imported, skipped }
            ));
          }
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

  // src/ui/sidebar-hover.ts
  var SidebarHoverCard = class {
    win;
    doc;
    store;
    card = null;
    showTimer = null;
    constructor(win, doc, store) {
      this.win = win;
      this.doc = doc;
      this.store = store;
    }
    mount() {
      if (this.card) return;
      const card = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      card.id = "ztf-hover-card";
      card.hidden = true;
      this.doc.documentElement?.append(card);
      this.card = card;
    }
    scheduleShow(fn, delayMs = 180) {
      this.cancelTimer();
      if (typeof this.win?.setTimeout === "function") {
        this.showTimer = this.win.setTimeout(() => {
          this.showTimer = null;
          fn();
        }, delayMs);
      } else {
        fn();
      }
    }
    cancelTimer() {
      if (this.showTimer !== null) {
        this.win?.clearTimeout?.(this.showTimer);
        this.showTimer = null;
      }
    }
    show(anchor, tab, placement = "right") {
      if (!getPref("enableHoverPreview") || !this.card) return;
      const reader = Zotero.Reader?.getByTabID?.(tab.tab.id);
      const pageIdx = reader?.state?.pageIndex;
      const numPages = reader?._internalReader?._pdfDocument?.numPages;
      const pageText = typeof pageIdx === "number" && pageIdx >= 0 ? typeof numPages === "number" && numPages > 0 ? t("zotero-tabflow-hover-page-of", `第 ${pageIdx + 1} / ${numPages} 页`, { page: pageIdx + 1, total: numPages }) : t("zotero-tabflow-hover-page", `第 ${pageIdx + 1} 页`, { page: pageIdx + 1 }) : "";
      const itemObj = tab.itemID ? Zotero.Items.get(tab.itemID) : null;
      const annots = itemObj?.isAttachment?.() && typeof itemObj?.getAnnotations === "function" ? itemObj.getAnnotations()?.length : void 0;
      const annotText = typeof annots === "number" && annots >= 0 ? t("zotero-tabflow-hover-annots", `批注 ${annots} 条`, { count: annots }) : "";
      const readerMeta = [pageText, annotText].filter(Boolean).join(" · ");
      this.renderCard(anchor, tab.key, tab.title, tab.creatorYear, tab.source, tab.collection, readerMeta, placement);
    }
    showVirtual(anchor, member, groupName = "", placement = "below") {
      if (!getPref("enableHoverPreview") || !this.card) return;
      const col = [member.collection, groupName].filter(Boolean).join(" · ");
      this.renderCard(anchor, member.key, member.title, member.creatorYear, member.source, col, t("zotero-tabflow-spot-virtual-hint", "虚拟保留"), placement);
    }
    renderCard(anchor, key, title, creatorYear, source, collection, extraMeta, placement) {
      if (!this.card) return;
      const h = this.store.state.history[key];
      const last = h?.lastViewed;
      const days = last ? Math.max(0, Math.floor((Date.now() - last) / 864e5)) : 0;
      const remark = getPref("enableTabRemarks") ? this.store.getRemark(key).note : "";
      this.card.textContent = "";
      const mk = (cls, text) => {
        const d = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        d.className = cls;
        d.textContent = text;
        return d;
      };
      const lastText = !last ? t("zotero-tabflow-hover-never-viewed", "尚未查看") : days === 0 ? t("zotero-tabflow-hover-today", "今天") : t("zotero-tabflow-hover-days-ago", `${days} 天前`, { days });
      this.card.append(
        mk("ztf-hc-title", title),
        mk("ztf-hc-meta", [creatorYear, source].filter(Boolean).join(" · ") || t("zotero-tabflow-hover-no-meta", "暂无作者/期刊元数据")),
        mk("ztf-hc-meta", t("zotero-tabflow-hover-collection-last", `集合：${collection} · 上次阅读：${lastText}`, { collection, time: lastText }))
      );
      if (extraMeta) this.card.append(mk("ztf-hc-meta", extraMeta));
      if (remark) this.card.append(mk("ztf-hc-note", t("zotero-tabflow-hover-remark", `备注：${remark}`, { note: remark })));
      const rect = anchor.getBoundingClientRect();
      this.card.hidden = false;
      const cardRect = this.card.getBoundingClientRect?.();
      const cardW = cardRect?.width ? Math.ceil(cardRect.width) + 16 : 332;
      const cardH = cardRect?.height ? Math.ceil(cardRect.height) + 12 : 165;
      const left = placement === "below" ? Math.min(rect.left, this.win.innerWidth - cardW) : Math.min(rect.right + 8, this.win.innerWidth - cardW);
      const top = placement === "below" ? Math.min(rect.bottom + 6, this.win.innerHeight - cardH) : Math.min(rect.top, this.win.innerHeight - cardH);
      this.card.style.left = `${Math.max(8, left)}px`;
      this.card.style.top = `${Math.max(8, top)}px`;
    }
    hide() {
      this.cancelTimer();
      if (this.card && !this.card.hidden) this.card.hidden = true;
    }
    dispose() {
      this.cancelTimer();
      this.card?.remove();
      this.card = null;
    }
  };

  // src/services/spotlight-library.ts
  var INDEX_BATCH_SIZE = 200;
  async function buildSpotlightLibraryIndex(win, meta, isDisposed) {
    const api = Zotero.Libraries;
    const libraries = api?.getAll?.();
    const libraryIDs = Array.isArray(libraries) ? [...new Set(libraries.map((library) => library?.libraryID).filter((id) => Number.isInteger(id) && Number(id) > 0))] : [api?.userLibraryID ?? 1];
    const entries = [];
    let complete = true;
    for (const libraryID of libraryIDs) {
      if (isDisposed()) return null;
      try {
        const items = await Zotero.Items?.getAll?.(libraryID, true, false, false);
        if (isDisposed()) return null;
        if (!Array.isArray(items)) {
          complete = false;
          continue;
        }
        let libraryName = "";
        try {
          libraryName = api?.getName?.(libraryID) || "";
        } catch {
        }
        for (let i = 0; i < items.length; i++) {
          if (i > 0 && i % INDEX_BATCH_SIZE === 0) {
            await new Promise((resolve) => win.setTimeout(resolve, 0));
            if (isDisposed()) return null;
          }
          const item = items[i];
          if (!item?.isRegularItem?.() || item.deleted) continue;
          const title = meta.plainTitle(String(item.getField?.("title") || "")) || item.key;
          const creators = item.getCreators?.() || [];
          const author = creators[0]?.lastName || creators[0]?.firstName || "";
          const year = String(item.getField?.("year") || "").slice(0, 4);
          const pub = String(item.getField?.("publicationTitle") || item.getField?.("proceedingsTitle") || "");
          entries.push({
            id: item.id,
            fullKey: `${libraryID}:${item.key}`,
            title,
            metaHint: [libraryName, author, year, pub].filter(Boolean).join(" · "),
            searchText: `${title} ${author} ${year} ${pub} ${libraryName}`.toLowerCase()
          });
        }
      } catch {
        complete = false;
      }
    }
    return { entries, complete };
  }

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
    cacheExpiresAt = 0;
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
            if (!item.keepOpen) this.close();
          }
        }
      });
    }
    handleGlobalShortcut = (e) => {
      if (!getPref("enableSpotlight")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        if (this.panel?.state === "open") this.close();
        else this.open();
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
      if (Date.now() < this.cacheExpiresAt) return Promise.resolve();
      if (this.libraryLoad) return this.libraryLoad;
      this.libraryLoading = true;
      this.libraryLoad = (async () => {
        try {
          const index = await buildSpotlightLibraryIndex(this.win, this.meta, () => !this.panel);
          if (index && this.panel) {
            this.libraryCache = index.entries;
            this.cacheExpiresAt = Date.now() + (index.complete ? 12e4 : 1e4);
          }
        } catch {
        } finally {
          this.libraryLoading = false;
          this.libraryLoad = null;
          if (["open", "showing"].includes(this.panel?.state) && this.input?.value.trim().startsWith("@")) this.renderResults();
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
      const matches = (value) => terms.every((term) => value.toLowerCase().includes(term));
      const tabMatches = (tab) => matches(`${this.store.getRemark(tab.key).note} ${tab.title} ${tab.shortTitle} ${tab.filename} ${tab.collection} ${tab.creatorYear} ${names.get(tab.groupId) ?? ""}`);
      if (tabsMode) {
        const viewedAt = (key) => this.store.state.history[key]?.lastViewed ?? 0;
        tabs.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
      }
      const tabEntries = q.startsWith(">") && !tabsMode || libMode ? [] : tabs.filter((tab) => tabMatches(tab)).map((tab) => {
        const gName = names.get(tab.groupId) || t("zotero-tabflow-ungrouped", "未分组");
        const r = getPref("enableTabRemarks") ? this.store.getRemark(tab.key).note : "";
        return { label: `${tab.pinned ? "📌 " : ""}${r || tab.title}`, hint: `${gName} · ${tab.collection}`, run: () => this.actions.selectTab(tab.tab.id) };
      });
      const openKeys = new Set(tabs.map((tab) => tab.key));
      const visibleVirtuals = q.startsWith(">") && !tabsMode || libMode || tabsMode || !getPref("enableVirtualMembers") ? [] : Object.values(this.store.state.virtualMembers).flatMap((m) => {
        const gid = this.store.groupOfKey(m.key);
        if (openKeys.has(m.key) || !matches(`${this.store.getRemark(m.key).note} ${m.title} ${m.shortTitle} ${m.filename} ${m.collection} ${m.creatorYear} ${names.get(gid) ?? ""}`)) return [];
        const r = getPref("enableTabRemarks") ? this.store.getRemark(m.key).note : "";
        return [{ label: `◌ ${r || m.title}`, hint: `${names.get(gid) || t("zotero-tabflow-ungrouped", "未分组")} · ${t("zotero-tabflow-spot-virtual-hint", "虚拟保留")}`, run: () => void this.actions.openVirtualOrItem(m.itemID, gid, false, m.key).then((ok) => {
          if (!ok) Services.prompt.alert(this.win, m.title, t("zotero-tabflow-spot-hidden-open-failed", "未能打开这篇文献。请检查附件文件是否可用。"));
          this.onRefresh();
        }) }];
      });
      const allTabEntries = [...tabEntries, ...visibleVirtuals];
      const libraryEntries = [];
      if (libMode && terms.length) {
        const openItemIds = new Set(tabs.flatMap((tab) => [tab.itemID, tab.parentItemID]));
        const libHintFallback = t("zotero-tabflow-spot-hint-library", "文献库 · 打开");
        for (const it of this.libraryCache) {
          if (openKeys.has(it.fullKey) || openItemIds.has(it.id) || !terms.every((term) => it.searchText.includes(term))) continue;
          libraryEntries.push({
            label: `📖 ${it.title}`,
            hint: it.metaHint || libHintFallback,
            run: () => void this.actions.openVirtualOrItem(it.id).then(async (opened) => {
              if (!opened) await this.win.ZoteroPane?.selectItem?.(it.id);
              this.onRefresh();
            }).catch((error) => Zotero.logError(error))
          });
          if (libraryEntries.length >= 6) break;
        }
      }
      const selectedID = this.meta.getSelectedTabID();
      const activeTab = tabs.find((tab) => tab.tab.id === selectedID);
      const sessionEntries = !getPref("enableSessions") || libMode ? [] : [...this.store.state.sessions, ...this.store.state.rollingSessions ?? []].map((s) => ({
        label: `💾 ${t("zotero-tabflow-spot-session-prefix", "会话")}：${s.name} (${s.openKeys.length})`,
        hint: t("zotero-tabflow-spot-session-hint", "预览并恢复"),
        run: () => this.win.setTimeout(() => void this.popovers.previewAndRestoreSession(s), 0)
      })).filter((e) => !terms.length || terms.every((term) => `${e.label} ${e.hint}`.toLowerCase().includes(term)));
      const cmdEntries = libMode ? [] : [
        ...getPref("enableSessions") ? [{
          label: `🗂️ ${t("zotero-tabflow-spot-cmd-workspace", "打开 TabFlow 工作区…")}`,
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
        ...getPref("enableTabSleep") ? [{
          label: `💤 ${t("zotero-tabflow-spot-cmd-sleep", "休眠所有后台非固定标签")}`,
          hint: t("zotero-tabflow-spot-hint-sleep", "释放内存"),
          run: () => {
            this.actions.sleepInactiveTabs();
            this.onRefresh();
          }
        }] : [],
        ...getPref("enableSessions") && !this.store.readOnly ? [{
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
          ...activeTab.itemID && activeTab.tab.type?.startsWith("reader") && getPref("enableShowInFilesystem") ? [{
            label: `📂 ${t("zotero-tabflow-spot-cmd-pdf-folder", "打开当前 PDF 附件所在文件夹")}`,
            hint: t("zotero-tabflow-spot-hint-folder", "文件夹"),
            run: () => void this.actions.showInFilesystem(activeTab.tab.id)
          }] : []
        ] : []
      ].filter((c) => !terms.length || terms.every((term) => `${c.label} ${c.hint}`.toLowerCase().includes(term)));
      const helpMode = q === "?";
      const fill = (prefix) => {
        if (this.input) {
          this.input.value = prefix;
          this.input.focus();
          this.renderResults();
        }
      };
      const helpEntries = helpMode ? [
        { label: "@关键词", hint: t("zotero-tabflow-spot-help-lib", "搜索全部文库中的文献（不限于已打开标签）"), keepOpen: true, run: () => fill("@") },
        { label: ">tabs", hint: t("zotero-tabflow-spot-help-tabs", "列出所有打开标签并按最近阅读时间排序"), keepOpen: true, run: () => fill(">tabs ") },
        { label: ">命令", hint: t("zotero-tabflow-spot-help-cmd", "筛选保存工作区、切换侧边栏等快捷操作"), keepOpen: true, run: () => fill(">") }
      ] : [];
      const sections = helpMode ? [[t("zotero-tabflow-spot-help-hint", "搜索语法提示"), helpEntries]] : [
        [t("zotero-tabflow-spot-section-tabs", "打开的标签"), allTabEntries],
        [t("zotero-tabflow-spot-section-library", "文库文献"), libraryEntries],
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
        if (!entry.keepOpen) this.close();
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
      this.libraryCache = [];
      this.cacheExpiresAt = 0;
    }
  };

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
    disposed = false;
    defer(fn) {
      const run = () => {
        if (!this.disposed) fn();
      };
      if (typeof this.win?.setTimeout === "function") this.win.setTimeout(run, 0);
      else run();
    }
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
      const tabMenuEnabled = getPref("enableTabContextMenu");
      if (!tabMenuEnabled && (tracked.groupId || !this.canRestoreUngroupedHeading())) return;
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        if (!tracked.groupId) this.addUngroupedHeadingRestore(popup);
        if (!tabMenuEnabled) return;
        if (getPref("enablePinnedTabs")) {
          this.item(popup, tracked.pinned ? t("zotero-tabflow-menu-unpin", "取消固定标签") : `📌 ${t("zotero-tabflow-menu-pin", "固定标签（防误关）")}`, () => {
            this.store.togglePinned(tracked.key);
            this.onRefresh();
          });
        }
        if (getPref("enableTabRemarks")) {
          const remark = this.store.getRemark(tracked.key);
          this.item(popup, remark.note ? `✎ ${t("zotero-tabflow-menu-edit-remark", "编辑标签备注…")}` : `✎ ${t("zotero-tabflow-menu-set-remark", "设置标签备注…")}`, () => {
            this.defer(() => {
              const val = { value: remark.note };
              if (Services.prompt.prompt(this.win, t("zotero-tabflow-menu-set-remark", "设置标签备注"), t("zotero-tabflow-remark-prompt", "输入备注（≤300 字，不改原文件名）："), val, null, {})) {
                this.store.setRemark(tracked.key, val.value);
                this.onRefresh();
              }
            });
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
          this.defer(() => {
            const val = { value: "" };
            if (Services.prompt.prompt(this.win, t("zotero-tabflow-new-group-title", "新建分组"), t("zotero-tabflow-new-group-prompt", "分组名称："), val, null, {}) && val.value.trim()) {
              const g = this.store.ensureGroup(val.value);
              this.store.assignKey(tracked.key, g.id);
              this.onRefresh();
            }
          });
        });
        this.item(groupPop, t("zotero-tabflow-menu-remove-group", "移出分组"), () => {
          this.store.assignKey(tracked.key, "");
          this.onRefresh();
        }, { disabled: !tracked.groupId });
        popup.append(this.xul("menuseparator"));
        this.item(popup, t("zotero-tabflow-menu-show-library", "在文献库中定位"), () => this.actions.showInLibrary(tracked.tab.id));
        this.item(popup, t("zotero-tabflow-menu-show-collection", "在集合树中定位所属集合"), () => void this.actions.showCollectionInLibrary(tracked.tab.id).catch((error) => Zotero.logError(error)));
        if (getPref("enableCopyReference")) this.item(popup, t("zotero-tabflow-menu-copy-ref", "复制引用到剪贴板"), () => this.actions.copyReference(tracked.tab.id));
        if (getPref("enableShowInFilesystem")) this.item(popup, t("zotero-tabflow-menu-show-fs", "在文件管理器中显示"), () => void this.actions.showInFilesystem(tracked.tab.id));
        if (getPref("enableReloadTab") && tracked.tab.type.startsWith("reader")) this.item(popup, t("zotero-tabflow-menu-reload", "重新加载标签页"), () => void this.actions.reloadTab(tracked.tab.id));
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
          this.defer(() => {
            const val = { value: group.name };
            if (Services.prompt.prompt(this.win, t("zotero-tabflow-rename-group-title", "重命名分组"), t("zotero-tabflow-rename-group-prompt", "分组名称："), val, null, {}) && val.value.trim()) {
              this.store.renameGroup(group.id, val.value);
              this.onRefresh();
            }
          });
        });
        const virtualMembers = Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === group.id);
        if (!group.id) {
          const ungroupedTabs = this.meta.buildTrackedTabs().filter((tab) => !tab.groupId);
          const ungrouped = ungroupedTabs.filter((tab) => !tab.pinned);
          this.item(popup, t("zotero-tabflow-menu-convert-ungrouped", `将未分组文献转为新分组… (${ungrouped.length})`, { count: ungrouped.length }), () => {
            this.defer(() => {
              const val = { value: "" };
              if (Services.prompt.prompt(this.win, t("zotero-tabflow-new-group-title", "新建分组"), t("zotero-tabflow-new-group-prompt", "分组名称："), val, null, {}) && val.value.trim()) {
                const g = this.store.ensureGroup(val.value);
                for (const item of ungrouped) this.store.assignKey(item.key, g.id);
                this.onRefresh();
              }
            });
          }, { disabled: !ungrouped.length });
        }
        this.item(popup, t("zotero-tabflow-dissolve-group", "解散此分组"), () => this.defer(() => this.confirmDissolve(group)));
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
          this.defer(() => {
            const val = { value: group.color };
            if (Services.prompt.prompt(this.win, t("zotero-tabflow-menu-custom-color", "自定义颜色"), t("zotero-tabflow-custom-color-prompt", "输入 3 位或 6 位 Hex 颜色："), val, null, {})) {
              this.store.setGroupColor(group.id, val.value);
              this.onRefresh();
            }
          });
        });
        popup.append(this.xul("menuseparator"));
        if (getPref("enableSessions") && !this.store.readOnly) {
          this.item(popup, t("zotero-tabflow-menu-archive-group", "保存到工作区并关闭…"), () => this.defer(() => {
            const title = t("zotero-tabflow-menu-archive-group", "保存到工作区并关闭…");
            const name = group.name.trim().slice(0, 60);
            const idx = findMatchingSessionIndex(this.store.state, name, "manual");
            if (idx >= 0 && !Services.prompt.confirm(this.win, title, t("zotero-tabflow-archive-overwrite", "同名工作区已存在。要覆盖它吗？"))) return;
            void this.actions.archiveGroup(group.id, name).then((remaining) => {
              this.onRefresh();
              if (remaining) Services.prompt.alert(this.win, title, t("zotero-tabflow-archive-remaining", "工作区已保存。仍有 { $count } 个标签未关闭，分组已保留。", { count: remaining }));
            }).catch((error) => {
              Zotero.logError(error);
              Services.prompt.alert(this.win, title, t("zotero-tabflow-archive-failed", "无法保存并关闭工作区。"));
            });
          }));
        }
        this.item(popup, t("zotero-tabflow-menu-collapse-others", "折叠其他分组"), () => {
          this.store.collapseOtherGroups(group.id);
          this.onRefresh();
        }, { disabled: !this.store.visibleGroups().some((g) => g.id !== group.id) });
        if (virtualMembers.length) {
          this.item(popup, `▶ ${t("zotero-tabflow-menu-open-virtual-all", `打开组内全部虚拟文献 (${virtualMembers.length})`, { count: virtualMembers.length })}`, () => {
            void (async () => {
              for (const m of virtualMembers) await this.actions.openVirtualOrItem(m.itemID, group.id, false, m.key);
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
        if (!groupId) this.addUngroupedHeadingRestore(popup);
        this.item(popup, `▶ ${t("zotero-tabflow-menu-load-virtual", "加载标签页")}`, () => {
          void this.actions.openVirtualOrItem(member.itemID, groupId, false, member.key).then((opened) => {
            if (!opened) Services.prompt.alert(this.win, member.title, t("zotero-tabflow-spot-hidden-open-failed", "未能打开这篇文献。请检查附件文件是否可用。"));
            this.onRefresh();
          });
        });
        this.item(popup, t("zotero-tabflow-menu-remove-virtual", "从分组移除虚拟成员"), () => {
          this.store.removeVirtualMember(member.key);
          this.store.assignKey(member.key, "");
          this.onRefresh();
        });
      });
    }
    canRestoreUngroupedHeading() {
      return getPref("newTabMode") === "collection" && this.store.state.ungroupedHeadingHidden === true;
    }
    addUngroupedHeadingRestore(popup) {
      if (!this.canRestoreUngroupedHeading()) return;
      this.item(popup, t("zotero-tabflow-show-ungrouped-heading", "恢复未分组标题"), () => {
        if (this.store.setUngroupedHeadingHidden(false)) this.onRefresh();
      }, { disabled: this.store.readOnly });
    }
    confirmDissolve(group) {
      const title = t("zotero-tabflow-dissolve-group", "解散此分组");
      try {
        if (group.id) {
          const message = t("zotero-tabflow-dissolve-group-confirm", `解散“${group.name}”？标签页将保留并回到未分组。`, { name: group.name });
          if (!Services.prompt.confirm(this.win, title, message)) return;
        }
        if (this.store.dissolveGroup(group.id)) {
          this.onRefresh();
          return;
        }
      } catch (error) {
        Zotero.logError(error);
      }
      Services.prompt.alert(this.win, title, t("zotero-tabflow-dissolve-group-failed", "无法解散分组：数据为只读，或分组已不存在。"));
    }
    dispose() {
      this.disposed = true;
      for (const p of this.popups) {
        p.hidePopup?.();
        p.remove();
      }
      this.popups.clear();
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
      if (e.key === "F2" && navType === "head") {
        e.preventDefault();
        focusedNav.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 }));
        return;
      }
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
    row.onclick = () => void deps.actions.openVirtualOrItem(v.itemID, groupId, false, v.key).then((opened) => {
      if (!opened) Services.prompt.alert(deps.doc.defaultView ?? null, v.title, t("zotero-tabflow-spot-hidden-open-failed", "未能打开这篇文献。请检查附件文件是否可用。"));
      deps.onRefresh();
    });
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
    if (item.itemID && item.tab.type.startsWith("reader")) row.append(folderBtn);
    deps.selection?.addCheckbox(row, item);
    row.onclick = () => {
      deps.hoverCard.hide();
      deps.actions.selectTab(item.tab.id);
    };
    row.oncontextmenu = (e) => {
      deps.hoverCard.hide();
      deps.menus.openTabMenu(e, item);
    };
    row.onmouseenter = () => deps.hoverCard.scheduleShow(() => deps.hoverCard.show(row, item, "right"), 120);
    row.onmouseleave = () => deps.hoverCard.hide();
    row.onmousedown = () => deps.hoverCard.hide();
    row.ondragstart = (event) => {
      deps.hoverCard.hide();
      deps.setDraggedKey(item.key);
      deps.setDraggedTabId(item.tab.id);
      const dt = event.dataTransfer;
      dt?.setData(TABFLOW_DRAG_MIME, item.key);
      dt?.setData("text/plain", item.key);
    };
    row.ondragover = (e) => {
      const dt = e.dataTransfer;
      const dragged = deps.getDraggedKey();
      const hasCrossTab = !dragged && hasTabFlowDraggedTab(dt);
      const hasExt = !dragged && !hasCrossTab && hasZoteroDraggedItems(dt);
      if ((!dragged || dragged === item.key) && !hasCrossTab && !hasExt) return;
      e.preventDefault();
      if (hasExt) {
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
      const dt = e.dataTransfer;
      const dragged = deps.getDraggedKey() || dt?.getData(TABFLOW_DRAG_MIME) || "";
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
      const extIds = parseZoteroDraggedItemIDs(dt);
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
    const sig = `${counts.active}|${counts.sleeping}|${counts.virtual}|${counts.overBudget ? counts.budget : 0}`;
    if (bar.dataset?.ztfSig === sig) return;
    if (bar.dataset) bar.dataset.ztfSig = sig;
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
    constructor(win, doc, store, meta, actions, menus, onRefresh, onRestoreLastSession, sharedHoverCard) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.menus = menus;
      this.onRefresh = onRefresh;
      this.onRestoreLastSession = onRestoreLastSession;
      this.ownsHoverCard = !sharedHoverCard;
      this.hoverCard = sharedHoverCard ?? new SidebarHoverCard(win, doc, store);
    }
    sidebar = null;
    listEl = null;
    statusEl = null;
    selection = null;
    searchInput = null;
    hoverCard;
    ownsHoverCard;
    viewMode = "groups";
    draggedKey = null;
    draggedTabId = null;
    groupSections = /* @__PURE__ */ new Map();
    collapsedSections = /* @__PURE__ */ new Set();
    stopResize = null;
    lastStyleSig = "";
    searchTimer = null;
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
          if (!Services.prompt.prompt(this.win, t("zotero-tabflow-new-group-title", "新建标签分组"), t("zotero-tabflow-new-group-prompt", "请输入新分组名称："), input, null, {})) return;
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
      search.oninput = () => {
        if (this.searchTimer !== null) {
          this.win.clearTimeout(this.searchTimer);
          this.searchTimer = null;
        }
        if (!search.value.trim()) {
          this.renderList();
          return;
        }
        this.searchTimer = this.win.setTimeout(() => {
          this.searchTimer = null;
          this.renderList();
        }, 60);
      };
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
      list.addEventListener("scroll", () => this.hoverCard.hide(), { passive: true });
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
      if (this.ownsHoverCard) this.hoverCard.mount();
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
        this.stopResize?.();
        resizer.classList.add("active");
        const startX = me.clientX;
        const startWidth = aside.getBoundingClientRect().width;
        const onMove = (ev) => aside.style.setProperty("--ztf-sb-width", `${Math.min(440, Math.max(200, Math.round(startWidth + ev.clientX - startX)))}px`);
        const cleanup = () => {
          resizer.classList.remove("active");
          this.win.removeEventListener("mousemove", onMove, true);
          this.win.removeEventListener("mouseup", onUp, true);
          this.stopResize = null;
        };
        const onUp = () => {
          cleanup();
          setPref("verticalSidebarWidth", Math.round(aside.getBoundingClientRect().width));
        };
        this.stopResize = cleanup;
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
        this.sidebar.hidden = true;
        this.sidebar.classList.toggle("collapsed", collapsed);
        return;
      }
      this.sidebar.hidden = false;
      this.sidebar.classList.remove("collapsed");
      const sbW = getPref("verticalSidebarWidth"), rowH = getPref("verticalTabRowHeight"), fontSz = getPref("verticalTabFontSize");
      const styleSig = `${sbW}|${rowH}|${fontSz}`;
      if (this.lastStyleSig !== styleSig) {
        this.lastStyleSig = styleSig;
        this.sidebar.style.setProperty("--ztf-sb-width", `${sbW}px`);
        this.sidebar.style.setProperty("--ztf-row-height", `${rowH}px`);
        this.sidebar.style.setProperty("--ztf-font-size", `${fontSz}px`);
      }
      this.renderList(tracked);
    }
    renderList(snapshot) {
      if (!this.listEl) return;
      this.hoverCard.hide();
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
      if (this.viewMode === "groups") {
        if (!this.groupSections.size) this.listEl.replaceChildren();
        const tabsByGroup = indexGroupMembers(allTracked, (tab) => tab.groupId);
        const virtualsByGroup = indexGroupMembers(matchingVirtuals, (member) => this.store.groupOfKey(member.key));
        const collapsedIds = new Set(this.store.state.collapsed);
        const showUngrouped = getPref("newTabMode") === "collection" && !this.store.state.ungroupedHeadingHidden;
        const renderedGroups = groups.filter((g) => {
          const hasOpenMembers = tabsByGroup.has(g.id);
          const hasVirtualMembers = virtualsByGroup.has(g.id);
          const hasCustomHeading = showUngrouped && Boolean(this.store.state.ungroupedName);
          return shouldRenderGroupHeading(g.id, hasOpenMembers, hasVirtualMembers, hasCustomHeading);
        });
        for (const g of renderedGroups) {
          const members = tabsByGroup.get(g.id) ?? [];
          const virtuals = virtualsByGroup.get(g.id) ?? [];
          const showHeading = Boolean(g.id) || showUngrouped;
          const collapsed = showHeading && collapsedIds.has(g.id);
          const section = this.getGroupSection(g.id);
          section.element.style.setProperty("--ztf-group-dot", g.color);
          section.update(g, collapsed, members.length + virtuals.length, showHeading);
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
          const openCols = indexGroupMembers(allTracked, (tab) => tab.collection);
          const virtCols = indexGroupMembers(matchingVirtuals, (m) => m.collection);
          [.../* @__PURE__ */ new Set([...openCols.keys(), ...virtCols.keys()])].forEach((col, i) => {
            const items = openCols.get(col) ?? [];
            const vItems = virtCols.get(col) ?? [];
            const sec = buildSidebarSection(this.doc, this.collapsedSections, `col:${col}`, col, colors[i % colors.length], items.length + vItems.length, () => {
              const g = this.store.ensureGroup(col);
              this.store.assignKeys([...items, ...vItems].map((x) => x.key), g.id);
              this.viewMode = "groups";
              this.onRefresh();
            });
            const body = sec.querySelector(".ztf-sb-group-body");
            for (const item of items) body.append(buildSidebarTabRow(this.rowDeps(), item, selectedID));
            for (const v of vItems) body.append(buildSidebarVirtualRow(this.rowDeps(), v, this.store.groupOfKey(v.key)));
            this.listEl.append(sec);
          });
        } else if (allTracked.length || matchingVirtuals.length) {
          const deps = this.rowDeps();
          for (const [id, label, color, items, vItems] of [
            ["status:active", t("zotero-tabflow-sidebar-status-active", "已加载阅读器"), "#16a34a", allTracked.filter((x) => x.status === "active"), []],
            ["status:sleeping", t("zotero-tabflow-sidebar-status-sleeping", "已休眠省内存"), "#d97706", allTracked.filter((x) => x.status === "sleeping"), []],
            ["status:virtual", t("zotero-tabflow-sidebar-status-virtual", "虚拟保留成员"), "#64748b", [], matchingVirtuals]
          ]) {
            const sec = buildSidebarSection(this.doc, this.collapsedSections, id, label, color, items.length + vItems.length);
            const body = sec.querySelector(".ztf-sb-group-body");
            for (const item of items) body.append(buildSidebarTabRow(deps, item, selectedID));
            for (const v of vItems) body.append(buildSidebarVirtualRow(deps, v, this.store.groupOfKey(v.key)));
            this.listEl.append(sec);
          }
        }
      }
      const noMatches = Boolean(q) && !allTracked.length && !matchingVirtuals.length;
      const noNonGroupRows = this.viewMode !== "groups" && !allTracked.length && !matchingVirtuals.length;
      const brandNewEmpty = !q && this.viewMode === "groups" && !allTracked.length && !virtualList.length && !groups.some((g) => Boolean(g.id));
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
        { section: "ztf-sb-group", heading: "ztf-sb-group-head", body: "ztf-sb-group-body" },
        (closed) => this.store.setCollapsed(id, closed),
        (name) => this.store.renameGroup(id, name)
      );
      section.heading.dataset.ztfNav = "head";
      section.heading.dataset.ztfNavId = id;
      section.heading.prepend(this.h("span", "ztf-sb-dot"));
      section.heading.ondragover = (e) => {
        const dt = e.dataTransfer;
        if (this.draggedKey || hasTabFlowDraggedTab(dt) || hasZoteroDraggedItems(dt)) e.preventDefault();
      };
      section.heading.ondrop = (e) => {
        e.preventDefault();
        const dt = e.dataTransfer;
        const dropped = this.draggedKey || dt?.getData(TABFLOW_DRAG_MIME) || "";
        if (dropped) {
          this.store.assignKey(dropped, id);
          this.draggedKey = null;
          this.draggedTabId = null;
          this.onRefresh();
          return;
        }
        const extIds = parseZoteroDraggedItemIDs(dt);
        if (extIds.length) void Promise.all(extIds.map((itemID) => this.actions.openVirtualOrItem(itemID, id))).then(this.onRefresh);
      };
      this.groupSections.set(id, section);
      return section;
    }
    clearGroupSections() {
      for (const section of this.groupSections.values()) section.dispose();
      this.groupSections.clear();
    }
    dispose() {
      if (this.searchTimer !== null) {
        this.win.clearTimeout(this.searchTimer);
        this.searchTimer = null;
      }
      this.stopResize?.();
      this.lastStyleSig = "";
      this.clearGroupSections();
      if (this.ownsHoverCard) this.hoverCard.dispose();
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
#tab-bar-container[data-ztf-inline]:not([hidden]) { flex: 1 1 0%; min-width: 0; overflow: hidden; }
#tab-bar-container[data-ztf-inline] > div { min-width: 0; flex: 1 1 0%; }
#tab-bar-container[data-ztf-inline] .tab-bar-inner-container { --ztf-tab-height: 28px; min-width: 0; min-height: var(--tab-min-height, 36px); align-items: center; }
#tab-bar-container[data-ztf-inline] ~ #zotero-tabs-toolbar { flex: 0 0 auto; -moz-window-dragging: no-drag; }
#tab-bar-container[data-ztf-inline] .pinned-tabs { display: block; flex: 0 1 auto; min-width: 0; max-width: 42%; padding: 0; }
#tab-bar-container[data-ztf-inline] .pinned-tabs .tabs { padding: 4px 1px; position: static; overflow: visible; }
#tab-bar-container[data-ztf-inline] .pinned-tabs .tab { flex: 0 1 200px; min-width: 0; max-width: 200px; height: var(--ztf-tab-height); }
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
#ztf-inline .ztf-section:not([data-ztf-loose-tabs])::after {
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
#ztf-inline .ztf-doc.ztf-chip-collapsed { min-width: 30px; max-width: 36px; padding-inline: 8px; justify-content: center; background: color-mix(in srgb, currentColor 5%, transparent); }
#ztf-inline .ztf-doc.ztf-virtual.ztf-chip-collapsed { background: transparent; }
#ztf-inline .ztf-doc.ztf-chip-collapsed .ztf-doc-close { display: none; }
#ztf-inline .ztf-doc.ztf-chip-collapsed .ztf-doc-title { font-weight: 600; text-overflow: clip; }
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
.ztf-sb-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ztf-text); }
.ztf-sb-header-actions { display: inline-flex; align-items: center; gap: 2px; flex: none; }
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
.ztf-hc-title { font-weight: 600; margin-bottom: 3px; line-height: 1.4; overflow-wrap: anywhere; }
.ztf-hc-meta { color: var(--ztf-muted); font-size: 11px; overflow-wrap: anywhere; }
.ztf-hc-note { margin-top: 5px; padding: 4px 7px; border-radius: 5px; background: var(--ztf-accent-soft); color: var(--ztf-accent); font-size: 11px; overflow-wrap: anywhere; }

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
    constructor(win, store, onAgeTick) {
      this.win = win;
      this.store = store;
      this.onAgeTick = onAgeTick;
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
        if (!getPref("enableSessions")) return;
        const latest = this.store.state.sessions[0] || this.store.state.rollingSessions?.[0];
        if (latest) void this.popovers.previewAndRestoreSession(latest);
      }, this.hoverCard);
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
    hoverCard;
    notifierID = null;
    observer = null;
    refreshTimer = null;
    resizeTimer = null;
    ageTimer = null;
    autoGroupTimer = null;
    pendingAutoGroup = /* @__PURE__ */ new Set();
    lastSelected = "";
    disposed = false;
    tracked = [];
    staleCount = 0;
    onResize = () => {
      if (this.disposed || this.resizeTimer !== null) return;
      this.resizeTimer = this.win.setTimeout(() => {
        this.resizeTimer = null;
        this.schedule();
      }, 100);
    };
    getOpenKeys() {
      return this.meta.getOpenKeys();
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
      this.hoverCard.mount();
      this.spotlight.init();
      this.itemMenus.attach();
      this.win.addEventListener?.("resize", this.onResize);
      this.notifierID = Zotero.Notifier.registerObserver(
        {
          notify: (event, type, ids) => {
            if (type !== "tab") {
              if (!this.tracked.length) return;
              if (type === "item") {
                const changed = new Set(ids.map(Number));
                if (!this.tracked.some((tab) => changed.has(tab.itemID ?? 0) || changed.has(tab.parentItemID ?? 0))) return;
                this.meta.invalidateItemFields(changed);
              }
              this.schedule();
              return;
            }
            if (event === "add" && !this.onTabsAdded(ids)) return;
            this.schedule();
          }
        },
        ["tab", "item", "collection"],
        "zotero-tabflow"
      );
      this.refresh();
      const host = doc.getElementById("tab-bar-container");
      if (host) {
        this.observer = new this.win.MutationObserver((records) => {
          if (this.disposed || this.refreshTimer !== null) return;
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
        const now = Date.now();
        const slept = this.actions.sleepTabs(this.tracker.getIdleTabsForSleep(now, this.tracked).map((tab) => tab.tab.id));
        const showTime = getPref("enableVerticalSidebar") && !getPref("verticalSidebarCollapsed") && getPref("verticalTabSubtitleMode") === "lastViewed";
        const staleCount = this.tracker.getStaleTabs(now, this.tracked).length;
        if (slept || showTime && this.tracked.length || staleCount !== this.staleCount) this.schedule();
        this.onAgeTick();
      }, 6e4);
    }
    onTabsAdded(ids) {
      const added = new Set(ids.map(String));
      const tabs = this.meta.getNativeTabs().filter((tab) => tab.type !== "library" && added.has(tab.id));
      if (!tabs.length) return false;
      const collapsed = new Set(this.store.state.collapsed);
      if (collapsed.size) {
        const canOpenUngrouped = getPref("newTabMode") === "collection" && !this.store.state.ungroupedHeadingHidden;
        for (const tab of tabs) {
          const groupId = this.store.groupOfKey(this.meta.tabKey(tab));
          if (groupId || canOpenUngrouped) collapsed.delete(groupId);
        }
        if (collapsed.size !== this.store.state.collapsed.length) {
          this.store.state.collapsed = [...collapsed];
          this.store.scheduleSave();
        }
      }
      if (getPref("newTabMode") === "collection") {
        for (const tab of tabs) this.pendingAutoGroup.add(tab.id);
        this.autoGroupTimer ??= this.win.setTimeout(() => {
          this.autoGroupTimer = null;
          const pending = this.pendingAutoGroup;
          this.pendingAutoGroup = /* @__PURE__ */ new Set();
          if (!this.disposed) this.actions.autoGroupNewTabs(pending);
        }, 80);
      }
      return true;
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
      const tracked = this.tracked = this.meta.buildTrackedTabs();
      this.lastSelected = this.tracker.trackActivity(this.lastSelected, tracked);
      const retained = this.store.state.virtualMembers;
      if (Object.keys(retained).length) {
        let changed = false;
        for (const tab of tracked) {
          if (Object.hasOwn(retained, tab.key)) {
            delete retained[tab.key];
            changed = true;
          }
        }
        if (changed) this.store.save(false);
      }
      if (this.lastSelected && this.lastSelected !== prevSelected) {
        const active = tracked.find((t2) => t2.tab.id === this.lastSelected);
        if (active && (active.groupId || getPref("newTabMode") === "collection") && this.store.state.collapsed.includes(active.groupId)) {
          this.store.setCollapsed(active.groupId, false, false);
        }
      }
      this.sidebar.render(tracked);
      this.staleCount = this.horizontal.render(tracked) ?? 0;
    }
    dispose() {
      this.disposed = true;
      this.win.removeEventListener?.("resize", this.onResize);
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
  };
  var TabFlowPlugin = class {
    id = "";
    version = "";
    rootURI = "";
    _ftlRegistered = false;
    store = new TabFlowStore();
    windows = /* @__PURE__ */ new Map();
    pdfFolderSection = new PdfFolderSectionController();
    pdfPreviewSection = new PdfPreviewSectionController();
    prefObserverIDs = [];
    nextRollingAt = 0;
    unsubscribeStore = null;
    init(info) {
      this.id = info.id;
      this.version = info.version;
      this.rootURI = info.rootURI;
    }
    start() {
      migrateNewTabMode();
      enablePrefCache(true);
      this.store.load();
      this.nextRollingAt = Date.now() + 3e5;
      if (getPref("debug")) Zotero.debug("[TabFlow] Workspace state loaded");
      this.pdfFolderSection.register(this.id, this.rootURI);
      this.pdfPreviewSection.register(this.id, this.rootURI);
      this.unsubscribeStore = this.store.subscribe(() => this.refreshAll());
      this.prefObserverIDs = Object.keys(DEFAULT_PREFS).map(
        (key) => Zotero.Prefs.registerObserver(PREF_PREFIX + key, () => {
          invalidatePrefCache(key);
          this.refreshAll();
        }, true)
      );
      for (const win of this.getMainWindows()) this.onMainWindowLoad(win);
    }
    reloadState() {
      this.store.load();
      if (getPref("debug")) Zotero.debug("[TabFlow] Workspace state reloaded");
      this.refreshAll();
    }
    refreshAll() {
      for (const ws of this.windows.values()) ws.schedule();
    }
    onMainWindowLoad(win) {
      if (this.windows.has(win) || !win.Zotero_Tabs) return;
      const ws = new WindowWorkspace(win, this.store, () => this.saveRollingIfDue());
      this.windows.set(win, ws);
      ws.init();
    }
    onMainWindowUnload(win) {
      const ws = this.windows.get(win);
      if (!ws) return;
      if (this.windows.size === 1) this.saveRollingIfDue(true);
      ws.dispose();
      this.windows.delete(win);
    }
    shutdown() {
      if (getPref("debug")) Zotero.debug("[TabFlow] Shutting down");
      this.saveRollingIfDue(true);
      enablePrefCache(false);
      resetI18nCache();
      this.pdfFolderSection.unregister();
      this.pdfPreviewSection.unregister();
      for (const id of this.prefObserverIDs) Zotero.Prefs.unregisterObserver(id);
      this.prefObserverIDs = [];
      this.unsubscribeStore?.();
      this.unsubscribeStore = null;
      for (const ws of this.windows.values()) ws.dispose();
      this.windows.clear();
    }
    saveRollingIfDue(force = false) {
      const now = Date.now();
      if (!force && now < this.nextRollingAt) return;
      this.nextRollingAt = now + 3e5;
      try {
        if (this.windows.size && getPref("enableSessions") && getPref("enableRollingSnapshots")) {
          const keys = /* @__PURE__ */ new Set();
          for (const workspace of this.windows.values()) {
            for (const key of workspace.getOpenKeys()) keys.add(key);
          }
          if (keys.size || this.store.state.groups.length) this.store.saveRollingSnapshot([...keys]);
        }
      } catch (error) {
        Zotero.logError(error);
      } finally {
        if (force) {
          try {
            this.store.flushPendingSave();
          } catch (error) {
            Zotero.logError(error);
          }
        }
      }
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
