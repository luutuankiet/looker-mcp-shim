#!/usr/bin/env node

/**
 * Looker Dev Tools — MCP Server Entry Point
 *
 * Provides AI agents with Looker development tools via MCP protocol.
 * Supports stdio transport (native MCP) and passthru testing via mcp-proxy-shim.
 *
 * Usage:
 *   npx tsx src/index.ts                          # stdio mode
 *   npx @luutuankiet/mcp-proxy-shim passthru -- npx tsx src/index.ts  # REST testing
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { createSession, type Session } from './core.js'

// Import tool modules
import * as sessionTools from './tools/session.js'
import * as gitTools from './tools/git.js'
import * as inspectTools from './tools/inspect.js'
import * as queryTools from './tools/query.js'
import * as executeTools from './tools/execute.js'

// All tool modules
const toolModules = [sessionTools, gitTools, inspectTools, queryTools, executeTools]

// Collect all tool definitions
const allToolDefs = toolModules.flatMap((mod) => mod.tools)

// Find handler for a given tool name
function findHandler(toolName: string) {
  for (const mod of toolModules) {
    if (mod.tools.some((t: any) => t.name === toolName)) {
      return mod.handle
    }
  }
  return null
}

async function main() {
  console.error('[looker-dev-tools] Starting MCP server...')

  // Initialize Looker session (auth + dev mode)
  let session: Session
  try {
    session = await createSession()
  } catch (err: any) {
    console.error('[looker-dev-tools] Fatal: Failed to create Looker session:', err.message)
    process.exit(1)
  }

  // Create MCP server
  const server = new Server(
    { name: 'looker-dev-tools', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  // List all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefs,
  }))

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const handler = findHandler(name)
    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      }
    }

    try {
      const result = await handler(name, args || {}, session)
      const text =
        typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return {
        content: [{ type: 'text' as const, text }],
      }
    } catch (error: any) {
      console.error(`[looker-dev-tools] Tool error (${name}):`, error.message)
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
        isError: true,
      }
    }
  })

  // Connect stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(
    `[looker-dev-tools] MCP server running on stdio — ${allToolDefs.length} tools registered`
  )
}

main().catch((err) => {
  console.error('[looker-dev-tools] Fatal:', err)
  process.exit(1)
})
