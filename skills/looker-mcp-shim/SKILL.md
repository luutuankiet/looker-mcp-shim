---
name: looker-mcp-shim
description: Looker development workflow for AI agents. Inspect dashboards, run tile queries, mutate tiles/filters, edit LookML, sync git, validate. Read rules/*.md for correct usage.
metadata:
  tags: looker, lookml, mcp, dashboard, bigquery, data-engineering
---

## When to use

Use this skill when working with Looker dashboards, LookML, or any Looker API operation. This covers:

- Inspecting dashboards and tiles (fields, SQL, filters, vis config)
- Running tile queries with dashboard filters auto-applied
- Creating, modifying, and deleting dashboard tiles and filters
- Editing LookML, pushing to git, syncing Looker, validating
- Executing any of Looker's 469 API methods via SDK discovery

## Tools Overview

| Tool | Purpose |
|------|--------|
| `inspect` | Dashboard overview or tile detail (URL-smart input) |
| `run_tile` | Execute tile query with auto-wired dashboard filters |
| `run_query` | Ad-hoc explore query |
| `create_tile` | Add tile to dashboard |
| `update_tile` | Modify tile (partial merge — only send what changed) |
| `delete_tile` | Remove tile |
| `create_filter` | Add dashboard filter |
| `update_filter` | Modify filter |
| `delete_filter` | Remove filter |
| `switch_mode` | Toggle dev/prod mode with branch |
| `reset_to_remote` | Sync Looker project to git HEAD |
| `validate` | LookML validation with file:line errors |
| `retrieve_sdk_methods` | Search 469 SDK methods by keyword |
| `describe_sdk_method` | Get full params + code example for a method |
| `execute_sdk_code` | Run arbitrary SDK code |

## Workflow Guides

Read these before starting:

- [rules/workflow.md](rules/workflow.md) — **Start here.** The complete dev loop and decision tree
- [rules/inspect.md](rules/inspect.md) — Dashboard/tile inspection patterns
- [rules/query.md](rules/query.md) — Running queries, filter auto-wiring, async fallback
- [rules/mutate.md](rules/mutate.md) — Creating/updating/deleting tiles and filters
- [rules/git-ops.md](rules/git-ops.md) — Dev/prod mode, git sync, LookML validation
- [rules/sdk-escape.md](rules/sdk-escape.md) — SDK method discovery + code execution
- [rules/patterns.md](rules/patterns.md) — Common recipes: migration QA, dashboard cloning, bulk ops
