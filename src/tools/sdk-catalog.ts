/**
 * SDK Method Catalog — Dynamic API reference from Looker swagger.json
 *
 * Fetches the OpenAPI spec from the Looker instance at startup,
 * builds a searchable catalog of all 469 SDK methods.
 *
 * Tools:
 * - retrieve_sdk_methods: keyword search, returns compact list
 * - describe_sdk_method: hydrate full details for a specific method
 */

import type { Session } from '../core.js'

interface MethodEntry {
  name: string           // operationId = SDK method name
  summary: string        // one-line description
  description: string    // full description
  tags: string[]         // category tags
  httpMethod: string     // GET, POST, PATCH, DELETE
  path: string           // API path
  parameters: {
    name: string
    in: string           // path, query, body
    type?: string
    required: boolean
    description?: string
  }[]
  bodySchema?: string    // body parameter type name
  responseType?: string  // success response type
}

let catalog: MethodEntry[] = []
let catalogReady = false

/**
 * Load swagger.json from the Looker instance and build catalog.
 * Called once at server startup. Non-blocking — tools return
 * helpful error if catalog isn't ready yet.
 */
export async function loadCatalog(baseUrl: string): Promise<void> {
  try {
    const url = `${baseUrl}/api/4.0/swagger.json`
    console.error(`[looker-dev-tools] Loading SDK catalog from ${url}...`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const spec = await res.json() as any

    catalog = []
    for (const [path, methods] of Object.entries(spec.paths || {})) {
      for (const [httpMethod, opRaw] of Object.entries(methods as any)) {
        const op = opRaw as any
        if (!op.operationId) continue
        const params = (op.parameters || []).map((p: any) => ({
          name: p.name,
          in: p.in,
          type: p.type || (p.schema?.$ref?.split('/')?.pop()) || (p.schema?.type) || 'object',
          required: !!p.required,
          description: p.description || '',
        }))

        const bodyParam = params.find((p: any) => p.in === 'body')
        const successResp = op.responses?.['200'] || op.responses?.['204']
        const responseRef = successResp?.schema?.$ref?.split('/')?.pop()
          || successResp?.schema?.items?.$ref?.split('/')?.pop()

        catalog.push({
          name: op.operationId,
          summary: op.summary || '',
          description: op.description || '',
          tags: op.tags || [],
          httpMethod: httpMethod.toUpperCase(),
          path,
          parameters: params,
          bodySchema: bodyParam?.type,
          responseType: responseRef || 'string',
        })
      }
    }

    catalogReady = true
    console.error(`[looker-dev-tools] SDK catalog loaded: ${catalog.length} methods`)
  } catch (err: any) {
    console.error(`[looker-dev-tools] Failed to load SDK catalog: ${err.message}`)
  }
}

export const tools = [
  {
    name: 'retrieve_sdk_methods',
    description:
      'Search the Looker SDK method catalog by keyword. Returns compact list of matching methods ' +
      'with name, summary, and tags. Use this to discover which SDK methods are available, then ' +
      'call describe_sdk_method to get full details before writing execute_sdk_code.\n\n' +
      'Examples:\n' +
      '  retrieve_sdk_methods({query: "dashboard"})\n' +
      '  retrieve_sdk_methods({query: "schedule plan", tag: "ScheduledPlan"})\n' +
      '  retrieve_sdk_methods({tag: "Query"})\n' +
      '  retrieve_sdk_methods({query: "render png"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keyword search across method names, summaries, descriptions',
        },
        tag: {
          type: 'string',
          description: 'Filter by API tag/category (e.g. Dashboard, Query, Look, Folder, LookmlModel, Project)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
    },
  },
  {
    name: 'describe_sdk_method',
    description:
      'Get full details for a specific SDK method: parameters, types, description, HTTP endpoint, ' +
      'and a ready-to-use code example for execute_sdk_code.\n\n' +
      'Always call this before writing execute_sdk_code to get the exact parameter shape.\n\n' +
      'Example: describe_sdk_method({method: "scheduled_plans_for_dashboard"})',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: {
          type: 'string',
          description: 'Exact method name (operationId from retrieve_sdk_methods)',
        },
      },
      required: ['method'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  _session: Session
): Promise<unknown> {
  if (!catalogReady) {
    return { error: 'SDK catalog not loaded yet. The server may still be starting, or the Looker instance was unreachable.' }
  }

  switch (name) {
    case 'retrieve_sdk_methods':
      return retrieveMethods(args)
    case 'describe_sdk_method':
      return describeMethod(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function retrieveMethods(args: Record<string, unknown>) {
  const query = ((args.query as string) || '').toLowerCase()
  const tag = (args.tag as string) || ''
  const limit = (args.limit as number) || 20

  let results = catalog

  // Filter by tag
  if (tag) {
    results = results.filter(m =>
      m.tags.some(t => t.toLowerCase() === tag.toLowerCase())
    )
  }

  // Keyword search: score by matches in name, summary, description
  if (query) {
    const keywords = query.split(/\s+/).filter(Boolean)
    const scored = results.map(m => {
      const text = `${m.name} ${m.summary} ${m.description} ${m.tags.join(' ')}`.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        if (m.name.toLowerCase().includes(kw)) score += 10  // name match is strongest
        if (m.summary.toLowerCase().includes(kw)) score += 5
        if (m.tags.some(t => t.toLowerCase().includes(kw))) score += 3
        if (m.description.toLowerCase().includes(kw)) score += 1
      }
      return { ...m, score }
    })
    results = scored.filter(m => m.score > 0).sort((a, b) => b.score - a.score)
  }

  const truncated = results.slice(0, limit)

  return {
    total: results.length,
    showing: truncated.length,
    methods: truncated.map(m => ({
      name: m.name,
      summary: m.summary,
      tags: m.tags,
      http: `${m.httpMethod} ${m.path}`,
    })),
    hint: truncated.length > 0
      ? 'Use describe_sdk_method({method: "METHOD_NAME"}) to get full details + code example'
      : 'No matches. Try broader keywords or check available tags: Dashboard, Query, Look, Folder, LookmlModel, Project, Theme, RenderTask, ScheduledPlan, Content, Connection',
  }
}

function describeMethod(args: Record<string, unknown>) {
  const methodName = args.method as string
  const entry = catalog.find(m => m.name === methodName)

  if (!entry) {
    // Fuzzy match suggestion
    const fuzzy = catalog
      .filter(m => m.name.toLowerCase().includes(methodName.toLowerCase()))
      .slice(0, 5)
    return {
      error: `Method "${methodName}" not found`,
      did_you_mean: fuzzy.map(m => m.name),
    }
  }

  // Build parameter details
  const params = entry.parameters.map(p => ({
    name: p.name,
    location: p.in,
    type: p.type,
    required: p.required,
    description: p.description || undefined,
  }))

  // Build code example
  const pathParams = params.filter(p => p.location === 'path')
  const queryParams = params.filter(p => p.location === 'query')
  const bodyParam = params.find(p => p.location === 'body')

  let codeExample = `// ${entry.summary}\n`
  const sdkArgs: string[] = []

  // SDK methods use request objects for complex signatures, positional for simple ones
  if (pathParams.length <= 2 && !bodyParam && queryParams.length <= 1) {
    // Simple positional: sdk.method(pathParam1, pathParam2?, queryParam?)
    for (const p of pathParams) sdkArgs.push(`"<${p.name}>" /* ${p.type} */`)
    if (queryParams.length > 0) sdkArgs.push(`"" /* fields */`)
    codeExample += `const result = await sdk.ok(sdk.${entry.name}(${sdkArgs.join(', ')}))\n`
  } else if (bodyParam) {
    // Body method: sdk.method(pathParam?, body, fields?)
    for (const p of pathParams) sdkArgs.push(`"<${p.name}>"`) 
    sdkArgs.push(`{ /* ${bodyParam.type} */ }`)
    if (queryParams.some(q => q.name === 'fields')) sdkArgs.push(`""`) 
    codeExample += `const result = await sdk.ok(sdk.${entry.name}(${sdkArgs.join(', ')}))\n`
  } else {
    // Request object: sdk.method({param1, param2, ...})
    const reqFields = [...pathParams, ...queryParams].map(p => `  ${p.name}: "<${p.type}>"`).join(',\n')
    codeExample += `const result = await sdk.ok(sdk.${entry.name}({\n${reqFields}\n}))\n`
  }
  codeExample += `return result`

  return {
    name: entry.name,
    summary: entry.summary,
    description: entry.description,
    tags: entry.tags,
    endpoint: `${entry.httpMethod} ${entry.path}`,
    parameters: params,
    returns: entry.responseType,
    code_example: codeExample,
    usage: `execute_sdk_code({ code: \`${codeExample}\` })`,
  }
}
