#!/usr/bin/env tsx
// Recapture the snapshot baseline (file count, total bytes, content hash, sorted paths)
// for templates.snapshot.test.ts. Run after any deliberate template-output change.
//
//   pnpm exec tsx scripts/recapture-snapshot.ts
//
// Copy the printed values into templates.snapshot.test.ts (EXPECTED_FILE_COUNT etc.)
// and re-run `pnpm test` to confirm the snapshot test goes green.
import { createHash } from 'node:crypto'
import { getTemplates, type TemplateContext } from '../src/templates.js'

const ctx: TemplateContext = {
  name:       'snapshot-app',
  db:         'sqlite',
  orm:        'prisma',
  authSecret: 'a'.repeat(64),
  appKey:     'b'.repeat(44),
  frameworks: ['react', 'vue'],
  primary:    'react',
  tailwind:   true,
  shadcn:     true,
  pm:         'pnpm',
  packages: {
    auth:          true,
    sanctum:       true,
    passport:      true,
    socialite:     true,
    queue:         true,
    storage:       true,
    scheduler:     true,
    image:         true,
    mail:          true,
    notifications: true,
    broadcast:     true,
    sync:          true,
    ai:            true,
    mcp:           true,
    boost:         true,
    localization:  true,
    pennant:       true,
    telescope:     true,
    pulse:         true,
    horizon:       true,
    crypt:         true,
    http:          true,
    process:       true,
    concurrency:   true,
    terminal:      true,
  },
}

const out = getTemplates(ctx)
const paths = Object.keys(out).sort()
const totalBytes = paths.reduce((s, p) => s + out[p]!.length, 0)
const h = createHash('sha256')
for (const p of paths) {
  h.update(p)
  h.update('\0')
  h.update(out[p]!)
  h.update('\0')
}
console.log(`FILES: ${paths.length}`)
console.log(`BYTES: ${totalBytes}`)
console.log(`HASH:  ${h.digest('hex')}`)
console.log('PATHS:')
for (const p of paths) console.log(`  '${p}',`)
