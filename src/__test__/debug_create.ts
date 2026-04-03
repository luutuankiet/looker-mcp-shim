import { createSession } from '../core.js'

async function debug() {
  const session = await createSession()
  const { sdk } = session

  // Step 1: Create tile same way as test
  const q = await sdk.ok(sdk.create_query({
    model: 'common', view: 'da_revenue',
    fields: ['da_revenue.revenue_type', 'da_revenue.count'], limit: '10'
  } as any)) as any
  console.log('Query created:', q.id)

  const el = await sdk.ok(sdk.create_dashboard_element({
    body: { dashboard_id: '151', type: 'vis', title: '__debug_update', query_id: q.id }
  } as any)) as any
  console.log('Element created:', el.id)

  // Step 2: Read it back
  const readback = await sdk.ok(sdk.dashboard_element(String(el.id), '')) as any
  console.log('\n=== Readback ===')
  console.log('query:', readback.query ? 'present' : 'null')
  console.log('result_maker.query:', readback.result_maker?.query ? 'present' : 'null')
  console.log('query_id:', readback.query_id)
  console.log('result_maker.query_id:', readback.result_maker?.query_id)

  const existingQ = readback.query || readback.result_maker?.query || {}
  console.log('\nexistingQ keys:', Object.keys(existingQ).filter(k => existingQ[k] != null))
  console.log('existingQ.model:', existingQ.model)
  console.log('existingQ.view:', existingQ.view)
  console.log('existingQ.fields:', JSON.stringify(existingQ.fields))
  console.log('existingQ.client_id:', existingQ.client_id)

  // Step 3: Extract writable, merge, try create_query
  const WRITABLE = ['model','view','fields','pivots','fill_fields','filters','filter_expression','sorts','limit','column_limit','total','row_total','subtotals','vis_config','filter_config','visible_ui_sections','dynamic_fields','client_id','query_timezone']
  const writable: Record<string,any> = {}
  for (const f of WRITABLE) {
    if (existingQ[f] !== undefined && existingQ[f] !== null) writable[f] = existingQ[f]
  }
  const merged = { ...writable, fields: ['da_revenue.revenue_type', 'da_revenue.total_revenue', 'da_revenue.count'], sorts: ['da_revenue.total_revenue desc'] }
  console.log('\nMerged query:', JSON.stringify(merged, null, 2))

  try {
    const nq = await sdk.ok(sdk.create_query(merged as any)) as any
    console.log('create_query SUCCESS:', nq.id)
  } catch(e: any) {
    console.log('create_query FAIL:', e.message)
    // Try deep clone
    const clean = JSON.parse(JSON.stringify(merged))
    delete clean.client_id
    console.log('Retrying without client_id:', JSON.stringify(clean))
    try {
      const nq2 = await sdk.ok(sdk.create_query(clean as any)) as any
      console.log('create_query (no client_id) SUCCESS:', nq2.id)
    } catch(e2: any) {
      console.log('create_query (no client_id) FAIL:', e2.message)
    }
  }

  // Cleanup
  await sdk.ok(sdk.delete_dashboard_element(String(el.id)))
  console.log('\nCleaned up')
}
debug()
