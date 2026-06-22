# server/

Platform-side sources for binding real data to the **D3 Sankey Diagram**
component. Create these as records on the instance — they are NOT shipped by
`snc ui-component deploy`; the `server/` files are the version-controlled source.

Unlike the line/column chart's `D3ChartData` (which emits a `series` array), the
Sankey's `D3SankeyData` emits a GRAPH object `{ nodes, links }` by grouping on a
**source field AND a target field**.

| File | What it is |
|---|---|
| `D3SankeyData.js` | Script Include — `fromAggregate()`, `fromRows()` |
| `d3-sankey-data.transform.js` | Table-aggregate data resource script |
| `d3-sankey-data.properties.json` | Table-aggregate data resource inputs (bare array) |
| `sanity-test.background.js` | Verify the transforms by logging the graph JSON |

## Setup (one time)

1. **Create the Script Include.** *System Definition → Script Includes → New*.
   Name it `D3SankeyData`, set **Accessible from = All application scopes**,
   **Client callable = false**, and paste `D3SankeyData.js`. Save.
2. **Create the Transform data resource.** In UI Builder: **Add data resource →
   Transform** (creates a `sys_ux_data_broker_transform` record).
   - Name it e.g. `D3 Sankey Data`, leave **Mutates server data** unchecked.
   - Paste `d3-sankey-data.transform.js` into the **Script** field.
   - Paste the **bare JSON array** from `d3-sankey-data.properties.json` into the
     **Properties** field (must be just the `[ … ]` array — if it's wrapped in an
     object or has a `"readOnly"` entry, the config panel stays blank and **Add**
     is disabled).
3. **Create the execute ACL** (required — the resource won't run without it):
   - Get the data broker's **sys_id** (`sys_ux_data_broker_transform.list` → open
     the record → copy sys_id).
   - **Elevate roles:** profile menu → **Elevate role** → **security_admin**.
   - **System Security → Access Control (ACL) → New**: **Type** = `ux_data_broker`,
     **Operation** = `execute`, **Name** = paste the data broker **sys_id** (click
     the padlock to switch Name to free text), **Active** = true, and add one
     permissive criterion (e.g. Security Attribute **`UserIsAuthenticated`**, or
     Advanced script `answer = gs.isLoggedIn();`). **Submit**, then reload UI Builder.

Bind the resource output in UI Builder: **Data · Graph data** →
`@data.<resource_name>.output`.

## Use it: aggregate a table

- **Flow of incidents from intake channel to current state:** `table` = `incident`,
  `sourceField` = `contact_type`, `targetField` = `state`, `metric` = `count`. →
  ribbons sized by how many incidents flow from each channel into each state.
- **Prefix stages** when the same value can be both a source and a target (e.g.
  a status field used for both ends): set `prefixStages` = **true** so each value
  becomes two nodes (`From: X` / `To: X`) instead of collapsing into one. Self-loops
  (source == target) are always dropped because d3-sankey cannot lay them out.

`fromAggregate(cfg)` inputs: `table`, `filter`, `sourceField`, `targetField`,
`metric` (`count`/`sum`/`avg`/`min`/`max`), `valueField`, `useDisplayValue`,
`colors`, `prefixStages`.

## Use it: reshape rows you already have

```js
function transform(input) {
  return new global.D3SankeyData().fromRows(input.rows, {
    sourceField: 'from', targetField: 'to', valueField: 'n', metric: 'sum'
  });
}
```

Duplicate `(source, target)` pairs are combined (summed by default; `metric` can
be `min`/`max`/`avg`).

## Verify

Run `sanity-test.background.js` in *Scripts - Background* (Global scope) to log
the `{ nodes, links }` JSON before wiring it in.
