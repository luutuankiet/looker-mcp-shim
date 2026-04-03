# Workflow — The Looker Dev Loop

## Decision Tree

```
What do you need to do?
├─ Understand a dashboard → inspect (see inspect.md)
├─ Get data from a tile → run_tile (see query.md)
├─ Build/modify dashboard → create_tile / update_tile / create_filter (see mutate.md)
├─ Edit LookML code → edit files + git push + reset_to_remote (see git-ops.md)
├─ Validate LookML → validate (see git-ops.md)
├─ Compare dev vs prod → run_tile with force_production=true (see query.md)
└─ Something not covered → retrieve_sdk_methods + execute_sdk_code (see sdk-escape.md)
```

## The Complete Dev Loop

This is the standard cycle for LookML development + QA:

```
1. switch_mode({mode: "dev", branch: "feat/my-branch"})
2. inspect({target: "152"})  → see all tiles + filters
3. inspect({target: "tile:1487"})  → deep-dive into specific tile
4. run_tile({element_id: "1487"})  → get data (filters auto-applied)
5. [Edit LookML locally, git push]
6. reset_to_remote({})  → sync Looker to latest code
7. validate({})  → check for LookML errors
8. run_tile({element_id: "1487"})  → verify data after changes
9. run_tile({element_id: "1487", force_production: true})  → compare vs prod
```

## Mutation Cycle

To build or modify a dashboard:

```
1. inspect({target: "152"})  → see current state
2. create_tile({dashboard_id: "152", title: "Revenue", query: {...}})
3. update_tile({element_id: "1503", query: {vis_config: {type: "looker_pie"}}})
4. create_filter({dashboard_id: "152", name: "region", ...})
5. inspect({target: "152"})  → verify mutations
6. run_tile({dashboard_id: "152", tile: "Revenue"})  → verify data
```

## Key Concepts

**Dev mode**: All changes happen on a git branch. Agent must be in dev mode. Use `switch_mode` to toggle.

**Dashboard filters**: Tiles are wired to dashboard filters via `filter_wiring`. `run_tile` auto-applies dashboard filter defaults. Override specific filters with the `filters` arg.

**Two-level inspection**: `inspect` a dashboard = tile index (~50 tokens/tile). `inspect` a tile = full detail (~200 tokens). Start broad, drill down.

**Partial updates**: `update_tile` merges your changes with the existing query. Only send what changed. Fields, sorts, filters are preserved.

**force_production**: Run a query against production LookML from dev mode. Perfect for parity checks without switching modes.
