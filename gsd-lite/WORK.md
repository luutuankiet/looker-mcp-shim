# Work Log

## 1. Current Understanding

<current_mode>
stabilize — v0.4.2 shipped, LookML dashboard lifecycle complete
</current_mode>

<active_task>
none — v0.4.2 shipped with auto-release CI
</active_task>

<parked_tasks>
- Phase 1.5: LookML file I/O tools (read_lookml_files, edit_lookml_files, grep_lookml) — DEPRIORITIZED, upstream bridge provides get_project_files/update_project_file
- GHA publish workflow: OIDC publish working, auto-release on tag push (v0.4.2+)
</parked_tasks>

<vision>
One MCP server giving AI agents FULL Looker developer autonomy — inspect, query, mutate dashboards/tiles/filters, edit LookML, sync git, validate. 57 tools (17 shim + 41 upstream bridged). LookML dashboard lifecycle: inspect, import as UDD, iterate, export back to LookML. Skill docs for zero-context agent onboarding. Dashboard filter auto-wiring so agents get data without Looker domain knowledge.
</vision>

<decisions>
- Package: @luutuankiet/looker-mcp-shim (published on npm)
- Repo: git@github.com:luutuankiet/looker-mcp-shim.git
- SDK: @looker/sdk-node v24.20 + @modelcontextprotocol/sdk v1.12
- Safety: BLOCKED_METHODS hardcoded. Branch switching gated by LOOKER_ALLOWED_BRANCHES (* = any, default). reset_to_remote gated SEPARATELY by LOOKER_RESET_BRANCHES (explicit list only, defaults to empty)
- LOOKER_DEV_BRANCH removed — startup auto-detects current branch from Looker via sdk.git_branch(). Zero config needed
- LookML dashboards: inspect via sdk.dashboard(model::name), import via sdk.import_lookml_dashboard(), export via sdk.dashboard_lookml()
- Looker API rejects inline query on create/update element — must two-step: create_query() then reference via query_id
- client_id must be excluded from writable query fields when creating new queries
- Dashboard filter auto-wiring: run_tile reads filter_wiring + dashboard defaults, injects into query automatically
- SDK method catalog loaded from live swagger.json at startup (469 methods, always version-accurate)
- Upstream @toolbox-sdk/server bridged via MCP client — spawned as child process, tools merged at startup
- Skill docs ship with npm package, installed via `npx @luutuankiet/looker-mcp-shim install-skill`
- Client info SCRUBBED from repo — do NOT include client names
</decisions>

<blockers>
None
</blockers>

<next_action>
Real-world QA: agent-driven Tableau→Looker migration using LookML dashboard import→iterate→export workflow. Update skill docs for patterns.md with migration recipe using new tools.
</next_action>

---

## 2. Key Events

| Date | Event | Impact |
|------|-------|--------|
| 2026-04-02 | MVP shipped — 7 tools, 17/17 tests pass | Phase 1 complete, npm published |
| 2026-04-02 | SDK research for Phase 2 mutations | IWriteQuery has vis_config, fields, filters — full mutation possible |
| 2026-04-02 | .env secret was truncated (missing trailing char) | Fixed, auth works |
| 2026-04-03 | Phase 2 shipped: 6 mutation tools, 10/10 tests | v0.1.2 — full tile+filter CRUD |
| 2026-04-03 | Upstream bridge: 54 tools from single server | v0.2.0 — @toolbox-sdk/server bridged via MCP client |
| 2026-04-03 | Query timeout fix: 120s + async query task fallback | v0.2.1 — BigQuery queries on complex explores now complete |
| 2026-04-03 | SDK method discovery from live swagger.json | 469 methods searchable via retrieve/describe tools |
| 2026-04-03 | Dashboard filter auto-wiring in run_tile | Tiles that returned [] now return data (parameter-driven dims) |
| 2026-04-03 | Natural tile refs: run_tile({tile: "#2"}) | No more manual ID lookup from inspect output |
| 2026-04-03 | Skill docs + install-skill CLI | v0.3.0 — SKILL.md + 7 rules files for zero-context agents |
| 2026-04-03 | Tool discoverability fix: run_tile as PRIMARY | v0.3.3 — agents find run_tile instead of hallucinating query/query_sql |
| 2026-04-03 | Wildcard branches + reset_to_remote safety gate | ALLOWED_BRANCHES=* for switching, RESET_BRANCHES for destructive ops |
| 2026-04-03 | Stress test dashboard 152: 29/29 pass | Full e2e: inspect, query, mutate, SDK code, git ops, mode switching |
| 2026-04-06 | LookML dashboard inspect + import_lookml_dashboard | v0.4.0 — parse model::name, inspect via sdk.dashboard(), import to UDD with validation |
| 2026-04-06 | export_dashboard_lookml + LOOKER_DEV_BRANCH removal | v0.4.1 — full lifecycle (inspect→import→iterate→export), auto-detect branch from Looker |
| 2026-04-06 | GHA auto-release on tag push | v0.4.2 — gh release create --generate-notes, zero manual changelog |
| 2026-04-06 | README + skill docs updated for LookML dashboards | All 6 doc files updated: workflow, patterns, inspect, git-ops, SKILL.md |

