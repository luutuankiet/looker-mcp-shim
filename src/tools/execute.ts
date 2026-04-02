/**
 * execute_sdk_code tool — Escape hatch for arbitrary @looker/sdk calls.
 *
 * Runs user-provided TypeScript/JS code with a pre-initialized,
 * safety-proxied SDK instance. Blocked methods throw at access time.
 */

import type { Session } from '../core.js'

export const tools = [
  {
    name: 'execute_sdk_code',
    description:
      'Execute arbitrary @looker/sdk TypeScript code against the current session.\n\n' +
      'Available in scope:\n' +
      '- sdk: Looker40SDK (authenticated, safety-proxied — blocked methods will throw)\n' +
      '- projectId: string\n' +
      '- currentMode: "dev" | "prod"\n\n' +
      'Your code runs as an async function body. Use `return` to return results.\n' +
      'Results must be JSON-serializable.\n\n' +
      'Example: `const user = await sdk.ok(sdk.me()); return { name: user.display_name }`',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'TypeScript/JavaScript code to execute' },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (default: 30000)',
        },
      },
      required: ['code'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  if (name !== 'execute_sdk_code') throw new Error(`Unknown tool: ${name}`)

  const code = args.code as string
  const timeout = (args.timeout as number) || 30000

  // Static analysis for critical blocked methods (defense in depth)
  const CRITICAL_PATTERNS = [
    'deploy_ref_to_production',
    'deploy_to_production',
    'login_user',
  ]
  for (const pattern of CRITICAL_PATTERNS) {
    if (code.includes(pattern)) {
      throw new Error(
        `BLOCKED: ${pattern} is not allowed in execute_sdk_code — could affect production`
      )
    }
  }

  // Create async function from code string
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>

  let fn: (...args: unknown[]) => Promise<unknown>
  try {
    fn = new AsyncFunction('sdk', 'projectId', 'currentMode', code)
  } catch (e: any) {
    throw new Error(`Syntax error in code: ${e.message}`)
  }

  // Execute with timeout
  const result = await Promise.race([
    fn(session.safeSdk, session.projectId, session.currentMode()),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout: code execution exceeded ${timeout}ms`)),
        timeout
      )
    ),
  ])

  // Ensure result is JSON-serializable
  try {
    JSON.stringify(result)
  } catch {
    throw new Error('Result is not JSON-serializable')
  }

  return result
}
