/**
 * render tools — Visual preview of dashboards and tiles as PNG images.
 *
 * Uses Looker's RenderTask API to generate screenshots that multimodal
 * LLMs can analyze for layout, design, and data presentation quality.
 *
 * The render flow: create_render_task → poll status → download binary → base64 → MCP image
 */

import type { Session } from '../core.js'

const POLL_INTERVAL_MS = 1000
const MAX_POLL_ATTEMPTS = 60

export const tools = [
  {
    name: 'render_dashboard',
    description:
      'Render a Looker dashboard as a PNG/JPG image for visual inspection by the AI agent.\n\n' +
      'Returns the image directly as MCP image content — the agent can SEE the dashboard.\n' +
      'Use this to verify layout, colors, chart types, spacing, and overall visual quality.\n\n' +
      'Supports UDD dashboards (numeric ID) and LookML dashboards.\n\n' +
      'Workflow: inspect() → understand tiles → render_dashboard() → visual review → iterate\n\n' +
      'Examples:\n' +
      '  render_dashboard({dashboard_id: "151"})\n' +
      '  render_dashboard({dashboard_id: "151", width: 1920, height: 1080})\n' +
      '  render_dashboard({dashboard_id: "151", filters: "State=California"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dashboard_id: {
          type: 'string',
          description: 'Dashboard ID (numeric for UDD, or LookML dashboard ID)',
        },
        width: {
          type: 'number',
          description: 'Output width in pixels (default: 1280)',
        },
        height: {
          type: 'number',
          description: 'Output height in pixels (default: 800)',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpg'],
          description: 'Image format (default: png). Use png for best quality.',
        },
        filters: {
          type: 'string',
          description: 'Dashboard filters as URL-encoded string (e.g. "State=California&City=LA")',
        },
        theme: {
          type: 'string',
          description: 'Looker theme to apply. Renders the embedded version of the dashboard.',
        },
      },
      required: ['dashboard_id'],
    },
  },
  {
    name: 'render_tile',
    description:
      'Render a single dashboard tile as a PNG/JPG image for focused visual inspection.\n\n' +
      'Returns the image directly — the agent can SEE the individual visualization.\n' +
      'Use inspect() first to find element IDs, then render specific tiles.\n\n' +
      'Ideal for iterating on a specific chart: render → evaluate → update_tile → re-render.\n\n' +
      'Examples:\n' +
      '  render_tile({element_id: "1477"})\n' +
      '  render_tile({element_id: "1477", width: 800, height: 600})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_id: {
          type: 'string',
          description: 'Dashboard element/tile ID. Use inspect() to find these.',
        },
        width: {
          type: 'number',
          description: 'Output width in pixels (default: 800)',
        },
        height: {
          type: 'number',
          description: 'Output height in pixels (default: 600)',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpg'],
          description: 'Image format (default: png)',
        },
      },
      required: ['element_id'],
    },
  },
]

/**
 * Poll a render task until it completes or fails.
 */
async function pollRenderTask(sdk: any, taskId: string): Promise<any> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const task = await sdk.ok(sdk.render_task(taskId))

    if (task.status === 'failure') {
      throw new Error(
        `Render failed: ${task.status_detail || 'unknown error'}` +
        (task.runtime ? ` (after ${task.runtime}s)` : '')
      )
    }

    if (task.status === 'success') {
      return task
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error(`Render timed out after ${MAX_POLL_ATTEMPTS}s — dashboard may be too complex`)
}

/**
 * Download render results and convert to base64.
 * Handles Buffer, string, and ArrayBuffer responses from the SDK.
 */
async function downloadAndEncode(sdk: any, taskId: string): Promise<{ base64: string; sizeBytes: number }> {
  const result = await sdk.ok(sdk.render_task_results(taskId))

  let buffer: Buffer
  if (Buffer.isBuffer(result)) {
    buffer = result
  } else if (result instanceof ArrayBuffer) {
    buffer = Buffer.from(result)
  } else if (typeof result === 'string') {
    buffer = Buffer.from(result, 'binary')
  } else {
    buffer = Buffer.from(result as any)
  }

  if (buffer.length === 0) {
    throw new Error('Render produced empty result — the dashboard may have no visible data')
  }

  return {
    base64: buffer.toString('base64'),
    sizeBytes: buffer.length,
  }
}

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  const sdk = session.sdk

  if (name === 'render_dashboard') {
    const dashboardId = args.dashboard_id as string
    const width = (args.width as number) || 1280
    const height = (args.height as number) || 800
    const format = (args.format as string) || 'png'
    const filters = args.filters as string | undefined
    const theme = args.theme as string | undefined

    const body: Record<string, unknown> = { dashboard_style: 'tiled' }
    if (filters) body.dashboard_filters = filters

    const task = await sdk.ok(
      sdk.create_dashboard_render_task({
        dashboard_id: dashboardId,
        result_format: format,
        body,
        width,
        height,
        theme: theme || null,
      })
    ) as any

    const completed = await pollRenderTask(sdk, task.id)
    const { base64, sizeBytes } = await downloadAndEncode(sdk, task.id)
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'

    const meta = {
      dashboard_id: dashboardId,
      format,
      width,
      height,
      size_bytes: sizeBytes,
      query_runtime_s: completed.query_runtime,
      render_runtime_s: completed.render_runtime,
    }

    return {
      content: [
        { type: 'image' as const, data: base64, mimeType },
        { type: 'text' as const, text: JSON.stringify(meta, null, 2) },
      ],
    }
  }

  if (name === 'render_tile') {
    const elementId = args.element_id as string
    const width = (args.width as number) || 800
    const height = (args.height as number) || 600
    const format = (args.format as string) || 'png'

    const task = await sdk.ok(
      sdk.create_dashboard_element_render_task(elementId, format, width, height)
    ) as any

    const completed = await pollRenderTask(sdk, task.id)
    const { base64, sizeBytes } = await downloadAndEncode(sdk, task.id)
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'

    const meta = {
      element_id: elementId,
      format,
      width,
      height,
      size_bytes: sizeBytes,
      query_runtime_s: completed.query_runtime,
      render_runtime_s: completed.render_runtime,
    }

    return {
      content: [
        { type: 'image' as const, data: base64, mimeType },
        { type: 'text' as const, text: JSON.stringify(meta, null, 2) },
      ],
    }
  }

  throw new Error(`Unknown tool: ${name}`)
}
