import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAgent } from './agent-detect.js'
import { parseFlags, validateJsonMode, resolveJsonAnswers, packagesFromList, FlagError } from './cli-flags.js'

// ─── detectAgent ────────────────────────────────────────────

test('detectAgent — empty env returns no detection', () => {
  const result = detectAgent({})
  assert.strictEqual(result.detected, false)
})

test('detectAgent — recognizes Claude Code via CLAUDECODE', () => {
  const result = detectAgent({ CLAUDECODE: '1' })
  assert.strictEqual(result.detected, true)
  assert.strictEqual(result.name, 'claude-code')
})

test('detectAgent — recognizes Cursor via CURSOR_TRACE_ID', () => {
  const result = detectAgent({ CURSOR_TRACE_ID: 'abc123' })
  assert.strictEqual(result.detected, true)
  assert.strictEqual(result.name, 'cursor')
})

test('detectAgent — recognizes Cursor via TERM_PROGRAM', () => {
  const result = detectAgent({ TERM_PROGRAM: 'cursor' })
  assert.strictEqual(result.detected, true)
  assert.strictEqual(result.name, 'cursor')
})

test('detectAgent — recognizes generic opt-in via RUDDER_NONINTERACTIVE', () => {
  const result = detectAgent({ RUDDER_NONINTERACTIVE: '1' })
  assert.strictEqual(result.detected, true)
  assert.strictEqual(result.name, 'noninteractive')
})

// ─── parseFlags ─────────────────────────────────────────────

test('parseFlags — extracts project name from positional arg', () => {
  const r = parseFlags(['my-app'])
  assert.strictEqual(r.name, 'my-app')
  assert.deepStrictEqual(r.partial, {})
  assert.strictEqual(r.jsonRequested, false)
  assert.strictEqual(r.forceInteractive, false)
})

test('parseFlags — boolean --json and --interactive flags', () => {
  const r = parseFlags(['my-app', '--json', '--interactive'])
  assert.strictEqual(r.jsonRequested, true)
  assert.strictEqual(r.forceInteractive, true)
})

test('parseFlags — orm + db flags', () => {
  const r = parseFlags(['my-app', '--orm=prisma', '--db=sqlite'])
  assert.strictEqual(r.partial.orm, 'prisma')
  assert.strictEqual(r.partial.db, 'sqlite')
})

test('parseFlags — orm=none', () => {
  const r = parseFlags(['my-app', '--orm=none'])
  assert.strictEqual(r.partial.orm, false)
})

test('parseFlags — packages list', () => {
  const r = parseFlags(['my-app', '--orm=prisma', '--packages=auth,queue'])
  assert.strictEqual(r.partial.packages?.auth, true)
  assert.strictEqual(r.partial.packages?.queue, true)
  assert.strictEqual(r.partial.packages?.mail, false)
})

test('parseFlags — packages=* expands to all (DB-gated dropped when orm=none)', () => {
  const r = parseFlags(['my-app', '--orm=none', '--packages=*'])
  assert.strictEqual(r.partial.packages?.auth, false, 'auth gated when orm=none')
  assert.strictEqual(r.partial.packages?.queue, true)
  assert.strictEqual(r.partial.packages?.mail, true)
})

test('parseFlags — packages=* keeps DB-gated when orm=prisma', () => {
  const r = parseFlags(['my-app', '--orm=prisma', '--packages=*'])
  assert.strictEqual(r.partial.packages?.auth, true)
  assert.strictEqual(r.partial.packages?.passport, true)
})

test('parseFlags — frameworks list', () => {
  const r = parseFlags(['my-app', '--frameworks=react,vue'])
  assert.deepStrictEqual(r.partial.frameworks, ['react', 'vue'])
})

test('parseFlags — tailwind boolean', () => {
  const r = parseFlags(['my-app', '--tailwind=true'])
  assert.strictEqual(r.partial.tailwind, true)
  const r2 = parseFlags(['my-app', '--tailwind=false'])
  assert.strictEqual(r2.partial.tailwind, false)
})

