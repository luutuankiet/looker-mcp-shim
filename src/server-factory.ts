/**
 * Server Factory — shared bootstrap + Server builder used by all transports.
 *
 * Process-level singletons (one per process, regardless of transport):
 *   - Looker session  (auth, dev/prod mode, token refresh)
 *   - Upstream MCP bridge (spawned child process exposing 41+ tools)
 *   - Merged tool definition list
 *
 * Per-connection ephemera:
 *   - A fresh @modelcontextprotocol/sdk Server instance with handlers wired.
 *
 * Why split: HTTP Streamable transport creates one Server per client session,
 * but we want only ONE Looker auth + ONE upstream child process per node.
 * Stdio mode just calls buildServer() once. Both paths share the rest.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { createSession, type Session } from './core.js'
import { connectUpstream, type UpstreamBridge } from './upstream.js'
import { wrapShimResult, wrapUpstreamResult, hasNonTextContent } from './util/mcp-result.js'

import * as sessionTools from './tools/session.js'
import * as gitTools from './tools/git.js'
import * as inspectTools from './tools/inspect.js'
import * as queryTools from './tools/query.js'
import * as executeTools from './tools/execute.js'
import * as dashboardTools from './tools/dashboard.js'
import * as sdkCatalogTools from './tools/sdk-catalog.js'
import * as lookmlDashboardTools from './tools/lookml-dashboard.js'
import * as renderTools from './tools/render.js'
import { loadCatalog } from './tools/sdk-catalog.js'

const toolModules = [
  sessionTools,
  gitTools,
  inspectTools,
  queryTools,
  executeTools,
  dashboardTools,
  sdkCatalogTools,
  lookmlDashboardTools,
  renderTools,
]

function findShimHandler(toolName: string) {
  for (const mod of toolModules) {
    if (mod.tools.some((t: any) => t.name === toolName)) {
      return mod.handle
    }
  }
  return null
}

export interface ServerContext {
  session: Session
  upstream: UpstreamBridge
  /** Tool definitions: shim tools first, then non-colliding upstream tools */
  allToolDefs: any[]
  /** Names of upstream-bridged tools (for routing decision) */
  upstreamToolNames: Set<string>
}

/**
 * Process-level bootstrap. Call ONCE per process.
 *
 * Initializes Looker session, kicks off (non-blocking) SDK catalog load,
 * connects upstream bridge unless SKIP_UPSTREAM=1, and merges the tool list.
 */
export async function bootstrap(): Promise<ServerContext> {
  let session: Session
  try {
    session = await createSession()
  } catch (err: any) {
    console.error('[looker-dev-tools] Fatal: Failed to create Looker session:', err.message)
    process.exit(1)
  }

  // Non-blocking — agents may call retrieve_sdk_methods before this completes
  loadCatalog(process.env.LOOKER_BASE_URL || '').catch(() => {})

  let upstream: UpstreamBridge = {
    tools: [],
    callTool: async () => {
      throw new Error('No upstream')
    },
    close: async () => {},
  }
  if (!process.env.SKIP_UPSTREAM) {
    try {
      upstream = await connectUpstream()
    } catch (err: any) {
      console.error(
        `[looker-dev-tools] Upstream bridge error (continuing without): ${err.message}`,
      )
    }
  } else {
    console.error('[looker-dev-tools] SKIP_UPSTREAM=1 — shim-only mode')
  }

  const shimToolDefs = toolModules.flatMap((mod) => mod.tools)
  const shimToolNames = new Set(shimToolDefs.map((t) => t.name))
  const upstreamFiltered = upstream.tools.filter((t) => !shimToolNames.has(t.name))
  const allToolDefs = [...shimToolDefs, ...upstreamFiltered]
  const upstreamToolNames = new Set(upstreamFiltered.map((t) => t.name))

  console.error(
    `[looker-dev-tools] Tool surface: ${shimToolDefs.length} shim + ${upstreamFiltered.length} upstream = ${allToolDefs.length} total`,
  )

  return { session, upstream, allToolDefs, upstreamToolNames }
}

/**
 * Build a fresh MCP Server instance.
 *
 * Stdio transport: called once. HTTP Streamable transport: called per
 * downstream session. Either way, the Server is cheap — it's just request
 * handlers — and all the expensive state lives in ServerContext.
 */
export function buildServer(ctx: ServerContext): Server {
  const server = new Server(
    { name: 'looker-dev-tools', version: '0.6.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ctx.allToolDefs,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const shimHandler = findShimHandler(name)
    if (shimHandler) {
      try {
        const result = await shimHandler(name, args || {}, ctx.session)
        if (hasNonTextContent(result)) return result as any
        return wrapShimResult(result)
      } catch (error: any) {
        console.error(`[looker-dev-tools] Tool error (${name}):`, error.message)
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        }
      }
    }

    if (ctx.upstreamToolNames.has(name)) {
      try {
        const result = await ctx.upstream.callTool(name, args || {})
        return wrapUpstreamResult(result)
      } catch (error: any) {
        console.error(`[looker-dev-tools] Upstream tool error (${name}):`, error.message)
        return {
          content: [{ type: 'text' as const, text: `Error (upstream): ${error.message}` }],
          isError: true,
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    }
  })

  return server
}
