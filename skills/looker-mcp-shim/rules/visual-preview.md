# Visual Preview — Render, Debug, Iterate

## Tools

| Tool | When | Key args |
|------|------|----------|
| `render_dashboard` | See the full dashboard as an image | `dashboard_id`, `detail`, `filters`, `wait`, `debug` |
| `render_tile` | See a single tile — tight edit/render loop | `element_id`, `detail`, `filters`, `wait`, `debug` |
| `get_render` | Pick up an async render | `render_task_id` |

## Detail Tiers

| Tier | Dashboard | Tile | Use for |
|------|-----------|------|---------|
| `low` | 640x400 | 400x300 | Rapid iteration — burn 50 per session |
| `medium` (default) | 1024x768 | 640x480 | Judge design + data |
| `high` | 1920x1080 | 1024x768 | Final review / sign-off |

Explicit `width`/`height` override tiers.

## Sync vs Async

```
wait: true (default)
  └─ render completes in time → image returned same call
  └─ exceeds timeout_s → {status: pending, render_task_id, check_with}

wait: false
  └─ returns pending handle immediately
  └─ get_render({render_task_id}) → image when ready
```

Default `timeout_s`: 60 (max 120). For loop mode use `timeout_s: 20`.

## Filters on Tiles

`render_tile` with `filters` routes through `create_query_render_task` (the element render API has no filter param). Display names auto-translate to dimensions via dashboard filter map.

```
render_tile({element_id: "2548", filters: "Brand=Calvin Klein"})
→ render_path: "query" in metadata
```

No-filter calls use the fast native element render path.

## Debug + Failure Envelopes

Every render failure returns a structured envelope (never a raw throw):

```json
{
  "status": "failed",
  "error_class": "ANGULAR_RUNTIME_EXCEPTION",
  "likely_cause": "...",
  "next_actions": ["Retry with filters...", "Use inspect..."],
  "raw_status_detail": "...",
  "render_task_id": "...",
  "diagnostics": { "workspace": "dev", "element_found": true, ... }
}
```

**`debug: true`** — opt-in pre-flight. Runs cheap SDK probes (session, element, dashboard) BEFORE rendering. Fails fast if target is missing. Use in tight loops:

```
render_tile({element_id: "1477", detail: "low", debug: true, timeout_s: 20})
```

Failure diagnostics run **always** on error paths — not gated by `debug`.

## Error Classes

| Class | Top action |
|-------|------------|
| `ANGULAR_RUNTIME_EXCEPTION` | Retry with `filters` string — bypasses element render crash |
| `NO_BASE_QUERY` | Use `render_dashboard` instead — text/button tiles not renderable standalone |
| `EMPTY_RESULT` | Check `run_tile` for row_count; widen filters |
| `MODEL_NOT_FOUND` | Run `validate`; check branch with `switch_mode` |
| `VALIDATION_ERROR` | Run `validate` for file:line errors |
| `QUERY_TIMEOUT` | Lower `detail` tier or narrow filters; use `wait: false` |
| `PERMISSION` | Verify SDK credentials + role |
| `UNKNOWN` | Retry with `debug: true`; read `raw_status_detail` |

## Edit-Render-Critique Loop

```
1. inspect({target: dashboard_url})           → understand layout
2. render_dashboard({id, detail: "low"})      → see current state
3. [critique image with vision]
4. update_tile / edit LookML / create_filter  → make changes
5. render_tile({id, detail: "low", debug: true}) → verify change
6. repeat 3-5 until satisfied
7. render_dashboard({id, detail: "high"})     → final review
```

Use `low` for iteration, `high` for sign-off. `debug: true` catches bad targets early.
