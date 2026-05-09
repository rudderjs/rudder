import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm'

export function detectPackageManager(cwd: string): PackageManager {
  const dirs = [cwd, join(cwd, '..')]
  for (const dir of dirs) {
    if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dir, 'bun.lockb'))) return 'bun'
  }
  return 'npm'
}

/**
 * Build the argv to invoke `rudder <args>` via the project's package manager.
 * Uses --silent (where supported) to suppress the script-header line that
 * pnpm/npm/yarn print to stdout, but callers should still tolerate prefixed
 * lines defensively (see {@link parseFirstJsonObject}).
 */
export function rudderArgv(pm: PackageManager, args: string[]): { command: string; argv: string[] } {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', argv: ['--silent', 'rudder', ...args] }
    case 'yarn':
      return { command: 'yarn', argv: ['--silent', 'rudder', ...args] }
    case 'bun':
      return { command: 'bun', argv: ['rudder', ...args] }
    case 'npm':
      return { command: 'npm', argv: ['exec', '--silent', 'rudder', '--', ...args] }
  }
}

/**
 * Parse the first `{...}` JSON object out of stdout. Tolerates script-header
 * preambles emitted by package managers (e.g. `> playground@0.0.1 rudder ...`)
 * that may show up before the actual JSON payload.
 */
export function parseFirstJsonObject<T = unknown>(stdout: string): T {
  const start = stdout.indexOf('{')
  if (start === -1) throw new Error(`No JSON object found in output:\n${stdout.slice(0, 500)}`)
  // JSON object spans to the matching closing brace at depth 0. We do a
  // bracket-aware scan that also respects strings (so braces inside string
  // values don't throw off the depth count).
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i]!
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = stdout.slice(start, i + 1)
        return JSON.parse(slice) as T
      }
    }
  }
  throw new Error(`Unterminated JSON in output:\n${stdout.slice(0, 500)}`)
}
