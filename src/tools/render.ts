/**
 * render tools — Visual preview of Looker dashboards and tiles.
 *
 * Returns images as first-class MCP ImageContent. No disk staging, no
 * file-path handoff. Native MCP clients (Claude Code, TUI) consume the
 * image directly. REST/daemon clients get automatic disk-write fallback
 * from mcp-proxy-shim daemon.ts — that is a compatibility shim, NOT a
 * required step for this tool.
 *
 * Flow: create_render_task → poll (or hand off task_id for async) →
 *       download binary → base64 → { type: 'image' }
 */

import type { Session } from '../core.js'
import {
  runRenderDiagnostics,
  buildFailureEnvelope,
  preflightEnvelope,
  type RenderFailureEnvelope,
} from './render-debug.js'

type DetailTier = 'low' | 'medium' | 'high'
type RenderKind = 'dashboard' | 'tile'

interface TierDims {
  width: number
  height: number
  format: 'png' | 'jpg'
}

const DETAIL_TIERS: Record<RenderKind, Record<DetailTier, TierDims>> = {
  dashboard: {
    low:    { width: 640,  height: 400,  format: 'png' },
    medium: { width: 1024, height: 768,  format: 'png' },
    high:   { width: 1920, height: 1080, format: 'png' },
  },
  tile: {
    low:    { width: 400,  height: 300,  format: 'png' },
    medium: { width: 640,  height: 480,  format: 'png' },
    high:   { width: 1024, height: 768,  format: 'png' },
  },
}

const SYNC_DEFAULT_TIMEOUT_S = 60
const SYNC_MAX_TIMEOUT_S = 120
const POLL_INTERVAL_MS = 1000

