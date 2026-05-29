import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'

// ── Types ─────────────────────────────────────────────────────

export interface TestOptions {
  watch?:    boolean
  bail?:     boolean
  coverage?: boolean
  only?:     boolean
  reporter?: string
  filter?:   string
}

// ── tsx resolution ────────────────────────────────────────────

/**
 * Locate the `tsx` binary the app uses to run TypeScript. Most Rudder apps
 * already have it (the `pnpm rudder` script itself runs through tsx). We
 * walk from `cwd` upward so monorepo-hoisted deps surface too — same shape
 * as how doctor finds the user's tooling.
 *
 * Returns `null` when not found; the caller prints an install hint.
 */
export function findTsx(cwd: string): string | null {
  let dir = cwd
  while (dir) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'tsx')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// ── Argument builder ──────────────────────────────────────────

/**
 * Translate the rudder-level positional + flags into the `tsx --test ...`
 * argv that Node's built-in runner expects. Kept pure (no I/O) so it can
 * be unit-tested without spawning a subprocess.
 *
 * Positional arg semantics:
 * - Ends in `.ts` / `.test.ts` → treated as a file path; Node runs that
 *   file directly, ignoring directory discovery.
 * - Anything else → passed to `--test-name-pattern` (matches `describe`
 *   and `it` labels), and Node discovers tests under `tests/`.
 *
 * When no positional is provided, Node discovers everything under `tests/`.
 */
export function buildTestArgs(positional: string | undefined, opts: TestOptions): string[] {
  const out = ['--test']

  if (opts.watch)    out.push('--watch')
  if (opts.coverage) out.push('--experimental-test-coverage')
  if (opts.only)     out.push('--test-only')
  if (opts.bail)     out.push('--test-force-exit')   // stops the process on first failure
  if (opts.reporter) out.push(`--test-reporter=${opts.reporter}`)

  // `--filter` is an alias for `--test-name-pattern`. Both can be used,
  // explicit `--filter` wins when also passed alongside a positional.
  let namePattern: string | undefined = opts.filter

  let pathArg:    string | undefined
  if (positional) {
    if (/\.ts$/.test(positional)) {
      pathArg = positional
    } else if (!namePattern) {
      namePattern = positional
    }
  }

  if (namePattern) out.push(`--test-name-pattern=${namePattern}`)

  // Always end with the path arg (specific file) OR the `tests/` directory
  // so Node has something to discover. Without this Node walks cwd and
  // discovers unrelated test files (e.g. inside node_modules) — slow + wrong.
  out.push(pathArg ?? 'tests')

  return out
}

// ── Command ───────────────────────────────────────────────────

export function testCommand(program: Command): void {
  program
    .command('test [filter]')
    .description('Run the app\'s test suite (wraps `tsx --test tests/`)')
    .option('-w, --watch',         're-run tests on file changes')
    .option('-b, --bail',          'stop on first failure')
    .option('--coverage',          'collect test coverage (Node --experimental-test-coverage)')
    .option('--only',              'run only tests marked with .only()')
    .option('--filter <pattern>',  'filter by test name (regex passed to Node --test-name-pattern)')
    .option('--reporter <name>',   'Node test reporter name (spec / dot / tap / junit)')
    .action((positional: string | undefined, opts: TestOptions) => {
      const cwd = process.cwd()
      const tsx = findTsx(cwd)
      if (!tsx) {
        console.error('[rudder test] tsx not found in node_modules/.bin.')
        console.error('  Run `pnpm add -D tsx` (or yarn/npm/bun equivalent) and re-try.')
        process.exit(1)
      }
      const args = buildTestArgs(positional, opts)
      const child = spawn(tsx, args, {
        cwd,
        stdio: 'inherit',
        // Windows can't exec node_modules/.bin/tsx (a .CMD shim) without a
        // shell. Other platforms execute the script directly.
        shell: process.platform === 'win32',
      })
      child.on('close', (code) => process.exit(code ?? 0))
      child.on('error', (err) => {
        console.error('[rudder test] failed to spawn tsx:', err.message)
        process.exit(1)
      })
    })
}

/** @internal — exposed for unit tests */
export const _internal = {
  findTsx,
  buildTestArgs,
}
