#!/usr/bin/env node

// Subcommand routing
if (process.argv[2] === 'install-skill') {
  await import('./install-skill.js')
  process.exit(0)
}

/**
 * Looker Dev Tools — MCP Server Entry Point
 *
 * Unified MCP server that merges:
 * - Our custom shim tools (inspect, run_tile, mutations, execute_sdk_code, etc.)
 * - ALL upstream @toolbox-sdk/server tools (41+ from looker + looker-dev prebuilts)
 *
 * Upstream tools are dynamically discovered at startup via MCP client bridge.
 * If upstream is unavailable, shim tools still work independently.
 *
 * Usage:
 *   npx tsx src/index.ts                          # stdio mode (upstream auto-detected)
 *   SKIP_UPSTREAM=1 npx tsx src/index.ts          # shim-only mode
 *   npx @luutuankiet/mcp-proxy-shim passthru -- npx tsx src/index.ts  # REST testing
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { createSession, type Session } from './core.js'
import { connectUpstream, type UpstreamBridge } from './upstream.js'

// Shim tool modules (our custom tools)
import * as sessionTools from './tools/session.js'
import * as gitTools from './tools/git.js'
import * as inspectTools from './tools/inspect.js'
import * as queryTools from './tools/query.js'
import * as executeTools from './tools/execute.js'
import * as dashboardTools from './tools/dashboard.js'
import * as sdkCatalogTools from './tools/sdk-catalog.js'
import * as lookmlDashboardTools from './tools/lookml-dashboard.js'
import { loadCatalog } from './tools/sdk-catalog.js'

const toolModules = [sessionTools, gitTools, inspectTools, queryTools, executeTools, dashboardTools, sdkCatalogTools, lookmlDashboardTools]

// Collect shim tool definitions
const shimToolDefs = toolModules.flatMap((mod) => mod.tools)
const shimToolNames = new Set(shimToolDefs.map((t) => t.name))

function findShimHandler(toolName: string) {
  for (const mod of toolModules) {
    if (mod.tools.some((t: any) => t.name === toolName)) {
      return mod.handle
    }
  }
  return null
}

async function main() {
  console.error('[looker-dev-tools] Starting MCP server...')

  // 1. Initialize Looker session (auth + dev mode)
  let session: Session
  try {
    session = await createSession()
  } catch (err: any) {
    console.error('[looker-dev-tools] Fatal: Failed to create Looker session:', err.message)
    process.exit(1)
  }

  // 2. Load SDK method catalog from Looker swagger.json (non-blocking)
  loadCatalog(process.env.LOOKER_BASE_URL || '').catch(() => {})

  // 3. Connect upstream MCP bridge (unless SKIP_UPSTREAM=1)
  let upstream: UpstreamBridge = {
    tools: [],
    callTool: async () => { throw new Error('No upstream') },
    close: async () => {},
  }
  if (!process.env.SKIP_UPSTREAM) {
    try {
      upstream = await connectUpstream()
    } catch (err: any) {
      console.error(`[looker-dev-tools] Upstream bridge error (continuing without): ${err.message}`)
    }
  } else {
    console.error('[looker-dev-tools] SKIP_UPSTREAM=1 \u2014 shim-only mode')
  }

  // 3. Merge tool lists: shim tools first, upstream tools that don't collide
  const upstreamFiltered = upstream.tools.filter((t) => !shimToolNames.has(t.name))
  const allToolDefs = [...shimToolDefs, ...upstreamFiltered]
  const upstreamToolNames = new Set(upstreamFiltered.map((t) => t.name))

  console.error(
    `[looker-dev-tools] Tool surface: ${shimToolDefs.length} shim + ${upstreamFiltered.length} upstream = ${allToolDefs.length} total`
  )

  // 4. Create MCP server
  const server = new Server(
    { name: 'looker-dev-tools', version: '0.3.3' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefs,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    // Route: shim handler takes priority, then upstream
    const shimHandler = findShimHandler(name)
    if (shimHandler) {
      try {
        const result = await shimHandler(name, args || {}, session)
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        return { content: [{ type: 'text' as const, text }] }
      } catch (error: any) {
        console.error(`[looker-dev-tools] Tool error (${name}):`, error.message)
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        }
      }
    }

    if (upstreamToolNames.has(name)) {
      try {
        const result = await upstream.callTool(name, args || {}) as any
        // Upstream returns MCP CallToolResult shape \u2014 pass through directly
        if (result?.content) return result
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        return { content: [{ type: 'text' as const, text }] }
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

  // 5. Graceful shutdown \u2014 close upstream bridge
  process.on('SIGINT', async () => {
    await upstream.close()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    await upstream.close()
    process.exit(0)
  })

  // 6. Connect stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(
    `[looker-dev-tools] MCP server running on stdio \u2014 ${allToolDefs.length} tools registered`
  )
}

main().catch((err) => {
  console.error('[looker-dev-tools] Fatal:', err)
  process.exit(1)
})
