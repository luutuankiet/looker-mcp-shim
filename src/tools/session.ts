/**
 * switch_mode tool — Toggle between Looker dev and prod mode.
 */

import type { Session } from '../core.js'

export const tools = [
  {
    name: 'switch_mode',
    description:
      'Switch between Looker dev and prod mode.\n\n' +
      'Dev mode: edits affect dev branch only. Specify branch name.\n' +
      'Prod mode: read-only access to production LookML.\n\n' +
      'Branch must be in LOOKER_ALLOWED_BRANCHES (.env) or the call is rejected.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        mode: {
          type: 'string',
          enum: ['dev', 'prod'],
          description: 'Target workspace mode',
        },
        branch: {
          type: 'string',
          description: 'Git branch for dev mode (optional, defaults to LOOKER_DEV_BRANCH)',
        },
      },
      required: ['mode'],
    },
  },
]

export async function handle(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<unknown> {
  if (name !== 'switch_mode') throw new Error(`Unknown tool: ${name}`)

  const mode = args.mode as 'dev' | 'prod'
  const branch = args.branch as string | undefined

  return session.switchMode(mode, branch)
}
