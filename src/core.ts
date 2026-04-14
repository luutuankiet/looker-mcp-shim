/**
 * Looker Dev Tools — Core Session Manager + Safety Layer
 *
 * Handles: SDK auth from .env, dev/prod mode toggle, branch switching,
 * auto token refresh, blocked methods, safe SDK proxy.
 */

import { config } from 'dotenv'
config()

// Bridge our env var names to what @looker/sdk-node expects (LOOKERSDK_* prefix)
process.env.LOOKERSDK_BASE_URL = process.env.LOOKER_BASE_URL || ''
process.env.LOOKERSDK_CLIENT_ID = process.env.LOOKER_CLIENT_ID || ''
process.env.LOOKERSDK_CLIENT_SECRET = process.env.LOOKER_CLIENT_SECRET || ''

import { LookerNodeSDK } from '@looker/sdk-node'
import type { Looker40SDK } from '@looker/sdk'

// --- Configuration from .env ---

export const CONFIG = {
  projectId: process.env.LOOKER_PROJECT_ID || '',
  /** Branches the agent can switch_mode to. '*' = any branch (default). */
  allowedBranches: (process.env.LOOKER_ALLOWED_BRANCHES || '*')
    .split(',')
    .map(b => b.trim())
    .filter(Boolean),
  /** Branches that reset_to_remote can wipe. Must be explicitly listed — no default.
   *  This is deliberately separate from allowedBranches — switching is safe, resetting is destructive. */
  resetBranches: (process.env.LOOKER_RESET_BRANCHES || '')
    .split(',')
    .map(b => b.trim())
    .filter(Boolean),
  sandboxFolderId: process.env.LOOKER_SANDBOX_FOLDER_ID || undefined,
}

// --- Blocked SDK Methods (NON-NEGOTIABLE) ---

const BLOCKED_METHODS = new Set([
  // CRITICAL — production deployment
  'deploy_ref_to_production',
  'deploy_to_production',
  // CRITICAL — user impersonation
  'login_user',
  // Destructive admin ops
  'delete_group', 'create_group', 'update_group',
  'delete_user_attribute',
  'delete_role',
  'delete_folder',
  'delete_dashboard',
  'delete_look',
  'update_user',
  // Schedule/delivery manipulation
  'delete_scheduled_plan',
  'update_scheduled_plan',
  'create_scheduled_plan',
])

// --- Safe SDK Proxy ---

function createSafeSdk(sdk: Looker40SDK): Looker40SDK {
  return new Proxy(sdk, {
    get(target: any, prop: string | symbol) {
      if (typeof prop === 'string' && BLOCKED_METHODS.has(prop)) {
        return (..._args: unknown[]) => {
          throw new Error(`BLOCKED: ${prop} is not allowed — could affect production`)
        }
      }
      const value = target[prop]
      if (typeof value === 'function') {
        return value.bind(target)
      }
      return value
    }
  }) as Looker40SDK
}

// --- Session Interface ---

export interface Session {
  sdk: Looker40SDK
  safeSdk: Looker40SDK
  switchMode: (mode: 'dev' | 'prod', branch?: string) => Promise<{ mode: string; branch: string | null }>
  resetToRemote: () => Promise<{ success: boolean; message: string }>
  validate: () => Promise<unknown>
  currentMode: () => string
  currentBranch: () => string | null
  projectId: string
  config: typeof CONFIG
}

// --- Session State ---

let _currentMode: 'dev' | 'prod' = 'dev'
let _currentBranch: string | null = null

// --- Session Factory ---

