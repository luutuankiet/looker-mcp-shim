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
      return {
        ...t,
        name: prefixedName,
        description: t.description
          ? `[upstream] ${t.description}`
          : `[upstream] ${t.name}`,
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