---

## 3. Atomic Session Log

### [LOG-001] - [EXEC] - MVP build: 7 MCP tools, all tests passing - Task: Phase-1
**Timestamp:** 2026-04-02 23:00
**Depends On:** None (first entry)

---

#### What Was Built

| File | Purpose |
|------|--------|
| `src/core.ts` | Session manager — SDK auth from .env, dev/prod toggle, branch switching, BLOCKED_METHODS safety proxy |
| `src/tools/session.ts` | `switch_mode` — dev/prod with branch allowlist |
| `src/tools/git.ts` | `reset_to_remote` + `validate` — git sync and LookML validation |
| `src/tools/inspect.ts` | URL-smart two-level inspection (dashboard summary → tile detail with filter wiring) |
| `src/tools/query.ts` | `run_tile` (data+SQL per tile) + `run_query` (ad-hoc explore) |
| `src/tools/execute.ts` | `execute_sdk_code` — escape hatch, runs arbitrary SDK code against safeSdk proxy |
| `src/util/url-parser.ts` | Parses URLs, bare IDs, `tile:NNN` into structured targets |
| `src/index.ts` | MCP stdio entry point — 7 tools registered |

#### Key Technical Details

- **Auth:** `dotenv` loads .env → bridges `LOOKER_*` to `LOOKERSDK_*` → `LookerNodeSDK.init40()`
- **Safety proxy:** `new Proxy(sdk, { get })` intercepts blocked method access, `.bind(target)` preserves SDK internals
- **execute_sdk_code:** `AsyncFunction` constructor, passes `safeSdk` as `sdk`, static analysis blocks critical patterns pre-execution
- **run_query/run_tile:** SDK methods take request objects (`IRequestRunQuery`, `IRequestRunInlineQuery`), not positional params
- **validate:** Method is `sdk.validate_project(projectId)` NOT `sdk.lookml_validation()`
- **Passthru testing:** `MCP_PORT=8765 npx @luutuankiet/mcp-proxy-shim passthru -- npx tsx src/index.ts` (port 3456 used by daemon)

#### Test Results — 17/17 Pass

All verified against live Looker API:
- Auth as API user ✅
- Dashboard inspect → 3 tiles with IDs ✅
- Tile inspect → fields + filter wiring ✅
- run_tile json → data rows ✅
- run_tile sql → compiled BigQuery SQL ✅
- run_query ad-hoc → results ✅
- reset_to_remote → success ✅
- validate → no errors ✅
- execute_sdk_code → lists projects ✅
- Mode round-trip prod↔dev ✅
- Blocked method → REJECTED ✅
- Blocked branch → REJECTED ✅

---

📦 STATELESS HANDOFF
**Dependency chain:** LOG-001 (root)
**What was decided:** MVP architecture — thin tool wrappers over @looker/sdk with safety proxy. 7 tools cover read/inspect/query loop. execute_sdk_code covers the long tail.
**Next action:** Build Phase 2 mutation tools (update_tile, create_tile, filters) + enhance execute_sdk_code
**If pivoting:** All source in `src/`, tests in `src/__test__/`. Run `npx tsx src/__test__/integration.test.ts` to verify.

