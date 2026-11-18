# Zotero TabFlow

**Zotero TabFlow** (`v17.1.0`) is a Zotero 10–12 productivity plugin in the Zotero Flow suite that unifies horizontal tab grouping, a collapsible vertical tabs sidebar, pinned tabs, reader tab sleep, custom tab remarks, workspace session snapshots, collection auto-grouping, Spotlight quick search (`Ctrl+P`), and one-click PDF folder navigation.

## Key Features
- **Dual-Mode Tab Organization**: Edge-style horizontal grouped tab bar and collapsible/resizable vertical sidebar (`Custom Groups` / `Collection` / `Status` views), each independently toggleable in Settings.
- **Pinned Tabs, Tab Sleep & Virtual Members**: Pin key papers (`📌`), suspend inactive background reader tabs to save memory, and retain closed grouped tabs as virtual members for one-click reload.
- **Inline Group Editing & Drag-and-Drop**: Double-click any group header to rename inline; drag tabs to stack-create groups, reorder, or spring-open collapsed groups.
- **Tab Remarks & Hover Preview**: Add up to 300-character custom aliases without altering original PDF filenames, plus hover metadata cards (authors, venue, collection, last-read time).
- **Collection Auto-Grouping & Sessions**: Automatically group newly opened papers by Zotero collection with configurable multi-collection disambiguation, and save/restore named workspace sessions.
- **Spotlight (`Ctrl+P`) & Stale Cleanup**: Instant fuzzy search across open tabs, remarks, collections, and commands, plus stale-tab cleanup suggestions.
- **One-Click PDF Folder Jump**: Dedicated icon in Zotero's right-hand Item Pane sidenav and hover action in the vertical sidebar.

## Development & Build

```bash
npm install
npm test
pwsh -NoProfile -File scripts/build.ps1 -UpdateFeed
```

## License
AGPL-3.0-or-later
