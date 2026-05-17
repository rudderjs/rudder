#!/usr/bin/env node
// Realistic-workload bench — boots playground in prod, hits a weighted route
// mix, prints per-route + mixed-workload latency. See
// docs/plans/2026-05-17-realistic-workload-bench.md for methodology.
//
// Usage (from repo root):
//   pnpm build
//   pnpm --filter=playground run build
//   node playground/bench/realistic.mjs
//
// Tunables (env vars):
//   BENCH_PORT          default 3100  — picked off the dev/prod default (3000)
//   BENCH_PER_ROUTE_N   default 200   — sequential requests per route in Phase 1
//   BENCH_MIXED_N       default 5000  — total requests in Phase 2
//   BENCH_CONCURRENCY   default 8     — concurrency for Phase 2
//   BENCH_WARMUP        default 20    — warm-up requests against /api/health
//   BENCH_READY_TIMEOUT default 30000 — ms to wait for [RudderJS] ready

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename  = fileURLToPath(import.meta.url)
const __dirname   = dirname(__filename)
const PLAYGROUND  = resolve(__dirname, '..')

const PORT          = Number(process.env.BENCH_PORT          ?? 3100)
const PER_ROUTE_N   = Number(process.env.BENCH_PER_ROUTE_N   ?? 200)
const MIXED_N       = Number(process.env.BENCH_MIXED_N       ?? 5000)
const CONCURRENCY   = Number(process.env.BENCH_CONCURRENCY   ?? 8)
const WARMUP        = Number(process.env.BENCH_WARMUP        ?? 20)
const READY_TIMEOUT = Number(process.env.BENCH_READY_TIMEOUT ?? 30_000)

const BASE = `http://127.0.0.1:${PORT}`

/** Weighted route mix — see plan doc for rationale. */
const ROUTES = [
  { path: '/api/health',          weight: 15, label: 'GET /api/health         JSON, floor' },
  { path: '/api/config',          weight: 15, label: 'GET /api/config         JSON, framework' },
  { path: '/api/users',           weight: 12, label: 'GET /api/users          JSON, DB list' },
  { path: '/api/users/seed-1',    weight: 13, label: 'GET /api/users/:id      JSON, DB find' },
  { path: '/',                    weight: 15, label: 'GET /                   view, no-DB' },
  { path: '/about',               weight: 10, label: 'GET /about              view, no-DB' },
  { path: '/demos/todos',         weight: 10, label: 'GET /demos/todos        view, DB' },
  { path: '/demos/polymorphic',   weight: 10, label: 'GET /demos/polymorphic  view, complex DB' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sortNumeric(xs) { return [...xs].sort((a, b) => a - b) }
function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}
function fmt(ms) { return ms.toFixed(2).padStart(7) }

async function hit(path) {
  const t = performance.now()
  const r = await fetch(BASE + path).catch((e) => ({ ok: false, status: 0, error: e }))
  // Drain the body so we time end-to-end, not just headers.
  if (r.ok && r.body) await r.text()
  return { ms: performance.now() - t, status: r.status ?? 0, ok: r.ok }
}

async function runRoute(path, n, concurrency) {
  const samples = []
  const errors  = []
  let i = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = i++
      if (idx >= n) break
      const { ms, status, ok } = await hit(path)
      samples.push(ms)
      if (!ok) errors.push({ path, status, idx })
    }
  }))
  return { samples, errors }
}

function summary(samples) {
  const sorted = sortNumeric(samples)
  return {
    n:   sorted.length,
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    avg: sorted.reduce((s, x) => s + x, 0) / Math.max(1, sorted.length),
  }
}

// ─── Phases ────────────────────────────────────────────────────────────────────

async function warmup() {
  process.stdout.write(`Warming up (${WARMUP} requests to /api/health)... `)
  for (let i = 0; i < WARMUP; i++) await hit('/api/health')
  console.log('done.')
}

