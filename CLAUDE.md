# roam-autopin

Roam Research extension that automatically pins any block or page added to the right sidebar.

Forked from [mlava/workspaces](https://github.com/mlava/workspaces), stripped down to only the auto-pin feature.

## Build

```
npm install
npm run build    # webpack bundles src/index.js -> extension.js (ES module)
```

## Architecture

- `src/index.js` — Extension entry point. Exports `onload`/`onunload` lifecycle hooks expected by Roam's extension system.
- `src/sidebar.js` — Core logic. A `MutationObserver` watches the DOM for new `.rm-sidebar-window` DIV elements, then calls `roamAlphaAPI.ui.rightSidebar.pinWindow()` on each.
- `webpack.config.js` — Bundles to `extension.js` at repo root as an ES module.
- `extension.js` — Build output (gitignored).

## Key APIs

- `window.roamAlphaAPI.ui.rightSidebar.getWindows()` — Lists current sidebar windows with order, type, and uid.
- `window.roamAlphaAPI.ui.rightSidebar.pinWindow({ window: { type, "block-uid" } })` — Pins a sidebar window. Uses `block-uid` for blocks and `page-uid` for pages/outlines.

