#!/usr/bin/env node
// Realistic-workload bench — boots playground in prod, hits a weighted route
// mix, prints per-route + mixed-workload latency, and (with --save) commits a
// baseline. See playground/bench/README.md for methodology.
//
// Usage (from repo root):
//   pnpm build
//   pnpm --filter=rudderjs-playground run build
//   node playground/bench/realistic.mjs            # run + print
//   node playground/bench/realistic.mjs --save     # also write results/ + REPORT.md
//
// Tunables (env vars):
//   BENCH_PORT          default 3100  — picked off the dev/prod default (3000)
//   BENCH_PER_ROUTE_N   default 200   — sequential requests per route in Phase 1
//   BENCH_MIXED_N       default 5000  — total requests in Phase 2
//   BENCH_CONCURRENCY   default 8     — concurrency for Phase 2
//   BENCH_WARMUP        default 20    — warm-up requests against /api/health
//   BENCH_READY_TIMEOUT default 30000 — ms to wait for [RudderJS] ready
//   BENCH_SAVE          set to 1 (or pass --save) to persist results/ + REPORT.md
//
// The spawned server runs with RUDDER_BENCH=1 so the playground skips its
// per-minute RateLimit middleware — otherwise every request past the cap is a
// 429 and the bench measures rate-limiter rejection, not real work.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'

const __filename  = fileURLToPath(import.meta.url)
const __dirname   = dirname(__filename)
const PLAYGROUND  = resolve(__dirname, '..')
const REPO_ROOT   = resolve(PLAYGROUND, '..')
const RESULTS_DIR = resolve(__dirname, 'results')

const PORT          = Number(process.env.BENCH_PORT          ?? 3100)
const PER_ROUTE_N   = Number(process.env.BENCH_PER_ROUTE_N   ?? 200)
const MIXED_N       = Number(process.env.BENCH_MIXED_N       ?? 5000)
const CONCURRENCY   = Number(process.env.BENCH_CONCURRENCY   ?? 8)
const WARMUP        = Number(process.env.BENCH_WARMUP        ?? 20)
const READY_TIMEOUT = Number(process.env.BENCH_READY_TIMEOUT ?? 30_000)
const SAVE          = process.env.BENCH_SAVE === '1' || process.argv.includes('--save')

const BASE = `http://127.0.0.1:${PORT}`

/** Weighted route mix — see README for rationale. The `:id` find route's id is
 *  resolved at runtime (see resolveUserId) so it never 404s on a seed mismatch. */
