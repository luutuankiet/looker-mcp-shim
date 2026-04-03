/**
 * inspect tool — URL-smart dashboard and tile inspection.
 *
 * Two levels:
 * - Dashboard: returns tile index (id, title, type, explore, field_count) + filters
 * - Tile: returns full metadata (fields, filters, sorts, vis_config, filter wiring)
 */

import type { Session } from '../core.js'
import { parseTarget } from '../util/url-parser.js'

export const tools = [
  {
    name: 'inspect',
    description:
      'Inspect a Looker dashboard or tile. Use this FIRST to see what tiles exist, then run_tile to get data.\n\n' +
      'Dashboard level: returns tile index (id, title, type, explore, field_count) + filters.\n' +
      'Tile level: returns full metadata (fields, filters, sorts, vis_config, filter wiring).\n\n' +
      'Examples: "151", "tile:1477", "https://host/dashboards/151"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description:
            'Dashboard URL, dashboard ID (e.g. "151"), or tile reference (e.g. "tile:1477")',
        },
      },
      required: ['target'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  if (name !== 'inspect') throw new Error(`Unknown tool: ${name}`)

  const target = parseTarget(args.target as string)

  switch (target.type) {
    case 'dashboard':
      return inspectDashboard(target.id!, session)
    case 'tile':
      return inspectTile(target.id!, session)
    case 'explore':
      return {
        type: 'explore',
        model: target.model,
        explore: target.explore,
        fields: target.fields,
        filters: target.filters,
        note: 'Use run_query to execute this explore',
      }
    case 'look':
      return { type: 'look', id: target.id, note: 'Look inspection not yet implemented' }
    default:
      throw new Error(`Unsupported target type: ${target.type}`)
  }
}

async function inspectDashboard(dashboardId: string, session: Session) {
  const { sdk } = session

  const [elements, filters] = await Promise.all([
    sdk.ok(sdk.dashboard_dashboard_elements(dashboardId, '')),
    sdk.ok(sdk.dashboard_dashboard_filters(dashboardId, '')),
  ])

  const tiles = (elements as any[]).map((e: any, idx: number) => {
    const q = e.query || e.result_maker?.query || {}
    return {
      '#': idx + 1,  // ordinal — use in run_tile as tile: "#2" or tile: "Revenue"
      id: e.id,
      title: e.title || e.title_text || '(untitled)',
      type: e.type,
      model: q.model,
      explore: q.view,
      field_count: (q.fields || []).length,
      query_id: e.query_id || e.result_maker?.query_id,
    }
  })

  const dashFilters = (filters as any[]).map((f: any) => ({
    id: f.id,
    name: f.name,
    title: f.title,
    type: f.type,
    default_value: f.default_value,
  }))

  return {
    dashboard_id: dashboardId,
    tile_count: tiles.length,
    tiles,
    filters: dashFilters,
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}

async function inspectTile(elementId: string, session: Session) {
  const { sdk } = session

  const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
  const q = element.query || element.result_maker?.query || {}

  // Extract filter wiring from result_maker.filterables
  const filterWiring = (element.result_maker?.filterables || []).map((f: any) => ({
    listen: (f.listen || []).map((l: any) => ({
      dashboard_filter_name: l.dashboard_filter_name,
      field: l.field,
    })),
  }))

  return {
    element_id: elementId,
    title: element.title || element.title_text || '(untitled)',
    type: element.type,
    model: q.model,
    explore: q.view,
    fields: q.fields || [],
    filters: q.filters || {},
    sorts: q.sorts || [],
    limit: q.limit,
    query_id: element.query_id || element.result_maker?.query_id,
    vis_config: element.vis_config || q.vis_config,
    filter_wiring: filterWiring,
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}
