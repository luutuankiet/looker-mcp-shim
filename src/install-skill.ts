#!/usr/bin/env node
/**
 * install-skill CLI — Install looker-dev skill docs into Claude Code skills directory.
 *
 * Usage:
 *   npx @luutuankiet/looker-mcp-shim install-skill           # install to current project
 *   npx @luutuankiet/looker-mcp-shim install-skill --global   # install to ~/.claude/skills/
 *   npx @luutuankiet/looker-mcp-shim install-skill --path /custom/path
 *
 * Namespace: looker-dev (only touches .claude/skills/looker-dev/)
 */

import { existsSync, mkdirSync, cpSync, readdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const NAMESPACE = 'looker-mcp-shim'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function getSkillsSource(): string {
  // In dist/ after build, skills/ is at package root
  // In src/ during dev, skills/ is also at package root
  const candidates = [
    join(__dirname, '..', 'skills', NAMESPACE),       // from dist/install-skill.js
    join(__dirname, '..', '..', 'skills', NAMESPACE), // from src/install-skill.ts via tsx
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'SKILL.md'))) return c
  }
  throw new Error(
    `Cannot find skills/ directory. Looked in: ${candidates.join(', ')}. ` +
    `Make sure the package is installed correctly.`
  )
}

function getTargetDir(args: string[]): string {
  // --global: ~/.claude/skills/looker-dev/
  if (args.includes('--global')) {
    return join(homedir(), '.claude', 'skills', NAMESPACE)
  }

  // --path /custom/path: /custom/path/.claude/skills/looker-dev/
  const pathIdx = args.indexOf('--path')
  if (pathIdx !== -1 && args[pathIdx + 1]) {
    return join(resolve(args[pathIdx + 1]), '.claude', 'skills', NAMESPACE)
  }

  // Default: current working directory
  return join(process.cwd(), '.claude', 'skills', NAMESPACE)
}

function copyDir(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      cpSync(srcPath, destPath)
    }
  }
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx @luutuankiet/looker-mcp-shim install-skill [options]

Install Looker dev skill docs for Claude Code agents.
Namespace: ${NAMESPACE} (only touches .claude/skills/${NAMESPACE}/)

Options:
  --global    Install to ~/.claude/skills/${NAMESPACE}/
  --path DIR  Install to DIR/.claude/skills/${NAMESPACE}/
  (default)   Install to ./.claude/skills/${NAMESPACE}/

Installed files:
  SKILL.md         Entry point — workflow overview + tool index
  rules/workflow.md   Complete dev loop and decision tree
  rules/inspect.md    Dashboard/tile inspection
  rules/query.md      Running queries with filter auto-wiring
  rules/mutate.md     Create/update/delete tiles and filters
  rules/git-ops.md    Dev mode, git sync, LookML validation
  rules/sdk-escape.md SDK method discovery + code execution
  rules/patterns.md   Common recipes (migration QA, bulk ops)
`)
    return
  }

  const source = getSkillsSource()
  const target = getTargetDir(args)

  console.log(`\n  Installing looker-dev skill docs...`)
  console.log(`  Source: ${source}`)
  console.log(`  Target: ${target}\n`)

  copyDir(source, target)

  // Count installed files
  const count = readdirSync(source, { recursive: true, withFileTypes: false }).length
  console.log(`  \u2705 Installed ${count} files to ${target}`)
  console.log(`  Namespace: ${NAMESPACE} (no other skills affected)\n`)

  if (args.includes('--global')) {
    console.log('  Skills installed globally. Available in all Claude Code sessions.')
  } else {
    console.log('  Skills installed for this project. Commit .claude/skills/ to share with team.')
  }
  console.log()
}

main()
