/**
 * Query tools — run_tile, run_query
 *
 * run_tile: Execute a dashboard tile's query. Returns data (json), compiled SQL, or CSV.
 * run_query: Execute an ad-hoc explore query.
 */

import type { Session } from '../core.js'

export const tools = [
  {
    name: 'run_tile',
    description:
      'Run a dashboard tile query. Returns data (json), compiled SQL (sql), or CSV.\n\n' +
      'First retrieves the tile element to find its query_id, then executes.',
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
      },
      required: ['element_id'],
    },
  },
  {
    name: 'run_query',
    description:
      'Run an ad-hoc explore query against a model/explore.\n\n' +
      'Specify model, explore, and fields. Optionally add filters, sorts, limit.',
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

async function runTile(
  args: Record<string, unknown>,
  session: Session
) {
  const { sdk } = session
  const elementId = args.element_id as string
  const format = (args.format as string) || 'json'
  const limit = args.limit as number | undefined

  // Get element to find query_id
  const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
  const queryId = element.query_id || element.result_maker?.query_id

  if (!queryId) {
    throw new Error(`Element ${elementId} has no associated query`)
  }

  // Run the query
  const result = await sdk.ok(
    sdk.run_query({
      query_id: queryId,
      result_format: format,
      limit: limit || undefined,
    } as any)
  )

  if (format === 'sql') {
    return { sql: result, element_id: elementId, query_id: queryId }
  }

  // For JSON, try to parse if it's a string
  if (format === 'json' && typeof result === 'string') {
    try {
      return JSON.parse(result)
    } catch {
      return result
    }
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
    } as any)
  )

  // For JSON, try to parse if it's a string
  if (format === 'json' && typeof result === 'string') {
    try {
      return JSON.parse(result)
    } catch {
      return result
    }
  }

  return result
}
