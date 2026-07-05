# CLAUDE.md — D3 Sankey Diagram UI component

Context for Claude Code (or any agent) continuing work on this project.

## What this is

A ServiceNow **Next Experience / UI Builder** custom component that renders a
configurable **Sankey flow diagram** with D3 v7 + the `d3-sankey` plugin. It is a
sibling of the **D3 Line Chart** and **D3 Column Chart** components and mirrors
their architecture and conventions — but its **data shape is different** (a graph,
not a series array).

- Component tag: `x-2114311-sankey-chart-uic` · Scope: `x_2114311_sankey_0`
- Vendor prefix `x_2114311` is shared with the line/column charts (same publisher).

## Architecture (important conventions)

- **Seismic + D3 split.** The snabbdom `view` renders only a single stable
  `<div class="sc-root">`. D3 owns the SVG imperatively.
  `drawChart(container, props, dispatch)` in
  `src/x-2114311-sankey-chart-uic/chart.js` fully re-renders on every property
  change. Never mix snabbdom virtual DOM with D3 mutation on the same nodes.
- **Lifecycle** (`index.js`): redraw on `COMPONENT_RENDERED` and
  `COMPONENT_PROPERTY_CHANGED`; a `ResizeObserver` (wired in
  `COMPONENT_DOM_READY`) redraws on width changes only, and skips re-animating so
  the grow-in isn't snapped to its end state.
- **D3 imports must be NAMED submodule imports** (`import { select } from
'd3-selection'`), not `import * as d3`. The ServiceNow prod build tree-shakes a
  passed-around namespace object and would strip methods. Core d3 submodules
  resolve through the `d3` meta-package.
- **`d3-sankey` is a SEPARATE package** (NOT part of `d3`), declared in
  `package.json` and imported with named imports
  (`import { sankey, sankeyLinkHorizontal, sankeyLeft, sankeyRight, sankeyCenter,
sankeyJustify } from 'd3-sankey'`). It must stay in `dependencies`.
- **No `d3-transition`.** The grow-in animation grows node rects from their
  vertical center and thickens link strokes from 0 via `requestAnimationFrame`.
  Don't introduce `d3-transition` — it gets tree-shaken out of the prod bundle.
- **Indentation is TABS** in JS (see `.editorconfig`); ESLint uses
  `@tectonic/tectonic/servicenow`.
- **Server files are ES5** (`server/*.js`) — scoped/global ServiceNow
  compatibility (no `let`/arrow funcs/template literals in those).

## Files

- `src/x-2114311-sankey-chart-uic/index.js` — `createCustomElement`: property
  defaults + lifecycle. JSON-typed defaults (`data`, `colorPalette`) live here.
- `src/x-2114311-sankey-chart-uic/chart.js` — the D3 + d3-sankey renderer (the
  bulk of the logic). `normalizeGraph()` resolves name/index source/target,
  auto-creates unknown nodes, drops self-loops + zero/negative links; the layout
  call is wrapped in try/catch to handle cyclic graphs gracefully.
- `src/x-2114311-sankey-chart-uic/sampleData.js` — `SAMPLE_DATA` graph fallback.
- `src/x-2114311-sankey-chart-uic/styles.scss` — host/container/tooltip styles
  (css prefix `sc`).
- `now-ui.json` — UI Builder manifest: every property (section-prefixed labels) +
  the `CHART_CLICKED` / `NODE_CLICKED` / `LINK_CLICKED` / `NODE_HOVERED` actions.
  **Keep this in sync with the `properties` block in `index.js` and the prop
  reads in `chart.js`** (the three-places rule).
- `server/` — platform-side sources (`D3SankeyData.js` Script Include + transform
  - properties JSON + sanity-test). NOT shipped by `snc ui-component deploy`; they
    are created as platform records on the instance. See README "Feeding data".
- `scripts/verify_chart.mjs` — headless verification harness (47 scenarios).

## Data contract — DIFFERS from line/column

`data` = `{ nodes: [ { name, color? } ], links: [ { source, target, value } ] }`.

This is **not** the line/column `series` array (`[ { name, color?, data:[ { label,
value } ] } ]`). The Sankey models **flows between nodes**, not points on axes:

- `nodes` — the stages; each `{ name, color? }`.
- `links` — the flows; each `{ source, target, value }`. `source`/`target` may be
  a node **name** (string) or a node **index** (number); both are resolved to
  node names before `sankey().nodeId(d => d.name)`.
- Unknown referenced nodes are auto-created; self-loops and zero/negative links
  are dropped; **cyclic graphs are caught** (d3-sankey throws) and shown as a
  friendly empty-state.

`server/D3SankeyData.js` builds this graph by grouping a table on a **source field
AND a target field** (vs the line/column `D3ChartData`, which groups one category
field into a `series` array). It is a distinct Script Include.

## Build / dev / deploy

```bash
npm install                              # pulls in d3 AND d3-sankey
snc ui-component develop --open          # local hot-reload harness (example/element.js)
snc ui-component generate-update-set --offline
snc ui-component deploy                   # push to the connected instance
```

Requires the `snc` CLI (`npm i -g @servicenow/cli`) + a configured profile.

## How to verify changes without an instance

`chart.js` imports only d3 submodules + d3-sankey, so it can be bundled and run
headless:

```bash
node scripts/verify_chart.mjs --chart src/x-2114311-sankey-chart-uic/chart.js
```

The harness installs `d3@7 d3-sankey jsdom esbuild` (d3-sankey is NOT in the d3
meta-package, so it's installed explicitly), esbuild-bundles `chart.js` to CJS,
and calls `drawChart` across 47 scenarios in jsdom, asserting an `<svg>` is
produced with no exceptions. All 47 pass as of the initial build.

## Likely next tasks / ideas

- Add unit tests under `__tests__/` (currently a stub) using the jsdom approach.
- Optional: vertical-only / circular Sankey variants, node drag-to-reposition,
  multi-level color inheritance, link value labels on the ribbons.
- If adding a property: update `now-ui.json` (manifest), `index.js` (default),
  and read it in `chart.js` — all three.
