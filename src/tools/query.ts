/**
 * Query tools — run_tile, run_query
 *
 * run_tile: Execute a dashboard tile's query. Returns data (json), compiled SQL, or CSV.
 * run_query: Execute an ad-hoc explore query.
 *
 * Both support:
 * - force_production: run against prod cache even in dev mode (faster, cached PDTs)
 * - timeout: configurable SDK transport timeout (default 120s)
 * - Async fallback: for queries exceeding timeout, uses create_query_task + polling
 */

import type { Session } from '../core.js'

const DEFAULT_TIMEOUT = 120 // seconds
const POLL_INTERVAL = 2000 // ms
const MAX_POLL_TIME = 300000 // 5 min max poll

export const tools = [
  {
    name: 'run_tile',
    description:
      'Run a dashboard tile query. Returns data (json), compiled SQL (sql), or CSV.\n\n' +
      'For complex explores that take long, the tool automatically uses async query tasks ' +
      '(same mechanism as Looker UI) — it submits the query, polls for completion, then returns results.\n\n' +
      'Use force_production=true to run against cached production PDTs (faster for parity checks).\n\n' +
      'Timeout default: 120s. Increase for very heavy queries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_id: { type: 'string', description: 'Dashboard element/tile ID' },
        format: {
          type: 'string',
          enum: ['json', 'sql', 'csv'],
          description: 'Output format (default: json)',
        },
        limit: { type: 'number', description: 'Row limit (default: server default)' },
        force_production: {
          type: 'boolean',
          description: 'Run against production cache even in dev mode (faster, uses cached PDTs)',
        },
        timeout: { type: 'number', description: 'Query timeout in seconds (default: 120)' },
      },
      required: ['element_id'],
    },
  },
  {
    name: 'run_query',
    description:
      'Run an ad-hoc explore query against a model/explore.\n\n' +
      'For complex explores, automatically falls back to async query tasks if the ' +
      'synchronous call times out.\n\n' +
      'Use force_production=true to compare dev vs prod data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', description: 'LookML model name' },
        explore: { type: 'string', description: 'Explore name' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to select (e.g. ["view.field1", "view.measure1"])',
        },
        filters: {
          type: 'object',
          description: 'Field filters as {field: value} pairs',
        },
        sorts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sort specifications (e.g. ["view.field desc"])',
        },
        format: {
          type: 'string',
          enum: ['json', 'sql', 'csv'],
          description: 'Output format (default: json)',
        },
        limit: { type: 'number', description: 'Row limit (default: 500)' },
        force_production: {
          type: 'boolean',
          description: 'Run against production cache even in dev mode',
        },
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
    case 'run_tile':
      return runTile(args, session)
    case 'run_query':
      return runQuery(args, session)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/**
 * Poll a query task until complete, then return results.
 * This is how the Looker UI handles long-running queries.
 */
async function pollQueryTask(
  sdk: any,
  taskId: string,
  format: string
): Promise<unknown> {
  const start = Date.now()
  while (Date.now() - start < MAX_POLL_TIME) {
    const task = await sdk.ok(sdk.query_task(taskId, '')) as any
    const status = task.status

    if (status === 'complete') {
      const raw = await sdk.ok(sdk.query_task_results(taskId))
      if (format === 'sql') return raw
      if (format === 'json' && typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { return raw }
      }
      return raw
    }

    if (status === 'error') {
      throw new Error(`Query task ${taskId} failed: ${task.result_source || 'unknown error'}`)
    }

    if (status === 'running' || status === 'added' || status === 'pending') {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
      continue
    }

    throw new Error(`Query task ${taskId} unexpected status: ${status}`)
  }
  throw new Error(`Query task ${taskId} timed out after ${MAX_POLL_TIME / 1000}s`)
}

/** Build transport options with timeout */
function transportOpts(timeoutSec?: number): { timeout: number } {
  return { timeout: (timeoutSec || DEFAULT_TIMEOUT) * 1000 }
}

