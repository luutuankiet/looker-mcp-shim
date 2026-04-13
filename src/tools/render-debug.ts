/**
 * render-debug — classify Looker render failures into structured envelopes
 * the agent can act on, instead of re-throwing raw Looker stack traces.
 *
 * Used by render.ts at every failure site + optional pre-flight diagnostics
 * when a render call passes `debug: true`.
 *
 * Agent DX contract: on failure, return a typed envelope with
 *   { error_class, likely_cause, next_actions, diagnostics?, raw_status_detail }
 * so the agent knows what to try next without re-reading minified stack traces.
 */

export type RenderErrorClass =
  | 'ANGULAR_RUNTIME_EXCEPTION'
  | 'EMPTY_RESULT'
  | 'NO_BASE_QUERY'
  | 'QUERY_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'PERMISSION'
  | 'UNKNOWN'

export interface RenderDiagnostics {
  workspace: string | null
  element_found?: boolean
  element_title?: string | null
  has_base_query?: boolean
  query_id?: number | null
  model?: string | null
  explore?: string | null
  dashboard_found?: boolean
  dashboard_title?: string | null
  force_production_retry_available?: boolean
  notes?: string[]
}

export interface RenderFailureEnvelope {
  status: 'failed'
  error_class: RenderErrorClass
  message: string
  likely_cause: string
  next_actions: string[]
  raw_status_detail: string | null
  render_task_id: string | null
  diagnostics?: RenderDiagnostics
}

const PATTERNS: Array<{
  cls: RenderErrorClass
  match: RegExp[]
  cause: string
  actions: string[]
}> = [
  {
    cls: 'ANGULAR_RUNTIME_EXCEPTION',
    match: [
      /ANGULAR_RUNTIME_EXCEPTION/i,
      /chunk\.js:\d+:\d+/,
      /Cannot read propert(y|ies) of undefined/i,
    ],
    cause:
      "Looker's headless Chromium crashed while rendering the element — usually a stale vis cache, a broken vis_config, or a d3 scale crash on missing/malformed data in the underlying query.",
    actions: [
      'Retry render_tile with a filters string — routes through create_query_render_task and bypasses the element render crash path entirely',
      'Use inspect({url: tile_url_or_element_id}) to check vis_config and measures for stale fields',
      'Switch to production or a fresh dev branch via switch_mode — the crash may be dev-branch state',
      'If the crash affects every tile on an instance, it is a server-side Looker bug (e.g. demo-data instance) and cannot be fixed in the shim',
    ],
  },
  {
    cls: 'NO_BASE_QUERY',
    match: [/has no base query/i, /no base query/i],
    cause:
      'The element has no attached query — typically a text/markdown/button tile, or a LookML-defined tile whose result_maker exists but has no query object.',
    actions: [
      'Use render_dashboard({dashboard_id}) to see the tile in dashboard context',
      'Use inspect to confirm element type — text and button tiles are not renderable as standalone',
    ],
  },
  {
    cls: 'EMPTY_RESULT',
    match: [/produced empty/i, /empty result/i, /0 bytes/i],
    cause:
      'Looker reported the render task as successful but the PNG payload is zero bytes. The underlying query most likely returned no rows (over-filtered, date range empty, or dimension values excluded).',
    actions: [
      'Run run_tile({dashboard_id, tile}) and verify row_count > 0',
      'Retry render with a wider filter range or no filters',
      "Inspect dashboard_element.query.filters for overly restrictive defaults (e.g. 'Created Date is in the last 1 days')",
    ],
  },
  {
    cls: 'MODEL_NOT_FOUND',
    match: [/model.*not.*found/i, /no such model/i, /model does not exist/i],
    cause:
      'The LookML model the query references is missing or mis-named on the current branch.',
    actions: [
      'Run validate({project}) for structured LookML errors',
      'Check branch: switch_mode to the right dev branch, or use force_production',
      'Confirm the model file name via project files listing',
    ],
  },
  {
    cls: 'VALIDATION_ERROR',
    match: [/validation failed/i, /validation error/i, /syntax error/i],
    cause:
      'LookML validation failed — project errors block render compilation.',
    actions: [
      'Run validate({project}) for file:line errors',
      'Fix reported LookML errors and re-run',
    ],
  },
  {
    cls: 'QUERY_TIMEOUT',
    match: [/timeout/i, /timed out/i, /query.*took.*too long/i, /runtime exceeded/i],
    cause:
      "The underlying query exceeded Looker's render-task time budget.",
    actions: [
      'Lower detail tier (detail: low) for a faster render — fewer pixels, smaller chart payload',
      'Narrow filters to reduce data volume',
      'Submit async: render_dashboard({wait: false}) then get_render({render_task_id}) later',
    ],
  },
  {
    cls: 'PERMISSION',
    match: [/\b403\b/, /forbidden/i, /not authorized/i, /unauthori[sz]ed/i],
    cause:
      'Looker rejected the request on authorization grounds. The SDK credentials may lack render permission on this instance.',
    actions: [
      'Verify .env LOOKER_CLIENT_ID / LOOKER_CLIENT_SECRET against the target instance',
      'Confirm the role on this instance has the "render" permission',
    ],
  },
]