### [LOG-002] - [RESEARCH] - SDK mutation API surface for Phase 2 - Task: Phase-2
**Timestamp:** 2026-04-02 23:30
**Depends On:** LOG-001

---

#### SDK Methods Available for Dashboard Mutation

| Method | Signature | What It Does |
|--------|-----------|-------------|
| `update_dashboard_element` | `(element_id, body: Partial<IWriteDashboardElement>)` | Update tile: query, title, type, result_maker |
| `create_dashboard_element` | `(request: {body, fields?, apply_filters?})` | Add tile to dashboard |
| `update_dashboard_filter` | `(filter_id, body: Partial<IWriteDashboardFilter>)` | Modify filter config |
| `create_dashboard_filter` | `(body: Partial<IWriteCreateDashboardFilter>)` | Add filter to dashboard |
| `delete_dashboard_filter` | `(filter_id)` | Remove filter |
| `update_dashboard` | `(dashboard_id, body: Partial<IWriteDashboard>)` | Update dashboard metadata |
| `create_dashboard` | `(body)` | Create new dashboard |
| `copy_dashboard` | `(dashboard_id, folder_id?)` | Clone dashboard |
| `move_dashboard` | `(dashboard_id, folder_id)` | Move to folder |
| `update_dashboard_layout` | `(layout_id, body)` | Update layout |
| `update_dashboard_layout_component` | `(component_id, body)` | Update tile position/size |
| `create_query` | `(body: Partial<IWriteQuery>)` | Create saved query |
| `create_dashboard_element_render_task` | `(element_id, format, w, h)` | Render tile as PNG |

#### IWriteQuery — Full Mutation Surface

```typescript
interface IWriteQuery {
  model: string
  view: string
  fields?: string[] | null           // ← change what tile shows
  pivots?: string[] | null
  fill_fields?: string[] | null
  filters?: IDictionary<string>       // ← change tile filters
  filter_expression?: string | null
  sorts?: string[] | null             // ← change sort order
  limit?: string | null
  column_limit?: string | null
  total?: boolean | null
  row_total?: string | null
  subtotals?: string[] | null
  vis_config?: IDictionary<any>       // ← change chart type, colors, labels
  filter_config?: IDictionary<any>    // ← change filter UI config
  visible_ui_sections?: string | null
  dynamic_fields?: string | null      // ← table calcs
  client_id?: string | null
  query_timezone?: string | null
}
```

#### IWriteDashboardElement — Tile Write Surface

```typescript
interface IWriteDashboardElement {
  query?: IWriteQuery | null         // ← embed full query (fields, vis, filters)
  query_id?: string | null           // ← point to saved query
  result_maker?: { query?: IWriteQuery } | null
  title?: string | null
  title_text?: string | null
  subtitle_text?: string | null
  type?: string | null               // ← 'vis', 'text', etc.
  dashboard_id?: string | null
  note_text?: string | null
  title_hidden?: boolean
  look_id?: string | null
  refresh_interval?: string | null
}
```

#### IWriteCreateDashboardFilter — Filter Write Surface

```typescript
interface IWriteCreateDashboardFilter {
  dashboard_id: string               // required
  name: string                       // required
  title: string                      // required
  type: string                       // required (field_filter, etc.)
  default_value?: string
  model?: string
  explore?: string
  dimension?: string                 // field to filter on
  row?: number
  listens_to_filters?: string[]      // filter-to-filter wiring
  allow_multiple_values?: boolean
  required?: boolean
  ui_config?: IDictionary<any>
}
```

#### Key Insight: Filter Wiring

Filter wiring (dashboard filter → tile field) is stored in `result_maker.filterables[].listen[]` on READ, but the WRITE interface (`IWriteResultMakerWithIdVisConfigAndDynamicFields`) only exposes `query`. Filter wiring changes likely need to go through `execute_sdk_code` or through the Looker UI. This needs live testing to confirm.

---

📦 STATELESS HANDOFF
**Dependency chain:** LOG-002 ← LOG-001
**What was decided:** Full mutation is possible via update_dashboard_element + IWriteQuery. vis_config, fields, filters, sorts all writable. Filter wiring write path needs live testing.
**Next action:** Build Phase 2 tools, test mutation scenarios against live API
**If pivoting:** SDK types at `node_modules/@looker/sdk/lib/4.0/models.d.ts`