export const tools = [
  {
    name: 'render_dashboard',
    description:
      'Render a Looker dashboard as an image the agent can SEE (MCP ImageContent, first-class).\n\n' +
      'Use for visual review — layout, colors, chart types, spacing, filter bar state.\n\n' +
      'DETAIL TIERS (default: medium):\n' +
      '  low    — 640×400  PNG, loop mode, rapid iteration\n' +
      '  medium — 1024×768 PNG, default, judge design + data\n' +
      '  high   — 1920×1080 PNG, review/final sign-off\n\n' +
      'ASYNC / GRACEFUL DEGRADE:\n' +
      '  - Default (wait: true): polls inline up to timeout_s. If the render completes in time, image is returned in the SAME call (zero round-trip for the fast path, typical for simple dashboards).\n' +
      '  - If it exceeds timeout_s, the call returns {status: "pending", render_task_id, check_with} instead of erroring. Retrieve with get_render when ready.\n' +
      '  - wait: false forces the async handle immediately (skip the inline wait entirely).\n\n' +
      'FILTERS: dashboard_filters body param is passed to Looker; filter values show in the rendered filter bar and apply to all wired tiles.\n\n' +
      'Examples:\n' +
      '  render_dashboard({dashboard_id: "151"})                                // medium sync\n' +
      '  render_dashboard({dashboard_id: "151", detail: "low"})                 // loop mode\n' +
      '  render_dashboard({dashboard_id: "151", detail: "high"})                // review\n' +
      '  render_dashboard({dashboard_id: "151", filters: "State=California"})\n' +
      '  render_dashboard({dashboard_id: "151", wait: false})                   // async',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dashboard_id: { type: 'string', description: 'Dashboard ID (numeric UDD or model::name for LookML)' },
        detail: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Detail tier: low 640×400 / medium 1024×768 / high 1920×1080 (default: medium)',
        },
        width: { type: 'number', description: 'Override width in pixels (takes precedence over detail)' },
        height: { type: 'number', description: 'Override height in pixels (takes precedence over detail)' },
        format: { type: 'string', enum: ['png', 'jpg'], description: 'Image format (default: png)' },
        filters: {
          type: 'string',
          description: 'Dashboard filters as URL-encoded string (e.g. "State=California&City=LA"). Applied to tiles wired to those filters AND rendered in the filter bar.',
        },
        theme: { type: 'string', description: 'Looker theme name (renders embedded style)' },
        wait: {
          type: 'boolean',
          description: 'If false, returns {render_task_id, status: "pending"} immediately. Retrieve with get_render. Default: true.',
        },
        timeout_s: {
          type: 'number',
          description: 'Sync poll timeout in seconds (default: 60, max: 120). Ignored when wait: false.',
        },
        debug: {
          type: 'boolean',
          description: 'Pre-flight: run cheap diagnostics (dashboard exists? workspace?) before rendering — fails early with a structured envelope if the dashboard is missing. Also wraps any render failure in the same envelope (error_class, likely_cause, next_actions). Default: false.',
        },
      },
      required: ['dashboard_id'],
    },
  },
  {
    name: 'render_tile',
    description:
      'Render a single dashboard tile as an image (MCP ImageContent, first-class).\n\n' +
      'Use inspect() first to find element_ids. Ideal for focused iteration: render → update_tile → re-render.\n\n' +
      'FILTERS: passing filters routes through create_query_render_task so filter values can be injected into the tile query — the native element render task does NOT accept filters. When filters are omitted, the fast element render path is used.\n\n' +
      'DETAIL TIERS (default: medium): low 400×300 / medium 640×480 / high 1024×768\n\n' +
      'ASYNC / GRACEFUL DEGRADE:\n' +
      '  - Default (wait: true): tries inline up to timeout_s, returns image directly if ready. If the render overruns, returns {status: "pending", render_task_id} for pickup via get_render.\n' +
      '  - wait: false forces the async handle immediately.\n\n' +
      'Examples:\n' +
      '  render_tile({element_id: "1477"})\n' +
      '  render_tile({element_id: "1477", detail: "low"})\n' +
      '  render_tile({element_id: "1477", filters: "State=California"})         // via query render task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        element_id: { type: 'string', description: 'Dashboard element/tile ID. Use inspect() first.' },
        detail: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Detail tier (default: medium)',
        },
        width: { type: 'number', description: 'Override width in pixels' },
        height: { type: 'number', description: 'Override height in pixels' },
        format: { type: 'string', enum: ['png', 'jpg'], description: 'Image format (default: png)' },
        filters: {
          type: 'string',
          description: 'Filters as URL-encoded string. Routes through create_query_render_task to inject filter values — dashboard_element_render_task cannot handle filters directly.',
        },
        wait: { type: 'boolean', description: 'If false, async mode. Default: true.' },
        timeout_s: { type: 'number', description: 'Sync timeout in seconds (default: 60, max: 120)' },
        debug: {
          type: 'boolean',
          description: 'Pre-flight: run cheap diagnostics (element exists? has base query? workspace?) before rendering — fails early with a structured envelope if the element is missing or not renderable. Also wraps any render failure in the same envelope (error_class, likely_cause, next_actions). Default: false.',
        },
      },
      required: ['element_id'],
    },
  },
  {
    name: 'get_render',
    description:
      'Poll a pending render task by ID. Used with the wait: false flow from render_dashboard/render_tile.\n\n' +
      'Returns:\n' +
      '  - Ready:   MCP ImageContent + metadata\n' +
      '  - Pending: { status, render_task_id, status_detail }\n' +
      '  - Failed:  structured envelope {error_class, likely_cause, next_actions, raw_status_detail, diagnostics} — never a raw throw\n\n' +
      'Typical flow:\n' +
      '  1. render_dashboard({dashboard_id: "151", wait: false}) → { render_task_id }\n' +
      '  2. ...do other work while Looker renders...\n' +
      '  3. get_render({render_task_id}) → image when ready',
    inputSchema: {
      type: 'object' as const,
      properties: {
        render_task_id: { type: 'string', description: 'Task ID from an async render_dashboard / render_tile response' },
      },
      required: ['render_task_id'],
    },
  },
]

function resolveDetail(
  kind: RenderKind,
  args: Record<string, unknown>
): { dims: TierDims; detail: DetailTier } {
  const detailArg = (args.detail as string | undefined) ?? 'medium'
  if (!['low', 'medium', 'high'].includes(detailArg)) {
    throw new Error(`Invalid detail: ${detailArg} (must be low | medium | high)`)
  }
  const detail = detailArg as DetailTier
  const base = DETAIL_TIERS[kind][detail]
  const formatArg = args.format as string | undefined
  const format: 'png' | 'jpg' = formatArg === 'jpg' ? 'jpg' : formatArg === 'png' ? 'png' : base.format
  return {
    dims: {
      width: (args.width as number | undefined) ?? base.width,
      height: (args.height as number | undefined) ?? base.height,
      format,
    },
    detail,
  }
}

