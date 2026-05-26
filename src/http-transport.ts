/**
 * HTTP Streamable Transport for looker-mcp-shim.
 *
 * Exposes the MCP server over HTTP at POST/GET/DELETE /mcp using
 * `StreamableHTTPServerTransport` from the MCP SDK. Each downstream client
 * gets its own MCP Server + Transport pair, but they all share a single
 * process-level Looker session + upstream bridge (see server-factory.ts).
 *
 * Architecture:
 *   Remote Agent  ──HTTP──▶  this server (:3000/mcp)  ───▶  Looker API (via @looker/sdk)
 *                                                       └──▶  @toolbox-sdk/server (child process)
 *
 * Environment variables:
 *   PORT         (optional)  Port to listen on (default: 3000)
 *   HOST         (optional)  Host to bind to (default: 127.0.0.1)
 *   MCP_APIKEY   (optional)  When set, requests must include ?apikey=KEY.
 *                            Unset = open (intended for localhost / reverse-proxy auth).
 *
 * Usage:
 *   looker-mcp-shim serve                # listens on 127.0.0.1:3000
 *   PORT=4000 HOST=0.0.0.0 looker-mcp-shim serve
 *
 * Point your MCP client at:  http://localhost:3000/mcp
 *
 * For production-grade deployment, front this with Caddy/nginx for TLS:
 *   https://looker-shim.yourdomain.com/mcp  ──▶  http://localhost:3000/mcp
 */

import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { bootstrap, buildServer, type ServerContext } from './server-factory.js'

const log = (...args: unknown[]) => console.error('[looker-dev-tools:http]', ...args)

const transports = new Map<string, StreamableHTTPServerTransport>()

async function createSessionTransport(ctx: ServerContext): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      log(`session initialized: ${sessionId.slice(0, 12)}…`)
      transports.set(sessionId, transport)
    },
  })

  transport.onclose = () => {
    const sid = transport.sessionId
    if (sid && transports.has(sid)) {
      log(`session closed: ${sid.slice(0, 12)}…`)
      transports.delete(sid)
    }
  }

  const server = buildServer(ctx)
  await server.connect(transport)
  return transport
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(raw ? JSON.parse(raw) : null)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  // CORS — permissive by default. Tighten via reverse proxy if needed.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Last-Event-ID')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined

  try {
    if (req.method === 'POST') {
      const body = await parseBody(req)

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!
        await transport.handleRequest(req, res, body)
      } else if (!sessionId && isInitializeRequest(body)) {
        const transport = await createSessionTransport(ctx)
        await transport.handleRequest(req, res, body)
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          }),
        )
      }
    } else if (req.method === 'GET') {
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid or missing session ID')
        return
      }
      const lastEventId = req.headers['last-event-id']
      if (lastEventId) log(`client reconnecting with Last-Event-ID: ${lastEventId}`)
      const transport = transports.get(sessionId)!
      await transport.handleRequest(req, res)
    } else if (req.method === 'DELETE') {
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid or missing session ID')
        return
      }
      log(`session termination: ${sessionId.slice(0, 12)}…`)
      const transport = transports.get(sessionId)!
      await transport.handleRequest(req, res)
    } else {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method Not Allowed')
    }
  } catch (error) {
    log('handler error:', (error as Error).message)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }),
      )
    }
  }
}

export async function startHttp(): Promise<void> {
  const PORT = parseInt(process.env.PORT || '3000', 10)
  const HOST = process.env.HOST || '127.0.0.1'
  const APIKEY = process.env.MCP_APIKEY || null

  log(`starting HTTP Streamable server on ${HOST}:${PORT}`)
  log(`auth: ${APIKEY ? 'apikey required (?apikey=…)' : 'OPEN (no MCP_APIKEY set)'}`)

  const ctx = await bootstrap()

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      if (APIKEY && url.searchParams.get('apikey') !== APIKEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized: invalid or missing apikey' },
            id: null,
          }),
        )
        return
      }
      handleMcpRequest(req, res, ctx).catch((err) => {
        log('unhandled error in MCP handler:', (err as Error).message)
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('Internal Server Error')
        }
      })
    } else if (url.pathname === '/health' || url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          sessions: transports.size,
          tools: ctx.allToolDefs.length,
          uptime: process.uptime(),
        }),
      )
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found — MCP endpoint is at /mcp, health at /health')
    }
  })

  httpServer.listen(PORT, HOST, () => {
    log(`listening on http://${HOST}:${PORT}/mcp`)
    log(`health check: http://${HOST}:${PORT}/health`)
  })

  const shutdown = async () => {
    log('shutting down…')
    for (const [sid, transport] of transports) {
      try {
        log(`closing session ${sid.slice(0, 12)}…`)
        await transport.close()
      } catch (err) {
        log(`error closing session ${sid.slice(0, 12)}:`, (err as Error).message)
      }
    }
    transports.clear()
    await ctx.upstream.close()
    httpServer.close(() => {
      log('stopped')
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 5000).unref()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
