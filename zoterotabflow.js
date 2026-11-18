/* Zotero TabFlow - Unified horizontal & vertical tab workspace for Zotero 10-12. */
"use strict";
(() => {
  // src/core/prefs.ts
  var PREF_PREFIX = "extensions.zotero.tabflow.";
  var DEFAULT_PREFS = {
    enableHorizontalGroups: true,
    enableVerticalSidebar: true,
    enableBatchSelection: true,
    enablePinnedTabs: true,
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
    enableTabSleep: true,
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
  function contrastInk(color) {
    const parts = color.slice(1).match(/../g);
    if (!parts) return "#ffffff";
    const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? "#111111" : "#ffffff";
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
      sessions: []
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
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
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
      const all = [
        { id: "", name: this.state.ungroupedName || "未分组", color: this.state.ungroupedColor || "#737373" },
        ...this.state.groups
      ];
      const order = [.../* @__PURE__ */ new Set([...this.state.order || [], ...all.map((g) => g.id)])];
      return order.map((id) => all.find((g) => g.id === id)).filter((g) => Boolean(g));
    }
    ensureGroup(name) {
      const clean = name.trim().slice(0, 60);
      const existing = this.state.groups.find((g) => g.name === clean);
      if (existing) return existing;
      const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const group = { id, name: clean, color: AUTO_COLORS[this.state.groups.length % AUTO_COLORS.length] };
      this.state.groups.push(group);
      this.state.order = [.../* @__PURE__ */ new Set([...this.state.order, id])];
      this.save();
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
      this.state.groups = this.state.groups.filter((g) => g.id !== id);
      for (const key of Object.keys(this.state.assignments)) {
        if (this.state.assignments[key] === id) delete this.state.assignments[key];
      }
      this.state.order = this.state.order.filter((x) => x !== id);
      this.state.collapsed = this.state.collapsed.filter((x) => x !== id);
      delete this.state.groupDisplay[id];
      this.save();
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
      const snapshot = {
        id: `s-${Date.now()}`,
        name: name.trim().slice(0, 60) || "工作区会话",
        createdAt: Date.now(),
        groups: this.state.groups.map((g) => ({ ...g })),
        assignments: { ...this.state.assignments },
        pinned: [...this.state.pinned],
        openKeys: [...new Set(openKeys)],
        order: [...this.state.order],
        collapsed: [...this.state.collapsed]
      };
      this.state.sessions = [snapshot, ...this.state.sessions].slice(0, 30);
      this.save();
      return snapshot;
    }
    deleteSession(id) {
      this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
      this.save();
    }
    restoreSessionLayout(snapshot, merge) {
      const existing = new Set(this.state.groups.map((g) => g.id));
      const added = snapshot.groups.filter((g) => !merge || !existing.has(g.id));
      this.state.groups = [...merge ? this.state.groups : [], ...added.map((g) => ({ ...g }))];
      const validIds = /* @__PURE__ */ new Set(["", ...this.state.groups.map((g) => g.id)]);
      const order = [...merge ? this.state.order : [], ...snapshot.order ?? []];
      this.state.order = [.../* @__PURE__ */ new Set([...order.filter((id) => validIds.has(id)), ...validIds])];
      if (merge) {
        const addedIds = new Set(added.map((g) => g.id));
        this.state.collapsed = [.../* @__PURE__ */ new Set([
          ...this.state.collapsed,
          ...(snapshot.collapsed ?? []).filter((id) => addedIds.has(id))
        ])];
      } else {
        this.state.collapsed = (snapshot.collapsed ?? []).filter((id) => validIds.has(id));
      }
      if (!merge) this.state.assignments = {};
      for (const [key, id] of Object.entries(snapshot.assignments)) {
        if (id && validIds.has(id) && (!merge || !this.groupOfKey(key))) this.state.assignments[key] = id;
      }
      this.state.pinned = [.../* @__PURE__ */ new Set([...merge ? this.state.pinned : [], ...snapshot.pinned])];
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
    trackActivity(previousSelected) {
      const now = Date.now();
      let changed = false;
      const selectedID = this.meta.getSelectedTabID();
      for (const tab of this.meta.getNativeTabs().filter((t) => t.type !== "library")) {
        const key = this.meta.tabKey(tab);
        if (!key) continue;
        if (!this.store.state.history[key]) {
          this.store.state.history[key] = { firstSeen: now, lastViewed: null };
          changed = true;
        }
      }
      if (previousSelected !== selectedID) {
        for (const id of [previousSelected, selectedID]) {
          const tab = this.meta.getNativeTabs().find((t) => t.id === id && t.type !== "library");
          const key = this.meta.tabKey(tab);
          if (key && this.store.state.history[key]) {
            this.store.state.history[key].lastViewed = now;
            changed = true;
          }
        }
      }
      if (changed) this.store.save(false);
      return selectedID;
    }
    getStaleTabs(now = Date.now()) {
      if (!getPref("enableStaleSuggestions")) return [];
      const threshold = getPref("staleSuggestDays");
      const selected = this.meta.getSelectedTabID();
      const dayMs = 864e5;
      return this.meta.buildTrackedTabs().filter((t) => !t.pinned && t.tab.id !== selected).map((t) => {
        const h = this.store.state.history[t.key];
        const since = h?.lastViewed ?? h?.firstSeen ?? now;
        return { tracked: t, days: Math.max(0, Math.floor((now - since) / dayMs)) };
      }).filter((x) => x.days >= threshold).sort((a, b) => b.days - a.days);
    }
  };

  // src/services/item-metadata.ts
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
      if (!item) return "未分类集合";
      const primary = item.parentItemID ? Zotero.Items.get(item.parentItemID) || item : item;
      const collectionIDs = primary.getCollections?.() || [];
      if (!collectionIDs.length) return "未分类集合";
      const strategy = getPref("multiCollectionStrategy");
      if (strategy === "active") {
        const activeCol = this.win.ZoteroPane?.getSelectedCollections?.()?.find(
          (collection) => collectionIDs.includes(collection.id)
        );
        if (activeCol) {
          return String(activeCol.name || "未分类集合");
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
      return first ? String(first.name) : "未分类集合";
    }
    plainTitle(value) {
      const render = Zotero.Utilities?.Internal?.renderItemTitle;
      return typeof render === "function" ? render.call(Zotero.Utilities.Internal, value) : value.replace(/<[^>]*>/g, "");
    }
    buildTrackedTabs() {
      const enablePinned = getPref("enablePinnedTabs");
      const enableSleep = getPref("enableTabSleep");
      return this.getNativeTabs().filter((t) => t.type !== "library").map((tab) => {
        const key = this.tabKey(tab) || `tab:${tab.id}`;
        const itemID = typeof tab.data?.itemID === "number" ? tab.data.itemID : null;
        const rawItem = itemID ? Zotero.Items.get(itemID) : null;
        const primary = this.resolvePrimaryItem(itemID);
        const title = this.plainTitle(String(primary?.getField?.("title") || tab.title || "无标题"));
        const shortTitle = this.plainTitle(String(primary?.getField?.("shortTitle") || title));
        const filename = String(rawItem?.isAttachment?.() ? rawItem.attachmentFilename || title : title);
        const source = String(
          primary?.getField?.("publicationTitle") || primary?.getField?.("proceedingsTitle") || primary?.getField?.("bookTitle") || primary?.getField?.("repository") || ""
        );
        const creators = primary?.getCreators?.() || [];
        const firstAuthor = creators[0]?.lastName || creators[0]?.firstName || "";
        const year = String(primary?.getField?.("year") || "").slice(0, 4);
        const creatorYear = [firstAuthor, year].filter(Boolean).join(", ");
        const collection = this.resolveCollectionName(primary);
        const sleeping = enableSleep && this.store.isSleeping(key);
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
          groupId: this.store.groupOfKey(key),
          pinned: enablePinned && this.store.isPinned(key),
          status: sleeping ? "sleeping" : "active"
        };
      });
    }
    getDisplayTitle(t) {
      const mode = getPref("verticalTabTitleMode");
      const base = mode === "shortTitle" ? t.shortTitle : mode === "filename" ? t.filename : t.title;
      if (!getPref("enableTabRemarks")) return base;
      const r = this.store.getRemark(t.key);
      if (!r.note || r.mode === "original") return base;
      return r.mode === "note" ? r.note : `${r.note} · ${base}`;
    }
    getDisplaySubtitle(t) {
      const mode = getPref("verticalTabSubtitleMode");
      if (mode === "none") return "";
      if (mode === "creatorYear") return t.creatorYear;
      if (mode === "collection") return t.collection;
      return t.source;
    }
  };

  // src/services/tab-actions.ts
  var TabActionService = class {
    constructor(win, store, meta) {
      this.win = win;
      this.store = store;
      this.meta = meta;
    }
    selectTab(tabId) {
      const tabs = this.win.Zotero_Tabs;
      if (!tabs) return;
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
      const key = this.meta.tabKey(tab);
      if (key && this.store.isSleeping(key)) this.store.setSleeping(key, false);
      if (tab) {
        this.store.setCollapsed(this.store.groupOfKey(key), false);
        tabs.select(tabId);
      }
    }
    async closeTab(tabId, preserveVirtual = true) {
      const tabs = this.win.Zotero_Tabs;
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
      if (!tabs || !tab || tab.type === "library") return;
      const tracked = this.meta.buildTrackedTabs().find((x) => x.tab.id === tabId);
      if (tracked && preserveVirtual && getPref("enableVirtualMembers") && tracked.groupId && tracked.itemID) {
        const vMeta = {
          key: tracked.key,
          itemID: tracked.itemID,
          parentItemID: tracked.parentItemID,
          title: tracked.title,
          shortTitle: tracked.shortTitle,
          filename: tracked.filename,
          source: tracked.source,
          creatorYear: tracked.creatorYear,
          collection: tracked.collection,
          type: tab.type
        };
        this.store.saveVirtualMember(vMeta);
      }
      tabs.close(tabId);
    }
    sleepTab(tabId) {
      if (!getPref("enableTabSleep")) return;
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
      const key = this.meta.tabKey(tab);
      if (!key || this.store.isPinned(key)) return;
      this.store.setSleeping(key, true);
      const reader = Zotero.Reader?.getByTabID?.(tabId);
      if (reader?.unload) {
        try {
          reader.unload();
        } catch {
        }
      }
    }
    sleepInactiveTabs() {
      if (!getPref("enableTabSleep")) return 0;
      const selected = this.meta.getSelectedTabID();
      let count = 0;
      for (const t of this.meta.buildTrackedTabs()) {
        if (t.tab.id !== selected && !t.pinned && t.status === "active") {
          this.sleepTab(t.tab.id);
          count++;
        }
      }
      return count;
    }
    async openVirtualOrItem(itemID, groupId, openInBackground = false) {
      const item = Zotero.Items.get(itemID);
      if (!item) return;
      const key = `${item.libraryID}:${item.key}`;
      if (groupId) this.store.assignKey(key, groupId);
      this.store.removeVirtualMember(key);
      if (item.isAttachment?.()) {
        await Zotero.Reader.open(item.id, void 0, { openInBackground });
        return;
      }
      const attachment = await item.getBestAttachment?.();
      if (attachment) await Zotero.Reader.open(attachment.id, void 0, { openInBackground });
    }
    autoGroupByCollection(onlyTabIDs) {
      let moved = 0;
      const filterSet = onlyTabIDs ? new Set(onlyTabIDs) : null;
      for (const t of this.meta.buildTrackedTabs()) {
        if (filterSet && !filterSet.has(t.tab.id)) continue;
        if (!t.groupId && t.collection && t.collection !== "未分类集合") {
          const group = this.store.ensureGroup(t.collection);
          this.store.assignKey(t.key, group.id);
          moved++;
        }
      }
      return moved;
    }
    async showInFilesystem(tabId) {
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
      const itemID = tab?.data?.itemID;
      if (typeof itemID !== "number") return;
      const item = Zotero.Items.get(itemID);
      const att = item?.isFileAttachment?.() ? item : await item?.getBestAttachment?.();
      if (att) await this.win.ZoteroPane?.showAttachmentInFilesystem?.(att.id);
    }
    showInLibrary(tabId) {
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
      const primary = this.meta.resolvePrimaryItem(tab?.data?.itemID ?? null);
      if (primary) this.win.ZoteroPane?.selectItem?.(primary.id);
    }
    copyReference(tabId) {
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
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
      const tab = this.meta.getNativeTabs().find((t) => t.id === tabId);
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
    constructor(win, store, onRefresh) {
      this.win = win;
      this.store = store;
      this.onRefresh = onRefresh;
    }
    draggedTabId = null;
    draggedKey = null;
    draggedGroupId = null;
    hoverTimer = null;
    bindTabDrag(node, t) {
      node.draggable = true;
      node.ondragstart = (e) => {
        e.stopPropagation();
        this.draggedTabId = t.tab.id;
        this.draggedKey = t.key;
        this.draggedGroupId = null;
        e.dataTransfer?.setData("text/plain", t.key);
      };
      node.ondragover = (e) => {
        if (!this.draggedKey || this.draggedKey === t.key) return;
        e.preventDefault();
        node.setAttribute("data-ztf-drop", "stack");
      };
      node.ondragleave = () => node.removeAttribute("data-ztf-drop");
      node.ondrop = (e) => {
        e.preventDefault();
        node.removeAttribute("data-ztf-drop");
        if (!this.draggedKey || this.draggedKey === t.key) return;
        const me = e;
        const rect = node.getBoundingClientRect();
        const ratio = rect.width > 0 ? (me.clientX - rect.left) / rect.width : 0.5;
        if (ratio < 0.25 || ratio > 0.75) {
          this.store.assignKey(this.draggedKey, t.groupId);
          const tabs = this.win.Zotero_Tabs;
          const targetIdx = tabs?._tabs?.findIndex((x) => x.id === t.tab.id) ?? -1;
          if (targetIdx > 0 && this.draggedTabId) {
            tabs.move(this.draggedTabId, targetIdx + (ratio > 0.75 ? 1 : 0));
          }
        } else if (!t.groupId) {
          const val = { value: t.shortTitle.slice(0, 24) };
          if (Services.prompt.prompt(this.win, "叠放新建分组", "将两篇文献合并到新分组：", val, null, {}) && val.value.trim()) {
            const g = this.store.ensureGroup(val.value);
            this.store.assignKey(t.key, g.id);
            this.store.assignKey(this.draggedKey, g.id);
          }
        } else {
          this.store.assignKey(this.draggedKey, t.groupId);
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
        if (!this.draggedKey && this.draggedGroupId === null) return;
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
          this.store.moveGroup(this.draggedGroupId, groupId, true);
        } else if (this.draggedKey) {
          this.store.assignKey(this.draggedKey, groupId);
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
      this.drag = new HorizontalDragController(win, store, onRefresh);
    }
    root = null;
    pinnedStrip = null;
    toolbarActions = null;
    drag;
    lastSelectedID = "";
    headingClickTimer = null;
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
    render() {
      const host = this.doc.getElementById("tab-bar-container");
      if (!host) return;
      this.mount();
      const enabled = getPref("enableHorizontalGroups");
      const mounted = enabled && Boolean(this.root?.isConnected);
      host.toggleAttribute("data-ztf-inline", mounted);
      if (this.root) this.root.hidden = !mounted;
      if (!mounted && this.pinnedStrip) this.pinnedStrip.hidden = true;
      this.renderToolbarButtons();
      if (!mounted || !this.root || this.root.querySelector(".ztf-inline-edit")) return;
      const tracked = this.meta.buildTrackedTabs();
      const selectedID = this.meta.getSelectedTabID();
      const scroll = this.root.scrollLeft;
      this.root.textContent = "";
      const pinnedTabs = getPref("enablePinnedTabs") ? tracked.filter((t) => t.pinned) : [];
      if (this.pinnedStrip) {
        const strip = this.pinnedStrip;
        const pinnedScroll = strip.scrollLeft;
        strip.replaceChildren();
        strip.hidden = pinnedTabs.length === 0;
        for (const t of pinnedTabs) {
          const chip = this.h("button", `ztf-pinned-chip${t.tab.id === selectedID ? " selected" : ""}`);
          chip.type = "button";
          const labelSpan = this.h("span");
          labelSpan.textContent = this.meta.getDisplayTitle(t);
          chip.append(createSvgIcon(this.doc, "pin", 12), labelSpan);
          chip.title = t.title;
          chip.onclick = () => this.actions.selectTab(t.tab.id);
          chip.oncontextmenu = (e) => this.menus.openTabMenu(e, t);
          strip.append(chip);
        }
        strip.scrollLeft = pinnedScroll;
      }
      const unpinned = tracked.filter((t) => !t.pinned);
      for (const g of this.store.orderedGroups()) {
        const section = this.h("div", "ztf-section");
        section.style.setProperty("--ztf-color", g.color);
        section.style.setProperty("--ztf-ink", contrastInk(g.color));
        const collapsed = this.store.state.collapsed.includes(g.id);
        const members = unpinned.filter((t) => t.groupId === g.id);
        const virtuals = getPref("enableVirtualMembers") ? Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === g.id) : [];
        const heading = this.h("button", `ztf-heading${!g.id ? " ztf-ungrouped" : ""}`);
        heading.type = "button";
        heading.textContent = `${collapsed ? "▸" : "▾"} ${g.name} (${members.length + virtuals.length})`;
        heading.title = heading.textContent;
        heading.setAttribute("aria-expanded", String(!collapsed));
        heading.onmousedown = (e) => e.stopPropagation();
        heading.onclick = (e) => {
          e.stopPropagation();
          if (this.headingClickTimer !== null) this.win.clearTimeout(this.headingClickTimer);
          this.headingClickTimer = this.win.setTimeout(() => {
            this.headingClickTimer = null;
            this.store.setCollapsed(g.id, !collapsed);
          }, 210);
        };
        heading.ondblclick = (e) => {
          e.stopPropagation();
          if (this.headingClickTimer !== null) {
            this.win.clearTimeout(this.headingClickTimer);
            this.headingClickTimer = null;
          }
          this.beginInlineEdit(heading, g.name, (next) => this.store.renameGroup(g.id, next));
        };
        heading.oncontextmenu = (e) => this.menus.openGroupMenu(e, g);
        this.drag.bindGroupDrag(heading, g.id, collapsed);
        section.append(heading);
        if (!collapsed) {
          for (const t of members) section.append(this.buildTabNode(t, selectedID));
          for (const v of virtuals) {
            const vNode = this.h("button", "ztf-doc ztf-virtual");
            vNode.type = "button";
            const label = this.h("span", "ztf-doc-title");
            label.textContent = `◌ ${this.meta.getDisplayTitle(v)}`;
            vNode.append(label);
            vNode.title = `虚拟保留成员（点击重新加载）：${v.title}`;
            vNode.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id).then(this.onRefresh);
            vNode.oncontextmenu = (e) => this.menus.openVirtualMenu(e, v, g.id);
            section.append(vNode);
          }
        }
        this.root.append(section);
      }
      const addBtn = this.h("button", "ztf-add-group");
      addBtn.type = "button";
      addBtn.append(createSvgIcon(this.doc, "plus", 13));
      addBtn.title = "新建分组";
      addBtn.onclick = () => {
        this.beginInlineEdit(addBtn, "", (next) => this.store.ensureGroup(next), "新分组名称…");
      };
      this.root.append(addBtn);
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
    buildTabNode(t, selectedID) {
      const node = this.h("div", `ztf-doc${t.tab.id === selectedID ? " selected" : ""}${t.status === "sleeping" ? " ztf-sleeping" : ""}`);
      node.title = `${t.title}
集合：${t.collection}`;
      const label = this.h("span", "ztf-doc-title");
      label.textContent = `${t.status === "sleeping" ? "💤 " : ""}${this.meta.getDisplayTitle(t)}`;
      const closeBtn = this.h("button", "ztf-doc-close");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", `关闭标签：${t.title}`);
      closeBtn.append(createSvgIcon(this.doc, "close", 11));
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        void this.actions.closeTab(t.tab.id, true).then(this.onRefresh);
      };
      node.append(label, closeBtn);
      node.onclick = () => this.actions.selectTab(t.tab.id);
      node.onauxclick = (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.actions.closeTab(t.tab.id, true).then(this.onRefresh);
        }
      };
      node.oncontextmenu = (e) => this.menus.openTabMenu(e, t);
      this.drag.bindTabDrag(node, t);
      return node;
    }
    renderToolbarButtons() {
      if (!this.toolbarActions) return;
      this.toolbarActions.textContent = "";
      if (getPref("enableVerticalSidebar")) {
        const open = !getPref("verticalSidebarCollapsed");
        const btn = this.h("button", `ztf-tb-btn${open ? " active" : ""}`);
        btn.type = "button";
        btn.append(createSvgIcon(this.doc, "sidebar", 13));
        btn.title = open ? "收起垂直标签侧边栏" : "展开垂直标签侧边栏";
        btn.onclick = () => {
          setPref("verticalSidebarCollapsed", open);
          this.onRefresh();
        };
        this.toolbarActions.append(btn);
      }
      if (getPref("enableSpotlight")) {
        const btn = this.h("button", "ztf-tb-btn");
        btn.type = "button";
        btn.append(createSvgIcon(this.doc, "search", 12), this.doc.createTextNode("Spotlight"));
        btn.title = "快速搜索与命令 (Ctrl+P)";
        btn.onclick = () => this.spotlight.open(btn);
        this.toolbarActions.append(btn);
      }
      if (getPref("enableSessions")) {
        const btn = this.h("button", "ztf-tb-btn");
        btn.type = "button";
        btn.append(createSvgIcon(this.doc, "layers", 12), this.doc.createTextNode(`会话 (${this.store.state.sessions.length})`));
        btn.onclick = () => this.popovers.openSessionsMenu(btn);
        this.toolbarActions.append(btn);
      }
      if (getPref("enableStaleSuggestions")) {
        const count = this.tracker.getStaleTabs().length;
        const btn = this.h("button", `ztf-tb-btn${count ? " warn" : ""}`);
        btn.type = "button";
        btn.append(createSvgIcon(this.doc, "clock", 12), this.doc.createTextNode(`建议关闭 (${count})`));
        btn.onclick = () => this.popovers.openStaleMenu(btn);
        this.toolbarActions.append(btn);
      }
    }
    dispose() {
      if (this.headingClickTimer !== null) {
        this.win.clearTimeout(this.headingClickTimer);
        this.headingClickTimer = null;
      }
      this.drag.clear();
      this.doc.getElementById("tab-bar-container")?.removeAttribute("data-ztf-inline");
      this.root?.remove();
      this.pinnedStrip?.remove();
      this.toolbarActions?.remove();
      this.root = null;
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
      menu.setAttribute("label", "TabFlow：打开并分组");
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
      this.item(this.itemSubPopup, "打开到新分组…", () => {
        const val = { value: selected[0]?.getField?.("title")?.slice(0, 30) || "新分组" };
        if (!Services.prompt.prompt(this.win, "打开到新分组", "分组名称：", val, null, {}) || !val.value.trim()) return;
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
  var FOLDER_CLICK_INTERVAL_MS = 500;
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
    recentFolder = null;
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
    async resolveFileAttachment(item) {
      if (!item) return null;
      if (item.isFileAttachment?.()) return item;
      const best = await item.getBestAttachment?.();
      return best?.isFileAttachment?.() ? best : null;
    }
    async updateBody(st) {
      const item = st.item;
      st.btn.disabled = true;
      st.btn.style.opacity = "0.5";
      st.meta.textContent = "";
      st.meta.removeAttribute("title");
      st.meta.removeAttribute("data-l10n-id");
      if (!item) return;
      const att = await this.resolveFileAttachment(item).catch(() => null);
      if (this.states.get(st.body) !== st || st.item !== item) return;
      if (!att) {
        st.meta.setAttribute("data-l10n-id", "zotero-tabflow-pdf-folder-unavailable");
        return;
      }
      st.meta.textContent = String(att.attachmentFilename || att.getField?.("title") || "附件文件");
      st.meta.title = st.meta.textContent;
      st.btn.disabled = false;
      st.btn.style.opacity = "1";
    }
    async openAttachmentFolder(win, item, signal) {
      if (signal.aborted || this.openingFolders.has(win)) return;
      this.openingFolders.add(win);
      try {
        const att = await this.resolveFileAttachment(item);
        if (signal.aborted || !att) return;
        const filePath = await att.getFilePathAsync?.();
        if (signal.aborted || !filePath) return;
        const folder = Zotero.File.pathToFile(filePath).parent?.path;
        if (!folder) return;
        const now = Date.now();
        if (this.recentFolder?.path === folder && now - this.recentFolder.openedAt < FOLDER_CLICK_INTERVAL_MS) return;
        Zotero.launchFile(folder);
        this.recentFolder = { path: folder, openedAt: now };
      } catch (error) {
        Zotero.logError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        this.openingFolders.delete(win);
      }
    }
    unregister() {
      this.recentFolder = null;
      for (const controller of this.listeners.values()) controller.abort();
      this.listeners.clear();
      if (this.sectionID) {
        Zotero.ItemPaneManager?.unregisterSection?.(this.sectionID);
        this.sectionID = false;
      }
      this.states.clear();
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
    }
    activePopups = /* @__PURE__ */ new Set();
    restoring = false;
    disposed = false;
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
        this.item(popup, `${threshold} 天未查看的文献 (${stale.length})`, () => {
        }, true);
        if (!stale.length) this.item(popup, "暂时没有建议清理的文献", () => {
        }, true);
        for (const entry of stale) {
          const sub = this.xul("menu");
          sub.setAttribute("label", `${entry.tracked.title.slice(0, 56)} · ${entry.days} 天`);
          const subPop = this.xul("menupopup");
          sub.append(subPop);
          popup.append(sub);
          this.item(subPop, "查看文献", () => this.actions.selectTab(entry.tracked.tab.id));
          if (getPref("enableTabSleep")) {
            this.item(subPop, "休眠以释放内存", () => {
              this.actions.sleepTab(entry.tracked.tab.id);
              this.onRefresh();
            });
          }
          this.item(subPop, "关闭标签页（保留在分组）", () => {
            void this.actions.closeTab(entry.tracked.tab.id, true).then(this.onRefresh);
          });
        }
        popup.append(this.xul("menuseparator"));
        if (getPref("enableTabSleep")) {
          this.item(popup, "全部休眠释放内存", () => {
            for (const s of stale) this.actions.sleepTab(s.tracked.tab.id);
            this.onRefresh();
          }, !stale.length);
        }
        this.item(popup, "关闭以上建议的全部标签页", () => {
          for (const s of stale) void this.actions.closeTab(s.tracked.tab.id, true);
          this.onRefresh();
        }, !stale.length);
        this.item(popup, `设置天数阈值…（当前 ${threshold} 天）`, () => {
          const val = { value: String(threshold) };
          if (Services.prompt.prompt(this.win, "建议关闭阈值", "多少天未查看后列入建议（1–3650）：", val, null, {})) {
            const num = Number(val.value);
            if (Number.isInteger(num) && num >= 1 && num <= 3650) {
              setPref("staleSuggestDays", num);
              this.onRefresh();
            }
          }
        });
      });
    }
    openSessionsMenu(anchor) {
      if (!getPref("enableSessions")) return;
      this.openPopupMenu(anchor, (popup) => {
        this.item(popup, "保存当前工作区为会话…", () => {
          const val = { value: "" };
          if (!Services.prompt.prompt(this.win, "保存会话快照", "请输入会话名称：", val, null, {})) return;
          this.store.saveSession(val.value || "工作区会话", this.meta.buildTrackedTabs().map((t) => t.key));
          this.onRefresh();
        });
        popup.append(this.xul("menuseparator"));
        const sessions = this.store.state.sessions;
        if (!sessions.length) {
          this.item(popup, "暂无已保存的会话", () => {
          }, true);
          return;
        }
        for (const s of sessions) {
          const sub = this.xul("menu");
          sub.setAttribute("label", `${s.name} (${s.openKeys.length} 篇)`);
          const subPop = this.xul("menupopup");
          sub.append(subPop);
          popup.append(sub);
          this.item(subPop, "合并恢复会话（保留当前分组）", () => void this.restoreSession(s, true), this.restoring);
          this.item(subPop, "恢复会话并替换当前分组…", () => {
            if (Services.prompt.confirm(this.win, "替换当前分组", "用会话的分组与固定状态替换当前设置？已打开的标签页会保留。")) {
              void this.restoreSession(s, false);
            }
          }, this.restoring);
          this.item(subPop, "删除此会话", () => {
            this.store.deleteSession(s.id);
            this.onRefresh();
          });
        }
      });
    }
    async restoreSession(session, merge) {
      if (this.disposed || this.restoring) return;
      this.restoring = true;
      try {
        this.store.restoreSessionLayout(session, merge);
        const open = new Set(this.meta.buildTrackedTabs().map((t) => t.key));
        for (const fullKey of session.openKeys) {
          if (this.disposed) return;
          if (open.has(fullKey)) continue;
          const [libStr, itemKey] = fullKey.split(":");
          const libraryID = Number(libStr);
          if (!Number.isInteger(libraryID) || libraryID <= 0 || !itemKey) continue;
          try {
            const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, itemKey);
            if (this.disposed) return;
            if (item && !item.deleted) {
              await this.actions.openVirtualOrItem(item.id, void 0, true);
              open.add(fullKey);
            }
          } catch (error) {
            Zotero.logError(error);
          }
        }
      } finally {
        this.restoring = false;
        if (!this.disposed) this.onRefresh();
      }
    }
    dispose() {
      this.disposed = true;
      for (const p of this.activePopups) {
        p.hidePopup?.();
        p.remove();
      }
      this.activePopups.clear();
    }
  };

  // src/ui/spotlight.ts
  var SpotlightController = class {
    constructor(win, doc, store, meta, actions, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.onRefresh = onRefresh;
    }
    panel = null;
    input = null;
    resultsEl = null;
    entries = [];
    activeIndex = 0;
    h(tag, className) {
      const el = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) el.className = className;
      return el;
    }
    init() {
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
          const t = this.entries[this.activeIndex];
          if (t) {
            t.run();
            this.close();
          }
        }
      });
      this.win.addEventListener("keydown", this.handleGlobalShortcut, true);
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
      if (!getPref("enableSpotlight") || !this.panel || !this.input) return;
      this.input.value = "";
      this.activeIndex = 0;
      this.renderResults();
      const target = anchor || this.doc.getElementById("tab-bar-container") || this.doc.documentElement;
      this.panel.openPopup(target, "after_start", 0, 8, false, false);
    }
    close() {
      this.panel?.hidePopup?.();
    }
    renderResults() {
      if (!this.resultsEl || !this.input) return;
      const q = this.input.value.trim().toLowerCase();
      const tabsMode = /^>tabs(?:\s|$)/.test(q);
      const terms = q.replace(tabsMode ? /^>tabs/ : /^>/, "").split(/\s+/).filter(Boolean);
      const tabs = this.meta.buildTrackedTabs();
      const groups = this.store.orderedGroups();
      const names = new Map(groups.map((group) => [group.id, group.name]));
      if (tabsMode) {
        const viewedAt = (key) => this.store.state.history[key]?.lastViewed ?? 0;
        tabs.sort((a, b) => viewedAt(b.key) - viewedAt(a.key));
      }
      const tabEntries = q.startsWith(">") && !tabsMode ? [] : tabs.filter((t) => {
        const r = this.store.getRemark(t.key).note;
        const searchable = `${r} ${t.title} ${t.shortTitle} ${t.filename} ${t.collection} ${t.creatorYear} ${names.get(t.groupId) ?? ""}`.toLowerCase();
        return terms.every((term) => searchable.includes(term));
      }).map((t) => {
        const gName = names.get(t.groupId) || "未分组";
        const r = this.store.getRemark(t.key).note;
        return { label: `${t.pinned ? "📌 " : ""}${r || t.title}`, hint: `${gName} · ${t.collection}`, run: () => this.actions.selectTab(t.tab.id) };
      });
      const cmdEntries = [
        { label: "📂 按 Zotero 集合自动分组", hint: "Auto-Group", run: () => {
          this.actions.autoGroupByCollection();
          this.onRefresh();
        } },
        { label: "💤 休眠所有后台非固定标签", hint: "Memory Saver", run: () => {
          this.actions.sleepInactiveTabs();
          this.onRefresh();
        } }
      ].filter((c) => !terms.length || terms.every((term) => `${c.label} ${c.hint}`.toLowerCase().includes(term)));
      this.entries = tabsMode ? tabEntries : [...tabEntries, ...cmdEntries];
      this.resultsEl.textContent = "";
      this.entries.forEach((entry, idx) => {
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
        this.resultsEl.append(btn);
      });
      if (!this.entries.length) {
        const empty = this.h("div", "ztf-spot-empty");
        empty.textContent = "没有匹配的文献或命令";
        this.resultsEl.append(empty);
      }
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
          this.item(popup, tracked.pinned ? "取消固定标签" : "📌 固定标签（防误关）", () => {
            this.store.togglePinned(tracked.key);
            this.onRefresh();
          });
        }
        if (getPref("enableTabRemarks")) {
          const remark = this.store.getRemark(tracked.key);
          this.item(popup, remark.note ? "✎ 编辑标签备注…" : "✎ 设置标签备注…", () => {
            const val = { value: remark.note };
            if (Services.prompt.prompt(this.win, "设置标签备注", "输入备注（≤300 字，不改原文件名）：", val, null, {})) {
              this.store.setRemark(tracked.key, val.value);
              this.onRefresh();
            }
          });
          const dispMenu = this.xul("menu");
          dispMenu.setAttribute("label", "标签显示模式");
          const dispPop = this.xul("menupopup");
          dispMenu.append(dispPop);
          popup.append(dispMenu);
          for (const [mode, label] of [["both", "备注 + 原标题"], ["note", "仅显示备注"], ["original", "仅显示原标题"]]) {
            this.item(dispPop, label, () => {
              this.store.setDisplayMode(tracked.key, mode);
              this.onRefresh();
            }, { type: "radio", checked: remark.mode === mode });
          }
        }
        if (getPref("enableTabSleep") && !tracked.pinned) {
          this.item(popup, tracked.status === "sleeping" ? "⚡ 唤醒标签页" : "💤 休眠标签（释放内存）", () => {
            if (tracked.status === "sleeping") this.actions.selectTab(tracked.tab.id);
            else this.actions.sleepTab(tracked.tab.id);
            this.onRefresh();
          });
        }
        popup.append(this.xul("menuseparator"));
        const groupMenu = this.xul("menu");
        groupMenu.setAttribute("label", "加入分组");
        const groupPop = this.xul("menupopup");
        groupMenu.append(groupPop);
        popup.append(groupMenu);
        for (const g of this.store.orderedGroups().filter((x) => x.id)) {
          this.item(groupPop, g.name, () => {
            this.store.assignKey(tracked.key, g.id);
            this.onRefresh();
          }, { type: "checkbox", checked: tracked.groupId === g.id });
        }
        this.item(groupPop, "新建分组并加入…", () => {
          const val = { value: "" };
          if (Services.prompt.prompt(this.win, "新建分组", "分组名称：", val, null, {}) && val.value.trim()) {
            const g = this.store.ensureGroup(val.value);
            this.store.assignKey(tracked.key, g.id);
            this.onRefresh();
          }
        });
        this.item(groupPop, "移出分组", () => {
          this.store.assignKey(tracked.key, "");
          this.onRefresh();
        }, { disabled: !tracked.groupId });
        popup.append(this.xul("menuseparator"));
        this.item(popup, "在文献库中定位", () => this.actions.showInLibrary(tracked.tab.id));
        if (getPref("enableCopyReference")) this.item(popup, "复制引用到剪贴板", () => this.actions.copyReference(tracked.tab.id));
        if (getPref("enableShowInFilesystem")) this.item(popup, "在文件管理器中显示", () => void this.actions.showInFilesystem(tracked.tab.id));
        if (getPref("enableReloadTab")) this.item(popup, "重新加载标签页", () => void this.actions.reloadTab(tracked.tab.id));
        popup.append(this.xul("menuseparator"));
        if (getPref("enableVirtualMembers") && tracked.groupId) {
          this.item(popup, "关闭标签（保留在分组）", () => void this.actions.closeTab(tracked.tab.id, true).then(this.onRefresh));
        }
        this.item(popup, "彻底关闭标签页", () => void this.actions.closeTab(tracked.tab.id, false).then(this.onRefresh));
      });
    }
    openGroupMenu(event, group) {
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        this.item(popup, "重命名分组…", () => {
          const val = { value: group.name };
          if (Services.prompt.prompt(this.win, "重命名分组", "分组名称：", val, null, {}) && val.value.trim()) {
            this.store.renameGroup(group.id, val.value);
            this.onRefresh();
          }
        });
        if (!group.id) {
          const ungrouped = this.meta.buildTrackedTabs().filter((t) => !t.groupId && !t.pinned);
          this.item(popup, `将未分组文献转为新分组… (${ungrouped.length})`, () => {
            const val = { value: "" };
            if (Services.prompt.prompt(this.win, "新建分组", "分组名称：", val, null, {}) && val.value.trim()) {
              const g = this.store.ensureGroup(val.value);
              for (const t of ungrouped) this.store.assignKey(t.key, g.id);
              this.onRefresh();
            }
          }, { disabled: !ungrouped.length });
        }
        if (group.id) {
          this.item(popup, "解散此分组", () => {
            if (Services.prompt.confirm(this.win, "解散分组", `解散“${group.name}”？标签页将保留并回到未分组。`)) {
              this.store.dissolveGroup(group.id);
              this.onRefresh();
            }
          });
        }
        const colorMenu = this.xul("menu");
        colorMenu.setAttribute("label", "分组颜色");
        const colorPop = this.xul("menupopup");
        colorMenu.append(colorPop);
        popup.append(colorMenu);
        for (const [label, hex] of DEFAULT_PALETTE) {
          this.item(colorPop, `${label} (${hex})`, () => {
            this.store.setGroupColor(group.id, hex);
            this.onRefresh();
          });
        }
        this.item(colorPop, "自定义 Hex 颜色…", () => {
          const val = { value: group.color };
          if (Services.prompt.prompt(this.win, "自定义颜色", "输入 3 位或 6 位 Hex 颜色：", val, null, {})) {
            this.store.setGroupColor(group.id, val.value);
            this.onRefresh();
          }
        });
        popup.append(this.xul("menuseparator"));
        const virtualMembers = Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === group.id);
        if (virtualMembers.length) {
          this.item(popup, `▶ 打开组内全部虚拟文献 (${virtualMembers.length})`, () => {
            void (async () => {
              for (const m of virtualMembers) await this.actions.openVirtualOrItem(m.itemID, group.id);
              this.onRefresh();
            })();
          });
        }
        if (getPref("enableCopyReference")) {
          const groupTabs = this.meta.buildTrackedTabs().filter((x) => x.groupId === group.id);
          const items = groupTabs.map((x) => this.meta.resolvePrimaryItem(x.itemID)).filter(Boolean);
          this.item(popup, `复制组内全部引用 (${items.length})`, () => this.actions.copyReferencesForItems(items), { disabled: !items.length });
        }
        this.item(popup, "仅打开本组（关闭其他标签）", () => {
          for (const t of this.meta.buildTrackedTabs().filter((x) => x.groupId !== group.id && !x.pinned)) {
            void this.actions.closeTab(t.tab.id, true);
          }
          this.onRefresh();
        });
        this.item(popup, "关闭组内所有已开标签", () => {
          for (const t of this.meta.buildTrackedTabs().filter((x) => x.groupId === group.id)) {
            void this.actions.closeTab(t.tab.id, true);
          }
          this.onRefresh();
        });
      });
    }
    openVirtualMenu(event, member, groupId) {
      event.preventDefault();
      event.stopPropagation();
      this.openAt(event, (popup) => {
        this.item(popup, "▶ 加载标签页", () => void this.actions.openVirtualOrItem(member.itemID, groupId).then(this.onRefresh));
        this.item(popup, "从分组移除虚拟成员", () => {
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
    show(anchor, t) {
      if (!getPref("enableHoverPreview") || !this.card) return;
      const h = this.store.state.history[t.key];
      const last = h?.lastViewed || h?.firstSeen;
      const days = last ? Math.max(0, Math.floor((Date.now() - last) / 864e5)) : 0;
      const remark = this.store.getRemark(t.key).note;
      this.card.textContent = "";
      const mk = (cls, text) => {
        const d = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        d.className = cls;
        d.textContent = text;
        return d;
      };
      this.card.append(
        mk("ztf-hc-title", t.title),
        mk("ztf-hc-meta", [t.creatorYear, t.source].filter(Boolean).join(" · ") || "暂无作者/期刊元数据"),
        mk("ztf-hc-meta", `集合：${t.collection} · 上次阅读：${days === 0 ? "今天" : `${days} 天前`}`)
      );
      if (remark) this.card.append(mk("ztf-hc-note", `备注：${remark}`));
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

  // src/ui/sidebar-selection.ts
  var SidebarSelection = class {
    constructor(doc, store, header, aside, list, onChange) {
      this.doc = doc;
      this.store = store;
      this.list = list;
      this.onChange = onChange;
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
      this.controls.append(this.count, this.selectAll, this.groups, ...this.pinButtons);
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
      return [...this.list.querySelectorAll(".ztf-batch-check")];
    }
    beginRender(tracked) {
      const enabled = getPref("enableBatchSelection");
      if (!enabled) {
        this.active = false;
        this.selected.clear();
      }
      this.tracked = tracked;
      const open = new Set(tracked.map((t) => t.tab.id));
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
      for (const group of this.store.orderedGroups()) {
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
    }
    selectedKeys() {
      return [...new Set(this.tracked.filter((t) => this.selected.has(t.tab.id)).map((t) => t.key))];
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

  // src/ui/vertical-sidebar.ts
  var VerticalSidebarController = class {
    constructor(win, doc, store, meta, actions, menus, onRefresh) {
      this.win = win;
      this.doc = doc;
      this.store = store;
      this.meta = meta;
      this.actions = actions;
      this.menus = menus;
      this.onRefresh = onRefresh;
      this.hoverCard = new SidebarHoverCard(win, doc, store);
    }
    sidebar = null;
    listEl = null;
    selection = null;
    searchInput = null;
    hoverCard;
    viewMode = "groups";
    draggedKey = null;
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
      const headerActions = this.h("div", "ztf-sb-header-actions");
      const autoBtn = this.h("button", "ztf-sb-icon-btn ztf-sb-hide-collapsed");
      autoBtn.type = "button";
      autoBtn.title = "按 Zotero 集合自动归组";
      autoBtn.append(createSvgIcon(this.doc, "folder", 13));
      autoBtn.onclick = () => {
        this.actions.autoGroupByCollection();
        this.onRefresh();
      };
      const sleepBtn = this.h("button", "ztf-sb-icon-btn ztf-sb-hide-collapsed");
      sleepBtn.type = "button";
      sleepBtn.title = "休眠后台非固定标签（释放内存）";
      sleepBtn.append(createSvgIcon(this.doc, "sleep", 13));
      sleepBtn.onclick = () => {
        this.actions.sleepInactiveTabs();
        this.onRefresh();
      };
      const collapseBtn = this.h("button", "ztf-sb-icon-btn");
      collapseBtn.type = "button";
      collapseBtn.append(createSvgIcon(this.doc, "sidebar", 14));
      collapseBtn.title = "折叠/展开侧边栏";
      collapseBtn.onclick = () => {
        setPref("verticalSidebarCollapsed", !getPref("verticalSidebarCollapsed"));
        this.render();
      };
      headerActions.append(autoBtn, sleepBtn, collapseBtn);
      header.append(title, headerActions);
      const searchWrap = this.h("div", "ztf-sb-search-wrap ztf-sb-hide-collapsed");
      const search = this.h("input", "ztf-sb-search");
      search.type = "search";
      search.placeholder = "过滤标题、备注、集合…";
      search.oninput = () => this.renderList();
      searchWrap.append(search);
      const views = this.h("div", "ztf-sb-views ztf-sb-hide-collapsed");
      for (const [mode, label] of [
        ["groups", "分组"],
        ["collection", "集合"],
        ["recent", "状态"]
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
      const resizer = this.h("div", "ztf-sb-resizer ztf-sb-hide-collapsed");
      this.bindResizer(resizer, aside);
      aside.append(header, searchWrap, views, list, resizer);
      this.selection = new SidebarSelection(this.doc, this.store, headerActions, aside, list, () => this.renderList());
      deckParent.insertBefore(aside, deck);
      this.hoverCard.mount();
      this.sidebar = aside;
      this.listEl = list;
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
    render() {
      this.mount();
      if (!this.sidebar) return;
      const enabled = getPref("enableVerticalSidebar");
      const collapsed = getPref("verticalSidebarCollapsed");
      this.sidebar.hidden = !enabled || collapsed;
      this.sidebar.classList.toggle("collapsed", collapsed);
      if (!enabled || collapsed) return;
      this.sidebar.style.setProperty("--ztf-sb-width", `${getPref("verticalSidebarWidth")}px`);
      this.sidebar.style.setProperty("--ztf-row-height", `${getPref("verticalTabRowHeight")}px`);
      this.sidebar.style.setProperty("--ztf-font-size", `${getPref("verticalTabFontSize")}px`);
      this.renderList();
    }
    renderList() {
      if (!this.listEl) return;
      const q = (this.searchInput?.value || "").trim().toLowerCase();
      const selectedID = this.meta.getSelectedTabID();
      const tracked = this.meta.buildTrackedTabs();
      this.selection?.beginRender(tracked);
      const allTracked = tracked.filter((t) => {
        if (!q) return true;
        const r = this.store.getRemark(t.key).note;
        return `${t.title} ${t.shortTitle} ${t.filename} ${t.collection} ${r}`.toLowerCase().includes(q);
      });
      this.listEl.textContent = "";
      if (this.viewMode === "groups") {
        for (const g of this.store.orderedGroups()) {
          const members = allTracked.filter((t) => t.groupId === g.id);
          const virtuals = getPref("enableVirtualMembers") ? Object.values(this.store.state.virtualMembers).filter((m) => this.store.groupOfKey(m.key) === g.id) : [];
          const collapsed = this.store.state.collapsed.includes(g.id);
          const sec = this.buildSection(g.name, g.color, members.length + virtuals.length, collapsed, () => this.store.setCollapsed(g.id, !collapsed), (e) => this.menus.openGroupMenu(e, g), g.id, () => this.beginSidebarRename(sec, g.id, g.name));
          if (!collapsed) {
            const body = sec.querySelector(".ztf-sb-group-body");
            for (const t of members) body.append(this.buildRow(t, selectedID));
            for (const v of virtuals) {
              const row = this.h("div", "ztf-sb-row virtual");
              const ic = this.h("span", "ztf-sb-row-icon");
              ic.append(createSvgIcon(this.doc, "virtual", 13));
              const txt = this.h("div", "ztf-sb-row-text");
              const ttl = this.h("div", "ztf-sb-row-title");
              ttl.textContent = this.meta.getDisplayTitle(v);
              txt.append(ttl);
              row.append(ic, txt);
              row.onclick = () => void this.actions.openVirtualOrItem(v.itemID, g.id).then(this.onRefresh);
              row.oncontextmenu = (e) => this.menus.openVirtualMenu(e, v, g.id);
              body.append(row);
            }
          }
          this.listEl.append(sec);
        }
        this.selection?.updateControls();
        return;
      }
      if (this.viewMode === "collection") {
        const cols = [...new Set(allTracked.map((t) => t.collection))];
        cols.forEach((col, i) => {
          const items = allTracked.filter((t) => t.collection === col);
          const colors = ["#3977d5", "#21866a", "#8b5ac7", "#dc8225"];
          const sec = this.buildSection(col, colors[i % colors.length], items.length, false, () => {
          });
          const body = sec.querySelector(".ztf-sb-group-body");
          for (const t of items) body.append(this.buildRow(t, selectedID));
          this.listEl.append(sec);
        });
        this.selection?.updateControls();
        return;
      }
      for (const [label, color, items] of [
        ["已加载阅读器", "#16a34a", allTracked.filter((t) => t.status === "active")],
        ["已休眠省内存", "#d97706", allTracked.filter((t) => t.status === "sleeping")]
      ]) {
        const sec = this.buildSection(label, color, items.length, false, () => {
        });
        const body = sec.querySelector(".ztf-sb-group-body");
        for (const t of items) body.append(this.buildRow(t, selectedID));
        this.listEl.append(sec);
      }
      this.selection?.updateControls();
    }
    buildSection(title, color, count, collapsed, onToggle, onContext, dropGroupId, onDblClick) {
      const wrap = this.h("div", `ztf-sb-group${collapsed ? " collapsed" : ""}`);
      const head = this.h("div", "ztf-sb-group-head");
      const dot = this.h("span", "ztf-sb-dot");
      dot.style.background = color;
      const txt = this.h("span");
      txt.textContent = `${collapsed ? "▸" : "▾"} ${title} (${count})`;
      head.append(dot, txt);
      let clickTimer = null;
      head.onclick = () => {
        if (clickTimer !== null) this.win.clearTimeout(clickTimer);
        clickTimer = this.win.setTimeout(() => {
          clickTimer = null;
          onToggle();
        }, 210);
      };
      if (onDblClick) {
        head.ondblclick = (e) => {
          e.stopPropagation();
          if (clickTimer !== null) {
            this.win.clearTimeout(clickTimer);
            clickTimer = null;
          }
          onDblClick();
        };
      }
      if (onContext) head.oncontextmenu = (e) => onContext(e);
      if (dropGroupId !== void 0) {
        head.ondragover = (e) => {
          if (this.draggedKey) e.preventDefault();
        };
        head.ondrop = (e) => {
          e.preventDefault();
          if (!this.draggedKey) return;
          this.store.assignKey(this.draggedKey, dropGroupId);
          this.draggedKey = null;
          this.onRefresh();
        };
      }
      wrap.append(head, this.h("div", "ztf-sb-group-body"));
      return wrap;
    }
    buildRow(t, selectedID) {
      const row = this.h("div", `ztf-sb-row${t.tab.id === selectedID ? " selected" : ""}${t.status === "sleeping" ? " sleeping" : ""}`);
      row.draggable = true;
      const iconName = t.pinned ? "pin" : t.status === "sleeping" ? "sleep" : t.tab.type === "note" ? "note" : "pdf";
      const iconWrap = this.h("span", "ztf-sb-row-icon");
      iconWrap.append(createSvgIcon(this.doc, iconName, 13));
      const textWrap = this.h("div", "ztf-sb-row-text");
      const title = this.h("div", "ztf-sb-row-title");
      title.textContent = this.meta.getDisplayTitle(t);
      textWrap.append(title);
      const sub = this.meta.getDisplaySubtitle(t);
      if (sub) {
        const subEl = this.h("div", "ztf-sb-row-sub");
        subEl.textContent = sub;
        textWrap.append(subEl);
      }
      row.append(iconWrap, textWrap);
      const folderBtn = this.h("button", "ztf-sb-row-action");
      folderBtn.type = "button";
      folderBtn.title = "打开 PDF 附件所在文件夹";
      folderBtn.append(createSvgIcon(this.doc, "folder", 12));
      folderBtn.onclick = (e) => {
        e.stopPropagation();
        void this.actions.showInFilesystem(t.tab.id);
      };
      row.append(folderBtn);
      this.selection?.addCheckbox(row, t);
      row.onclick = () => this.actions.selectTab(t.tab.id);
      row.oncontextmenu = (e) => this.menus.openTabMenu(e, t);
      row.onmouseenter = () => this.hoverCard.show(row, t);
      row.onmouseleave = () => this.hoverCard.hide();
      row.ondragstart = () => {
        this.draggedKey = t.key;
      };
      row.ondragover = (e) => {
        if (!this.draggedKey || this.draggedKey === t.key) return;
        e.preventDefault();
        row.setAttribute("data-ztf-drop", "join");
      };
      row.ondragleave = () => row.removeAttribute("data-ztf-drop");
      row.ondrop = (e) => {
        e.preventDefault();
        row.removeAttribute("data-ztf-drop");
        if (!this.draggedKey || this.draggedKey === t.key) return;
        this.store.assignKey(this.draggedKey, t.groupId);
        this.draggedKey = null;
        this.onRefresh();
      };
      row.ondragend = () => {
        this.draggedKey = null;
      };
      return row;
    }
    beginSidebarRename(sec, groupId, currentName) {
      const head = sec.querySelector(".ztf-sb-group-head");
      if (!head) return;
      const input = this.h("input", "ztf-inline-edit");
      input.type = "text";
      input.value = currentName;
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const clean = input.value.trim();
        if (save && clean) this.store.renameGroup(groupId, clean);
        this.onRefresh();
      };
      input.onclick = (e) => e.stopPropagation();
      input.onkeydown = (e) => {
        const ke = e;
        if (ke.key === "Enter") {
          ke.preventDefault();
          finish(true);
        } else if (ke.key === "Escape") {
          ke.preventDefault();
          finish(false);
        }
      };
      input.onblur = () => finish(true);
      head.replaceWith(input);
      input.focus();
      input.select();
    }
    dispose() {
      this.hoverCard.dispose();
      this.sidebar?.remove();
      this.sidebar = null;
      this.listEl = null;
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
  display: inline-flex; align-items: center; gap: 4px; height: var(--ztf-tab-height); max-width: 132px;
  padding: 0 9px; border-radius: 6px; border: 0; flex: none;
  background: color-mix(in srgb, #f59e0b 12%, transparent); color: var(--ztf-text);
  font: 12px system-ui, "Microsoft YaHei UI", sans-serif; cursor: pointer;
}
.ztf-pinned-chip.selected { background: var(--ztf-card); box-shadow: 0 0 0 1px var(--ztf-border); font-weight: 600; }
.ztf-pinned-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

#ztf-inline .ztf-section {
  position: relative; display: inline-flex; align-items: center; flex: none; height: var(--ztf-tab-height); gap: 4px; box-sizing: border-box;
}
#ztf-inline .ztf-section::after {
  content: ""; position: absolute; left: 2px; right: 2px; bottom: -3px; height: 2px; border-radius: 1px;
  background: color-mix(in srgb, var(--ztf-color, transparent) 65%, transparent); pointer-events: none;
}
#ztf-inline .ztf-heading {
  display: inline-block; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
  height: var(--ztf-tab-height); box-sizing: border-box;
  border: 0; border-radius: 6px; padding: 0 10px;
  background: var(--ztf-color, #64748b); color: var(--ztf-ink, #fff);
  font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
}
#ztf-inline .ztf-heading.ztf-ungrouped {
  background: var(--ztf-hover); color: var(--ztf-text); border: 0;
}
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

/* Native Flat Toolbar Action Buttons */
#ztf-toolbar-actions { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; margin-inline: 4px 6px; }
.ztf-tb-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px;
  border: 1px solid transparent; background: transparent; color: var(--ztf-text);
  border-radius: 6px; font: 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap;
}
.ztf-tb-btn:hover { background: var(--ztf-hover); border-color: var(--ztf-border); }
.ztf-tb-btn.active { background: var(--ztf-accent-soft); color: var(--ztf-accent); border-color: color-mix(in srgb, var(--ztf-accent) 35%, transparent); }
.ztf-tb-btn.warn { color: light-dark(#b91c1c, #f87171); }

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
  font-size: 11px; font-weight: 600; color: var(--ztf-muted); cursor: pointer; user-select: none;
}
.ztf-sb-group-head:hover { background: var(--ztf-hover); color: var(--ztf-text); }
.ztf-sb-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
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
      this.tabMenus = new TabContextMenuController(win, doc, store, this.meta, this.actions, refresh);
      this.itemMenus = new ItemContextMenuController(win, doc, store, this.actions, refresh);
      this.popovers = new PopoverController(win, doc, store, this.meta, this.actions, this.tracker, refresh);
      this.spotlight = new SpotlightController(win, doc, store, this.meta, this.actions, refresh);
      this.horizontal = new HorizontalBarController(win, doc, store, this.meta, this.actions, this.tracker, this.tabMenus, this.popovers, this.spotlight, refresh);
      this.sidebar = new VerticalSidebarController(win, doc, store, this.meta, this.actions, this.tabMenus, refresh);
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
      this.ageTimer = this.win.setInterval(() => this.schedule(), 36e5);
      this.refresh();
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
      this.lastSelected = this.tracker.trackActivity(this.lastSelected);
      const tracked = this.meta.buildTrackedTabs();
      for (const t of tracked) {
        this.store.removeVirtualMember(t.key, false);
      }
      if (this.lastSelected && this.lastSelected !== prevSelected) {
        const active = tracked.find((t) => t.tab.id === this.lastSelected);
        if (active && this.store.state.collapsed.includes(active.groupId)) {
          this.store.setCollapsed(active.groupId, false, false);
        }
      }
      this.horizontal.render();
      this.sidebar.render();
    }
    dispose() {
      this.disposed = true;
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