async function runTile(
  args: Record<string, unknown>,
  session: Session
) {
  const { sdk } = session
  const elementId = args.element_id as string
  const format = (args.format as string) || 'json'
  const limit = args.limit as number | undefined
  const forceProd = args.force_production as boolean | undefined
  const timeout = args.timeout as number | undefined

  // Get tile's query ID
  const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
  const queryId = element.query_id || element.result_maker?.query_id
  if (!queryId) throw new Error(`Element ${elementId} has no associated query`)

  // For SQL format, use sync (SQL compilation is fast, no BigQuery)
  if (format === 'sql') {
    const result = await sdk.ok(
      sdk.run_query({
        query_id: queryId,
        result_format: 'sql',
        force_production: forceProd || undefined,
      } as any, transportOpts(timeout))
    )
    return { sql: result, element_id: elementId, query_id: queryId }
  }

  // Try sync first with timeout, fall back to async query task
  try {
    const result = await sdk.ok(
      sdk.run_query({
        query_id: queryId,
        result_format: format,
        limit: limit || undefined,
        force_production: forceProd || undefined,
      } as any, transportOpts(timeout))
    )
    return parseResult(result, format)
  } catch (err: any) {
    // If timeout or connection error, fall back to async
    if (isTimeoutError(err)) {
      console.error(`[looker-dev-tools] run_tile sync timed out, falling back to async query task`)
      return runTileAsync(sdk, queryId, format, limit, forceProd, elementId)
    }
    throw err
  }
}

async function runTileAsync(
  sdk: any,
  queryId: string,
  format: string,
  limit: number | undefined,
  forceProd: boolean | undefined,
  elementId: string
) {
  const task = await sdk.ok(
    sdk.create_query_task({
      body: {
        query_id: queryId,
        result_format: format,
        source: 'looker-mcp-shim',
      },
      limit: limit || undefined,
      force_production: forceProd || undefined,
      cache: true,
    } as any)
  ) as any

  console.error(`[looker-dev-tools] Async query task created: ${task.id} for tile ${elementId}`)
  const result = await pollQueryTask(sdk, task.id, format)

  if (format === 'sql') {
    return { sql: result, element_id: elementId, query_id: queryId, async: true }
  }
  return result
}

async function runQuery(
  args: Record<string, unknown>,
  session: Session
) {
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

  // Try sync first
  try {
    const result = await sdk.ok(
      sdk.run_inline_query({
        result_format: format,
        body: {
          model,
          view: explore,
          fields,
          filters,
          sorts,
          limit: String(limit),
        },
        force_production: forceProd || undefined,
      } as any, transportOpts(timeout))
    )
    return parseResult(result, format)
  } catch (err: any) {
    // Timeout — fall back to async: create query, then create_query_task
    if (isTimeoutError(err)) {
      console.error(`[looker-dev-tools] run_query sync timed out, falling back to async query task`)
      return runQueryAsync(sdk, model, explore, fields, filters, sorts, format, limit, forceProd)
    }
    throw err
  }
}

async function runQueryAsync(
  sdk: any,
  model: string,
  explore: string,
  fields: string[],
  filters: Record<string, string>,
  sorts: string[],
  format: string,
  limit: number,
  forceProd: boolean | undefined
) {
  // Step 1: Create a saved query
  const query = await sdk.ok(
    sdk.create_query({
      model,
      view: explore,
      fields,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      sorts: sorts.length > 0 ? sorts : undefined,
      limit: String(limit),
    } as any)
  ) as any

  // Step 2: Submit as async task
  const task = await sdk.ok(
    sdk.create_query_task({
      body: {
        query_id: query.id,
        result_format: format,
        source: 'looker-mcp-shim',
      },
      force_production: forceProd || undefined,
      cache: true,
    } as any)
  ) as any

  console.error(`[looker-dev-tools] Async query task created: ${task.id} for ${model}/${explore}`)
  return pollQueryTask(sdk, task.id, format)
}

function parseResult(result: unknown, format: string): unknown {
  if (format === 'json' && typeof result === 'string') {
    try { return JSON.parse(result) } catch { return result }
  }
  return result
}

function isTimeoutError(err: any): boolean {
  const msg = (err.message || '').toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted')
  )
}
