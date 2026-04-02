#!/usr/bin/env npx tsx
import { createSession } from '../core.js'
import * as inspectTools from '../tools/inspect.js'
import * as queryTools from '../tools/query.js'
import * as dashboardTools from '../tools/dashboard.js'
import * as gitTools from '../tools/git.js'
import * as sessionTools from '../tools/session.js'
import * as executeTools from '../tools/execute.js'

const DASH_ID = '152'
let passed = 0, failed = 0
const errors: string[] = []

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  \u2705 ${name}`) }
  catch (err: any) { failed++; const m = `${name}: ${err.message}`; errors.push(m); console.log(`  \u274c ${m}`) }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m) }

async function main() {
  console.log('\nSTRESS TEST - Dashboard 152 E2E\n')
  const session = await createSession()
  console.log(`Mode: ${session.currentMode()}, Branch: ${session.currentBranch()}\n`)

  const tileIds: string[] = []
  const filterIds: string[] = []
  let dashTiles: any[] = []

  try {
    // === 1. INSPECT DASHBOARD ===
    console.log('--- 1. INSPECT DASHBOARD ---')
    await test('inspect dashboard 152', async () => {
      const r = await inspectTools.handle('inspect', { target: DASH_ID }, session) as any
      dashTiles = r.tiles || []
      assert(dashTiles.length > 0, 'No tiles')
      console.log(`    ${dashTiles.length} tiles, ${(r.filters||[]).length} filters`)
    })

    // === 2. INSPECT TILES ===
    console.log('--- 2. INSPECT TILES ---')
    for (const tile of dashTiles.slice(0, 5)) {
      await test(`inspect tile:${tile.id} (${tile.title})`, async () => {
        const r = await inspectTools.handle('inspect', { target: `tile:${tile.id}` }, session) as any
        assert(r.element_id !== undefined, 'No element_id')
        if (r.fields?.length) console.log(`    ${r.fields.length} fields, ${r.model}/${r.explore}`)
      })
    }

    // === 3. DISCOVER FIELDS ===
    console.log('--- 3. DISCOVER FIELDS ---')
    const queryableTiles = dashTiles.filter((t: any) => t.query_id)
    let testModel = 'common', testExplore = 'transactions', testFields: string[] = []
    if (queryableTiles.length > 0) {
      const d = await inspectTools.handle('inspect', { target: `tile:${queryableTiles[0].id}` }, session) as any
      if (d.model) testModel = d.model
      if (d.explore) testExplore = d.explore
      testFields = (d.fields || []).slice(0, 3)
    }
    if (testFields.length < 2) testFields = [`${testExplore}.business_unit`, `${testExplore}.count`]
    console.log(`  Using ${testModel}/${testExplore}: ${testFields.join(', ')}\n`)

    // === 4. CREATE TILES ===
    console.log('--- 4. CREATE TILES ---')
    await test('create_tile - bar chart', async () => {
      const r = await dashboardTools.handle('create_tile', {
        dashboard_id: DASH_ID, title: '__stress_bar',
        query: { model: testModel, view: testExplore, fields: testFields.slice(0,2), sorts: [`${testFields[0]} desc`], limit: '10', vis_config: { type: 'looker_bar' } },
      }, session) as any
      assert(r.element_id, 'No element_id'); tileIds.push(String(r.element_id))
      console.log(`    Created tile ${r.element_id}`)
    })
    await test('create_tile - table', async () => {
      const r = await dashboardTools.handle('create_tile', {
        dashboard_id: DASH_ID, title: '__stress_table',
        query: { model: testModel, view: testExplore, fields: testFields, limit: '20', vis_config: { type: 'looker_grid' } },
      }, session) as any
      assert(r.element_id, 'No element_id'); tileIds.push(String(r.element_id))
      console.log(`    Created tile ${r.element_id}`)
    })

    // === 5. UPDATE TILES ===
    console.log('--- 5. UPDATE TILES ---')
    if (tileIds.length >= 2) {
      await test('update_tile - title', async () => {
        const r = await dashboardTools.handle('update_tile', { element_id: tileIds[0], title: '__stress_bar_UPDATED' }, session) as any
        assert(r.title === '__stress_bar_UPDATED', `Title: ${r.title}`)
      })
      await test('update_tile - vis_config bar->pie', async () => {
        const r = await dashboardTools.handle('update_tile', { element_id: tileIds[0], query: { vis_config: { type: 'looker_pie' } } }, session) as any
        assert(r.fields.length > 0, 'Fields lost')
      })
      await test('update_tile - sort', async () => {
        const r = await dashboardTools.handle('update_tile', { element_id: tileIds[1], query: { sorts: [`${testFields[0]} desc`] } }, session) as any
        assert(r.fields.length >= 2, `Fields: ${r.fields.length}`)
      })
    }

    // === 6. CREATE + UPDATE FILTERS ===
    console.log('--- 6. FILTERS ---')
    await test('create_filter', async () => {
      const r = await dashboardTools.handle('create_filter', {
        dashboard_id: DASH_ID, name: '__stress_filter1', title: 'Stress Filter 1',
        type: 'field_filter', dimension: testFields[0], model: testModel, explore: testExplore,
      }, session) as any
      assert(r.filter_id, 'No filter_id'); filterIds.push(String(r.filter_id))
      console.log(`    Created filter ${r.filter_id}`)
    })
    await test('create_filter 2', async () => {
      const dim = testFields.length > 1 ? testFields[1] : testFields[0]
      const r = await dashboardTools.handle('create_filter', {
        dashboard_id: DASH_ID, name: '__stress_filter2', title: 'Stress Filter 2',
        type: 'field_filter', dimension: dim, model: testModel, explore: testExplore,
      }, session) as any
      assert(r.filter_id, 'No filter_id'); filterIds.push(String(r.filter_id))
    })
    if (filterIds.length >= 1) {
      await test('update_filter', async () => {
        const r = await dashboardTools.handle('update_filter', { filter_id: filterIds[0], title: 'Updated Filter', default_value: 'Consultation' }, session) as any
        assert(r.title === 'Updated Filter', `Title: ${r.title}`)
      })
    }

    // === 7. VERIFY ===
    console.log('--- 7. VERIFY ---')
    await test('inspect shows created resources', async () => {
      const r = await inspectTools.handle('inspect', { target: DASH_ID }, session) as any
      for (const tid of tileIds) assert(r.tiles.some((t:any) => String(t.id) === tid), `Tile ${tid} missing`)
      for (const fid of filterIds) assert(r.filters.some((f:any) => String(f.id) === fid), `Filter ${fid} missing`)
      console.log(`    All ${tileIds.length} tiles + ${filterIds.length} filters confirmed`)
    })

    // === 8. EXECUTE_SDK_CODE ===
    console.log('--- 8. SDK CODE ---')
    await test('execute_sdk_code', async () => {
      const r = await executeTools.handle('execute_sdk_code', {
        code: `const els = await sdk.ok(sdk.dashboard_dashboard_elements('${DASH_ID}','')); return els.map(e=>({id:e.id,title:e.title||'?'}))`,
      }, session) as any
      assert(Array.isArray(r) && r.length > 0, 'No elements')
      console.log(`    ${r.length} elements via SDK code`)
    })
    await test('blocked method throws', async () => {
      let threw = false
      try { await executeTools.handle('execute_sdk_code', { code: 'await sdk.ok(sdk.deploy_ref_to_production("x"))' }, session) }
      catch (e: any) { threw = true; assert(e.message.includes('BLOCKED'), e.message) }
      assert(threw, 'Should have thrown')
    })

    // === 9. GIT OPS ===
    console.log('--- 9. GIT OPS ---')
    await test('reset_to_remote', async () => {
      const r = await gitTools.handle('reset_to_remote', {}, session) as any
      assert(r.success === true, r.message)
    })
    await test('validate', async () => {
      const r = await gitTools.handle('validate', {}, session) as any
      console.log(`    Status: ${r.status}, ${r.error_count||0} errors`)
    })

    // === 10. MODE SWITCHING ===
    console.log('--- 10. MODE SWITCHING ---')
    await test('prod and back', async () => {
      const r1 = await sessionTools.handle('switch_mode', { mode: 'prod' }, session) as any
      assert(r1.mode === 'prod', `Got ${r1.mode}`)
      const r2 = await sessionTools.handle('switch_mode', { mode: 'dev', branch: 'tmp/unified_users' }, session) as any
      assert(r2.mode === 'dev' && r2.branch === 'tmp/unified_users', `Got ${r2.mode}/${r2.branch}`)
    })
    await test('blocked branch', async () => {
      let threw = false
      try { await sessionTools.handle('switch_mode', { mode: 'dev', branch: 'main' }, session) }
      catch (e: any) { threw = true; assert(e.message.includes('LOOKER_ALLOWED_BRANCHES'), e.message) }
      assert(threw, 'Should have thrown')
    })

    // === 11. AD-HOC QUERY ===
    console.log('--- 11. AD-HOC QUERY ---')
    await test('run_query', async () => {
      const r = await queryTools.handle('run_query', {
        model: testModel, explore: testExplore, fields: testFields.slice(0,2), sorts: [`${testFields[0]} desc`], limit: 5,
      }, session) as any
      const rows = Array.isArray(r) ? r.length : 0
      assert(rows > 0, 'No rows'); console.log(`    ${rows} rows`)
    })

  } finally {
    // === CLEANUP ===
    console.log('--- CLEANUP ---')
    for (const fid of filterIds) {
      await test(`delete_filter ${fid}`, async () => {
        const r = await dashboardTools.handle('delete_filter', { filter_id: fid }, session) as any
        assert(r.deleted === true, 'Not deleted')
      })
    }
    for (const tid of tileIds) {
      await test(`delete_tile ${tid}`, async () => {
        const r = await dashboardTools.handle('delete_tile', { element_id: tid }, session) as any
        assert(r.deleted === true, 'Not deleted')
      })
    }
    await test('verify cleanup', async () => {
      const r = await inspectTools.handle('inspect', { target: DASH_ID }, session) as any
      for (const tid of tileIds) assert(!r.tiles.some((t:any) => String(t.id)===tid), `Tile ${tid} still exists`)
      for (const fid of filterIds) assert(!r.filters.some((f:any) => String(f.id)===fid), `Filter ${fid} still exists`)
    })
  }

  console.log(`\nRESULTS: ${passed} passed, ${failed} failed`)
  if (errors.length) { console.log('Failures:'); errors.forEach(e => console.log(`  - ${e}`)) }
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
