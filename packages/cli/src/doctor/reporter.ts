import type { CheckOutcome, RunResult } from './orchestrator.js'
import type { FixResult } from './fixer.js'

const ESC = ''

const ANSI = {
  reset:  `${ESC}[0m`,
  bold:   `${ESC}[1m`,
  dim:    `${ESC}[2m`,
  green:  `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  red:    `${ESC}[31m`,
  cyan:   `${ESC}[36m`,
}

const ICON = {
  ok:    `${ANSI.green}✓${ANSI.reset}`,
  warn:  `${ANSI.yellow}⚠${ANSI.reset}`,
  error: `${ANSI.red}✗${ANSI.reset}`,
}

export interface ReportOptions {
  /** Show `detail` blocks for every outcome (default: only on failure). */
  verbose?: boolean
  /** Suppress ANSI colors (auto-detected via NO_COLOR or non-TTY). */
  plain?:   boolean
}

// Built via constructor so the source file stays ASCII-only — keeps eslint's
// no-control-regex rule happy without an inline-disable, and stops Windows
// editors from mangling the literal ESC byte on autosave.
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
function strip(s: string): string {
  return s.replace(ANSI_RE, '')
}

function pad(s: string, width: number): string {
  const visible = strip(s).length
  return visible >= width ? s : s + ' '.repeat(width - visible)
}

/**
 * Render a doctor report as one block of stdout-ready text. The caller is
 * responsible for printing — keeps this unit pure for tests.
 */
export function renderReport(result: RunResult, opts: ReportOptions = {}): string {
  const plain = opts.plain ?? (!process.stdout.isTTY || !!process.env['NO_COLOR'])
  const c = plain ? new Proxy(ANSI, { get: () => '' }) : ANSI
  const i = plain
    ? { ok: '✓', warn: '⚠', error: '✗' }
    : ICON

  const lines: string[] = []
  lines.push(`${c.bold}Rudder Doctor${c.reset}`)
  lines.push('')

  if (result.outcomes.length === 0) {
    lines.push(`${c.dim}No checks registered.${c.reset}`)
    lines.push('')
    lines.push(footer(result, c))
    return lines.join('\n')
  }

  // Compute the column width for status icon + title, so message aligns
  const titleWidth = Math.max(...result.outcomes.map(o => o.title.length)) + 2

  // Group by category preserving outcome order
  const groups = new Map<string, CheckOutcome[]>()
  for (const o of result.outcomes) {
    const list = groups.get(o.category) ?? []
    list.push(o)
    groups.set(o.category, list)
  }

  for (const [cat, outcomes] of groups) {
    lines.push(`${c.cyan}${cat}${c.reset}`)
    for (const o of outcomes) {
      const icon = i[o.status]
      const titleColored = o.status === 'error'
        ? `${c.red}${o.title}${c.reset}`
        : o.status === 'warn'
          ? `${c.yellow}${o.title}${c.reset}`
          : o.title
      lines.push(`  ${icon} ${pad(titleColored, titleWidth)} ${c.dim}${o.message}${c.reset}`)
      if (o.fix) {
        lines.push(`     ${c.dim}fix:${c.reset} ${o.fix}`)
      }
      if (o.detail && (opts.verbose || o.status !== 'ok')) {
        for (const dl of o.detail.split('\n')) {
          lines.push(`     ${c.dim}${dl}${c.reset}`)
        }
      }
    }
    lines.push('')
  }

  lines.push(footer(result, c))
  return lines.join('\n')
}

function footer(result: RunResult, c: typeof ANSI | Record<string, string>): string {
  const { ok, warn, error } = result.counts
  const total = ok + warn + error
  const ms = result.totalMs.toFixed(0)
  const parts = [
    `${total} checks`,
    `${c.green}${ok} ok${c.reset}`,
    warn  > 0 ? `${c.yellow}${warn} warn${c.reset}`  : `${ok ? c.dim : ''}${warn} warn${c.reset}`,
    error > 0 ? `${c.red}${error} errors${c.reset}` : `${ok ? c.dim : ''}${error} errors${c.reset}`,
    `${c.dim}${ms}ms${c.reset}`,
  ]
  return parts.join(`${c.dim} · ${c.reset}`)
}

/** Map outcome counts to a process exit code: 0 if no errors, 1 otherwise. */
export function exitCodeFor(result: RunResult): number {
  return result.counts.error > 0 ? 1 : 0
}

/**
 * Render the per-fix outcomes from `applyFixes()` as a single block.
 * Shows before → after status for each eligible check + a summary line.
 */
export function renderFixReport(result: FixResult, opts: ReportOptions = {}): string {
  const plain = opts.plain ?? (!process.stdout.isTTY || !!process.env['NO_COLOR'])
  const c = plain ? new Proxy(ANSI, { get: () => '' }) : ANSI
  const i = plain
    ? { ok: '✓', warn: '⚠', error: '✗' }
    : ICON

  const lines: string[] = []
  lines.push(`${c.bold}Fixes${c.reset}`)
  lines.push('')

  if (result.outcomes.length === 0) {
    lines.push(`  ${c.dim}No fixable failures.${c.reset}`)
    lines.push('')
    return lines.join('\n')
  }

  const titleWidth = Math.max(...result.outcomes.map(o => o.title.length)) + 2

  for (const o of result.outcomes) {
    if (o.skipped) {
      const titleColored = `${c.dim}${o.title}${c.reset}`
      lines.push(`  ${c.dim}-${c.reset} ${pad(titleColored, titleWidth)} ${c.dim}skipped${c.reset}`)
      continue
    }
    const arrow      = `${arrowIcon(o.before, c)} → ${i[o.after]}`
    const titleColor = o.after === 'error' ? c.red : o.after === 'warn' ? c.yellow : c.green
    const titleColored = `${titleColor}${o.title}${c.reset}`
    lines.push(`  ${arrow} ${pad(titleColored, titleWidth)} ${c.dim}${o.message}${c.reset}`)
    if (o.error) {
      for (const dl of o.error.split('\n').slice(0, 4)) {
        lines.push(`     ${c.dim}${dl}${c.reset}`)
      }
    }
  }
  lines.push('')
  const fixed   = result.outcomes.filter(o => !o.skipped && o.after === 'ok').length
  const failed  = result.outcomes.filter(o => !o.skipped && o.after === 'error').length
  const skipped = result.outcomes.filter(o => o.skipped).length
  const parts = [
    `${result.eligible} fixable`,
    `${c.green}${fixed} fixed${c.reset}`,
    failed  > 0 ? `${c.red}${failed} failed${c.reset}`  : `${c.dim}0 failed${c.reset}`,
    skipped > 0 ? `${c.yellow}${skipped} skipped${c.reset}` : `${c.dim}0 skipped${c.reset}`,
  ]
  lines.push(parts.join(`${c.dim} · ${c.reset}`))
  return lines.join('\n')
}

function arrowIcon(status: CheckOutcome['status'], c: typeof ANSI | Record<string, string>): string {
  return status === 'error'
    ? `${c.red}✗${c.reset}`
    : status === 'warn'
      ? `${c.yellow}⚠${c.reset}`
      : `${c.green}✓${c.reset}`
}
