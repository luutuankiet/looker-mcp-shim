#!/usr/bin/env node
/**
 * Unit tests for src/util/mcp-result.ts
 *
 * Pure-function tests — NO Looker API, NO MCP server spawn, NO network.
 * Run via: node dist/util/mcp-result.test.mjs   (after `npm run build`)
 * Or as JS via: node src/util/mcp-result.test.mjs (this file)
 *
 * Tests import the COMPILED helper from dist/ so we prove the shipped artifact works.
 */

import {
  toStructuredContent,
  hasNonTextContent,
  extractUpstreamSC,
  wrapShimResult,
  wrapUpstreamResult,
} from '../../dist/util/mcp-result.js'

let passed = 0
let failed = 0
const failures = []

function assert(cond, label, detail) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    failures.push({ label, detail })
    console.error(`  ✗ ${label}`)
    if (detail) console.error(`      ${detail}`)
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ─── toStructuredContent ──────────────────────────────────────────────────
console.log('\n[toStructuredContent]')
assert(
  deepEqual(toStructuredContent({ a: 1, b: 'x' }), { a: 1, b: 'x' }),
  'passes plain objects through',
)
assert(
  deepEqual(toStructuredContent([1, 2, 3]), { result: [1, 2, 3] }),
  'wraps arrays in { result }',
)
assert(
  deepEqual(toStructuredContent('hello'), { result: 'hello' }),
  'wraps primitive strings in { result }',
)
assert(
  deepEqual(toStructuredContent(42), { result: 42 }),
  'wraps primitive numbers in { result }',
)
assert(
  deepEqual(toStructuredContent(null), { result: null }),
  'wraps null in { result }',
)
assert(
  deepEqual(toStructuredContent(undefined), { result: undefined }),
  'wraps undefined in { result }',
)

// ─── hasNonTextContent ────────────────────────────────────────────────────
console.log('\n[hasNonTextContent]')
assert(hasNonTextContent(null) === false, 'null → false')
assert(hasNonTextContent('string') === false, 'string → false')
assert(hasNonTextContent({}) === false, 'empty object → false')
assert(
  hasNonTextContent({ content: [] }) === false,
  'empty content array → false',
)
assert(
  hasNonTextContent({ content: [{ type: 'text', text: 'hi' }] }) === false,
  'text-only content → false',
)
assert(
  hasNonTextContent({ content: [{ type: 'image', data: 'b64', mimeType: 'image/png' }] }) === true,
  'image content → true',
)
assert(
  hasNonTextContent({
    content: [
      { type: 'text', text: 'caption' },
      { type: 'audio', data: 'b64', mimeType: 'audio/wav' },
    ],
  }) === true,
  'mixed text+audio → true',
)

// ─── extractUpstreamSC ────────────────────────────────────────────────────
console.log('\n[extractUpstreamSC]')
assert(extractUpstreamSC(null) === undefined, 'null → undefined')
assert(extractUpstreamSC('text') === undefined, 'primitive → undefined')
assert(extractUpstreamSC([]) === undefined, 'array → undefined')
assert(extractUpstreamSC({}) === undefined, 'no structuredContent → undefined')
assert(
  deepEqual(
    extractUpstreamSC({ structuredContent: { foo: 'bar' } }),
    { foo: 'bar' },
  ),
  'extracts valid structuredContent object',
)
assert(
  extractUpstreamSC({ structuredContent: [1, 2, 3] }) === undefined,
  'rejects array-typed structuredContent',
)

// ─── wrapShimResult ───────────────────────────────────────────────────────
console.log('\n[wrapShimResult]')
{
  const r = wrapShimResult({ tile_id: 1477, title: 'Revenue by Type' })
  assert(Array.isArray(r.content) && r.content.length === 1, 'returns content array')
  assert(r.content[0].type === 'text', 'content block is text')
  assert(r.content[0].text.includes('1477'), 'text contains data')
  assert(
    deepEqual(r.structuredContent, { tile_id: 1477, title: 'Revenue by Type' }),
    'structuredContent is the raw object',
  )
}
{
  const r = wrapShimResult([1, 2, 3])
  assert(
    deepEqual(r.structuredContent, { result: [1, 2, 3] }),
    'array data wrapped in { result }',
  )
}
{
  const r = wrapShimResult('plain string')
  assert(r.content[0].text === 'plain string', 'string text returned verbatim')
  assert(
    deepEqual(r.structuredContent, { result: 'plain string' }),
    'string wrapped in { result }',
  )
}

// ─── wrapUpstreamResult ───────────────────────────────────────────────────
console.log('\n[wrapUpstreamResult]')

// Case 1: non-text content → passthrough
{
  const upstream = {
    content: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }],
  }
  const r = wrapUpstreamResult(upstream)
  assert(r.structuredContent === undefined, 'image content → no structuredContent')
  assert(r.content[0].type === 'image', 'image content preserved')
}

// Case 2: upstream already has structuredContent
{
  const upstream = {
    content: [{ type: 'text', text: '{"id":42}' }],
    structuredContent: { id: 42 },
  }
  const r = wrapUpstreamResult(upstream)
  assert(deepEqual(r.structuredContent, { id: 42 }), 'preserves upstream structuredContent')
  assert(r.content[0].text === '{"id":42}', 'preserves upstream content')
}

// Case 2b: structuredContent but missing content[] → synthesize
{
  const upstream = { structuredContent: { id: 42 } }
  const r = wrapUpstreamResult(upstream)
  assert(deepEqual(r.structuredContent, { id: 42 }), 'preserves SC')
  assert(r.content.length === 1 && r.content[0].type === 'text', 'synthesizes content[]')
  assert(r.content[0].text.includes('42'), 'synthesized content has data')
}

// Case 3: content[] present, no SC → synthesize SC from JSON in first text block
{
  const upstream = {
    content: [{ type: 'text', text: '{"dashboards":[{"id":151}]}' }],
  }
  const r = wrapUpstreamResult(upstream)
  assert(
    deepEqual(r.structuredContent, { dashboards: [{ id: 151 }] }),
    'synthesizes SC from JSON text',
  )
  assert(r.content[0].text === '{"dashboards":[{"id":151}]}', 'preserves original text')
}

// Case 3b: content[] has non-JSON text → fallback wraps in { result }
{
  const upstream = { content: [{ type: 'text', text: 'plain human message' }] }
  const r = wrapUpstreamResult(upstream)
  assert(
    deepEqual(r.structuredContent, { result: 'plain human message' }),
    'non-JSON text wrapped in { result }',
  )
}

// Case 4: bare data (no wrapper)
{
  const r = wrapUpstreamResult(42)
  assert(
    deepEqual(r.structuredContent, { result: 42 }),
    'bare primitive wrapped in { result }',
  )
}

// isError preservation
{
  const upstream = {
    content: [{ type: 'text', text: 'boom' }],
    isError: true,
  }
  const r = wrapUpstreamResult(upstream)
  assert(r.isError === true, 'isError=true preserved from upstream')
}
{
  const upstream = {
    content: [{ type: 'text', text: '{"ok":true}' }],
    structuredContent: { ok: true },
    isError: false,
  }
  const r = wrapUpstreamResult(upstream)
  // isError: false is falsy and not preserved (intentionally — we only pass true)
  assert(
    r.isError === undefined || r.isError === false,
    'isError=false does not corrupt output',
  )
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('')
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('\nFailures:')
  failures.forEach((f) => console.error(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`))
  process.exit(1)
}
process.exit(0)
