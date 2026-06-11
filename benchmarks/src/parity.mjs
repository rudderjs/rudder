// ─── Result-parity gate ──────────────────────────────────────────────────────
// The credibility linchpin (plan §Risks): before any timing, prove all three
// contenders return the SAME result for every op. A benchmark where the ORMs
// measure different work is worse than no benchmark. Run standalone
// (`pnpm bench:parity`) or as the gate inside `pnpm bench:setup`.

import assert from 'node:assert/strict'
import { CONTENDERS, OPS } from './contenders/index.mjs'
import { fixtures } from './fixtures.mjs'
import { dbPath } from './setup.mjs'
import { scratchCopy, cleanScratch } from './scratch.mjs'
import { SIZES } from './schema.mjs'

const norm = (v) => JSON.stringify(v)

/** Run every op once per contender on `size` and assert cross-contender equality. */
export async function checkParity(size, { quiet = false } = {}) {
  const fx = fixtures(size)
  const failures = []

  for (const op of OPS) {
    const results = []
    for (const contender of CONTENDERS) {
      // Write ops get a fresh scratch each so they all start from identical
      // state; read ops share the untouched seed.
      const file = op.write ? await scratchCopy(size, `parity-${contender.name}-${op.id}`) : dbPath(size)
      const ctx = await contender.connect(file)
      try {
        const ops = contender.build(ctx, fx)
        results.push({ contender: contender.name, value: await ops[op.id]() })
      } finally {
        await contender.disconnect(ctx)
      }
    }

    const [first, ...rest] = results
    const agree = rest.every((r) => norm(r.value) === norm(first.value))
    if (!agree) {
      failures.push({ op: op.id, results: results.map((r) => `${r.contender}=${norm(r.value)}`) })
    }
    if (!quiet) {
      console.log(
        `[parity] ${op.id.padEnd(13)} ${agree ? '✓' : '✗ MISMATCH'}  ${norm(first.value).slice(0, 60)}`,
      )
    }
  }

  await cleanScratch()
  if (failures.length) {
    const detail = failures.map((f) => `  ${f.op}: ${f.results.join('  ')}`).join('\n')
    throw new assert.AssertionError({
      message: `Result-parity FAILED on ${size} for ${failures.length} op(s):\n${detail}`,
    })
  }
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const size = process.argv.find((a) => a in SIZES) ?? '1k'
  console.log(`[parity] checking all ops on size=${size}\n`)
  await checkParity(size)
  console.log('\n[parity] all ops agree across rudder / drizzle / prisma ✓')
}
