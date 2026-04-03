/**
 * Query tools — run_tile, run_query
 *
 * run_tile: Execute a dashboard tile's query WITH dashboard filters auto-applied.
 *   Accepts element_id directly, or dashboard_id + tile (ordinal/title).
 *   Reads filter_wiring metadata + dashboard filter defaults and injects them.
 *
 * run_query: Execute an ad-hoc explore query.
 *
 * Both support: force_production, configurable timeout, async query task fallback.
 */

import type { Session } from '../core.js'

const DEFAULT_TIMEOUT = 120
const POLL_INTERVAL = 2000
const MAX_POLL_TIME = 300000

export const tools = [
  {
    name: 'run_tile',
    description:
      'Query a dashboard tile and get its data (json), compiled SQL, or CSV. ' +
      'This is the PRIMARY tool for getting tile data, executing tile queries, and QA verification. ' +
      'Dashboard filters are AUTO-APPLIED.\n\n' +
      'Accepts element_id directly, OR dashboard_id + tile (ordinal like "#2" or title match ' +
      'like "Revenue"). You do NOT need to manually reconstruct filters. They are auto-wired from filter_wiring metadata + dashboard defaults.\n\n' +
      'Override specific filters with the filters arg. Use force_production=true for prod cache.\n\n' +
      'Examples:\n' +
      '  run_tile({element_id: "1487"})  \u2014 auto-applies dashboard filter defaults\n' +
      '  run_tile({dashboard_id: "152", tile: "#2"})  \u2014 2nd tile by ordinal\n' +
      '  run_tile({dashboard_id: "152", tile: "Revenue"})  \u2014 first title match\n' +
      '  run_tile({element_id: "1487", filters: {"view.field": "value"}})  \u2014 override filter',
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_id: { type: 'string', description: 'Dashboard element/tile ID (direct)' },
        dashboard_id: { type: 'string', description: 'Dashboard ID (use with tile param)' },
        tile: { type: 'string', description: 'Tile ref: ordinal ("#2"), title match ("Revenue"), or element ID' },
        format: { type: 'string', enum: ['json', 'sql', 'csv'], description: 'Output format (default: json)' },
        limit: { type: 'number', description: 'Row limit' },
        filters: { type: 'object', description: 'Override specific filter values {field: value}' },
        force_production: { type: 'boolean', description: 'Run against production cache even in dev mode' },
        timeout: { type: 'number', description: 'Query timeout in seconds (default: 120)' },
      },
    },
  },
  {
    name: 'run_query',
    description:
      'Run an ad-hoc explore query. For tile data, prefer run_tile (auto-applies dashboard filters).\n\n' +
      'For complex explores, automatically falls back to async query tasks if the ' +
      'synchronous call times out.\n\n' +
      'Use force_production=true to compare dev vs prod data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', description: 'LookML model name' },
        explore: { type: 'string', description: 'Explore name' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Fields to select' },
        filters: { type: 'object', description: 'Field filters as {field: value} pairs' },
        sorts: { type: 'array', items: { type: 'string' }, description: 'Sort specs' },
        format: { type: 'string', enum: ['json', 'sql', 'csv'], description: 'Output format (default: json)' },
        limit: { type: 'number', description: 'Row limit (default: 500)' },
        force_production: { type: 'boolean', description: 'Run against production cache' },
        timeout: { type: 'number', description: 'Query timeout in seconds (default: 120)' },
      },
      required: ['model', 'explore', 'fields'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  switch (name) {
    case 'run_tile': return runTile(args, session)
    case 'run_query': return runQuery(args, session)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

// ============================================================
// Tile resolution: element_id, ordinal (#2), or title match
// ============================================================

async function resolveTile(
  sdk: any, args: Record<string, unknown>
): Promise<{ elementId: string; dashboardId: string | null }> {
  if (args.element_id) {
    const el = await sdk.ok(sdk.dashboard_element(args.element_id as string, '')) as any
    return { elementId: String(el.id), dashboardId: el.dashboard_id ? String(el.dashboard_id) : null }
  }
  const dashId = args.dashboard_id as string
  const tileRef = args.tile as string
  if (!dashId) throw new Error('Either element_id or dashboard_id + tile is required')
  if (!tileRef) throw new Error('tile param required with dashboard_id (e.g. "#2" or "Revenue")')

  const elements = await sdk.ok(sdk.dashboard_dashboard_elements(dashId, '')) as any[]
  const visTiles = elements.filter((e: any) => e.type === 'vis')

  // Ordinal: #1, #2, 1, 2
  const ordMatch = tileRef.match(/^#?(\d+)$/)
  if (ordMatch) {
    const idx = parseInt(ordMatch[1], 10) - 1
    if (idx < 0 || idx >= visTiles.length)
      throw new Error(`Tile #${idx + 1} out of range (${visTiles.length} tiles)`)
    return { elementId: String(visTiles[idx].id), dashboardId: dashId }
  }

  // Title match (case-insensitive substring)
  const lower = tileRef.toLowerCase()
  const match = visTiles.find((e: any) =>
    (e.title || e.title_text || '').toLowerCase().includes(lower)
  )
  if (match) return { elementId: String(match.id), dashboardId: dashId }

  const avail = visTiles.map((e: any, i: number) =>
    `#${i + 1}: ${e.title || '?'} (id:${e.id})`
  ).join(', ')
  throw new Error(`No tile matching "${tileRef}". Available: ${avail}`)
}

// ============================================================
// Dashboard filter auto-wiring
// ============================================================

async function getDashboardFilterValues(
  sdk: any, elementId: string, dashboardId: string | null
): Promise<Record<string, string>> {
  const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
  const filterables = element.result_maker?.filterables || []

  // Collect all listen entries: dashboard_filter_name -> field
  const listens: { name: string; field: string }[] = []
  for (const f of filterables) {
    for (const l of (f.listen || [])) {
      listens.push({ name: l.dashboard_filter_name, field: l.field })
    }
  }
  if (listens.length === 0) return {}

  const dId = dashboardId || element.dashboard_id
  if (!dId) return {}

  // Get dashboard filters with defaults
  const dashFilters = await sdk.ok(sdk.dashboard_dashboard_filters(String(dId), '')) as any[]
  const defaults = new Map<string, string>()
  for (const df of dashFilters) {
    if (df.default_value) defaults.set(df.name, df.default_value)
  }

  // Wire: dashboard_filter.name -> listen.field using default_value
  const wired: Record<string, string> = {}
  for (const l of listens) {
    const val = defaults.get(l.name)
    if (val) wired[l.field] = val
  }
  return wired
}

// ============================================================
// run_tile
// ============================================================

async function runTile(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const format = (args.format as string) || 'json'
  const limit = args.limit as number | undefined
  const forceProd = args.force_production as boolean | undefined
  const timeout = args.timeout as number | undefined
  const filterOverrides = (args.filters as Record<string, string>) || {}

  // 1. Resolve tile
  const { elementId, dashboardId } = await resolveTile(sdk, args)

  // 2. Get element + query
  const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
  const existingQ = element.query || element.result_maker?.query || {}
  const queryId = element.query_id || element.result_maker?.query_id
  if (!queryId && !existingQ.model) throw new Error(`Element ${elementId} has no query`)

  // 3. Auto-wire dashboard filters
  const wiredFilters = await getDashboardFilterValues(sdk, elementId, dashboardId)
  const allFilters = { ...wiredFilters, ...filterOverrides }
  const hasFilters = Object.keys(allFilters).length > 0

  // 4. SQL format is fast — no BigQuery execution
  if (format === 'sql' && !hasFilters) {
    const result = await sdk.ok(
      sdk.run_query({ query_id: queryId, result_format: 'sql', force_production: forceProd || undefined } as any, transportOpts(timeout))
    )
    return { sql: result, element_id: elementId, query_id: queryId }
  }

  // 5. If we have dashboard filters, rebuild query with them applied
  if (hasFilters) {
    const existingFilters = existingQ.filters || {}
    const mergedFilters = { ...existingFilters, ...allFilters }
    const queryBody: Record<string, unknown> = {
      model: existingQ.model,
      view: existingQ.view,
      fields: existingQ.fields ? [...existingQ.fields] : [],
      filters: mergedFilters,
      sorts: existingQ.sorts ? [...existingQ.sorts] : [],
      limit: existingQ.limit || '500',
    }
    if (existingQ.dynamic_fields) queryBody.dynamic_fields = existingQ.dynamic_fields

    if (format === 'sql') {
      // For SQL with filters, use inline query
      const result = await sdk.ok(
        sdk.run_inline_query({ result_format: 'sql', body: queryBody, force_production: forceProd || undefined } as any, transportOpts(timeout))
      )
      return { sql: result, element_id: elementId, filters_applied: allFilters }
    }

    try {
      const result = await sdk.ok(
        sdk.run_inline_query({ result_format: format, body: queryBody, force_production: forceProd || undefined } as any, transportOpts(timeout))
      )
      return parseResult(result, format)
    } catch (err: any) {
      if (isTimeoutError(err)) {
        console.error('[looker-dev-tools] run_tile timed out, falling back to async')
        const q = await sdk.ok(sdk.create_query(queryBody as any)) as any
        return runTileAsync(sdk, q.id, format, limit, forceProd, elementId)
      }
      throw err
    }
  }

  // 6. No extra filters — run saved query directly
  try {
    const result = await sdk.ok(
      sdk.run_query({ query_id: queryId, result_format: format, limit: limit || undefined, force_production: forceProd || undefined } as any, transportOpts(timeout))
    )
    return parseResult(result, format)
  } catch (err: any) {
    if (isTimeoutError(err)) {
      console.error('[looker-dev-tools] run_tile timed out, falling back to async')
      return runTileAsync(sdk, queryId, format, limit, forceProd, elementId)
    }
    throw err
  }
}

// ============================================================
// Async query task fallback
// ============================================================

async function runTileAsync(
  sdk: any, queryId: string, format: string,
  limit: number | undefined, forceProd: boolean | undefined, elementId: string
) {
  const task = await sdk.ok(sdk.create_query_task({
    body: { query_id: queryId, result_format: format, source: 'looker-mcp-shim' },
    limit: limit || undefined, force_production: forceProd || undefined, cache: true,
  } as any)) as any
  console.error(`[looker-dev-tools] Async task ${task.id} for tile ${elementId}`)
  const result = await pollQueryTask(sdk, task.id, format)
  if (format === 'sql') return { sql: result, element_id: elementId, async: true }
  return result
}

async function pollQueryTask(sdk: any, taskId: string, format: string): Promise<unknown> {
  const start = Date.now()
  while (Date.now() - start < MAX_POLL_TIME) {
    const task = await sdk.ok(sdk.query_task(taskId, '')) as any
    if (task.status === 'complete') {
      const raw = await sdk.ok(sdk.query_task_results(taskId))
      if (format === 'sql') return raw
      return parseResult(raw, format)
    }
    if (task.status === 'error')
      throw new Error(`Query task ${taskId} failed: ${task.result_source || 'unknown'}`)
    if (['running', 'added', 'pending'].includes(task.status)) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      continue
    }
    throw new Error(`Query task ${taskId} unexpected status: ${task.status}`)
  }
  throw new Error(`Query task ${taskId} timed out after ${MAX_POLL_TIME / 1000}s`)
}

// ============================================================
// run_query (ad-hoc)
// ============================================================

async function runQuery(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const model = args.model as string
  const explore = args.explore as string
  const fields = args.fields as string[]
  const filters = (args.filters as Record<string, string>) || {}
  const sorts = (args.sorts as string[]) || []
  const format = (args.format as string) || 'json'
  const limit = (args.limit as number) || 500
  const forceProd = args.force_production as boolean | undefined
  const timeout = args.timeout as number | undefined

  try {
    const result = await sdk.ok(
      sdk.run_inline_query({
        result_format: format,
        body: { model, view: explore, fields, filters, sorts, limit: String(limit) },
        force_production: forceProd || undefined,
      } as any, transportOpts(timeout))
    )
    return parseResult(result, format)
  } catch (err: any) {
    if (isTimeoutError(err)) {
      console.error('[looker-dev-tools] run_query timed out, falling back to async')
      return runQueryAsync(sdk, model, explore, fields, filters, sorts, format, limit, forceProd)
    }
    throw err
  }
}

async function runQueryAsync(
  sdk: any, model: string, explore: string, fields: string[],
  filters: Record<string, string>, sorts: string[],
  format: string, limit: number, forceProd: boolean | undefined
) {
  const q = await sdk.ok(sdk.create_query({
    model, view: explore, fields,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    sorts: sorts.length > 0 ? sorts : undefined,
    limit: String(limit),
  } as any)) as any
  const task = await sdk.ok(sdk.create_query_task({
    body: { query_id: q.id, result_format: format, source: 'looker-mcp-shim' },
    force_production: forceProd || undefined, cache: true,
  } as any)) as any
  console.error(`[looker-dev-tools] Async task ${task.id} for ${model}/${explore}`)
  return pollQueryTask(sdk, task.id, format)
}

// ============================================================
// Helpers
// ============================================================

function transportOpts(sec?: number) { return { timeout: (sec || DEFAULT_TIMEOUT) * 1000 } }

function parseResult(result: unknown, format: string): unknown {
  if (format === 'json' && typeof result === 'string') {
    try { return JSON.parse(result) } catch { return result }
  }
  return result
}

function isTimeoutError(err: any): boolean {
  const m = (err.message || '').toLowerCase()
  return m.includes('timeout') || m.includes('etimedout') || m.includes('econnreset') || m.includes('socket hang up') || m.includes('aborted')
}
