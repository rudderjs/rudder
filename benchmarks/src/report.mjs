// ─── Report generator ────────────────────────────────────────────────────────
// Renders results/<engine>-<size>.json → results/REPORT.md (SQLite) or
// results/REPORT-postgres.md (Postgres), the committed publishable artifacts.
// Honest by construction: every op shows all three contenders and bolds the
// fastest, win or lose for RudderJS. Engine selected via BENCH_ENGINE.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE, IS_PG } from './engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(HERE, '..', 'results')

const ORDER = ['rudder', 'drizzle', 'prisma']
const LABELS = { rudder: 'RudderJS', drizzle: 'Drizzle', prisma: 'Prisma' }
const ENGINE_NAME = IS_PG ? 'Postgres' : 'SQLite'

const us = (ns) => (ns / 1000).toFixed(2)

function sizeTable(doc) {
  const lines = []
  lines.push(`| Operation | RudderJS | Drizzle | Prisma | Fastest |`)
  lines.push(`|---|--:|--:|--:|---|`)
  for (const op of doc.ops) {
    const byName = Object.fromEntries(op.results.map((r) => [r.contender, r]))
    const fastestNs = Math.min(...op.results.map((r) => r.avg_ns))
    const fastest = op.results.find((r) => r.avg_ns === fastestNs)
    const cells = ORDER.map((name) => {
      const r = byName[name]
      if (!r) return 'n/a'
      const rel = r.avg_ns / fastestNs
      const txt = `${us(r.avg_ns)}µs${rel > 1.005 ? ` (${rel.toFixed(2)}×)` : ''}`
      return r.avg_ns === fastestNs ? `**${us(r.avg_ns)}µs**` : txt
    })
    lines.push(`| ${op.label} | ${cells.join(' | ')} | ${LABELS[fastest.contender]} |`)
  }
  return lines.join('\n')
}

function provenanceBlock(p) {
  return [
    `**Size:** ${p.size} (${p.users} users) · **Date:** ${p.date}`,
    '',
    `- **Machine:** ${p.cpu} (${p.cores} cores) · ${p.os} · ${p.arch} · Node ${p.node}`,
    `- **Versions:** ` +
      Object.entries(p.versions)
        .map(([k, v]) => `\`${k}@${v}\``)
        .join(', '),
    `- **Seed:** \`${p.seed}\` (deterministic)`,
  ].join('\n')
}

function intro() {
  if (IS_PG) {
    return (
      'RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an ' +
      'identical Postgres database over a local socket — no HTTP, no server, no Vike. ' +
      'rudder + Drizzle both run on **porsager `postgres`** (postgres-js), so that pair ' +
      'is a pure query-layer comparison over one driver; **Prisma runs on node-postgres** ' +
      '(it has no porsager adapter — an idiomatic-path difference, not a thumb on the ' +
      'scale). Lower is faster; **bold** is the fastest for that op. Numbers are mean ' +
      'per-call wall time from [mitata](https://github.com/evanwashere/mitata).'
    )
  }
  return (
    'RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an ' +
    'identical `better-sqlite3` file — no HTTP, no server, no Vike. Lower is ' +
    'faster; **bold** is the fastest for that op. Numbers are mean per-call ' +
    'wall time from [mitata](https://github.com/evanwashere/mitata).'
  )
}

function caveat() {
  if (IS_PG) {
    return (
      '> **Reading these numbers:** every call now pays a real network round-trip ' +
      '(~80–100µs floor on a localhost socket), so single-statement ops ' +
      '(insert/find/list/increment/aggregate) cluster near that floor and Prisma\'s ' +
      'query engine is competitive — even ahead — there. The ORMs separate on the ' +
      'query-layer-heavy ops (bulk insert, large hydration, eager + pivot loading), ' +
      'where RudderJS\'s leaner engine still leads. This is the contrast the SQLite ' +
      'report flagged as the committed follow-up: SQLite\'s zero-latency in-process ' +
      'reads under-represent the per-statement engine cost that a socket exposes.\n' +
      '>\n' +
      "> **Increment caveat:** RudderJS's op uses its idiomatic instance path " +
      '(`find()` then `increment()` = two round-trips); Drizzle/Prisma issue a single ' +
      '`UPDATE … RETURNING`. On SQLite the extra round-trip is ~free; over a socket it ' +
      'roughly doubles that one op. The result value is identical (parity-gated) — only ' +
      'the round-trip count differs.'
    )
  }
  return (
    '> **SQLite caveat:** SQLite removes network + connection-pool variance, ' +
    "which under-represents Prisma's query-engine overhead (more visible on Postgres " +
    'over a socket — see [`REPORT-postgres.md`](REPORT-postgres.md)). Read these as ' +
    'query-layer/hydration numbers.'
  )
}

function render(docs) {
  const out = []
  out.push(`# Comparative ORM benchmark — ${ENGINE_NAME} query layer`)
  out.push('')
  out.push(intro())
  out.push('')
  out.push(
    '> Every op is result-parity asserted across all three ORMs before timing ' +
      '(`pnpm bench:parity`) — they each do identical work. Methodology + fairness ' +
      'rules: [`README.md`](../README.md) and ' +
      '[the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).',
  )
  out.push('')
  out.push(caveat())
  out.push('')
  for (const doc of docs) {
    out.push(`## ${ENGINE_NAME} — ${doc.provenance.size}`)
    out.push('')
    out.push(provenanceBlock(doc.provenance))
    out.push('')
    out.push(sizeTable(doc))
    out.push('')
  }
  out.push('---')
  out.push('')
  const setup = IS_PG ? 'pnpm bench:pg:setup && pnpm bench:pg && pnpm bench:pg:report' : 'pnpm bench:setup && pnpm bench && pnpm bench:report'
  out.push(
    `_Regenerate: \`${setup}\`. ` +
      'Headline published numbers come from a pinned local machine, not CI ' +
      '(timing on shared runners is noise)._',
  )
  return out.join('\n') + '\n'
}

const SIZE_ORDER = ['1k', '10k', '100k']
const RX = new RegExp(`^${ENGINE}-.*\\.json$`)
const docs = existsSync(RESULTS_DIR)
  ? readdirSync(RESULTS_DIR)
      .filter((f) => RX.test(f))
      .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')))
      .sort((a, b) => SIZE_ORDER.indexOf(a.provenance.size) - SIZE_ORDER.indexOf(b.provenance.size))
  : []

if (!docs.length) {
  const cmd = IS_PG ? 'pnpm bench:pg' : 'pnpm bench'
  console.error(`[report] no results/${ENGINE}-*.json found — run \`${cmd}\` first`)
  process.exit(1)
}

const outFile = IS_PG ? 'REPORT-postgres.md' : 'REPORT.md'
const out = join(RESULTS_DIR, outFile)
writeFileSync(out, render(docs))
console.log(`[report] wrote ${out.split('/').slice(-2).join('/')} (${docs.length} size(s))`)
