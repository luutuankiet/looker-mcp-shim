/**
 * Core smoke test — validates auth, mode switching, branch guards, and safety proxy.
 *
 * Run: npx tsx src/__test__/core.test.ts
 */

import { createSession } from '../core.js'

async function main() {
  console.log('=== Core Smoke Test ===\n')
  let passed = 0
  let failed = 0

  function ok(label: string) {
    passed++
    console.log(`  \u2705 ${label}`)
  }
  function fail(label: string, err?: string) {
    failed++
    console.log(`  \u274C ${label}${err ? ': ' + err : ''}`)
  }

  // 1. Create session (tests auth)
  console.log('1. Creating session (authenticating)...')
  let session: Awaited<ReturnType<typeof createSession>>
  try {
    session = await createSession()
    ok('Authenticated successfully')
  } catch (e: any) {
    fail('Authentication', e.message)
    process.exit(1)
  }

  // 2. Test dev mode with branch
  console.log('\n2. Testing switch to dev mode with branch...')
  try {
    const result = await session.switchMode('dev', 'feat/dev_tools')
    if (result.mode === 'dev' && result.branch === 'feat/dev_tools') {
      ok(`Mode: ${result.mode}, Branch: ${result.branch}`)
    } else {
      fail('Unexpected result', JSON.stringify(result))
    }
  } catch (e: any) {
    fail('Dev mode switch', e.message)
  }

  // 3. Test prod mode
  console.log('\n3. Testing switch to prod mode...')
  try {
    const result = await session.switchMode('prod')
    if (result.mode === 'prod') {
      ok(`Mode: ${result.mode}, Branch: ${result.branch}`)
    } else {
      fail('Unexpected result', JSON.stringify(result))
    }
  } catch (e: any) {
    fail('Prod mode switch', e.message)
  }

  // 4. Test blocked branch
  console.log('\n4. Testing blocked branch (main)...')
  try {
    await session.switchMode('dev', 'main')
    fail('Should have thrown for blocked branch')
  } catch (e: any) {
    if (e.message.includes('not in LOOKER_ALLOWED_BRANCHES')) {
      ok(`BLOCKED: ${e.message}`)
    } else {
      fail('Wrong error', e.message)
    }
  }

  // 5. Test safeSdk blocks dangerous methods
  console.log('\n5. Testing safeSdk blocks deploy_ref_to_production...')
  try {
    await (session.safeSdk as any).deploy_ref_to_production('my-project')
    fail('Should have thrown for blocked method')
  } catch (e: any) {
    if (e.message.includes('BLOCKED')) {
      ok(`BLOCKED: ${e.message}`)
    } else {
      fail('Wrong error', e.message)
    }
  }

  // 6. Restore dev mode
  console.log('\n6. Restoring dev mode...')
  try {
    const result = await session.switchMode('dev', 'feat/dev_tools')
    ok(`Restored: ${result.mode} / ${result.branch}`)
  } catch (e: any) {
    fail('Restore dev mode', e.message)
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test crashed:', err)
  process.exit(1)
})