### [LOG-003] - [EXEC] - Full session: Phase 2 + upstream bridge + DX hardening - Task: Phase-2
**Timestamp:** 2026-04-03 07:30
**Depends On:** LOG-002, LOG-001

---

#### What Was Built (11 commits, v0.1.2 → v0.3.3)

| Commit | Tag | What |
|--------|-----|------|
| `158a059` | v0.1.2 | 6 mutation tools: create/update/delete tile + filter |
| `4560701` | v0.2.0 | Upstream MCP bridge: 13 shim + 41 upstream = 54 tools |
| `0caf629` | v0.2.1 | Query timeout: 120s transport + async query task fallback |
| `8fe57c8` | - | SDK method discovery: retrieve_sdk_methods + describe_sdk_method |
| `f20a72c` | - | README overhaul: 5 Mermaid workflow diagrams |
| `4deb24a` | - | Dashboard filter auto-wiring + natural tile references |
| `ad60f07` | v0.3.0 | Skill docs + install-skill CLI |
| `204ee72` | v0.3.3 | Tool discoverability fix (run_tile as PRIMARY) |
| `b3b5bc9` | - | Wildcard branches + reset_to_remote safety gate |
| `8eb802e` | - | Branch safety docs with Mermaid diagrams |

#### Key SDK Discoveries

1. **Two-step query creation (CRITICAL):** Looker API rejects inline `query` objects on `create_dashboard_element` and `update_dashboard_element`. Must `create_query()` first, then reference via `query_id`. The shim handles this automatically.

2. **client_id exclusion:** When creating new queries from existing query objects, `client_id` must be stripped — it's a unique identifier that can't be reused. Causes "Validation Failed" error.

3. **Dashboard filter auto-wiring:** Tiles with parameter-driven dimensions (e.g. `transactions_group_by_2` controlled by `Group By` dashboard filter) return `[]` when queried without filter values. The shim reads `result_maker.filterables[].listen[]` + dashboard filter defaults and injects them into the query. This is what the Looker UI does internally.

4. **Filter wiring writes:** `update_dashboard_element` DOES accept `result_maker.filterables[].listen[]` for writes — confirmed via live testing. Agents can wire filters to specific tiles via `execute_sdk_code`.

5. **Async query tasks:** Complex BigQuery explores (33K char compiled SQL) exceed SDK HTTP timeout. `create_query_task` + polling is the fix (same mechanism as Looker UI).

#### DX Failure Mode Discovered

Fresh agent QA session revealed: agent searched for "query" tools, found `run_dashboard` (upstream) instead of `run_tile` (our shim), then hallucinated `query` and `query_sql` tool names. Manually reconstructed filters, got "View Not Found". Fix: keyword-stuffed `run_tile` description, added CRITICAL guidance to SKILL.md.

#### Test Results

| Suite | Result | Coverage |
|-------|--------|----------|
| Phase 2 (dash 151) | 10/10 | Tile + filter CRUD, query merge, cleanup |
| Stress (dash 152) | 29/29 | Inspect, run_tile json+sql, create/update/delete, SDK code, git ops, mode switching |
| Branch safety | 6/6 | Wildcard switch, reset allowed/blocked |

#### Architecture Changes

```
src/
├── index.ts              # Entry + install-skill subcommand routing
├── core.ts               # Session + safety + RESET_BRANCHES gate
├── upstream.ts           # NEW: MCP client bridge to @toolbox-sdk/server
├── install-skill.ts      # NEW: CLI to install skill docs
├── tools/
│   ├── dashboard.ts      # NEW: 6 mutation tools
│   ├── sdk-catalog.ts    # NEW: retrieve/describe from swagger.json
│   ├── query.ts          # REWRITTEN: filter auto-wiring + natural tile refs + async fallback
│   ├── inspect.ts        # UPDATED: ordinal numbers in output
│   ├── execute.ts        # UPDATED: points agents at retrieve/describe workflow
│   ├── session.ts
│   └── git.ts
└── __test__/
    ├── phase2.test.ts    # 10 tests: tile + filter CRUD
    └── stress.test.ts    # 29 tests: full e2e on dashboard 152

skills/looker-mcp-shim/       # Ships with npm package
├── SKILL.md              # Entry point + tool index
└── rules/
    ├── workflow.md       # Decision tree + dev loop
    ├── inspect.md        # Dashboard/tile inspection
    ├── query.md          # run_tile auto-wiring, ordinals
    ├── mutate.md         # Tile + filter CRUD + filter wiring
    ├── git-ops.md        # Branch safety model + git sync
    ├── sdk-escape.md     # Method discovery + code execution
    └── patterns.md       # Migration QA, bulk ops, recipes
```