const ROUTES = [
  { key: 'health',      path: '/api/health',         weight: 15, label: 'GET /api/health         JSON, floor' },
  { key: 'config',      path: '/api/config',         weight: 15, label: 'GET /api/config         JSON, framework' },
  { key: 'users',       path: '/api/users',          weight: 12, label: 'GET /api/users          JSON, DB list' },
  { key: 'userFind',    path: '/api/users/1',        weight: 13, label: 'GET /api/users/:id      JSON, DB find' },
  { key: 'home',        path: '/',                   weight: 15, label: 'GET /                   view, no-DB' },
  { key: 'about',       path: '/about',              weight: 10, label: 'GET /about              view, no-DB' },
  { key: 'todos',       path: '/demos/todos',        weight: 10, label: 'GET /demos/todos        view, DB' },
  { key: 'polymorphic', path: '/demos/polymorphic',  weight: 10, label: 'GET /demos/polymorphic  view, complex DB' },
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

/** Resolve a real seeded user id from /api/users so the `:id` find route hits a
 *  row instead of 404ing on a hardcoded id that does not match the seed. Falls
 *  back to the static path if the list is empty or unreadable. */
async function resolveUserId() {
  try {
    const r = await fetch(BASE + '/api/users')
    if (!r.ok) return
    const body = await r.json()
    const id = body?.data?.[0]?.id
    if (id !== undefined && id !== null) {
      const route = ROUTES.find((x) => x.key === 'userFind')
      route.path = `/api/users/${id}`
      console.log(`Resolved DB-find route -> ${route.path}`)
    }
  } catch {
    // leave the static fallback path in place
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
  const out = []
  for (const r of ROUTES) {
    const { samples, errors } = await runRoute(r.path, PER_ROUTE_N, 1)
    const s = summary(samples)
    const errFlag = errors.length > 0 ? `  [${errors.length} errors, last status=${errors[errors.length-1].status}]` : ''
    console.log(`${r.label.padEnd(46)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.p99)}${errFlag}`)
    out.push({ key: r.key, label: r.label, path: r.path, errors: errors.length, ...s })
  }
  return out
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
  const throughput = MIXED_N / elapsed
  console.log(`throughput:                                  ${throughput.toFixed(0).padStart(7)} req/s`)
  console.log(`end-to-end latency:                          p50=${fmt(overall.p50)}  p95=${fmt(overall.p95)}  p99=${fmt(overall.p99)}`)
  if (errors.length) console.log(`errors: ${errors.length}/${MIXED_N}`)

  console.log(`\nPer-route under load (c=${CONCURRENCY}):`)
  console.log(`${'route'.padEnd(46)} ${'n'.padStart(5)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)}`)
  const perRouteOut = []
  for (const r of ROUTES) {
    const s = summary(perRoute.get(r.path))
    console.log(`${r.label.padEnd(46)} ${String(s.n).padStart(5)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.p99)}`)
    perRouteOut.push({ key: r.key, label: r.label, ...s })
  }
  return { throughput, overall, errors: errors.length, total: MIXED_N, concurrency: CONCURRENCY, perRoute: perRouteOut }
}

// ─── Persistence ────────────────────────────────────────────────────────────────

function pkgVersion(shortName) {
  try {
    return JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages', shortName, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

function provenance() {
  const packages = {}
  for (const p of ['core', 'server-hono', 'router', 'orm', 'database', 'view', 'vite', 'middleware']) {
    packages[`@rudderjs/${p}`] = pkgVersion(p)
  }
  return {
    date: new Date().toISOString(),
    node: process.version,
    os:   `${os.type()} ${os.release()} ${os.arch()}`,
    cpu:  os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    config: { perRouteN: PER_ROUTE_N, mixedN: MIXED_N, concurrency: CONCURRENCY, warmup: WARMUP },
    packages,
  }
}

function n2(x) { return x.toFixed(2) }

function renderReport(result) {
  const { meta, perRoute, mixed } = result
  const pkgRows = Object.entries(meta.packages).map(([k, v]) => `\`${k}\` ${v}`).join(', ')
  const lines = []
  lines.push('# Realistic-workload HTTP bench — baseline')
  lines.push('')
  lines.push('Through-the-server numbers for the prod **playground** (native engine): boot the')
  lines.push('server, warm it, then hit a weighted route mix. This measures the *whole* request')
  lines.push('path (router + normalization + middleware + handler + SSR), not the query layer in')
  lines.push('isolation (that is `benchmarks/`). Rate limiting is disabled via `RUDDER_BENCH=1`.')
  lines.push('')
  lines.push('Regenerate with `node playground/bench/realistic.mjs --save` from the repo root.')
  lines.push('Numbers come from a pinned local machine, not CI (shared-runner timing is noise).')
  lines.push('')
  lines.push('## Provenance')
  lines.push('')
  lines.push(`- **Date:** ${meta.date}`)
  lines.push(`- **Node:** ${meta.node}`)
  lines.push(`- **OS / CPU:** ${meta.os} — ${meta.cpu} (${meta.cores} cores)`)
  lines.push(`- **Run:** per-route n=${meta.config.perRouteN} (c=1), mixed=${meta.config.mixedN} (c=${meta.config.concurrency}), warmup=${meta.config.warmup}`)
  lines.push(`- **Packages:** ${pkgRows}`)
  lines.push('')
  lines.push('## Per-route, sequential (c=1)')
  lines.push('')
  lines.push('| Route | p50 (ms) | p95 (ms) | p99 (ms) | errors |')
  lines.push('|---|--:|--:|--:|--:|')
  for (const r of perRoute) {
    lines.push(`| ${r.label.trim()} | ${n2(r.p50)} | ${n2(r.p95)} | ${n2(r.p99)} | ${r.errors} |`)
  }
  lines.push('')
  lines.push(`## Mixed weighted (total=${mixed.total}, c=${mixed.concurrency})`)
  lines.push('')
  lines.push(`- **Throughput:** ${mixed.throughput.toFixed(0)} req/s`)
  lines.push(`- **End-to-end latency:** p50 ${n2(mixed.overall.p50)}ms, p95 ${n2(mixed.overall.p95)}ms, p99 ${n2(mixed.overall.p99)}ms`)
  lines.push(`- **Errors:** ${mixed.errors}/${mixed.total}`)
  lines.push('')
  lines.push('| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |')
  lines.push('|---|--:|--:|--:|--:|')
  for (const r of mixed.perRoute) {
    lines.push(`| ${r.label.trim()} | ${r.n} | ${n2(r.p50)} | ${n2(r.p95)} | ${n2(r.p99)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function persist(perRoute, mixed) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const result = { meta: provenance(), perRoute, mixed }
  writeFileSync(resolve(RESULTS_DIR, 'baseline.json'), JSON.stringify(result, null, 2) + '\n')
  writeFileSync(resolve(__dirname, 'REPORT.md'), renderReport(result))
  console.log(`\nSaved results/baseline.json + REPORT.md`)
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
  console.log(`port=${PORT}  per-route=${PER_ROUTE_N}  mixed=${MIXED_N}  c=${CONCURRENCY}  save=${SAVE}`)
  console.log()

  console.log(`Spawning: node dist/server/index.mjs  (cwd=${PLAYGROUND}, RUDDER_BENCH=1)`)
  const child = spawn('node', ['dist/server/index.mjs'], {
    cwd: PLAYGROUND,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', RUDDER_BENCH: '1' },
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
    await resolveUserId()
    const perRoute = await phasePerRoute()
    const mixed = await phaseMixed()
    if (SAVE) persist(perRoute, mixed)
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