function resolveTimeout(args: Record<string, unknown>): number {
  const requested = (args.timeout_s as number | undefined) ?? SYNC_DEFAULT_TIMEOUT_S
  return Math.min(Math.max(1, requested), SYNC_MAX_TIMEOUT_S)
}

function mimeFor(format: string): string {
  return format === 'jpg' ? 'image/jpeg' : 'image/png'
}

async function pollOnce(sdk: any, taskId: string): Promise<any> {
  return await sdk.ok(sdk.render_task(taskId))
}

/**
 * Poll a render task up to `timeoutS` seconds. Returns the completed task
 * on success, null on timeout (so the caller can degrade to an async handle),
 * or throws on explicit Looker failure.
 */
async function waitForCompletion(
  sdk: any,
  taskId: string,
  timeoutS: number
): Promise<any | null> {
  const maxAttempts = Math.ceil((timeoutS * 1000) / POLL_INTERVAL_MS)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const task = await pollOnce(sdk, taskId)
    if (task.status === 'failure' || task.status === 'success') {
      return task
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return null
}

async function downloadBase64(
  sdk: any,
  taskId: string
): Promise<{ base64: string; sizeBytes: number } | null> {
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
    return null
  }
  return {
    base64: buffer.toString('base64'),
    sizeBytes: buffer.length,
  }
}

function buildImageResult(
  base64: string,
  format: string,
  metadata: Record<string, unknown>
) {
  return {
    content: [
      { type: 'image' as const, data: base64, mimeType: mimeFor(format) },
      { type: 'text' as const, text: JSON.stringify(metadata, null, 2) },
    ],
  }
}

function buildPendingResult(payload: Record<string, unknown>) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
    ],
  }
}

function buildFailureResult(envelope: RenderFailureEnvelope) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(envelope, null, 2) },
    ],
    isError: true,
  }
}

/**
 * Merge user-provided filter string with dashboard filter defaults for a tile.
 *
 * User filter keys may be either display names (e.g. "Brand") or dimension
 * names (e.g. "products.brand"). Display names are resolved to dimensions via
 * the dashboard filter definitions — dashboard_element_render_task can accept
 * display names, but create_query_render_task runs a raw query which requires
 * actual dimension names in the filters map.
 */
