#!/usr/bin/env node

/**
 * Looker Dev Tools — MCP Server Entry Point
 *
 * Unified MCP server that merges:
 *   - Our custom shim tools (inspect, run_tile, mutations, execute_sdk_code, render_*, …)
 *   - ALL upstream @toolbox-sdk/server tools (41+ from looker + looker-dev prebuilts)
 *
 * Upstream tools are discovered dynamically at startup via MCP client bridge.
 * If upstream is unavailable, shim tools still work independently.
 *
 * Subcommands:
 *   looker-mcp-shim                  # stdio transport (default — for native MCP clients)
 *   looker-mcp-shim serve            # HTTP Streamable transport on PORT (default 3000)
 *   looker-mcp-shim install-skill    # install agent skill docs into .claude/skills/
 *
 * Environment variables (stdio + http):
 *   SKIP_UPSTREAM=1                  # disable upstream bridge, run shim tools only
 *   LOOKER_BASE_URL, LOOKER_CLIENT_ID, LOOKER_CLIENT_SECRET   # Looker API auth
 *
 * Environment variables (serve only):
 *   PORT          # default 3000
 *   HOST          # default 127.0.0.1
 *   MCP_APIKEY    # if set, requires ?apikey=KEY on /mcp requests
 *
 * Examples:
 *   npx tsx src/index.ts                                  # stdio mode
 *   SKIP_UPSTREAM=1 npx tsx src/index.ts                  # stdio, shim-only
 *   npx tsx src/index.ts serve                            # HTTP on 127.0.0.1:3000
 *   PORT=4000 HOST=0.0.0.0 node dist/index.js serve       # HTTP, public
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { bootstrap, buildServer } from './server-factory.js'

const subcommand = process.argv[2]

if (subcommand === 'install-skill') {
  await import('./install-skill.js')
  process.exit(0)
}

if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
  console.log(`Looker Dev Tools — MCP server with stdio + HTTP transports.

Usage:
  looker-mcp-shim                  Run as stdio MCP server (default)
  looker-mcp-shim serve            Run as HTTP Streamable MCP server
  looker-mcp-shim install-skill    Install skill docs into .claude/skills/
  looker-mcp-shim --help           Show this help

Env (all modes):  SKIP_UPSTREAM, LOOKER_BASE_URL, LOOKER_CLIENT_ID, LOOKER_CLIENT_SECRET
Env (serve only): PORT (3000), HOST (127.0.0.1), MCP_APIKEY (optional auth)
`)
  process.exit(0)
}

if (subcommand === 'serve') {
  const { startHttp } = await import('./http-transport.js')
  await startHttp()
} else {
  // Default: stdio transport
  console.error('[looker-dev-tools] Starting MCP server (stdio transport)…')
  const ctx = await bootstrap()
  const server = buildServer(ctx)

  process.on('SIGINT', async () => {
    await ctx.upstream.close()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    await ctx.upstream.close()
    process.exit(0)
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(
    `[looker-dev-tools] MCP server running on stdio — ${ctx.allToolDefs.length} tools registered`,
  )
}
