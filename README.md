# D3 Sankey Diagram — UI Builder custom component

A configurable **Sankey flow diagram** for ServiceNow UI Builder, rendered with
[D3.js](https://d3js.org/) and the [`d3-sankey`](https://github.com/d3/d3-sankey)
plugin. Nodes are drawn as bars; links are proportional curved ribbons whose
thickness encodes the flow value. The entire look-and-feel is driven by component
properties, so page builders can restyle it from the UI Builder property panel
without touching code. It supports four node-alignment modes, source/target/
gradient/static link coloring, node sorting, connected-flow highlighting on hover,
and emits events you can hook (click the chart, a node, or a link; hover a node).

- **Component tag:** `x-2114311-sankey-chart-uic`
- **Scope:** `x_2114311_sankey_0`
- **Renderer:** Seismic (`@servicenow/ui-renderer-snabbdom`) + D3 v7 + `d3-sankey`

> **Sibling of the D3 Line/Column charts.** This component shares the family's
> vendor prefix (`x_2114311`) and architecture, but its **data shape is
> different** — see [Data shape](#data-shape--how-it-differs-from-the-linecolumn-chart).

---

## Project layout

```
src/x-2114311-sankey-chart-uic/
├── index.js        # createCustomElement: properties, view (stable container), lifecycle handlers
├── chart.js        # drawChart(container, props, dispatch) — the D3 + d3-sankey rendering
├── sampleData.js   # SAMPLE_DATA fallback so it renders on drop
├── styles.scss     # host + container sizing, tooltip, hover/focus affordances
└── __tests__/
now-ui.json         # UI Builder manifest: properties + actions exposed to authors
now-cli.json        # CLI build config
package.json        # deps incl. d3 AND d3-sankey
scripts/verify_chart.mjs  # headless renderer verification harness
server/             # platform-side Script Include + Data Transform sources (see below)
```

D3 owns the SVG imperatively. The Seismic view renders only a single `.sc-root`
div; the diagram is (re)drawn from the `COMPONENT_RENDERED` / `COMPONENT_DOM_READY`
lifecycle actions, and a `ResizeObserver` redraws it when the UI Builder slot
resizes. This keeps snabbdom's virtual DOM and D3's direct DOM mutation on
separate elements.

### The `d3-sankey` dependency

The core d3 functions come from named submodule imports (`d3-selection`,
`d3-scale`, `d3-scale-chromatic`, `d3-format`, `d3-color`, `d3-ease`). The Sankey
layout itself lives in a **separate package**, `d3-sankey` (not part of the `d3`
meta-package), declared in `package.json` and imported with named imports:

```js
import {
  sankey,
  sankeyLinkHorizontal,
  sankeyLeft,
  sankeyRight,
  sankeyCenter,
  sankeyJustify,
} from "d3-sankey";
```

`npm install` pulls it in automatically.

---

## Develop & deploy

> Requires the `snc` CLI with the `ui-component` extension and a configured
> connection profile.

```powershell
# One-time: install the CLI and point it at your instance
npm install -g @servicenow/cli
snc configure profile set            # enter instance URL + credentials

# Install JS deps for this project (includes d3-sankey)
npm install

# Local dev harness (hot-reloading), opens example/element.js
snc ui-component develop --open

# Build the deployable update set XML without contacting the instance
snc ui-component generate-update-set --offline

# Build and push the component to the connected instance
snc ui-component deploy
```

After deploying, open **UI Builder → add component → "D3 Sankey Diagram"**
(category _Primitives_). Bind `data` to a data resource (or leave it empty to show
sample data), tune the look-and-feel in the property panel, and wire the events
under the component's **Events** section.

---

## Data shape — how it differs from the line/column chart

This is the key difference from the rest of the chart family. **Read this before
binding data.**

### Line / Column chart: a `series` array (points on axes)

The line and column charts take a **`series`** array — categorical x + value y:

```jsonc
[
  {
    "name": "Submitted",
    "color": "#2E93fA",
    "data": [
      { "label": "Jan", "value": 44 },
      { "label": "Feb", "value": 55 },
    ],
  },
]
```

Each entry is one series; each point is `{ label, value }` plotted against shared
category/value axes.

### Sankey diagram: a `data` GRAPH object (flows between nodes)

The Sankey takes a single **`data`** object with **two arrays** — it models
**flows between nodes**, not points on axes:

```jsonc
{
  "nodes": [
    { "name": "Open" },
    { "name": "In Progress" },
    { "name": "Resolved" },
  ],
  "links": [
    { "source": "Open", "target": "In Progress", "value": 30 },
    { "source": "In Progress", "target": "Resolved", "value": 25 },
  ],
}
```

- **`nodes`** — the stages/buckets. Each is `{ name, color? }`; the optional
  per-node `color` is used when _Colors · Use node colors_ is on.
- **`links`** — the flows. Each is `{ source, target, value }`. The ribbon's
  thickness is proportional to `value`.

### `source` / `target` may be a node NAME _or_ a node INDEX

A link's `source`/`target` can be either:

- a **node name** (string) — `"source": "Open"`, or
- a **node index** (number) — `"source": 0` (0-based index into `nodes`).

Internally the renderer resolves indices and names to node names and runs
`sankey().nodeId(d => d.name)`. You can even mix the two within one graph. Links
that reference an **unknown node name** auto-create that node; **self-loops**
(`source === target`) and **zero/negative** links are dropped.

|                 | Line/Column chart                  | Sankey diagram                                   |
| --------------- | ---------------------------------- | ------------------------------------------------ |
| Property        | `series` (array)                   | `data` (object)                                  |
| Top-level shape | `[ { name, color?, data:[…] } ]`   | `{ nodes:[…], links:[…] }`                       |
| Unit of data    | a point `{ label, value }` on axes | a flow `{ source, target, value }` between nodes |
| Models          | a value over a category/time axis  | how quantity moves between stages                |

### Guarding cycles

`d3-sankey` requires a directed **acyclic** graph and **throws** on circular
links (e.g. `A → B → A`). The renderer wraps the layout in a `try/catch` and shows
a friendly empty-state message (_"Cannot render flow (check for circular
links)"_) instead of crashing. An empty graph (no nodes/links) shows _"No data to
display"_.

Leave `data` empty/unbound to render the built-in sample (a ticket-lifecycle
flow with 9 nodes).

---

## Feeding data from the platform (Data Transform)

You rarely want to hand-write the graph. The recommended pattern turns real table
data into the `{ nodes, links }` graph **on the server** and binds it straight to
_Data · Graph data_. All transform logic lives in a reusable **Script Include**
(`server/D3SankeyData.js`); a **Transform data resource** calls it and exposes its
output to UI Builder.

```
Table ──GlideAggregate (group by source + target)──▶ D3SankeyData ──{nodes,links}──▶ Transform data resource
                                                                                          │ @data.<name>.output
                                                                                          ▼
                                                                                Data · Graph data
```

> **This is NOT the line/column chart's `D3ChartData`.** That Script Include emits
> a `series` array (one category field). `D3SankeyData` instead groups by a
> **source field AND a target field** to build the node set and the link set — a
> fundamentally different output (`{ nodes, links }`).

Server-side source files live in **`server/`**:

| File                                    | What it is                                        |
| --------------------------------------- | ------------------------------------------------- |
| `server/D3SankeyData.js`                | Script Include — `fromAggregate()`, `fromRows()`  |
| `server/d3-sankey-data.transform.js`    | Table-aggregate data resource script              |
| `server/d3-sankey-data.properties.json` | Table-aggregate data resource inputs (bare array) |
| `server/sanity-test.background.js`      | Verify the transforms by logging the graph JSON   |

### Setup (one time)

1. **Create the Script Include.** _System Definition → Script Includes → New_.
   Name it `D3SankeyData`, set **Accessible from = All application scopes**,
   **Client callable = false**, and paste `server/D3SankeyData.js`. Save.
2. **Create the Transform data resource.** In UI Builder: **Add data resource →
   Transform** (creates a `sys_ux_data_broker_transform` record).
   - Name it e.g. `D3 Sankey Data`, leave **Mutates server data** unchecked.
   - Paste `server/d3-sankey-data.transform.js` into the **Script** field.
   - Paste the **bare JSON array** from `server/d3-sankey-data.properties.json`
     into the **Properties** field (must be just the `[ … ]` array — if it's
     wrapped in an object or has a `"readOnly"` entry, the panel stays blank and
     **Add** is disabled).
3. **Create the execute ACL** (required — the resource won't run without it):
   - Get the data broker's **sys_id** (`sys_ux_data_broker_transform.list` → open
     → copy sys_id).
   - **Elevate roles:** profile menu → **Elevate role** → **security_admin**.
   - **System Security → Access Control (ACL) → New**: **Type** = `ux_data_broker`,
     **Operation** = `execute`, **Name** = paste the data broker **sys_id** (click
     the padlock to switch Name to free text), **Active** = true, and add one
     permissive criterion (e.g. Security Attribute **`UserIsAuthenticated`**).
     **Submit**, then reload UI Builder.

### Use it: aggregate a table

- **Bind:** _Data · Graph data_ → `@data.d3_sankey_data.output` (use your
  resource's name).
- **Channel → state flow:** `table` = `incident`, `sourceField` = `contact_type`,
  `targetField` = `state`, `metric` = `count`. → ribbons sized by how many
  incidents flow from each channel into each state.
- **Prefix stages:** when the same value can appear as both a source and a target
  (e.g. one status field for both ends), set `prefixStages` = **true** so each
  value becomes two nodes (`From: X` / `To: X`) instead of collapsing into one
  self-referential node.

`fromAggregate(cfg)` inputs (all exposed as data-resource inputs): `table`,
`filter`, `sourceField`, `targetField`, `metric` (`count`/`sum`/`avg`/`min`/`max`),
`valueField`, `useDisplayValue`, `colors`, `prefixStages`.

### Use it: reshape rows you already have

```js
function transform(input) {
  return new global.D3SankeyData().fromRows(input.rows, {
    sourceField: "from",
    targetField: "to",
    valueField: "n",
    metric: "sum",
  });
}
```

Duplicate `(source, target)` pairs are combined (summed by default).

### Verify

Run `server/sanity-test.background.js` in _Scripts - Background_ (Global scope) to
log the `{ nodes, links }` JSON before wiring it in.

> **Note:** these are **platform records** (Script Include / data resource / ACL),
> not part of the component bundle that `snc ui-component deploy` ships. Create
> them on the instance as above; the `server/` files are the version-controlled
> source.

---

## Configure properties

Panel labels are **prefixed by section** (`Nodes · …`, `Links · …`, etc.) to mimic
the native Data Visualization layout.

> **D3 format specifiers** — `valueFormat` accepts a
> [d3-format](https://github.com/d3/d3-format#locale_format) number string
> (`.0f`, `,.0f`, `$,.0f`, `.2s`).

### Data

| Property   | `name` | Default         | Description                                                                                                                           |
| ---------- | ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Graph data | `data` | built-in sample | `{ nodes: [ { name, color? } ], links: [ { source, target, value } ] }`. `source`/`target` = node name or index. Empty = sample data. |

### Header & border

| Property                      | `name`                                         | Default                 |
| ----------------------------- | ---------------------------------------------- | ----------------------- |
| Title                         | `chartTitle`                                   | `Ticket Lifecycle Flow` |
| Title font size               | `titleFontSize`                                | `18`                    |
| Title color                   | `titleColor`                                   | `#374151`               |
| Width                         | `componentWidth`                               | `100%`                  |
| Padding                       | `componentPadding`                             | `12px`                  |
| Background color              | `backgroundColor`                              | `transparent`           |
| Border color / width / radius | `borderColor` / `borderWidth` / `borderRadius` | blank / `0` / `0`       |

### Display

| Property                | `name`                       | Default                  | Description                                                                            |
| ----------------------- | ---------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Chart height (px)       | `chartHeight`                | `420`                    | Height of the diagram.                                                                 |
| Animate                 | `animate`                    | `true`                   | Nodes grow from their center; links thicken from 0.                                    |
| Animation duration (ms) | `animationDuration`          | `800`                    |                                                                                        |
| Animation easing        | `animationEasing`            | `Cubic out`              | Linear, Cubic out, Cubic in-out, Quad out, Exp out, Back out, Bounce out, Elastic out. |
| Base font family        | `fontFamily`                 | blank                    | Inherit from the page when blank.                                                      |
| Drop shadow             | `dropShadow`                 | `false`                  | Soft shadow on the node bars.                                                          |
| Shadow color / blur     | `shadowColor` / `shadowBlur` | `rgba(0,0,0,0.25)` / `4` | When drop shadow on.                                                                   |

### Nodes

| Property              | `name`                           | Default     | Description                                                                                       |
| --------------------- | -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Alignment             | `nodeAlign`                      | `Justify`   | `Justify` / `Left` / `Right` / `Center` (d3-sankey alignment functions).                          |
| Width (px)            | `nodeWidth`                      | `16`        | Thickness of each node bar.                                                                       |
| Vertical padding (px) | `nodePadding`                    | `12`        | Gap between stacked nodes in a column.                                                            |
| Corner radius (px)    | `nodeCornerRadius`               | `2`         | Rounded node bar corners.                                                                         |
| Border color / width  | `nodeStroke` / `nodeStrokeWidth` | blank / `0` | Node bar outline.                                                                                 |
| Vertical sort         | `nodeSort`                       | `Auto`      | `Auto` (minimize crossings) / `None` (input order) / `Ascending` / `Descending` (by total value). |

### Links

| Property                          | `name`             | Default    | Description                                                  |
| --------------------------------- | ------------------ | ---------- | ------------------------------------------------------------ |
| Color mode                        | `linkColorMode`    | `Gradient` | `Source` / `Target` / `Gradient` (source→target) / `Static`. |
| Static color                      | `linkStaticColor`  | `#94a3b8`  | Used when Color mode is Static.                              |
| Opacity                           | `linkOpacity`      | `0.45`     | Ribbon opacity.                                              |
| Hover opacity                     | `linkHoverOpacity` | `0.75`     | Opacity a ribbon rises to on hover.                          |
| Curvature                         | `linkCurvature`    | `0.5`      | 0 (straight) → 1 (S-curved).                                 |
| Highlight whole path on hover     | `linkHover`        | `true`     | Brighten connected nodes when hovering a ribbon.             |
| Highlight connected on node hover | `hoverHighlight`   | `true`     | Emphasize connected links/nodes when hovering a node.        |
| Dim others on hover               | `hoverDimOthers`   | `true`     | Fade unrelated nodes/links while hovering.                   |

### Colors

| Property        | `name`            | Default     | Description                                                                                         |
| --------------- | ----------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| Use node colors | `useSeriesColors` | `true`      | Use each node's own `color` when present.                                                           |
| Color scheme    | `colorScheme`     | `Tableau10` | A built-in D3 scheme (Category10, Tableau10, Set2, Set3, Paired, Dark2, Pastel1, Accent) or Custom. |
| Color palette   | `colorPalette`    | 6-color set | JSON array cycled across nodes when _Use node colors_ is off and scheme is Custom.                  |

### Labels

| Property         | `name`              | Default   | Description                                        |
| ---------------- | ------------------- | --------- | -------------------------------------------------- |
| Show node labels | `showNodeLabels`    | `true`    | Text label beside each node.                       |
| Position         | `nodeLabelPosition` | `Auto`    | `Auto` / `Outside` / `Inside`.                     |
| Font size (px)   | `nodeLabelFontSize` | `12`      |                                                    |
| Color            | `nodeLabelColor`    | `#374151` |                                                    |
| Show node totals | `showNodeValues`    | `false`   | Append the node's total throughflow to its label.  |
| Value format     | `valueFormat`       | blank     | D3 number format for totals + link tooltip values. |

### Tooltip

| Property                | `name`                                   | Default                           | Description                                                                                                                                                                    |
| ----------------------- | ---------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Show tooltip            | `showTooltip`                            | `true`                            |                                                                                                                                                                                |
| Node template           | `tooltipTemplate`                        | `<strong>{name}</strong>…`        | Tokens for NODES: `{name}`, `{value}`, `{formattedValue}`, `{swatch}`, `{color}`. Interpolated values are HTML-escaped. Links use a built-in `source → target: value` tooltip. |
| Follow cursor           | `tooltipFollowCursor`                    | `true`                            |                                                                                                                                                                                |
| Background / Text color | `tooltipBackground` / `tooltipTextColor` | `rgba(17,24,39,0.92)` / `#ffffff` |                                                                                                                                                                                |
| Font size               | `tooltipFontSize`                        | `12`                              |                                                                                                                                                                                |

---

## Events (actions)

| Action          | When                                           | Payload                               |
| --------------- | ---------------------------------------------- | ------------------------------------- |
| `CHART_CLICKED` | Click the diagram background (not a node/link) | `nodeCount`, `linkCount`              |
| `NODE_CLICKED`  | Click a node bar (drill-in)                    | `name`, `value` (node total), `index` |
| `LINK_CLICKED`  | Click a flow ribbon (drill-in)                 | `source`, `target`, `value`           |
| `NODE_HOVERED`  | Hover a node                                   | `name`, `value`                       |

`NODE_CLICKED` and `LINK_CLICKED` call `stopPropagation()` so they don't also fire
`CHART_CLICKED`. In UI Builder, add an event handler to navigate, open a record,
or set a page parameter using the payload.

---

## Verify without an instance

`chart.js` imports only d3 submodules + `d3-sankey`, so it can be bundled and run
headless:

```bash
node scripts/verify_chart.mjs --chart src/x-2114311-sankey-chart-uic/chart.js
```

The harness auto-installs `d3@7 d3-sankey jsdom esbuild` into a temp dir, bundles
the renderer, and exercises `drawChart` across 47 scenarios (every node alignment,
every link color mode, labels on/off, node values, links by name vs index, a
cyclic graph that must be caught, unknown-node links, single link, empty graph,
node-sort variants, animate off, hover settings, string-coerced props), asserting
an `<svg>` is produced with no exceptions.
