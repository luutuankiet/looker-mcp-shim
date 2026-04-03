/**
 * Dashboard mutation tools — update_tile, create_tile, delete_tile,
 * create_filter, update_filter, delete_filter
 *
 * Full CRUD over dashboard tiles and filters via @looker/sdk.
 * SDK reference: IWriteQuery, IWriteDashboardElement, IWriteCreateDashboardFilter
 */

import type { Session } from '../core.js'

/** Fields from IWriteQuery that are safe to send in mutation calls */
const WRITABLE_QUERY_FIELDS = [
  'model', 'view', 'fields', 'pivots', 'fill_fields', 'filters',
  'filter_expression', 'sorts', 'limit', 'column_limit', 'total',
  'row_total', 'subtotals', 'vis_config', 'filter_config',
  'visible_ui_sections', 'dynamic_fields', 'query_timezone',
  // NOTE: client_id deliberately excluded — it's a unique query identifier
  // that can't be reused when creating new queries via create_query()
]

/** Extract only IWriteQuery-compatible fields from a full query object */
function extractWritableQuery(q: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of WRITABLE_QUERY_FIELDS) {
    if (q[field] !== undefined && q[field] !== null) {
      result[field] = q[field]
    }
  }
  return result
}

export const tools = [
  {
    name: 'update_tile',
    description:
      'Update an existing dashboard tile (element). Accepts partial updates — only specified fields change.\n\n' +
      'For query changes (fields, filters, sorts, vis_config), the existing query is merged with your changes ' +
      'so you only need to specify what changed.\n\n' +
      'Examples:\n' +
      '  update_tile({element_id: "1477", title: "New Title"})\n' +
      '  update_tile({element_id: "1477", query: {filters: {"view.date": "7 days"}}})\n' +
      '  update_tile({element_id: "1477", query: {vis_config: {type: "looker_bar"}}})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_id: { type: 'string', description: 'Dashboard element/tile ID to update' },
        title: { type: 'string', description: 'New tile title' },
        title_text: { type: 'string', description: 'New tile title text' },
        subtitle_text: { type: 'string', description: 'New subtitle text' },
        type: { type: 'string', description: 'Element type (vis, text, etc.)' },
        note_text: { type: 'string', description: 'Note text for the tile' },
        title_hidden: { type: 'boolean', description: 'Hide the tile title' },
        query: {
          type: 'object',
          description:
            'Partial query update — merged with existing. Available: model, view, fields, pivots, ' +
            'filters, sorts, limit, vis_config, filter_config, dynamic_fields',
          properties: {
            model: { type: 'string' },
            view: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            pivots: { type: 'array', items: { type: 'string' } },
            filters: { type: 'object' },
            sorts: { type: 'array', items: { type: 'string' } },
            limit: { type: 'string' },
            vis_config: {
              type: 'object',
              description:
                'Visualization config (opaque JSON blob — types matter, wrong types crash Looker frontend). ' +
                'Common: type (string), stacking ("" | "normal" | "percent"), show_value_labels (bool), ' +
                'hidden_fields (string[]), hidden_series (string[] — MUST be array not object!), ' +
                'series_types ({field: "line" | "column"}), series_colors ({field: "#hex"}), ' +
                'series_labels ({field: "Label"}), show_legend (bool), legend_position ("center" | "left" | "right"), ' +
                'label_density (number), table_calculations ([{label, expression, value_format}]). ' +
                'See rules/mutate.md "vis_config Reference" for full list.',
            },
            filter_config: { type: 'object' },
            dynamic_fields: { type: 'string' },
          },
        },
      },
      required: ['element_id'],
    },
  },
  {
    name: 'create_tile',
    description:
      'Add a new tile to a dashboard. Provide an inline query (model + view + fields) or a saved query_id.\n\n' +
      'Example:\n' +
      '  create_tile({dashboard_id: "151", title: "Revenue", query: {\n' +
      '    model: "common", view: "orders", fields: ["orders.count", "orders.total_revenue"]\n' +
      '  }})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dashboard_id: { type: 'string', description: 'Dashboard ID to add the tile to' },
        title: { type: 'string', description: 'Tile title' },
        title_text: { type: 'string', description: 'Tile title text' },
        type: { type: 'string', description: 'Element type (default: "vis")' },
        query: {
          type: 'object',
          description: 'Inline query definition. Required fields: model, view, fields.',
          properties: {
            model: { type: 'string' },
            view: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            pivots: { type: 'array', items: { type: 'string' } },
            filters: { type: 'object' },
            sorts: { type: 'array', items: { type: 'string' } },
            limit: { type: 'string' },
            vis_config: {
              type: 'object',
              description:
                'Visualization config (opaque JSON blob — types matter, wrong types crash Looker frontend). ' +
                'Common: type (string), stacking ("" | "normal" | "percent"), show_value_labels (bool), ' +
                'hidden_fields (string[]), hidden_series (string[] — MUST be array not object!), ' +
                'series_types ({field: "line" | "column"}), series_colors ({field: "#hex"}), ' +
                'series_labels ({field: "Label"}), show_legend (bool), legend_position ("center" | "left" | "right"), ' +
                'label_density (number), table_calculations ([{label, expression, value_format}]). ' +
                'See rules/mutate.md "vis_config Reference" for full list.',
            },
            dynamic_fields: { type: 'string' },
          },
        },
        query_id: { type: 'string', description: 'Use existing saved query ID instead of inline query' },
      },
      required: ['dashboard_id'],
    },
  },
  {
    name: 'delete_tile',
    description: 'Remove a tile from a dashboard. Use inspect first to find the element_id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_id: { type: 'string', description: 'Dashboard element/tile ID to delete' },
      },
      required: ['element_id'],
    },
  },
  {
    name: 'create_filter',
    description:
      'Add a dashboard filter. Requires dashboard_id, name, title, type.\n\n' +
      'For field-based filters, also specify dimension, model, and explore.\n\n' +
      'Example:\n' +
      '  create_filter({dashboard_id: "151", name: "date_filter", title: "Date",\n' +
      '    type: "field_filter", dimension: "orders.created_date",\n' +
      '    model: "common", explore: "orders"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dashboard_id: { type: 'string', description: 'Dashboard ID' },
        name: { type: 'string', description: 'Filter name (internal identifier)' },
        title: { type: 'string', description: 'Filter display title' },
        type: { type: 'string', description: 'Filter type (field_filter, etc.)' },
        dimension: { type: 'string', description: 'Field to filter on (e.g. "view.field_name")' },
        model: { type: 'string', description: 'LookML model for field suggestions' },
        explore: { type: 'string', description: 'Explore for field suggestions' },
        default_value: { type: 'string', description: 'Default filter value' },
        allow_multiple_values: { type: 'boolean', description: 'Allow multiple selections' },
        required: { type: 'boolean', description: 'Make filter required' },
        ui_config: { type: 'object', description: 'UI configuration for the filter' },
        listens_to_filters: {
          type: 'array', items: { type: 'string' },
          description: 'Other filter names this filter listens to (cross-filtering)',
        },
        row: { type: 'number', description: 'Row position in filter bar' },
      },
      required: ['dashboard_id', 'name', 'title', 'type'],
    },
  },
  {
    name: 'update_filter',
    description:
      'Update an existing dashboard filter. Accepts partial updates.\n\n' +
      'Example: update_filter({filter_id: "42", default_value: "30 days", title: "Date Range"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter_id: { type: 'string', description: 'Dashboard filter ID to update' },
        name: { type: 'string', description: 'Filter name' },
        title: { type: 'string', description: 'Filter display title' },
        type: { type: 'string', description: 'Filter type' },
        dimension: { type: 'string', description: 'Field to filter on' },
        model: { type: 'string', description: 'LookML model' },
        explore: { type: 'string', description: 'Explore name' },
        default_value: { type: 'string', description: 'Default filter value' },
        allow_multiple_values: { type: 'boolean' },
        required: { type: 'boolean' },
        ui_config: { type: 'object' },
        listens_to_filters: { type: 'array', items: { type: 'string' } },
        row: { type: 'number', description: 'Row position' },
      },
      required: ['filter_id'],
    },
  },
  {
    name: 'delete_filter',
    description: 'Remove a dashboard filter. Use inspect first to find the filter_id.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter_id: { type: 'string', description: 'Dashboard filter ID to delete' },
      },
      required: ['filter_id'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  switch (name) {
    case 'update_tile': return updateTile(args, session)
    case 'create_tile': return createTile(args, session)
    case 'delete_tile': return deleteTile(args, session)
    case 'create_filter': return createFilter(args, session)
    case 'update_filter': return updateFilter(args, session)
    case 'delete_filter': return deleteFilter(args, session)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

async function updateTile(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const elementId = args.element_id as string

  const body: Record<string, unknown> = {}

  // Direct element properties
  for (const prop of ['title', 'title_text', 'subtitle_text', 'type', 'note_text', 'title_hidden']) {
    if (args[prop] !== undefined) body[prop] = args[prop]
  }

  // Query: merge partial updates with existing query
  if (args.query) {
    const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
    const existingQuery = element.query || element.result_maker?.query || {}
    const existingWritable = extractWritableQuery(existingQuery)
    const queryUpdates = args.query as Record<string, unknown>

    // Looker API ignores inline query on element update —
    // must create new query separately, then reference by ID
    const mergedQuery = { ...existingWritable, ...queryUpdates }
    const newQuery = await sdk.ok(sdk.create_query(mergedQuery as any)) as any
    body.query_id = newQuery.id
  }

  const result = await sdk.ok(
    sdk.update_dashboard_element(elementId, body as any, '')
  ) as any

  const rq = result.query || result.result_maker?.query || {}
  return {
    element_id: result.id,
    title: result.title || result.title_text,
    type: result.type,
    query_id: result.query_id || result.result_maker?.query_id,
    fields: rq.fields || [],
    updated_fields: Object.keys(body),
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}

async function createTile(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const dashboardId = args.dashboard_id as string

  const body: Record<string, unknown> = {
    dashboard_id: dashboardId,
    type: (args.type as string) || 'vis',
  }
  if (args.title) body.title = args.title
  if (args.title_text) body.title_text = args.title_text

  if (args.query_id) {
    body.query_id = args.query_id
  } else if (args.query) {
    // Looker API doesn't support inline query on create_dashboard_element —
    // must create query first, then reference by ID
    const queryResult = await sdk.ok(sdk.create_query(args.query as any)) as any
    body.query_id = queryResult.id
  } else {
    throw new Error('Either query or query_id is required to create a tile')
  }

  // SDK uses IRequestCreateDashboardElement: { body, fields?, apply_filters? }
  const result = await sdk.ok(
    sdk.create_dashboard_element({ body: body as any, fields: '' } as any)
  ) as any

  return {
    element_id: result.id,
    dashboard_id: dashboardId,
    title: result.title || result.title_text,
    type: result.type,
    query_id: result.query_id || result.result_maker?.query_id,
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}

async function deleteTile(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const elementId = args.element_id as string

  // Read tile info before deleting for confirmation message
  let title = '(unknown)'
  try {
    const element = await sdk.ok(sdk.dashboard_element(elementId, '')) as any
    title = element.title || element.title_text || '(untitled)'
  } catch { /* tile may already be gone */ }

  await sdk.ok(sdk.delete_dashboard_element(elementId))

  return {
    deleted: true,
    element_id: elementId,
    title,
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}

async function createFilter(args: Record<string, unknown>, session: Session) {
  const { sdk } = session

  const body: Record<string, unknown> = {
    dashboard_id: args.dashboard_id,
    name: args.name,
    title: args.title,
    type: args.type,
  }

  for (const prop of [
    'dimension', 'model', 'explore', 'default_value',
    'allow_multiple_values', 'required', 'ui_config',
    'listens_to_filters', 'row',
  ]) {
    if (args[prop] !== undefined) body[prop] = args[prop]
  }

  const result = await sdk.ok(
    sdk.create_dashboard_filter(body as any, '')
  ) as any

  return {
    filter_id: result.id,
    dashboard_id: args.dashboard_id,
    name: result.name,
    title: result.title,
    type: result.type,
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}

async function updateFilter(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const filterId = args.filter_id as string

  const body: Record<string, unknown> = {}
  for (const prop of [
    'name', 'title', 'type', 'dimension', 'model', 'explore',
    'default_value', 'allow_multiple_values', 'required',
    'ui_config', 'listens_to_filters', 'row',
  ]) {
    if (args[prop] !== undefined) body[prop] = args[prop]
  }

  const result = await sdk.ok(
    sdk.update_dashboard_filter(filterId, body as any, '')
  ) as any

  return {
    filter_id: result.id,
    name: result.name,
    title: result.title,
    type: result.type,
    updated_fields: Object.keys(body),
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}

async function deleteFilter(args: Record<string, unknown>, session: Session) {
  const { sdk } = session
  const filterId = args.filter_id as string

  // Read filter info before deleting
  let name = '(unknown)'
  try {
    const filter = await sdk.ok(sdk.dashboard_filter(filterId, '')) as any
    name = filter.name || filter.title || '(unnamed)'
  } catch { /* filter may already be gone */ }

  await sdk.ok(sdk.delete_dashboard_filter(filterId))

  return {
    deleted: true,
    filter_id: filterId,
    name,
    mode: session.currentMode(),
    branch: session.currentBranch(),
  }
}
