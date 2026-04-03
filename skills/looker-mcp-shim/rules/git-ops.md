# Git Ops — Dev Mode, Git Sync, Validation

## Switch Mode

```
switch_mode({mode: "dev", branch: "feat/my-branch"})
switch_mode({mode: "prod"})
```

Dev mode is required for:
- Editing LookML files
- Resetting to remote
- All mutations (tiles, filters)
- Running queries against dev branch LookML

Branch must be in `LOOKER_ALLOWED_BRANCHES` or the call is rejected. Set `LOOKER_ALLOWED_BRANCHES=*` to allow any branch.

**Safety:** `reset_to_remote` is gated separately by `LOOKER_RESET_BRANCHES` (defaults to `LOOKER_DEV_BRANCH` only). The agent can switch to any branch for inspection but can only reset branches you explicitly approve.

## Reset to Remote

Sync Looker's dev branch to git HEAD. Use after pushing LookML changes:

```
[Agent edits LookML locally, runs git push]
reset_to_remote({})  → Looker pulls latest from remote
```

This destroys any uncommitted changes in Looker's dev workspace.

## Validate

Run LookML validation on the current project:

```
validate({})
→ {status: "ok"} or {status: "errors", errors: [{severity, message, source_file, line}]}
```

## Full LookML Edit Cycle

```
1. switch_mode({mode: "dev", branch: "feat/migration"})
2. [Edit .lkml files locally or via upstream file tools]
3. [git add + git commit + git push]
4. reset_to_remote({})
5. validate({})
6. run_tile({element_id: "1487"})  → verify data
7. run_tile({element_id: "1487", force_production: true})  → compare vs prod
```

## Editing LookML Files

Use the upstream tools (auto-bridged from @toolbox-sdk/server):

```
get_project_files  → list all .lkml files
get_project_file   → read a specific file
update_project_file  → write changes
create_project_file  → create new file
delete_project_file  → remove file
```

Or edit locally via filesystem and git push. Both work — `reset_to_remote` syncs either way.