export async function createSession(): Promise<Session> {
  const sdk = LookerNodeSDK.init40()
  const safeSdk = createSafeSdk(sdk)

  // Verify auth by fetching current user
  const user = await sdk.ok(sdk.me()) as any
  console.error(`[looker-dev-tools] Authenticated as: ${user.display_name || user.email || 'unknown'}`)

  // Default: enter dev mode (skip if API key lacks permission or env override)
  const skipDevMode = process.env.LOOKER_SKIP_DEV_MODE === '1'
  if (skipDevMode) {
    console.error('[looker-dev-tools] Skipping dev mode (LOOKER_SKIP_DEV_MODE=1)')
    _currentMode = 'prod'
  } else {
    try {
      await sdk.ok(sdk.update_session({ workspace_id: 'dev' }))
      _currentMode = 'dev'
    } catch (e: any) {
      console.error(`[looker-dev-tools] Warning: could not enter dev mode (${e.message}), continuing in production mode`)
      _currentMode = 'prod'
    }
  }

  // Auto-detect current branch from Looker — zero config, respects user's Looker UI selection
  if (_currentMode === 'dev') {
    try {
      const branchInfo = await sdk.ok(sdk.git_branch(CONFIG.projectId)) as any
      _currentBranch = branchInfo.name || null
      if (_currentBranch) {
        console.error(`[looker-dev-tools] Dev mode: branch ${_currentBranch}`)
      } else {
        console.error('[looker-dev-tools] Dev mode: personal dev branch (no named branch)')
      }
    } catch (e: any) {
      console.error(`[looker-dev-tools] Warning: could not detect branch: ${e.message}`)
      _currentBranch = null
    }
  }

  // --- Mode switching ---
  const switchMode = async (
    mode: 'dev' | 'prod',
    branch?: string
  ): Promise<{ mode: string; branch: string | null }> => {
    if (mode === 'dev' && branch) {
      const wildcard = CONFIG.allowedBranches.includes('*')
      if (!wildcard && !CONFIG.allowedBranches.includes(branch)) {
        throw new Error(
          `Branch "${branch}" is not in LOOKER_ALLOWED_BRANCHES: [${CONFIG.allowedBranches.join(', ')}]. ` +
          `Set LOOKER_ALLOWED_BRANCHES=* to allow any branch, or add it explicitly.`
        )
      }
    }

    const workspaceId = mode === 'dev' ? 'dev' : 'production'
    await sdk.ok(sdk.update_session({ workspace_id: workspaceId }))
    _currentMode = mode

    if (mode === 'dev') {
      if (branch) {
        await sdk.ok(sdk.update_git_branch(CONFIG.projectId, { name: branch }))
        _currentBranch = branch
      } else {
        // No branch specified — stay on current, just re-detect
        const branchInfo = await sdk.ok(sdk.git_branch(CONFIG.projectId)) as any
        _currentBranch = branchInfo.name || null
      }
      return { mode, branch: _currentBranch }
    }

    _currentBranch = null
    return { mode, branch: null }
  }

  // --- Reset to remote ---
  const resetToRemote = async (): Promise<{ success: boolean; message: string }> => {
    if (_currentMode !== 'dev') {
      throw new Error('reset_to_remote only works in dev mode. Switch to dev first.')
    }
    // Safety: only allow reset on explicitly approved branches
    if (_currentBranch && !CONFIG.resetBranches.includes(_currentBranch)) {
      throw new Error(
        `BLOCKED: reset_to_remote on branch "${_currentBranch}" is not allowed. ` +
        `Safe branches for reset: [${CONFIG.resetBranches.join(', ')}]. ` +
        `Set LOOKER_RESET_BRANCHES to add this branch, or switch to a safe branch first.`
      )
    }
    await sdk.ok(sdk.reset_project_to_remote(CONFIG.projectId))
    return { success: true, message: `Reset ${CONFIG.projectId} (branch: ${_currentBranch}) to remote HEAD` }
  }

  // --- LookML validation ---
  const validate = async (): Promise<unknown> => {
    const result = await sdk.ok(sdk.validate_project(CONFIG.projectId)) as any
    const errors = result.errors || []
    if (errors.length === 0) {
      return { status: 'ok', message: 'No LookML errors found', stale_content: result.stale_content }
    }
    return {
      status: 'errors',
      error_count: errors.length,
      errors: errors.map((e: any) => ({
        severity: e.severity,
        kind: e.kind,
        message: e.message,
        source_file: e.source_file,
        line: e.line,
      })),
      stale_content: result.stale_content,
    }
  }

  return {
    sdk,
    safeSdk,
    switchMode,
    resetToRemote,
    validate,
    currentMode: () => _currentMode,
    currentBranch: () => _currentBranch,
    projectId: CONFIG.projectId,
    config: CONFIG,
  }
}
