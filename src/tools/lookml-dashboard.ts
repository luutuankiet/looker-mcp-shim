/**
 * lookml-dashboard tools — import LookML dashboards to UDD for fast iteration.
 *
 * Workflow: inspect LookML dashboard → validate → import as UDD → iterate with
 * existing mutation tools (no git commits) → when satisfied, port back to LookML.
 *
 * Safety: validates LookML before import to avoid cloning broken dashboards.
 */

import type { Session } from '../core.js'
import { CONFIG } from '../core.js'

export const tools = [
  {
    name: 'import_lookml_dashboard',
    description:
      'Import a LookML dashboard as a User-Defined Dashboard (UDD) for fast iteration.\n\n' +
      'WHY: LookML dashboards require git commit cycles to iterate. Importing as UDD lets you ' +
      'use create_tile/update_tile/update_filter directly — no git, no push, no reset.\n\n' +
      'WORKFLOW: validate LookML → inspect source dashboard → import as UDD copy → return UDD ID for iteration.\n' +
      'When done iterating, port changes back to .dashboard.lookml and commit.\n\n' +
      'VALIDATION: Runs LookML validation first. If there are errors in the model that owns this dashboard, ' +
      'the import is blocked with actionable error details. Use --skip_validation to bypass (not recommended).\n\n' +
      'Example: import_lookml_dashboard({lookml_dashboard_id: "model::dashboard_name", folder_id: "85"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lookml_dashboard_id: {
          type: 'string',
          description:
            'LookML dashboard ID in model::dashboard_name format (e.g. "general_healthcare_services::expired_calls_dashboard")',
        },
        folder_id: {
          type: 'string',
          description:
            'Folder/space ID to create the UDD in. Defaults to LOOKER_SANDBOX_FOLDER_ID from .env.',
        },
        skip_validation: {
          type: 'boolean',
          description:
            'Skip LookML validation before import. Not recommended — you may clone a broken dashboard. Default: false.',
        },
      },
      required: ['lookml_dashboard_id'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  if (name !== 'import_lookml_dashboard') throw new Error(`Unknown tool: ${name}`)

  const { sdk } = session
  const lookmlDashboardId = args.lookml_dashboard_id as string
  const folderId = (args.folder_id as string) || CONFIG.sandboxFolderId
  const skipValidation = args.skip_validation === true

  if (!folderId) {
    throw new Error(
      'No folder_id provided and LOOKER_SANDBOX_FOLDER_ID not set in .env. ' +
      'Provide folder_id explicitly or set the env var.'
    )
  }

  // Extract model name from lookml_dashboard_id (model::dashboard_name)
  const modelName = lookmlDashboardId.split('::')[0]
  if (!modelName || !lookmlDashboardId.includes('::')) {
    throw new Error(
      `Invalid lookml_dashboard_id format: "${lookmlDashboardId}". ` +
      'Expected "model::dashboard_name" (e.g. "general_healthcare_services::expired_calls_dashboard").'
    )
  }

  // Step 1: Validate LookML (unless skipped)
  if (!skipValidation) {
    try {
      const validation = await sdk.ok(
        sdk.validate_project(session.config.projectId)
      ) as any

      const errors = (validation.errors || []).filter((e: any) => {
        // Filter to errors in the model that owns this dashboard
        const msg = (e.message || '').toLowerCase()
        const src = (e.source_file || '').toLowerCase()
        return src.includes(modelName.toLowerCase()) ||
               msg.includes(modelName.toLowerCase())
      })

      if (errors.length > 0) {
        return {
          status: 'validation_failed',
          lookml_dashboard_id: lookmlDashboardId,
          model: modelName,
          error_count: errors.length,
          errors: errors.slice(0, 10).map((e: any) => ({
            severity: e.severity,
            message: e.message,
            source_file: e.source_file,
            line: e.line,
          })),
          hint: 'Fix LookML errors before importing. The dashboard may not render correctly with broken LookML. ' +
                'Use skip_validation: true to bypass (not recommended).',
        }
      }
    } catch (valErr: any) {
      // Validation itself failed — warn but don't block
      console.error(`[import_lookml_dashboard] Validation check failed: ${valErr.message}`)
    }
  }

  // Step 2: Verify the LookML dashboard exists and is renderable
  let sourceDash: any
  try {
    sourceDash = await sdk.ok(sdk.dashboard(lookmlDashboardId, ''))
  } catch (err: any) {
    const msg = err.message || String(err)
    return {
      status: 'source_not_found',
      lookml_dashboard_id: lookmlDashboardId,
      error: msg,
      hint: msg.includes('Not Found')
        ? `Dashboard "${lookmlDashboardId}" not found. Check model name and dashboard name. ` +
          'Ensure you are in dev mode on the correct branch if the dashboard is new.'
        : `Failed to fetch source dashboard: ${msg}`,
    }
  }

  const sourceInfo = {
    title: (sourceDash as any).title || '(untitled)',
    tile_count: ((sourceDash as any).dashboard_elements || []).length,
    filter_count: ((sourceDash as any).dashboard_filters || []).length,
  }

  // Step 3: Import as UDD
  let importedDash: any
  try {
    importedDash = await sdk.ok(
      sdk.import_lookml_dashboard(lookmlDashboardId, folderId)
    )
  } catch (err: any) {
    const msg = err.message || String(err)
    return {
      status: 'import_failed',
      lookml_dashboard_id: lookmlDashboardId,
      source: sourceInfo,
      error: msg,
      hint: msg.includes('already exists')
        ? 'A UDD imported from this LookML dashboard may already exist in this folder. ' +
          'Check the folder or use a different folder_id.'
        : `Import failed: ${msg}. The LookML dashboard exists (${sourceInfo.tile_count} tiles) ` +
          'but could not be cloned. Check folder permissions.',
    }
  }

  // Step 4: Verify the import — read back the UDD to confirm tiles/filters copied
  const importedId = String(importedDash.id)
  let verification: any
  try {
    const [elements, filters] = await Promise.all([
      sdk.ok(sdk.dashboard_dashboard_elements(importedId, '')),
      sdk.ok(sdk.dashboard_dashboard_filters(importedId, '')),
    ])
    verification = {
      tile_count: (elements as any[]).length,
      filter_count: (filters as any[]).length,
      tiles_match: (elements as any[]).length === sourceInfo.tile_count,
      filters_match: (filters as any[]).length === sourceInfo.filter_count,
    }
  } catch {
    verification = { warning: 'Could not verify imported dashboard — inspect it manually.' }
  }

  const baseUrl = (process.env.LOOKER_BASE_URL || '').replace(/\/+$/, '')

  return {
    status: 'success',
    lookml_dashboard_id: lookmlDashboardId,
    imported_dashboard: {
      id: importedId,
      title: importedDash.title,
      url: `${baseUrl}/dashboards/${importedId}`,
      folder_id: folderId,
    },
    source: sourceInfo,
    verification,
    mode: session.currentMode(),
    branch: session.currentBranch(),
    next_steps: [
      `inspect ${importedId} — verify tiles and filters`,
      `run_tile on any tile to check data`,
      'Use update_tile / create_tile / update_filter to iterate',
      'When satisfied, port changes back to .dashboard.lookml and commit',
    ],
  }
}
