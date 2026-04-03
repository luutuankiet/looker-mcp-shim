/**
 * Test: upstream tool descriptions get correct shim-preferred warnings.
 *
 * This doesn't spawn a real upstream server — it tests the description
 * rewriting logic in isolation by simulating the tool mapping code path.
 */

// Inline the SHIM_PREFERRED map (same as upstream.ts)
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

/** Simulate the description rewriting logic from upstream.ts */
function rewriteDescription(toolName: string, originalDesc: string): string {
  const shimAlt = SHIM_PREFERRED[toolName]
  const desc = originalDesc || toolName
  const prefix = shimAlt
    ? `⚠️ UPSTREAM FALLBACK — prefer ${shimAlt.split(' — ')[0]} instead. ${shimAlt}. Only use this if the shim tool cannot accomplish your task. Original: `
    : '[upstream] '
  return `${prefix}${desc}`
}

// ---- Tests ----

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++
    console.log(`  ✅ ${msg}`)
  } else {
    failed++
    console.error(`  ❌ ${msg}`)
  }
}

console.log('\n🔧 Upstream description rewriting tests\n')

// 1. Known overlapping tools get warning prefix
console.log('--- Overlapping tools get ⚠️ warning ---')
for (const name of Object.keys(SHIM_PREFERRED)) {
  const desc = rewriteDescription(name, `Original desc for ${name}`)
  assert(desc.startsWith('⚠️ UPSTREAM FALLBACK'), `${name} gets ⚠️ prefix`)
  assert(desc.includes('Only use this if the shim tool cannot accomplish your task'), `${name} has fallback warning`)
  assert(desc.includes(`Original desc for ${name}`), `${name} preserves original description`)
}

// 2. Non-overlapping tools get generic [upstream] prefix
console.log('\n--- Non-overlapping tools get [upstream] prefix ---')
for (const name of ['get_project_files', 'update_project_file', 'get_explores', 'get_dimensions']) {
  const desc = rewriteDescription(name, `Desc for ${name}`)
  assert(desc.startsWith('[upstream]'), `${name} gets [upstream] prefix`)
  assert(!desc.includes('⚠️'), `${name} does NOT get warning`)
}

// 3. Specific shim tool names appear in warnings
console.log('\n--- Correct shim alternatives mentioned ---')
assert(rewriteDescription('run_dashboard', 'x').includes('run_tile'), 'run_dashboard → mentions run_tile')
assert(rewriteDescription('query_sql', 'x').includes('run_tile'), 'query_sql → mentions run_tile')
assert(rewriteDescription('dev_mode', 'x').includes('switch_mode'), 'dev_mode → mentions switch_mode')
assert(rewriteDescription('validate_project', 'x').includes('validate'), 'validate_project → mentions validate')
assert(rewriteDescription('get_dashboards', 'x').includes('inspect'), 'get_dashboards → mentions inspect')
assert(rewriteDescription('make_dashboard', 'x').includes('create_tile'), 'make_dashboard → mentions create_tile')

// 4. Edge case: tool with no description
console.log('\n--- Edge cases ---')
const noDesc = rewriteDescription('run_dashboard', '')
assert(noDesc.includes('run_dashboard'), 'Falls back to tool name when no description')

const unknownNoDesc = rewriteDescription('some_unknown_tool', '')
assert(unknownNoDesc.includes('some_unknown_tool'), 'Unknown tool with no desc uses tool name')

// Summary
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
if (failed > 0) process.exit(1)
console.log('✅ All upstream description rewriting tests passed\n')