---

📦 STATELESS HANDOFF
**Dependency chain:** LOG-003 ← LOG-002 ← LOG-001
**What was decided:** Full Looker dev autonomy achieved. 56 tools from single server. Filter auto-wiring solves the parameter-driven dimension problem. Branch switching decoupled from reset safety. Skill docs guide zero-context agents.
**Next action:** npm publish v0.3.3 (needs user OTP). Then real-world QA: agent-driven Tableau→Looker migration on dashboard 152.
**If pivoting:** All source in `src/`, tests in `src/__test__/`. Run `SKIP_UPSTREAM=1 npx tsx src/__test__/stress.test.ts` for full verification. Skills at `skills/looker-mcp-shim/`. — grep for `IWrite*` interfaces

### [LOG-004] - [EXEC] [DECISION] - LookML dashboard lifecycle: inspect, import, export + DX overhaul - Task: LookML-Dashboard
**Timestamp:** 2026-04-06 05:10
**Depends On:** LOG-003 (v0.3.3 stable baseline)

---

#### Context: Why LookML Dashboard Support?

Existing `inspect` only handled UDD (User-Defined Dashboards) by numeric ID. LookML dashboards (code-defined, referenced as `model::dashboard_name`) were invisible to agents. This meant agents could edit `.dashboard.lookml` files but could never verify what Looker actually compiled from that code — flying blind.

#### What Was Built

**1. url-parser.ts — `lookml_dashboard` target type**
- Bare string: `model::dashboard_name` → `{type: 'lookml_dashboard', id: '...'}`
- URL: `/dashboards/model::dashboard_name` → same (checked before numeric pattern)
- Added to `ParsedTarget` union type

**2. inspect.ts — LookML dashboard handler**
- `case 'lookml_dashboard'` → `sdk.dashboard(id)` (single API call, elements + filters inline)
- Returns same shape as UDD inspect + `type: 'lookml_dashboard'` + `hint` field steering agents to `import_lookml_dashboard`
- Key insight: no `sdk.lookml_dashboard()` method exists — `sdk.dashboard()` accepts both numeric IDs and `model::name` strings

**3. lookml-dashboard.ts — Two new tools**

| Tool | SDK Call | Purpose |
|------|---------|--------|
| `import_lookml_dashboard` | `sdk.import_lookml_dashboard(id, folder_id)` | Clone LookML dashboard → editable UDD |
| `export_dashboard_lookml` | `sdk.dashboard_lookml(id)` | Export any dashboard → LookML YAML |

**import_lookml_dashboard pipeline:**
1. Validate LookML (`sdk.validate_project()`) — blocks import if model has errors
2. Verify source exists (`sdk.dashboard(id)`)
3. Import as UDD (`sdk.import_lookml_dashboard(id, folder_id)`)
4. Post-import verification — reads back UDD, confirms tiles_match + filters_match
5. Returns `next_steps` array guiding the agent

**Error handling tested:**
- Not found → `status: 'source_not_found'` with hint
- Bad format (no `::`) → throws with example
- Duplicate import → Looker auto-suffixes "(imported)", no collision
- Validation failures → `status: 'validation_failed'` with error details

