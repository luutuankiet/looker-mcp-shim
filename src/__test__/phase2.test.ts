#!/usr/bin/env npx tsx
/**
 * Phase 2 Integration Tests — Dashboard Mutation Tools
 *
 * Tests: create_tile, update_tile, delete_tile, create_filter, update_filter, delete_filter
 * Runs against live Looker API. Creates resources, tests them, cleans up.
 *
 * Usage: npx tsx src/__test__/phase2.test.ts
 */

import { createSession, type Session } from '../core.js'
import * as dashboardTools from '../tools/dashboard.js'
import * as inspectTools from '../tools/inspect.js'

const TEST_DASHBOARD_ID = '151'

let passed = 0
let failed = 0
const errors: string[] = []

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  \u2705 ${name}`)
  } catch (err: any) {
    failed++
    const msg = `${name}: ${err.message}`
    errors.push(msg)
    console.log(`  \u274C ${msg}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

async function main() {
  console.log('Phase 2 Integration Tests \u2014 Dashboard Mutation\n')

  console.log('Creating session...')
  const session = await createSession()
  console.log(`  Mode: ${session.currentMode()}, Branch: ${session.currentBranch()}\n`)

  let createdTileId: string | null = null
  let createdFilterId: string | null = null

  try {
    // ========================================
    // CREATE TILE
    // ========================================
    console.log('--- Create Tile ---')

    await test('create_tile with inline query', async () => {
      const result = await dashboardTools.handle('create_tile', {
        dashboard_id: TEST_DASHBOARD_ID,
        title: '__phase2_test_tile',
        query: {
          model: 'common',
          view: 'da_revenue',
          fields: ['da_revenue.revenue_type', 'da_revenue.count'],
          limit: '10',
        },
      }, session) as any

      assert(result.element_id, 'No element_id returned')
      assert(String(result.dashboard_id) === TEST_DASHBOARD_ID, `Wrong dashboard: ${result.dashboard_id}`)
      createdTileId = String(result.element_id)
      console.log(`    -> Created element_id: ${createdTileId}`)
    })

    // ========================================
    // UPDATE TILE
    // ========================================
    console.log('\n--- Update Tile ---')

    await test('update_tile - title only', async () => {
      assert(!!createdTileId, 'Prerequisite: create_tile must pass first')
      const result = await dashboardTools.handle('update_tile', {
        element_id: createdTileId,
        title: '__phase2_test_tile_UPDATED',
      }, session) as any

      assert(result.element_id, 'No element_id in result')
      assert(result.updated_fields.includes('title'), 'title not in updated_fields')
    })

    await test('update_tile - add field to query (partial merge)', async () => {
      assert(!!createdTileId, 'Prerequisite: create_tile must pass first')
      const result = await dashboardTools.handle('update_tile', {
        element_id: createdTileId,
        query: {
          fields: ['da_revenue.revenue_type', 'da_revenue.total_revenue', 'da_revenue.count'],
          sorts: ['da_revenue.total_revenue desc'],
        },
      }, session) as any

      assert(result.updated_fields.includes('query_id'), 'query_id not in updated_fields')
      assert(result.fields.length === 3, `Expected 3 fields, got ${result.fields.length}`)
    })

    await test('update_tile - vis_config only (model/view/fields preserved)', async () => {
      assert(!!createdTileId, 'Prerequisite: create_tile must pass first')
      const result = await dashboardTools.handle('update_tile', {
        element_id: createdTileId,
        query: {
          vis_config: { type: 'looker_bar', show_view_names: false },
        },
      }, session) as any

      assert(result.element_id, 'No element_id')
      // Fields should still be 3 (preserved from previous update)
      assert(result.fields.length === 3, `Fields lost during vis_config update: got ${result.fields.length}`)
    })

    // ========================================
    // CREATE FILTER
    // ========================================
    console.log('\n--- Create Filter ---')

    await test('create_filter - field_filter', async () => {
      const result = await dashboardTools.handle('create_filter', {
        dashboard_id: TEST_DASHBOARD_ID,
        name: '__phase2_test_filter',
        title: 'Phase 2 Test Filter',
        type: 'field_filter',
        dimension: 'da_revenue.revenue_type',
        model: 'common',
        explore: 'da_revenue',
      }, session) as any

      assert(result.filter_id, 'No filter_id returned')
      createdFilterId = String(result.filter_id)
      console.log(`    -> Created filter_id: ${createdFilterId}`)
    })

    // ========================================
    // UPDATE FILTER
    // ========================================
    console.log('\n--- Update Filter ---')

    await test('update_filter - title + default_value', async () => {
      assert(!!createdFilterId, 'Prerequisite: create_filter must pass first')
      const result = await dashboardTools.handle('update_filter', {
        filter_id: createdFilterId,
        title: 'Updated Test Filter',
        default_value: 'Consultation',
      }, session) as any

      assert(result.title === 'Updated Test Filter', `Title mismatch: ${result.title}`)
      assert(result.updated_fields.includes('title'), 'title not in updated_fields')
      assert(result.updated_fields.includes('default_value'), 'default_value not in updated_fields')
    })

    // ========================================
    // VERIFY VIA INSPECT
    // ========================================
    console.log('\n--- Verify via Inspect ---')

    await test('inspect dashboard shows created tile + filter', async () => {
      const result = await inspectTools.handle('inspect', {
        target: TEST_DASHBOARD_ID,
      }, session) as any

      const testTile = result.tiles.find((t: any) =>
        String(t.id) === createdTileId
      )
      assert(!!testTile, `Created tile ${createdTileId} not found in dashboard`)

      const testFilter = result.filters.find((f: any) =>
        String(f.id) === createdFilterId
      )
      assert(!!testFilter, `Created filter ${createdFilterId} not found in dashboard`)
    })

  } finally {
    // ========================================
    // CLEANUP (always runs)
    // ========================================
    console.log('\n--- Cleanup ---')

    if (createdFilterId) {
      await test('delete_filter', async () => {
        const result = await dashboardTools.handle('delete_filter', {
          filter_id: createdFilterId,
        }, session) as any
        assert(result.deleted === true, 'Filter not deleted')
      })
    }

    if (createdTileId) {
      await test('delete_tile', async () => {
        const result = await dashboardTools.handle('delete_tile', {
          element_id: createdTileId,
        }, session) as any
        assert(result.deleted === true, 'Tile not deleted')
      })
    }

    await test('verify cleanup - tile + filter gone from dashboard', async () => {
      const result = await inspectTools.handle('inspect', {
        target: TEST_DASHBOARD_ID,
      }, session) as any

      if (createdTileId) {
        const ghostTile = result.tiles.find((t: any) => String(t.id) === createdTileId)
        assert(!ghostTile, `Tile ${createdTileId} still exists after delete!`)
      }
      if (createdFilterId) {
        const ghostFilter = result.filters.find((f: any) => String(f.id) === createdFilterId)
        assert(!ghostFilter, `Filter ${createdFilterId} still exists after delete!`)
      }
    })
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Phase 2 Results: ${passed} passed, ${failed} failed`)
  if (errors.length > 0) {
    console.log('\n  Failures:')
    errors.forEach(e => console.log(`    - ${e}`))
  }
  console.log(`${'='.repeat(50)}\n`)

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
