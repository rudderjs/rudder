// ─── Report generator ────────────────────────────────────────────────────────
// Renders results/sqlite-<size>.json → results/REPORT.md, the committed,
// publishable artifact. Honest by construction: every op shows all three
// contenders and bolds the fastest, win or lose for RudderJS.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(HERE, '..', 'results')

const ORDER = ['rudder', 'drizzle', 'prisma']
const LABELS = { rudder: 'RudderJS', drizzle: 'Drizzle', prisma: 'Prisma' }

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

function render(docs) {
  const out = []
  out.push('# Comparative ORM benchmark — SQLite query layer')
  out.push('')
  out.push(
    'RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an ' +
      'identical `better-sqlite3` file — no HTTP, no server, no Vike. Lower is ' +
      'faster; **bold** is the fastest for that op. Numbers are mean per-call ' +
      'wall time from [mitata](https://github.com/evanwashere/mitata).',
  )
  out.push('')
  out.push(
    '> Every op is result-parity asserted across all three ORMs before timing ' +
      '(`pnpm bench:parity`) — they each do identical work. Methodology + fairness ' +
      'rules: [`README.md`](../README.md) and ' +
      '[the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).',
  )
  out.push('')
  out.push('> **SQLite caveat:** SQLite removes network + connection-pool variance, ' +
    'which under-represents Prisma\'s query-engine overhead (more visible on Postgres ' +
    'over a socket). Read these as query-layer/hydration numbers; Postgres is the ' +
    'committed follow-up.')
  out.push('')
  for (const doc of docs) {
    out.push(`## SQLite — ${doc.provenance.size}`)
    out.push('')
    out.push(provenanceBlock(doc.provenance))
    out.push('')
    out.push(sizeTable(doc))
    out.push('')
  }
  out.push('---')
  out.push('')
  out.push(
    '_Regenerate: `pnpm bench:setup && pnpm bench && pnpm bench:report`. ' +
      'Headline published numbers come from a pinned local machine, not CI ' +
      '(timing on shared runners is noise)._',
  )
  return out.join('\n') + '\n'
}

const SIZE_ORDER = ['1k', '10k', '100k']
const docs = existsSync(RESULTS_DIR)
  ? readdirSync(RESULTS_DIR)
      .filter((f) => /^sqlite-.*\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')))
      .sort((a, b) => SIZE_ORDER.indexOf(a.provenance.size) - SIZE_ORDER.indexOf(b.provenance.size))
  : []

if (!docs.length) {
  console.error('[report] no results/sqlite-*.json found — run `pnpm bench` first')
  process.exit(1)
}

const out = join(RESULTS_DIR, 'REPORT.md')
writeFileSync(out, render(docs))
console.log(`[report] wrote ${out.split('/').slice(-2).join('/')} (${docs.length} size(s))`)