async function mergeTileFilters(
  sdk: any,
  element: any,
  userFilters: string
): Promise<Record<string, string>> {
  const merged: Record<string, string> = {}
  const displayNameToDim: Record<string, string> = {}

  if (element.dashboard_id) {
    const dashFilters: any[] = await sdk.ok(sdk.dashboard_dashboard_filters(element.dashboard_id))
    for (const df of dashFilters) {
      if (df.dimension && df.name) {
        displayNameToDim[df.name] = df.dimension
        if (df.default_value) {
          merged[df.dimension] = df.default_value
        }
      }
    }
  }

  for (const part of userFilters.split('&')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx <= 0) continue
    const displayOrDim = decodeURIComponent(part.slice(0, eqIdx))
    const v = decodeURIComponent(part.slice(eqIdx + 1))
    const resolvedKey = displayNameToDim[displayOrDim] || displayOrDim
    merged[resolvedKey] = v
  }
  return merged
}

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  const sdk = session.sdk

  if (name === 'render_dashboard') {
    const dashboardId = args.dashboard_id as string
    const filters = args.filters as string | undefined
    const theme = args.theme as string | undefined
    const wait = args.wait !== false
    const { dims, detail } = resolveDetail('dashboard', args)

    const body: Record<string, unknown> = { dashboard_style: 'tiled' }
    if (filters) body.dashboard_filters = filters

    const debug = args.debug === true
    if (debug) {
      const diag = await runRenderDiagnostics(sdk, { dashboardId })
      const pf = preflightEnvelope(diag, { dashboardId })
      if (pf) return buildFailureResult(pf)
    }

    const task = (await sdk.ok(
      sdk.create_dashboard_render_task({
        dashboard_id: dashboardId,
        result_format: dims.format,
        body,
        width: dims.width,
        height: dims.height,
        theme: theme || null,
      })
    )) as any

    if (!wait) {
      return buildPendingResult({
        status: 'pending',
        render_task_id: task.id,
        dashboard_id: dashboardId,
        detail,
        width: dims.width,
        height: dims.height,
        format: dims.format,
        filters_applied: filters || null,
        check_with: `get_render({render_task_id: "${task.id}"})`,
      })
    }

    const timeoutS = resolveTimeout(args)
    const completed = await waitForCompletion(sdk, task.id, timeoutS)
    if (!completed) {
      // Graceful degrade — render exceeded inline budget, hand back the task id.
      return buildPendingResult({
        status: 'pending',
        render_task_id: task.id,
        dashboard_id: dashboardId,
        detail,
        width: dims.width,
        height: dims.height,
        format: dims.format,
        filters_applied: filters || null,
        inline_timeout_s: timeoutS,
        reason: `render exceeded inline budget of ${timeoutS}s`,
        check_with: `get_render({render_task_id: "${task.id}"})`,
      })
    }
    if (completed.status === 'failure') {
      const diag = await runRenderDiagnostics(sdk, { dashboardId })
      return buildFailureResult(
        buildFailureEnvelope({
          statusDetail: completed.status_detail || null,
          message: `Render failed: ${completed.status_detail || 'unknown error'}${completed.runtime ? ` (after ${completed.runtime}s)` : ''}`,
          renderTaskId: task.id,
          diagnostics: diag,
        })
      )
    }
    const dlDash = await downloadBase64(sdk, task.id)
    if (!dlDash) {
      const diag = await runRenderDiagnostics(sdk, { dashboardId })
      return buildFailureResult(
        buildFailureEnvelope({
          statusDetail: null,
          message: 'Render produced empty result — dashboard may have no visible data or filters excluded all rows',
          renderTaskId: task.id,
          diagnostics: diag,
        })
      )
    }
    const { base64, sizeBytes } = dlDash

    const metadata = {
      dashboard_id: dashboardId,
      render_task_id: task.id,
      detail,
      format: dims.format,
      width: dims.width,
      height: dims.height,
      size_bytes: sizeBytes,
      query_runtime_s: completed.query_runtime,
      render_runtime_s: completed.render_runtime,
      filters_applied: filters || null,
      theme: theme || null,
      rendered_at: new Date().toISOString(),
    }
    return buildImageResult(base64, dims.format, metadata)
  }

  if (name === 'render_tile') {
    const elementId = args.element_id as string
    const filters = args.filters as string | undefined
    const wait = args.wait !== false
    const { dims, detail } = resolveDetail('tile', args)

    const debugTile = args.debug === true
    if (debugTile) {
      const diag = await runRenderDiagnostics(sdk, { elementId })
      const pf = preflightEnvelope(diag, { elementId })
      if (pf) return buildFailureResult(pf)
    }

    let task: any
    let renderPath: 'element' | 'query'

    if (filters) {
      renderPath = 'query'
      const element = (await sdk.ok(sdk.dashboard_element(elementId))) as any
      const sourceQuery: any = element.query || element.result_maker?.query
      if (!sourceQuery) {
        const diag = await runRenderDiagnostics(sdk, { elementId })
        return buildFailureResult(
          buildFailureEnvelope({
            statusDetail: null,
            message: `Element ${elementId} has no base query — cannot apply filters via query render task`,
            renderTaskId: null,
            diagnostics: diag,
          })
        )
      }
      const mergedFilters = await mergeTileFilters(sdk, element, filters)
      const {
        id: _id,
        client_id: _cid,
        share_url: _su,
        expanded_share_url: _esu,
        url: _u,
        has_table_calculations: _htc,
        ...writable
      } = sourceQuery
      const queryBody = {
        ...writable,
        filters: { ...(sourceQuery.filters || {}), ...mergedFilters },
      }
      const newQuery = (await sdk.ok(sdk.create_query(queryBody))) as any
      task = (await sdk.ok(
        sdk.create_query_render_task(newQuery.id, dims.format, dims.width, dims.height)
      )) as any
    } else {
      renderPath = 'element'
      task = (await sdk.ok(
        sdk.create_dashboard_element_render_task(elementId, dims.format, dims.width, dims.height)
      )) as any
    }

    if (!wait) {
      return buildPendingResult({
        status: 'pending',
        render_task_id: task.id,
        element_id: elementId,
        detail,
        width: dims.width,
        height: dims.height,
        format: dims.format,
        filters_applied: filters || null,
        render_path: renderPath,
        check_with: `get_render({render_task_id: "${task.id}"})`,
      })
    }

    const timeoutS = resolveTimeout(args)
    const completed = await waitForCompletion(sdk, task.id, timeoutS)
    if (!completed) {
      return buildPendingResult({
        status: 'pending',
        render_task_id: task.id,
        element_id: elementId,
        detail,
        width: dims.width,
        height: dims.height,
        format: dims.format,
        filters_applied: filters || null,
        render_path: renderPath,
        inline_timeout_s: timeoutS,
        reason: `render exceeded inline budget of ${timeoutS}s`,
        check_with: `get_render({render_task_id: "${task.id}"})`,
      })
    }
    if (completed.status === 'failure') {
      const diag = await runRenderDiagnostics(sdk, { elementId })
      return buildFailureResult(
        buildFailureEnvelope({
          statusDetail: completed.status_detail || null,
          message: `Render failed: ${completed.status_detail || 'unknown error'}${completed.runtime ? ` (after ${completed.runtime}s)` : ''}`,
          renderTaskId: task.id,
          diagnostics: diag,
        })
      )
    }
    const dlTile = await downloadBase64(sdk, task.id)
    if (!dlTile) {
      const diag = await runRenderDiagnostics(sdk, { elementId })
      return buildFailureResult(
        buildFailureEnvelope({
          statusDetail: null,
          message: 'Render produced empty result — tile may have no visible data or filters excluded all rows',
          renderTaskId: task.id,
          diagnostics: diag,
        })
      )
    }
    const { base64, sizeBytes } = dlTile

    const metadata = {
      element_id: elementId,
      render_task_id: task.id,
      detail,
      format: dims.format,
      width: dims.width,
      height: dims.height,
      size_bytes: sizeBytes,
      query_runtime_s: completed.query_runtime,
      render_runtime_s: completed.render_runtime,
      filters_applied: filters || null,
      render_path: renderPath,
      rendered_at: new Date().toISOString(),
    }
    return buildImageResult(base64, dims.format, metadata)
  }

  if (name === 'get_render') {
    const renderTaskId = args.render_task_id as string
    const task = await pollOnce(sdk, renderTaskId)

    if (task.status === 'failure') {
      const diag = await runRenderDiagnostics(sdk, {
        elementId: task.dashboard_element_id ?? undefined,
        dashboardId: task.dashboard_id ?? undefined,
      })
      return buildFailureResult(
        buildFailureEnvelope({
          statusDetail: task.status_detail || null,
          message: `Render failed: ${task.status_detail || 'unknown error'}${task.runtime ? ` (after ${task.runtime}s)` : ''}`,
          renderTaskId: renderTaskId,
          diagnostics: diag,
        })
      )
    }

    if (task.status !== 'success') {
      return buildPendingResult({
        status: task.status || 'pending',
        render_task_id: renderTaskId,
        status_detail: task.status_detail || null,
        retry_hint: 'Retry in a few seconds',
      })
    }

    const dlGet = await downloadBase64(sdk, renderTaskId)
    if (!dlGet) {
      return buildFailureResult(
        buildFailureEnvelope({
          statusDetail: null,
          message: 'Render produced empty result — task succeeded but payload is 0 bytes',
          renderTaskId: renderTaskId,
          diagnostics: undefined,
        })
      )
    }
    const { base64, sizeBytes } = dlGet
    const fmt = (task.result_format as string) || 'png'
    const metadata = {
      render_task_id: renderTaskId,
      status: 'success',
      format: fmt,
      width: task.width,
      height: task.height,
      size_bytes: sizeBytes,
      query_runtime_s: task.query_runtime,
      render_runtime_s: task.render_runtime,
      dashboard_id: task.dashboard_id || null,
      element_id: task.dashboard_element_id || null,
      filters_applied: task.dashboard_filters || null,
      rendered_at: task.finalized_at || new Date().toISOString(),
    }
    return buildImageResult(base64, fmt, metadata)
  }

  throw new Error(`Unknown tool: ${name}`)
}
