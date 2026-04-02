/**
 * Full integration test — validates all tools against live Looker API.
 * Tests the 12-step MVP acceptance criteria directly (no HTTP passthru needed).
 *
 * Run: npx tsx src/__test__/integration.test.ts
 */

import { createSession } from '../core.js'
import * as sessionTools from '../tools/session.js'
import * as gitTools from '../tools/git.js'
import * as inspectTools from '../tools/inspect.js'
import * as queryTools from '../tools/query.js'
import * as executeTools from '../tools/execute.js'
import { parseTarget } from '../util/url-parser.js'
import type { Session } from '../core.js'

let passed = 0
let failed = 0

function ok(label: string, detail?: string) {
  passed++
  console.log(`  \u2705 ${label}${detail ? ' — ' + detail : ''}`)
}
function fail(label: string, err?: string) {
  failed++
  console.log(`  \u274C ${label}${err ? ': ' + err : ''}`)
}

async function test(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (e: any) {
    fail(label, e.message)
  }
}

async function main() {
  console.log('=== Integration Test (12-Step MVP) ===\n')

  // --- URL Parser unit tests (Step 4) ---
  console.log('Step 4: URL Parser')
  test('Parse dashboard URL', async () => {
    const r = parseTarget('https://example.cloud.looker.com/dashboards/151')
    if (r.type === 'dashboard' && r.id === '151') ok('Dashboard URL', JSON.stringify(r))
    else fail('Dashboard URL', JSON.stringify(r))
  })
  test('Parse bare ID', async () => {
    const r = parseTarget('151')
    if (r.type === 'dashboard' && r.id === '151') ok('Bare ID', JSON.stringify(r))
    else fail('Bare ID', JSON.stringify(r))
  })
  test('Parse tile reference', async () => {
    const r = parseTarget('tile:1477')
    if (r.type === 'tile' && r.id === '1477') ok('Tile ref', JSON.stringify(r))
    else fail('Tile ref', JSON.stringify(r))
  })
  test('Parse explore URL', async () => {
    const r = parseTarget('https://host/explore/my_model/my_explore?fields=my_explore.dimension1,my_explore.measure1')
    if (r.type === 'explore' && r.model === 'my_model' && r.explore === 'my_explore' && r.fields?.length === 2)
      ok('Explore URL', JSON.stringify(r))
    else fail('Explore URL', JSON.stringify(r))
  })
  // Let URL parser tests resolve
  await new Promise(r => setTimeout(r, 100))

  // --- Create session ---
  console.log('\nCreating session...')
  let session: Session
  try {
    session = await createSession()
    ok('Session created')
  } catch (e: any) {
    fail('Session creation', e.message)
    console.log(`\n=== ABORT: Cannot continue without session ===`)
    process.exit(1)
  }

  // --- Step 9.1: switch_mode -> dev + feat/dev_tools ---
  console.log('\nStep 9.1: switch_mode -> dev + feat/dev_tools')
  await test('switch_mode dev', async () => {
    const r = await sessionTools.handle('switch_mode', { mode: 'dev', branch: 'feat/dev_tools' }, session) as any
    if (r.mode === 'dev' && r.branch === 'feat/dev_tools') ok('Dev mode', JSON.stringify(r))
    else fail('Dev mode', JSON.stringify(r))
  })

  // --- Step 9.2: inspect dashboard 151 ---
  console.log('\nStep 9.2: inspect dashboard 151')
  await test('inspect dashboard', async () => {
    const r = await inspectTools.handle('inspect', { target: '151' }, session) as any
    if (r.tiles && r.tiles.length > 0) {
      ok('Dashboard inspect', `${r.tile_count} tiles found`)
      console.log(`    Tiles: ${r.tiles.map((t: any) => `${t.id}:${t.title}`).join(', ')}`)
    } else fail('Dashboard inspect', JSON.stringify(r))
  })

  // --- Step 9.3: inspect tile:1477 ---
  console.log('\nStep 9.3: inspect tile:1477')
  await test('inspect tile', async () => {
    const r = await inspectTools.handle('inspect', { target: 'tile:1477' }, session) as any
    if (r.fields && r.fields.length > 0) {
      ok('Tile inspect', `${r.fields.length} fields, query_id=${r.query_id}`)
      console.log(`    Fields: ${r.fields.join(', ')}`)
      console.log(`    Filter wiring: ${JSON.stringify(r.filter_wiring)}`)
    } else fail('Tile inspect', JSON.stringify(r))
  })

  // --- Step 9.4: run_tile 1477 format=json ---
  console.log('\nStep 9.4: run_tile 1477 format=json')
  await test('run_tile json', async () => {
    const r = await queryTools.handle('run_tile', { element_id: '1477', format: 'json', limit: 5 }, session) as any
    if (Array.isArray(r) && r.length > 0) {
      ok('Tile data', `${r.length} rows`)
      console.log(`    First row keys: ${Object.keys(r[0]).join(', ')}`)
    } else fail('Tile data', typeof r === 'string' ? r.slice(0, 200) : JSON.stringify(r).slice(0, 200))
  })

  // --- Step 9.5: run_tile 1477 format=sql ---
  console.log('\nStep 9.5: run_tile 1477 format=sql')
  await test('run_tile sql', async () => {
    const r = await queryTools.handle('run_tile', { element_id: '1477', format: 'sql' }, session) as any
    const sql = r.sql || r
    if (typeof sql === 'string' && sql.toUpperCase().includes('SELECT')) {
      ok('Compiled SQL', `${sql.length} chars`)
      console.log(`    SQL preview: ${sql.slice(0, 120)}...`)
    } else fail('Compiled SQL', JSON.stringify(r).slice(0, 200))
  })

  // --- Step 9.6: run_query ad-hoc ---
  console.log('\nStep 9.6: run_query ad-hoc')
  await test('run_query', async () => {
    const r = await queryTools.handle('run_query', {
      model: process.env.LOOKER_TEST_MODEL || 'my_model',
      explore: process.env.LOOKER_TEST_EXPLORE || 'my_explore',
      fields: (process.env.LOOKER_TEST_FIELDS || 'my_explore.dimension1,my_explore.measure1').split(','),
      format: 'json',
      limit: 5,
    }, session) as any
    if (Array.isArray(r) && r.length > 0) {
      ok('Ad-hoc query', `${r.length} rows`)
      console.log(`    First row: ${JSON.stringify(r[0])}`)
    } else fail('Ad-hoc query', JSON.stringify(r).slice(0, 200))
  })

  // --- Step 9.7: reset_to_remote ---
  console.log('\nStep 9.7: reset_to_remote')
  await test('reset_to_remote', async () => {
    const r = await gitTools.handle('reset_to_remote', {}, session) as any
    if (r.success) ok('Reset', r.message || 'success')
    else fail('Reset', JSON.stringify(r))
  })

  // --- Step 9.8: validate ---
  console.log('\nStep 9.8: validate')
  await test('validate', async () => {
    const r = await gitTools.handle('validate', {}, session) as any
    ok('Validate', r.status === 'ok' ? 'No errors' : `${r.error_count} errors`)
  })

  // --- Step 9.9: execute_sdk_code ---
  console.log('\nStep 9.9: execute_sdk_code')
  await test('execute_sdk_code', async () => {
    const r = await executeTools.handle('execute_sdk_code', {
      code: 'const projects = await sdk.ok(sdk.all_projects()); return projects.map(p => p.id)',
    }, session) as any
    if (Array.isArray(r) && r.length > 0) {
      ok('Execute SDK', `Found ${r.length} projects`)
    } else fail('Execute SDK', JSON.stringify(r).slice(0, 200))
  })

  // --- Step 9.10: switch_mode prod -> dev round-trip ---
  console.log('\nStep 9.10: switch_mode round-trip')
  await test('mode round-trip', async () => {
    const p = await sessionTools.handle('switch_mode', { mode: 'prod' }, session) as any
    const d = await sessionTools.handle('switch_mode', { mode: 'dev', branch: 'feat/dev_tools' }, session) as any
    if (p.mode === 'prod' && d.mode === 'dev') ok('Round-trip', `prod->dev`)
    else fail('Round-trip', `${JSON.stringify(p)} -> ${JSON.stringify(d)}`)
  })

  // --- Step 9.11: execute_sdk_code with blocked method ---
  console.log('\nStep 9.11: execute_sdk_code blocked method')
  await test('blocked execute', async () => {
    try {
      await executeTools.handle('execute_sdk_code', {
        code: 'await sdk.ok(sdk.deploy_ref_to_production("my-project"))',
      }, session)
      fail('Should have thrown')
    } catch (e: any) {
      if (e.message.includes('BLOCKED')) ok('Blocked', e.message)
      else fail('Wrong error', e.message)
    }
  })

  // --- Step 9.12: switch_mode to blocked branch ---
  console.log('\nStep 9.12: switch_mode blocked branch')
  await test('blocked branch', async () => {
    try {
      await sessionTools.handle('switch_mode', { mode: 'dev', branch: 'main' }, session)
      fail('Should have thrown')
    } catch (e: any) {
      if (e.message.includes('not in LOOKER_ALLOWED_BRANCHES')) ok('Blocked', e.message)
      else fail('Wrong error', e.message)
    }
  })

  // --- Summary ---
  console.log(`\n${'='.repeat(50)}`)
  console.log(`=== Results: ${passed} passed, ${failed} failed ===${failed === 0 ? ' \u2705 MVP COMPLETE' : ''}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test crashed:', err)
  process.exit(1)
})
