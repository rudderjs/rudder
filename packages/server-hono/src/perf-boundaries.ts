// Per-phase request latency instrumentation. Gated behind
// RUDDER_PERF_BOUNDARIES=1 — when unset, every public function is a no-op so
// there's zero overhead in production.
//
// Output is dumped to $RUDDER_PERF_OUT (default /tmp/rudder-perf.txt) on
// SIGTERM / SIGINT / beforeExit, as a per-phase percentile table.
//
// This file is dev-only instrumentation — do not export it from the package
// barrel and do not call it without the env flag set.

import { writeFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'

const ENABLED = process.env['RUDDER_PERF_BOUNDARIES'] === '1'

// Propagates the current request's perfId through the async call stack so
// markers inside the route handler can read it without the outer fetch
// handler having to thread it through Request/Response objects.
const als = new AsyncLocalStorage<number>()

export function runWithRequest<T>(perfId: number, fn: () => T): T {
  if (!ENABLED || perfId === 0) return fn()
  return als.run(perfId, fn)
}

export function currentPerfId(): number {
  if (!ENABLED) return 0
  return als.getStore() ?? 0
}

export const BOUNDARIES = [
  'HONO_FETCH_IN',
  'APP_FETCH_IN',
  'ROUTE_HANDLER_IN',
  'NORM_DONE',
  'BODY_PARSE_DONE',
  'MIDDLEWARE_DONE',
  'HANDLER_DONE',
  'VIEW_TORESPONSE_IN',
  'VIEW_TORESPONSE_OUT',
  'APP_FETCH_OUT',
  'HONO_FETCH_OUT',
] as const

export type Boundary = typeof BOUNDARIES[number]

export const B: { readonly [K in Boundary]: number } = Object.freeze(
  Object.fromEntries(BOUNDARIES.map((name, i) => [name, i])) as { [K in Boundary]: number }
)

// Each row is one request — `row[i]` is performance.now() at boundary i, or
// NaN if that boundary wasn't visited (e.g. non-view route skips VIEW_*).
const samples: number[][] = []
const active = new Map<number, number[]>()
let nextId = 0
let dumped = false

export function startRequest(): number {
  if (!ENABLED) return 0
  const id = ++nextId
  active.set(id, new Array(BOUNDARIES.length).fill(NaN))
  return id
}

export function markBoundary(reqId: number, idx: number): void {
  if (!ENABLED || reqId === 0) return
  const row = active.get(reqId)
  if (row) row[idx] = performance.now()
}

export function finishRequest(reqId: number): void {
  if (!ENABLED || reqId === 0) return
  const row = active.get(reqId)
  if (!row) return
  active.delete(reqId)
  samples.push(row)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return '   —  '
  if (ms < 0.01) return ms.toFixed(4)
  if (ms < 10)   return ms.toFixed(3)
  if (ms < 100)  return ms.toFixed(2)
  return ms.toFixed(1)
}

function dump(): void {
  if (dumped) return
  dumped = true
  if (samples.length === 0) return

  const lines: string[] = []
  lines.push(`# RudderJS perf boundaries`)
  lines.push(`# samples=${samples.length}`)
  lines.push('')

  // Per-phase = boundary[i+1] - boundary[i], skipping NaN gaps.
  const phaseStats: { name: string; values: number[] }[] = []
  for (let i = 0; i < BOUNDARIES.length - 1; i++) {
    const from = BOUNDARIES[i]!
    const to = BOUNDARIES[i + 1]!
    const values: number[] = []
    for (const row of samples) {
      const a = row[i]
      const b = row[i + 1]
      if (a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)) {
        values.push(b - a)
      }
    }
    phaseStats.push({ name: `${from} → ${to}`, values })
  }

  // End-to-end = last finite boundary − first finite boundary, per row.
  const endToEnd: number[] = []
  for (const row of samples) {
    let first = NaN, last = NaN
    for (const v of row) { if (Number.isFinite(v)) { first = v; break } }
    for (let i = row.length - 1; i >= 0; i--) { const v = row[i]!; if (Number.isFinite(v)) { last = v; break } }
    if (Number.isFinite(first) && Number.isFinite(last)) endToEnd.push(last - first)
  }
  phaseStats.push({ name: `END_TO_END (HONO_FETCH_IN → HONO_FETCH_OUT)`, values: endToEnd })

  const nameWidth = Math.max(...phaseStats.map(p => p.name.length))
  const header = `${'phase'.padEnd(nameWidth)}  ${'n'.padStart(6)}  ${'p50'.padStart(8)}  ${'p90'.padStart(8)}  ${'p99'.padStart(8)}  ${'max'.padStart(8)}  ${'mean'.padStart(8)}`
  lines.push(header)
  lines.push('-'.repeat(header.length))

  for (const { name, values } of phaseStats) {
    if (values.length === 0) {
      lines.push(`${name.padEnd(nameWidth)}  ${'0'.padStart(6)}  ${'—'.padStart(8)}`)
      continue
    }
    const sorted = [...values].sort((a, b) => a - b)
    const sum = values.reduce((s, v) => s + v, 0)
    const mean = sum / values.length
    lines.push(
      `${name.padEnd(nameWidth)}  ${String(values.length).padStart(6)}  ${fmt(percentile(sorted, 50)).padStart(8)}  ${fmt(percentile(sorted, 90)).padStart(8)}  ${fmt(percentile(sorted, 99)).padStart(8)}  ${fmt(sorted[sorted.length - 1]!).padStart(8)}  ${fmt(mean).padStart(8)}`
    )
  }

  const text = lines.join('\n') + '\n'
  const outPath = process.env['RUDDER_PERF_OUT'] ?? '/tmp/rudder-perf.txt'
  try {
    writeFileSync(outPath, text)
    console.log(`\n[rudder-perf] wrote ${samples.length} samples to ${outPath}`)
  } catch (err) {
    console.error(`[rudder-perf] failed to write ${outPath}:`, err)
  }
}

if (ENABLED) {
  process.once('SIGTERM', () => { dump(); process.exit(0) })
  process.once('SIGINT',  () => { dump(); process.exit(0) })
  process.once('beforeExit', () => { dump() })
}
