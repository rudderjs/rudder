/**
 * `pnpm rudder ai:eval` — discover `evals/**\/*.eval.ts` suites,
 * run each, and report. Console reporter by default; `--json` emits
 * a machine-readable envelope to stdout for CI.
 *
 * Registered from the CLI loader (`packages/cli/src/index.ts`)
 * — the AiProvider doesn't own this so it surfaces even when the
 * user app fails to boot, matching the `command:list --json`
 * graceful-degradation pattern from #349.
 */

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runSuite, reportConsole } from '../eval/index.js'
import type { EvalSuite } from '../eval/index.js'
import { reportJson } from '../eval/json-reporter.js'
import type { SuiteJson } from '../eval/json-reporter.js'

type Rudder = {
  command(
    name: string,
    handler: (args: string[]) => void | Promise<void>,
  ): { description(text: string): unknown }
}

/** CLI flags + positional name filter. */
export interface AiEvalOptions {
  /** Substring filter (case-insensitive) applied to suite names. */
  filter?: string
  /** Stop on the first failing suite. */
  bail:    boolean
  /** Emit `{ suites: [...] }` JSON to stdout. */
  json:    boolean
}

/**
 * Test seam — every external dependency gets an injectable
 * override. The CLI handler defaults each to its real impl.
 */
export interface AiEvalDeps {
  cwd?:        string
  stdout?:     { write(s: string): boolean | void }
  stderr?:     { write(s: string): boolean | void }
  /** Override the file walk (test harness returns a virtual list). */
  discover?:   (cwd: string, pattern: string) => Promise<string[]>
  /** Override file → suite loader (test harness uses an in-memory map). */
  loadSuite?:  (absPath: string) => Promise<EvalSuite | null>
  /** Override config lookup (test harness skips `@rudderjs/core`). */
  configPattern?: () => string | null | Promise<string | null>
}

/** Register the `ai:eval` command on the rudder runner. */
export function registerAiEvalCommand(rudder: Rudder): void {
  rudder.command('ai:eval', async (rawArgs: string[]) => {
    const code = await runEvalCli(parseArgs(rawArgs))
    if (code !== 0) process.exit(code)
  }).description(
    'Run eval suites — pnpm rudder ai:eval [name-pattern] [--bail] [--json]',
  )
}

// ─── Args parser ─────────────────────────────────────────

export function parseArgs(args: string[]): AiEvalOptions {
  const positional = args.filter(a => !a.startsWith('--'))
  const flags      = new Set(args.filter(a => a.startsWith('--')))
  const opts: AiEvalOptions = {
    bail: flags.has('--bail'),
    json: flags.has('--json'),
  }
  if (positional[0]) opts.filter = positional[0]
  return opts
}

// ─── Runner ──────────────────────────────────────────────

/**
 * Execute the CLI flow. Returns the process exit code (0 = all pass,
 * 1 = at least one suite had a failure or no suites discovered).
 *
 * The handler is `process.exit`-free so tests can drive it directly.
 */
export async function runEvalCli(opts: AiEvalOptions, deps: AiEvalDeps = {}): Promise<number> {
  const cwd    = deps.cwd ?? process.cwd()
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr

  const pattern = await Promise.resolve((deps.configPattern ?? loadConfigPattern)()) ?? 'evals/**/*.eval.ts'
  const discover = deps.discover ?? discoverSuiteFiles
  const files    = await discover(cwd, pattern)

  if (files.length === 0) {
    stderr.write(`[ai:eval] no suites found matching ${pattern}\n`)
    return opts.json ? emitJson(stdout, []) : 1
  }

  const loader = deps.loadSuite ?? defaultSuiteLoader
  const reports: SuiteJson[] = []
  let exitCode = 0

  for (const file of files) {
    let suite: EvalSuite | null
    try {
      suite = await loader(file)
    } catch (err) {
      stderr.write(`[ai:eval] failed to load ${path.relative(cwd, file)}: ${formatError(err)}\n`)
      exitCode = 1
      if (opts.bail) break
      continue
    }
    if (!suite) {
      stderr.write(`[ai:eval] ${path.relative(cwd, file)} has no default eval suite — skipping\n`)
      continue
    }

    if (opts.filter && !suite.name.toLowerCase().includes(opts.filter.toLowerCase())) continue

    const report = await runSuite(suite)
    if (opts.json) {
      reports.push(reportJson(report))
    } else {
      reportConsole(report, { log: (s) => stdout.write(`${s}\n`) })
    }

    if (report.failed > 0) {
      exitCode = 1
      if (opts.bail) break
    }
  }

  if (opts.json) emitJson(stdout, reports)
  return exitCode
}