export function classifyRenderError(
  statusDetail: string | null | undefined,
  message: string
): { cls: RenderErrorClass; cause: string; actions: string[] } {
  const text = `${statusDetail || ''}\n${message || ''}`
  for (const p of PATTERNS) {
    if (p.match.some((r) => r.test(text))) {
      return { cls: p.cls, cause: p.cause, actions: p.actions }
    }
  }
  return {
    cls: 'UNKNOWN',
    cause:
      'Unrecognized Looker render error — see raw_status_detail for the original string. The classifier has no pattern for this yet.',
    actions: [
      'Retry with debug: true for a pre-flight health check on the dashboard/element',
      'Use inspect to examine the element manually',
      'Read raw_status_detail for any hint in the Looker message',
    ],
  }
}

export interface DiagnosticInput {
  elementId?: string | number
  dashboardId?: string | number
}

/**
 * Run a battery of cheap SDK checks to give the agent a picture of why a
 * render might fail. Safe to call before OR after a render attempt — never
 * throws, all errors are captured into the envelope.
 */
export async function runRenderDiagnostics(
  sdk: any,
  input: DiagnosticInput
): Promise<RenderDiagnostics> {
  const diag: RenderDiagnostics = { workspace: null, notes: [] }

  try {
    const session: any = await sdk.ok(sdk.session())
    diag.workspace = session?.workspace_id || null
  } catch (e: any) {
    diag.notes?.push(`session_error: ${e?.message || String(e)}`)
  }

  let dashboardIdFromElement: string | number | undefined
  if (input.elementId !== undefined) {
    try {
      const el: any = await sdk.ok(sdk.dashboard_element(String(input.elementId)))
      diag.element_found = true
      diag.element_title = el.title || el.title_text || null
      const q = el.query || el.result_maker?.query
      diag.has_base_query = !!q
      if (q) {
        diag.query_id = q.id ?? null
        diag.model = q.model || null
        diag.explore = q.view || q.explore || null
      }
      if (el.dashboard_id) {
        dashboardIdFromElement = el.dashboard_id
      }
    } catch (e: any) {
      diag.element_found = false
      diag.notes?.push(`element_error: ${e?.message || String(e)}`)
    }
  }

  const dashId = input.dashboardId ?? dashboardIdFromElement
  if (dashId !== undefined) {
    try {
      const db: any = await sdk.ok(sdk.dashboard(String(dashId)))
      diag.dashboard_found = true
      diag.dashboard_title = db.title || null
    } catch (e: any) {
      diag.dashboard_found = false
      diag.notes?.push(`dashboard_error: ${e?.message || String(e)}`)
    }
  }

  diag.force_production_retry_available = diag.workspace === 'dev'

  if (diag.notes && diag.notes.length === 0) {
    delete diag.notes
  }
  return diag
}

export function buildFailureEnvelope(params: {
  statusDetail: string | null
  message: string
  renderTaskId: string | null
  diagnostics?: RenderDiagnostics
}): RenderFailureEnvelope {
  const c = classifyRenderError(params.statusDetail, params.message)
  return {
    status: 'failed',
    error_class: c.cls,
    message: params.message,
    likely_cause: c.cause,
    next_actions: c.actions,
    raw_status_detail: params.statusDetail,
    render_task_id: params.renderTaskId,
    ...(params.diagnostics ? { diagnostics: params.diagnostics } : {}),
  }
}

/**
 * Pre-flight: before attempting a render with debug: true, run diagnostics
 * and surface any fatal finding (missing element/dashboard) as an envelope.
 * Returns null when the pre-flight passed and the render should proceed.
 */
export function preflightEnvelope(
  diag: RenderDiagnostics,
  input: DiagnosticInput
): RenderFailureEnvelope | null {
  if (input.elementId !== undefined && diag.element_found === false) {
    return buildFailureEnvelope({
      statusDetail: diag.notes?.find((n) => n.startsWith('element_error')) || null,
      message: `Pre-flight: dashboard_element(${input.elementId}) not found`,
      renderTaskId: null,
      diagnostics: diag,
    })
  }
  if (input.dashboardId !== undefined && diag.dashboard_found === false) {
    return buildFailureEnvelope({
      statusDetail: diag.notes?.find((n) => n.startsWith('dashboard_error')) || null,
      message: `Pre-flight: dashboard(${input.dashboardId}) not found`,
      renderTaskId: null,
      diagnostics: diag,
    })
  }
  if (input.elementId !== undefined && diag.has_base_query === false) {
    return buildFailureEnvelope({
      statusDetail: null,
      message: `Pre-flight: element ${input.elementId} has no base query — not renderable as a tile`,
      renderTaskId: null,
      diagnostics: diag,
    })
  }
  return null
}