async function phasePerRoute() {
  console.log(`\nPer-route, sequential, n=${PER_ROUTE_N} per route, c=1`)
  console.log('─'.repeat(78))
  console.log(`${'route'.padEnd(46)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)}`)
  for (const r of ROUTES) {
    const { samples, errors } = await runRoute(r.path, PER_ROUTE_N, 1)
    const s = summary(samples)
    const errFlag = errors.length > 0 ? `  [${errors.length} errors, last status=${errors[errors.length-1].status}]` : ''
    console.log(`${r.label.padEnd(46)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.p99)}${errFlag}`)
  }
}

async function phaseMixed() {
  console.log(`\nMixed weighted, total=${MIXED_N}, c=${CONCURRENCY}`)
  console.log('─'.repeat(78))

  // Pre-build the weighted sequence so the picker is uniform-random over indices.
  const weighted = []
  for (const r of ROUTES) for (let i = 0; i < r.weight; i++) weighted.push(r)

  const perRoute = new Map() // path -> latencies[]
  for (const r of ROUTES) perRoute.set(r.path, [])
  const allSamples = []
  const errors = []

  const start = performance.now()
  let i = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const idx = i++
      if (idx >= MIXED_N) break
      const route = weighted[Math.floor(Math.random() * weighted.length)]
      const { ms, status, ok } = await hit(route.path)
      perRoute.get(route.path).push(ms)
      allSamples.push(ms)
      if (!ok) errors.push({ path: route.path, status, idx })
    }
  }))
  const elapsed = (performance.now() - start) / 1000

  const overall = summary(allSamples)
  console.log(`throughput:                                  ${(MIXED_N / elapsed).toFixed(0).padStart(7)} req/s`)
  console.log(`end-to-end latency:                          p50=${fmt(overall.p50)}  p95=${fmt(overall.p95)}  p99=${fmt(overall.p99)}`)
  if (errors.length) console.log(`errors: ${errors.length}/${MIXED_N}`)

  console.log(`\nPer-route under load (c=${CONCURRENCY}):`)
  console.log(`${'route'.padEnd(46)} ${'n'.padStart(5)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)}`)
  for (const r of ROUTES) {
    const s = summary(perRoute.get(r.path))
    console.log(`${r.label.padEnd(46)} ${String(s.n).padStart(5)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.p99)}`)
  }
}

// ─── Orchestration ─────────────────────────────────────────────────────────────

async function waitForReady(child, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    let stdout = ''
    const onData = (chunk) => {
      const s = chunk.toString()
      stdout += s
      process.stdout.write(s)
      if (s.includes('[RudderJS] ready') || s.includes('Listening on')) {
        child.stdout.off('data', onData)
        resolveP()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (c) => process.stderr.write(c.toString()))
    setTimeout(() => {
      child.stdout.off('data', onData)
      rejectP(new Error(`Timed out waiting for [RudderJS] ready after ${timeoutMs}ms.\n--- stdout ---\n${stdout}`))
    }, timeoutMs)
  })
}

async function main() {
  console.log(`Realistic-workload bench — playground prod`)
  console.log(`port=${PORT}  per-route=${PER_ROUTE_N}  mixed=${MIXED_N}  c=${CONCURRENCY}`)
  console.log()

  console.log(`Spawning: node dist/server/index.mjs  (cwd=${PLAYGROUND})`)
  const child = spawn('node', ['dist/server/index.mjs'], {
    cwd: PLAYGROUND,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const cleanup = () => { try { child.kill('SIGTERM') } catch {} }
  process.on('SIGINT',  () => { cleanup(); process.exit(130) })
  process.on('SIGTERM', () => { cleanup(); process.exit(143) })

  try {
    await waitForReady(child, READY_TIMEOUT)
    // Server logs "Listening on" before the first-request lazy boot completes.
    // Warm-up explicitly drives the first request so subsequent timings are steady-state.
    await warmup()
    await phasePerRoute()
    await phaseMixed()
  } finally {
    cleanup()
    // Give the child a moment to shut down before exiting.
    await new Promise((r) => setTimeout(r, 200))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
