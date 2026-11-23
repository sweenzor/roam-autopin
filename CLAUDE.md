# roam-autopin

Roam Research extension that automatically pins any block or page added to the right sidebar.

Forked from [mlava/workspaces](https://github.com/mlava/workspaces), stripped down to only the auto-pin feature.

## Build

```
npm install
npm run build    # webpack bundles src/index.js -> extension.js (ES module)
```

## Releasing

Version in `package.json` and `CHANGELOG.md`: semver 0.x.y, like the other extensions (the first Depot release counts as 0.1.0). A release to Roam Depot is a PR on
Roam-Research/roam-depot that bumps `source_commit` in `extensions/sweenzor/autopin.json`.

## README screenshots

`test/real-roam/screenshots.mjs` takes the README's pictures in Roam's real desktop app (Linux, Xvfb),
signed in to the test graph. The Screenshots workflow runs it (needs the `ROAM_EMAIL` and `ROAM_PASSWORD`
repository secrets), commits the pictures to `docs/images` and pins the README's image links to that
commit. Run it before every release to Roam Depot. Every feature has a README section and a picture.
Without credentials the script uses the public help graph, to try the script out only.

## Architecture

- `src/index.js` — Extension entry point. Exports `onload`/`onunload` lifecycle hooks expected by Roam's extension system.
- `src/sidebar.js` — Core logic. A `MutationObserver` watches the DOM for new `.rm-sidebar-window` DIV elements, then calls `roamAlphaAPI.ui.rightSidebar.pinWindow()` on each one that isn't pinned.
- `webpack.config.js` — Bundles to `extension.js` at repo root as an ES module.
- `extension.js` — Build output (gitignored).

## Key APIs

- `window.roamAlphaAPI.ui.rightSidebar.getWindows()` — Lists current sidebar windows with order, type, and uid.
- `window.roamAlphaAPI.ui.rightSidebar.pinWindow({ window: { type, "block-uid" } })` — Pins a sidebar window. `getWindows` reports `block-uid`, `page-uid` or `mentions-uid` depending on the kind; all are pinned with `block-uid`. A search is pinned with `search-query-str`.


## Test account plan

Real-Roam CI signs in to a Roam test account with a Believer plan that ends on 2031-11-23 (without a plan its local graphs are read-only). `test/test-account-plan.test.js` fails from a year before that; after renewing, put the new end date there. Each signed-in real-Roam run also reads the plan from Roam's Billing page (`test/real-roam/plan.mjs`, account menu > Billing, before a graph opens) and fails if it isn't Believer, ends within a year, or differs from that date.
