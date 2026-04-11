/**
 * MCP Tool Result Helpers — structuredContent wrapping
 *
 * Implements the MCP 2025-03-26+ pattern for returning both:
 * - content[] — human-readable text blocks (required, all MCP versions)
 * - structuredContent — machine-parseable JSON object (added in 2025-03-26)
 *
 * Pattern adapted from @luutuankiet/mcp-proxy-shim (see its src/core.ts:
 * toStructuredContent, hasNonTextContent, extractUpstreamSC, unwrapAndRewrap).
 *
 * Why it matters:
 *   - Clients like Claude Code PREFER structuredContent when present and may
 *     ignore the content array entirely. If a response carries non-text blocks
 *     (image/audio/resource), attaching a text-only structuredContent silently
 *     drops them. Hence the `hasNonTextContent` guard.
 *   - Agents that consume structuredContent can skip JSON.parse(text) and use
 *     the object directly — fewer tokens burnt, fewer parse errors.
 *   - Upstream MCP servers that are already 2025-03-26+ compliant may ship
 *     structuredContent on their own. We prefer theirs over synthesizing.
 */

/**
 * Loose internal result shape.
 *
 * We intentionally return `any` from the exported wrapper functions. Reason:
 * MCP SDK 1.28+ added an async-task variant to `CallToolResult`, turning it
 * into a discriminated union. TypeScript struggles to narrow local interface
 * types against that union at the `setRequestHandler` call site, so a local
 * type declaration for the content branch causes assignability errors. Casting
 * to the SDK's own `CallToolResult` doesn't help either — its strict
 * ContentBlock union conflicts with our loose passthrough types for upstream
 * responses we can't fully re-type.
 *
 * The runtime shape is correct and covered by 39 unit tests in
 * src/__test__/mcp-result.test.mjs. Exported wrappers return `any` so callers
 * (src/index.ts) can compose them freely with the SDK's union return type.
 */
interface McpToolResult {
  content: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/**
 * Convert any value to a structuredContent-compatible JSON object.
 * The MCP 2025-03-26 spec requires `structuredContent` to be a JSON object
 * (not array, not primitive, not null). Anything else gets wrapped in `{ result: value }`.
 */
export function toStructuredContent(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { result: value }
}

/**
 * True iff `obj` looks like an MCP tool result whose content array carries
 * non-text blocks (image, audio, resource). When this is the case, we must NOT
 * attach structuredContent — Claude Code would pick structuredContent and
 * drop the media blocks silently.
 */
export function hasNonTextContent(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  if (!Array.isArray(o.content) || o.content.length === 0) return false
  return o.content.some((c: unknown) => {
    const item = c as Record<string, unknown>
    return item?.type !== undefined && item.type !== 'text'
  })
}

/**
 * Extract upstream-provided structuredContent if present and valid.
 * Returns undefined if the upstream result doesn't carry one.
 */
export function extractUpstreamSC(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const r = result as Record<string, unknown>
  if (
    r.structuredContent &&
    typeof r.structuredContent === 'object' &&
    !Array.isArray(r.structuredContent)
  ) {
    return r.structuredContent as Record<string, unknown>
  }
  return undefined
}

/**
 * Wrap a shim tool handler's raw return value into an MCP tool result with
 * both content (JSON-pretty text) and structuredContent (the same data as object).
 *
 * Shim handlers in this project return raw JS values (objects, arrays, strings,
 * numbers) — not pre-wrapped MCP responses. This helper does the uniform wrapping
 * at the single central point (src/index.ts CallToolRequestSchema handler).
 */
export function wrapShimResult(rawData: unknown): any {
  const text = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2)
  return {
    content: [{ type: 'text', text }],
    structuredContent: toStructuredContent(rawData),
  }
}

/**
 * Wrap an upstream MCP server's tool result, adding structuredContent if missing.
 *
 * Decision tree:
 *   Case 1. Upstream content carries non-text blocks (image/audio) → return as-is
 *           (adding SC would drop the media blocks on clients that prefer SC).
 *   Case 2. Upstream already provides structuredContent → preserve it; ensure
 *           content[] exists (synthesize from SC if missing).
 *   Case 3. Upstream has content[] but no structuredContent → synthesize SC by
 *           parsing the first text block as JSON (fallback: wrap raw string).
 *   Case 4. Upstream returned bare data (no `content` wrapper) → wrap it like a
 *           shim result.
 *
 * The isError flag is preserved in cases 2 and 3.
 */
export function wrapUpstreamResult(upstreamResult: unknown): any {
  // Case 1: non-text content blocks — leave alone
  if (hasNonTextContent(upstreamResult)) {
    return upstreamResult as McpToolResult
  }

  // Case 4: bare primitive / null / array / undefined — treat like shim result
  if (!upstreamResult || typeof upstreamResult !== 'object' || Array.isArray(upstreamResult)) {
    return wrapShimResult(upstreamResult)
  }

  const r = upstreamResult as Record<string, unknown>
  const upstreamSC = extractUpstreamSC(upstreamResult)

  // Case 2: upstream already shipped structuredContent
  if (upstreamSC) {
    if (Array.isArray(r.content) && r.content.length > 0) {
      return upstreamResult as McpToolResult
    }
    // No content[] alongside SC — synthesize one
    const text = JSON.stringify(upstreamSC, null, 2)
    return {
      content: [{ type: 'text', text }],
      structuredContent: upstreamSC,
      ...(r.isError === true ? { isError: true as const } : {}),
    }
  }

  // Case 3: has content[] but no SC — synthesize SC from first text block
  if (Array.isArray(r.content) && r.content.length > 0) {
    const firstText = r.content.find((c: unknown) => {
      const item = c as Record<string, unknown>
      return item?.type === 'text' && typeof item.text === 'string'
    }) as { type: 'text'; text: string } | undefined

    let parsed: unknown = firstText?.text ?? ''
    if (firstText?.text) {
      try {
        parsed = JSON.parse(firstText.text)
      } catch {
        // Not JSON — keep as string; toStructuredContent wraps it in { result: "..." }
        parsed = firstText.text
      }
    }

    return {
      content: r.content as Array<Record<string, unknown>>,
      structuredContent: toStructuredContent(parsed),
      ...(r.isError === true ? { isError: true as const } : {}),
    }
  }

  // Case 4 fallback: object with neither content nor SC — wrap like shim
  return wrapShimResult(upstreamResult)
}
