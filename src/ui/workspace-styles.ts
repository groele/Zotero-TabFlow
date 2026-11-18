export const WORKSPACE_CSS = `
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
