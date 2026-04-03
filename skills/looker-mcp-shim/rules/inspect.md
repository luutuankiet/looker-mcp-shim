# Inspect — Dashboard & Tile Inspection

## Dashboard Level

```
inspect({target: "152"})
inspect({target: "https://host/dashboards/152"})
```

Returns: tile index with `#` ordinals, IDs, titles, types, field counts, query IDs. Plus all dashboard filters with default values.

Use ordinals to reference tiles naturally: `#1`, `#2`, etc.

## Tile Level

```
inspect({target: "tile:1487"})
```

Returns: fields, filters, sorts, vis_config, filter_wiring (which dashboard filters connect to which fields), query_id.

## URL-Smart Input

| Input | Resolves To |
|-------|------------|
| `"152"` | Dashboard 152 |
| `"tile:1487"` | Tile detail |
| `"https://host/dashboards/152"` | Dashboard 152 |
| `"https://host/explore/common/transactions?fields=..."` | Explore |

## Reading Filter Wiring

The `filter_wiring` array shows how dashboard filters connect to tile fields:

```json
{"listen": [
  {"dashboard_filter_name": "group_by", "field": "transactions.transactions_group_by_revenue_param"},
  {"dashboard_filter_name": "date_range", "field": "transactions.transactions_date_range"}
]}
```

This means: when the dashboard filter "group_by" changes, it sets the field `transactions.transactions_group_by_revenue_param` on this tile's query. `run_tile` uses this to auto-apply filters.