test('parseFlags — install boolean', () => {
  const r = parseFlags(['my-app', '--install=false'])
  assert.strictEqual(r.partial.install, false)
})

test('parseFlags — empty demos list resolves to []', () => {
  const r = parseFlags(['my-app', '--demos='])
  assert.deepStrictEqual(r.partial.demos, [])
})

test('parseFlags — demos=* is preserved (expanded later)', () => {
  const r = parseFlags(['my-app', '--demos=*'])
  assert.deepStrictEqual(r.partial.demos, ['*'])
})

test('parseFlags — invalid orm rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--orm=mongo']), FlagError)
})

test('parseFlags — invalid db rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--orm=prisma', '--db=oracle']), FlagError)
})

test('parseFlags — unknown package rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--packages=auth,bogus']), FlagError)
})

test('parseFlags — unknown framework rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--frameworks=svelte']), FlagError)
})

test('parseFlags — unknown demo rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--demos=bogus-demo']), FlagError)
})

// ─── validateJsonMode ───────────────────────────────────────

test('validateJsonMode — empty input lists every required flag', () => {
  const missing = validateJsonMode(undefined, {})
  assert.ok(missing.includes('<project-name>'))
  assert.ok(missing.includes('--orm'))
  assert.ok(missing.includes('--packages'))
  assert.ok(missing.includes('--frameworks'))
  assert.ok(missing.includes('--tailwind'))
  assert.ok(missing.includes('--demos'))
  assert.ok(missing.includes('--install'))
})

test('validateJsonMode — orm=false skips --db', () => {
  const missing = validateJsonMode('app', { orm: false })
  assert.ok(!missing.includes('--db'))
  assert.ok(missing.includes('--packages'))
})

test('validateJsonMode — single framework skips --primary-framework', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['react'], tailwind: true, shadcn: true, demos: [], install: false,
  })
  assert.ok(!missing.includes('--primary-framework'))
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — multi-framework requires --primary-framework', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['react', 'vue'], tailwind: true, shadcn: true, demos: [], install: false,
  })
  assert.ok(missing.includes('--primary-framework'))
})

test('validateJsonMode — react + tailwind=true requires --shadcn', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList([], 'prisma'),
    frameworks: ['react'], tailwind: true, demos: [], install: false,
  })
  assert.ok(missing.includes('--shadcn'))
})

test('validateJsonMode — react + tailwind=false skips --shadcn', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList([], 'prisma'),
    frameworks: ['react'], tailwind: false, demos: [], install: false,
  })
  assert.ok(!missing.includes('--shadcn'))
})

// ─── resolveJsonAnswers ─────────────────────────────────────

test('resolveJsonAnswers — defaults primary to first framework when omitted', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['vue'], tailwind: false, demos: [], install: false,
  })
  assert.strictEqual(answers.primary, 'vue')
})

test('resolveJsonAnswers — demos=* expands for react primary', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'prisma', db: 'sqlite',
    packages: packagesFromList(['auth', 'queue', 'mail'], 'prisma'),
    frameworks: ['react'], tailwind: false, demos: ['*'], install: false,
  })
  assert.ok(answers.demos.length > 0)
  assert.ok(answers.demos.includes('queue'))
  assert.ok(answers.demos.includes('mail'))
})

test('resolveJsonAnswers — demos=* yields empty for non-react primary', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'prisma', db: 'sqlite',
    packages: packagesFromList(['auth', 'queue'], 'prisma'),
    frameworks: ['vue'], tailwind: false, demos: ['*'], install: false,
  })
  assert.deepStrictEqual(answers.demos, [])
})

test('resolveJsonAnswers — orm=false coerces db to sqlite (unused)', () => {
  const answers = resolveJsonAnswers('app', {
    orm: false, packages: packagesFromList([], false),
    frameworks: ['react'], tailwind: false, demos: [], install: false,
  })
  assert.strictEqual(answers.db, 'sqlite')
  assert.strictEqual(answers.orm, false)
})
