// ─── Boot notices ──────────────────────────────────────────
//
// A collected channel for non-fatal boot-time warnings (e.g. "AI provider
// skipped — apiKey empty", "auth using a dev secret"). Providers call
// `bootNotice()` during `boot()` instead of `console.warn`-ing inline, so the
// framework can flush them as ONE grouped, aligned block AFTER the provider
// tree — rather than scattered between providers as they boot. Keeps the dev
// startup readable: banner, tree, ready, then notices as a trailing footnote.
//
// Buffer lives on `globalThis` (not module scope) so a provider package that
// reaches a second copy of @rudderjs/core (bundled + node_modules) still writes
// to the same channel the boot orchestrator drains — same pattern as the
// router / ModelRegistry singletons.

export interface BootNotice {
  /** Short source label, e.g. `'ai'`, `'auth'`. */
  scope: string
  /** One-line message. No prefix/brackets — the renderer adds the scope. */
  message: string
}

const KEY = '__rudderjs_boot_notices__'

function buffer(): BootNotice[] {
  const g = globalThis as Record<string, unknown>
  if (!Array.isArray(g[KEY])) g[KEY] = []
  return g[KEY] as BootNotice[]
}

/**
 * Record a non-fatal boot-time notice. Buffered and flushed as a grouped block
 * after the provider tree (see `drainBootNotices`). Safe to call any time; if
 * nothing ever drains the buffer (e.g. a CLI command, not a server boot) the
 * entries simply accumulate harmlessly until the next drain.
 */
export function bootNotice(scope: string, message: string): void {
  buffer().push({ scope, message })
}

/** Read and clear all buffered notices. Called once per boot by the orchestrator. */
export function drainBootNotices(): BootNotice[] {
  const b = buffer()
  const out = b.slice()
  b.length = 0
  return out
}

const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}

/**
 * @internal — exposed for tests.
 *
 * Render notices as a grouped, scope-aligned block. Returns the lines to print
 * (no trailing flush) so the formatting is unit-testable without capturing
 * console output. Empty input → no lines.
 */
export function formatBootNotices(notices: BootNotice[]): string[] {
  if (notices.length === 0) return []
  const width = Math.max(...notices.map(n => n.scope.length))
  const lines = [`  ${c.yellow('▲')} ${notices.length} notice${notices.length === 1 ? '' : 's'}`]
  for (const n of notices) {
    lines.push(`   ${c.yellow('→')} ${c.yellow(n.scope.padEnd(width))}  ${n.message}`)
  }
  return lines
}