function emitJson(stdout: { write(s: string): boolean | void }, suites: SuiteJson[]): 0 {
  stdout.write(`${JSON.stringify({ suites }, null, 2)}\n`)
  return 0
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ─── File discovery ──────────────────────────────────────

/**
 * Recursive walk constrained to a `<dir>/**\/*<suffix>` shape.
 * Returns absolute paths sorted lexicographically for stable test
 * output and predictable `--bail` ordering.
 */
export async function discoverSuiteFiles(cwd: string, pattern: string): Promise<string[]> {
  const { root, suffix } = parsePattern(pattern)
  const absRoot = path.resolve(cwd, root)
  const out: string[] = []
  await walk(absRoot, suffix, out)
  return out.sort()
}

/**
 * Tiny pattern parser — supports `<dir>/**\/*<suffix>` and bare
 * `*<suffix>` (current directory). Anything more elaborate is
 * deferred to userland (run a custom script that imports `runSuite`).
 *
 * Examples:
 *   `evals/**\/*.eval.ts`     → root=`evals`,    suffix=`.eval.ts`
 *   `tests/agents/**\/*.ts`   → root=`tests/agents`, suffix=`.ts`
 *   `*.eval.ts`               → root=`.`,        suffix=`.eval.ts`
 */
function parsePattern(pattern: string): { root: string; suffix: string } {
  const doubleStar = pattern.indexOf('**')
  let prefix:  string
  let postfix: string
  if (doubleStar >= 0) {
    prefix  = pattern.slice(0, doubleStar).replace(/\/$/, '')
    postfix = pattern.slice(doubleStar + 2).replace(/^\//, '')
  } else {
    const lastSlash = pattern.lastIndexOf('/')
    prefix  = lastSlash >= 0 ? pattern.slice(0, lastSlash) : ''
    postfix = lastSlash >= 0 ? pattern.slice(lastSlash + 1) : pattern
  }
  if (!postfix.startsWith('*')) {
    throw new Error(
      `[RudderJS AI] Unsupported eval pattern "${pattern}". ` +
      `Expected <dir>/**/*<suffix> or *<suffix>.`,
    )
  }
  return {
    root:   prefix || '.',
    suffix: postfix.slice(1),
  }
}

async function walk(dir: string, suffix: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      await walk(p, suffix, out)
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(p)
    }
  }
}

// ─── Suite loader ────────────────────────────────────────

async function defaultSuiteLoader(file: string): Promise<EvalSuite | null> {
  const mod = await import(pathToFileURL(file).href) as Record<string, unknown>
  const candidate = (mod['default'] ?? mod['suite']) as EvalSuite | undefined
  if (!candidate || typeof candidate.name !== 'string' || !candidate.spec) return null
  return candidate
}

// ─── Config lookup ───────────────────────────────────────

/**
 * Read `config('ai').eval.pattern` from the booted app. Returns
 * `null` (default pattern) when `@rudderjs/core` isn't loadable
 * or the app didn't boot — the CLI must still work in
 * introspective mode (#349).
 */
async function loadConfigPattern(): Promise<string | null> {
  try {
    // Dynamic import so the static graph doesn't pin `@rudderjs/core`
    // (optional peer). Falls back to default when core isn't loadable
    // or the app didn't boot.
    const core = await import('@rudderjs/core') as { config?: <T = unknown>(key: string) => T }
    if (typeof core.config !== 'function') return null
    const cfg = core.config<{ eval?: { pattern?: string } } | undefined>('ai')
    return cfg?.eval?.pattern ?? null
  } catch {
    return null
  }
}