#### Key Decisions

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| Remove `LOOKER_DEV_BRANCH` entirely | `sdk.git_branch()` auto-detects current branch. Config env var creates friction — if Looker is on branch A with uncommitted work and .env says B, startup force-switches and hides the work | Keep as optional (still confusing), keep as required (unnecessary config) |
| `ALLOWED_BRANCHES` default `*` | Switching is safe (read-only per session). Restrictive default blocks legitimate multi-branch workflows | Keep restrictive default (too many support questions) |
| `RESET_BRANCHES` default empty | Destructive op should require explicit opt-in. Empty = nothing resettable | Default to DEV_BRANCH (removed), default to all (dangerous) |
| Inspect hint field for LookML dashboards | Agents reading inspect output don't know about `import_lookml_dashboard`. Inline hint guarantees discoverability | Skill docs only (agent might not read), separate status tool (overhead) |
| `export_dashboard_lookml` as separate tool | Gives agent the YAML, lets it decide how to write/commit. Simpler than a full roundtrip tool | Full roundtrip (opinionated), escape hatch only (undiscoverable) |

#### Bug Fixes

| Bug | File | Fix |
|-----|------|-----|
| Server version `0.3.3` vs package `0.4.0` | `index.ts:103` | Updated to match package.json |
| `switchMode(dev)` with no branch crashed | `core.ts:143` | Re-detect current branch instead of calling `update_git_branch('')` |
| url-parser `"abc"` → `{type: 'dashboard', id: ''}` | `url-parser.ts:96` | Removed fragile numeric fallback |

#### Test Results (7 scenarios, live Looker instance)

| # | Test | Result |
|---|------|--------|
| T1 | Startup auto-detect (no DEV_BRANCH) | ✅ Detects current branch |
| T2 | Free branch swap → back | ✅ ALLOWED_BRANCHES=* works |
| T3 | Reset gate blocks non-listed branch | ✅ Clear error with branch + allowed list |
| T4 | LookML dashboard inspect + hint | ✅ 4 tiles, 14 filters, hint present |
| T5 | export_dashboard_lookml("173") | ✅ Returns LookML YAML |
| T6 | url-parser rejects "abc" | ✅ Throws clean error |
| T7 | switch_mode(dev) no branch arg | ✅ Stays on current branch |

#### Docs Updated

| File | Changes |
|------|--------|
| README.md | Config table (removed DEV_BRANCH, fixed defaults), tool count 17+41=57, new LookML Dashboard Lifecycle mermaid diagram |
| SKILL.md | Added import_lookml_dashboard + export_dashboard_lookml to tool table |
| rules/inspect.md | Added model::dashboard_name to URL table + LookML inspection section |
| rules/workflow.md | Added LookML dashboard branch to decision tree + iteration cycle |
| rules/patterns.md | Added LookML import→iterate→export recipe |
| rules/git-ops.md | Updated RESET_BRANCHES default, added Branch Auto-Detection section |

#### CI/CD: Auto-Release on Tag Push

Added `release` job to `.github/workflows/publish.yml`:
- Triggers on `v*` tag push (same as existing publish)
- Runs `gh release create --generate-notes` after tests pass
- Parallel with npm publish — no sequential dependency
- Verified working: v0.4.2 release auto-created with changelog link

#### Version History This Session

| Version | Commit | What |
|---------|--------|------|
| v0.4.0 | `357e185` + `510aef2` | LookML dashboard inspect + import tool |
| v0.4.1 | `bc595ed` + `6976fc3` | export tool + DEV_BRANCH removal + bug fixes + full docs update |
| v0.4.2 | `b511b27` + `0aa9487` | GHA auto-release workflow |

---

📦 STATELESS HANDOFF (for future agents reading this log)
**Dependency chain:** LOG-004 ← LOG-003 (v0.3.3 baseline)
**What was decided:** LookML dashboards get full lifecycle: inspect (sdk.dashboard), import to UDD (sdk.import_lookml_dashboard), iterate with mutation tools, export back (sdk.dashboard_lookml). LOOKER_DEV_BRANCH removed entirely — always auto-detect from Looker. ALLOWED_BRANCHES defaults to *. RESET_BRANCHES defaults to empty. GHA auto-creates GitHub Release with notes on tag push.
**Next action:** Real-world QA using the full LookML dashboard workflow on a migration. Skill docs may need refinement after first agent test.
**If pivoting:** Start from LOG-004 + LOG-003 for full project context. v0.4.2 is the stable baseline with 17 shim tools.
