# Mutate — Creating, Updating, Deleting Tiles & Filters

## Create Tile

Provide an inline query (model + view + fields) or a saved query_id:

```
create_tile({
  dashboard_id: "152",
  title: "Revenue by Region",
  query: {
    model: "common",
    view: "transactions",
    fields: ["transactions.region", "transactions.total_revenue"],
    sorts: ["transactions.total_revenue desc"],
    limit: "20",
    vis_config: {type: "looker_bar"}
  }
})
```

The shim handles the two-step dance automatically (Looker API rejects inline queries on element create — it creates the query first, then references via query_id).

## Update Tile (Partial Merge)

Only send what changed. Existing fields, sorts, filters are preserved.

**Change title:**
```
update_tile({element_id: "1503", title: "New Title"})
```

**Change chart type (fields preserved):**
```
update_tile({element_id: "1503", query: {vis_config: {type: "looker_pie"}}})
```

**Change sort order:**
```
update_tile({element_id: "1503", query: {sorts: ["transactions.revenue desc"]}})
```

**Add a filter to the query:**
```
update_tile({element_id: "1503", query: {filters: {"transactions.region": "SG"}}})
```

## Delete Tile

```
delete_tile({element_id: "1503"})
```

## Create Filter

```
create_filter({
  dashboard_id: "152",
  name: "region_filter",
  title: "Region",
  type: "field_filter",
  dimension: "transactions.region",
  model: "common",
  explore: "transactions",
  default_value: "SG"
})
```

**UI types:** Set `ui_config` to control how the filter renders:
- `{type: "button_toggles", display: "inline"}` — radio buttons
- `{type: "dropdown_menu"}` — dropdown
- `{type: "tag_list"}` — multi-select tags
- `{type: "advanced"}` — text input with operators

## Update Filter

```
update_filter({filter_id: "1145", title: "Updated", default_value: "GHS"})
update_filter({filter_id: "1145", ui_config: {type: "button_toggles"}})
```

## Delete Filter

```
delete_filter({filter_id: "1145"})
```

## Wiring a Filter to a Specific Tile

Dashboard filters connect to tiles via `filter_wiring`. To wire a filter to ONLY one tile, use `execute_sdk_code`:

```
execute_sdk_code({code: `
  const el = await sdk.ok(sdk.dashboard_element('1487', ''))
  const listens = el.result_maker?.filterables?.[0]?.listen || []
  listens.push({
    dashboard_filter_name: 'my_filter',
    field: 'transactions.business_unit'
  })
  await sdk.ok(sdk.update_dashboard_element('1487', {
    result_maker: { filterables: [{ listen: listens }] }
  }))
  return {wired: true, total_listens: listens.length}
`})
```

This adds the wiring to that tile only — other tiles are not affected.
