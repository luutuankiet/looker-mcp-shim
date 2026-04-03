/**
 * Upstream MCP Bridge — Spawns @toolbox-sdk/server as a child process,
 * connects via MCP client, discovers tools dynamically, and proxies calls.
 *
 * This lets us expose ONE MCP server that merges our custom shim tools
 * with ALL upstream Looker MCP tools (41+ from looker + looker-dev prebuilts).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

/**
 * Upstream tools that overlap with our hand-rolled shim tools.
 * Key = upstream tool name, Value = preferred shim tool + reason.
 *
 * When an upstream tool matches, its description gets a loud warning
 * steering the agent toward the shim equivalent. Agents that skip
 * skill docs and go straight to retrieve_tools still see the warning
 * at the exact moment they're deciding which tool to call.
 */
const SHIM_PREFERRED: Record<string, string> = {
  run_dashboard:
    'run_tile — per-tile data with filter auto-wiring, ordinal refs (#1), title matching, async fallback. run_dashboard returns bulk data without tile context.',
  query_sql:
    'run_tile (format: "sql") or run_query — has filter auto-wiring + async fallback. query_sql requires manual filter construction.',
  query:
    'run_tile or run_query — has filter auto-wiring, dashboard context, async fallback. Raw query requires manual filter/explore setup.',
  make_dashboard:
    'create_tile + create_filter — handles two-step query creation automatically. make_dashboard is coarse-grained.',
  make_look:
    'run_query or execute_sdk_code — more flexible for agent workflows.',
  dev_mode:
    'switch_mode — supports branch selection, wildcard branches, and mode confirmation in one call.',
  validate_project:
    'validate — returns structured file:line errors, not raw validation output.',
  get_dashboards:
    'inspect — URL-smart input, two-level depth control, token-efficient summaries.',
  get_looks:
    'inspect — URL-smart input with look URL support.',
  run_look:
    'run_tile or run_query — has filter auto-wiring and async fallback.',
}

export interface UpstreamBridge {
  tools: Tool[]
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  close: () => Promise<void>
}

export interface UpstreamConfig {
  /** NPX package to run (default: @toolbox-sdk/server@latest) */
  command?: string
  /** Args for upstream server (default: ['--stdio', '--prebuilt=looker,looker-dev']) */
  args?: string[]
  /** Env vars to pass (inherits LOOKER_* from process.env by default) */
  env?: Record<string, string>
  /** Prefix to add to upstream tool names to avoid collisions (default: none) */
  toolPrefix?: string
  /** Timeout for upstream connection in ms (default: 30000) */
  connectTimeout?: number
}

/**
 * Default config: spawn @toolbox-sdk/server with looker + looker-dev prebuilts.
 * Env vars are forwarded from the parent process.
 */
function getDefaultConfig(): Required<UpstreamConfig> {
  return {
    command: 'npx',
    args: ['-y', '@toolbox-sdk/server@latest', '--stdio', '--prebuilt=looker,looker-dev'],
    env: {
      LOOKER_BASE_URL: process.env.LOOKER_BASE_URL || '',
      LOOKER_CLIENT_ID: process.env.LOOKER_CLIENT_ID || '',
      LOOKER_CLIENT_SECRET: process.env.LOOKER_CLIENT_SECRET || '',
      // Forward PATH + NODE for npx to work
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    toolPrefix: '',
    connectTimeout: 30000,
  }
}

/**
 * Connect to upstream MCP server, discover tools, return bridge.
 * If upstream fails to connect (not installed, auth error, etc.),
 * returns a bridge with zero tools — our shim tools still work.
 */
export async function connectUpstream(
  userConfig?: UpstreamConfig
): Promise<UpstreamBridge> {
  const cfg = { ...getDefaultConfig(), ...userConfig }

  // Merge user env with defaults (user wins)
  if (userConfig?.env) {
    cfg.env = { ...getDefaultConfig().env, ...userConfig.env }
  }

  const client = new Client(
    { name: 'looker-mcp-shim-bridge', version: '0.1.0' },
    { capabilities: {} }
  )

  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
    stderr: 'pipe',
  })

  let upstreamTools: Tool[] = []
  const toolMap = new Map<string, string>() // prefixed name -> original name

  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upstream connection timeout')), cfg.connectTimeout)
      ),
    ])

    const result = await client.listTools()
    upstreamTools = (result.tools || []).map((t: Tool) => {
      const prefixedName = cfg.toolPrefix ? `${cfg.toolPrefix}${t.name}` : t.name
      toolMap.set(prefixedName, t.name)

      // If a hand-rolled shim tool exists for this upstream tool,
      // prepend a loud warning so agents prefer the shim even if
      // they skip skill docs and go straight to tool discovery.
      const shimAlt = SHIM_PREFERRED[t.name]
      const desc = t.description || t.name
      const prefix = shimAlt
        ? `⚠️ UPSTREAM FALLBACK — prefer ${shimAlt.split(' — ')[0]} instead. ${shimAlt}. Only use this if the shim tool cannot accomplish your task. Original: `
        : '[upstream] '

      return {
        ...t,
        name: prefixedName,
        description: `${prefix}${desc}`,
      }
    })

    console.error(
      `[looker-dev-tools] Upstream bridge connected: ${upstreamTools.length} tools from @toolbox-sdk/server`
    )
  } catch (err: any) {
    console.error(
      `[looker-dev-tools] Upstream bridge failed (shim tools still available): ${err.message}`
    )
    return {
      tools: [],
      callTool: async () => { throw new Error('Upstream not connected') },
      close: async () => {},
    }
  }

  return {
    tools: upstreamTools,

    callTool: async (name: string, args: Record<string, unknown>) => {
      const originalName = toolMap.get(name) || name
      const result = await client.callTool({ name: originalName, arguments: args })
      return result
    },

    close: async () => {
      try {
        await client.close()
      } catch {
        // Child process may already be gone
      }
    },
  }
}
