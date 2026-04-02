/**
 * Git tools — reset_to_remote, validate
 */

import type { Session } from '../core.js'

export const tools = [
  {
    name: 'reset_to_remote',
    description:
      'Reset Looker project to remote git HEAD. Destroys uncommitted dev changes.\n' +
      'Only works in dev mode. Use after pushing LookML to Bitbucket.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'validate',
    description:
      'Run LookML validation on the current project.\n' +
      'Returns errors with file:line references if validation fails.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

export async function handle(
  name: string,
  _args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  switch (name) {
    case 'reset_to_remote':
      return session.resetToRemote()
    case 'validate':
      return session.validate()
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
