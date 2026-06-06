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

test('parseFlags — orm=native', () => {
  const r = parseFlags(['my-app', '--orm=native'])
  assert.strictEqual(r.partial.orm, 'native')
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

// ─── validateJsonMode ───────────────────────────────────────

test('validateJsonMode — empty input lists every required flag (legacy path)', () => {
  const missing = validateJsonMode(undefined, {})
  assert.ok(missing.includes('<project-name>'))
  assert.ok(missing.includes('--orm'))
  assert.ok(missing.includes('--packages'))
  assert.ok(missing.includes('--frameworks'))
  assert.ok(missing.includes('--tailwind'))
  assert.ok(missing.includes('--install'))
})

test('validateJsonMode — orm=false skips --db', () => {
  const missing = validateJsonMode('app', { orm: false })
  assert.ok(!missing.includes('--db'))
  assert.ok(missing.includes('--packages'))
})

test('validateJsonMode — orm=native skips --db (defaults to sqlite)', () => {
  const missing = validateJsonMode('app', { orm: 'native' })
  assert.ok(!missing.includes('--db'))
})

test('resolveJsonAnswers — orm=native without --db defaults to sqlite', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'native', packages: packagesFromList(['auth'], 'native'),
    frameworks: ['react'], tailwind: false, install: false,
  })
  assert.strictEqual(answers.orm, 'native')
  assert.strictEqual(answers.db, 'sqlite')
})

test('resolveJsonAnswers — orm=native honors explicit --db=postgresql (legacy path)', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'native', db: 'postgresql', packages: packagesFromList(['auth'], 'native'),
    frameworks: ['react'], tailwind: false, install: false,
  })
  assert.strictEqual(answers.orm, 'native')
  assert.strictEqual(answers.db, 'postgresql')
  assert.strictEqual(answers.dbReady, false, 'pg defaults to dbReady=false — migrate needs a live server')
})

test('resolveJsonAnswers — orm=native honors explicit --db=mysql (legacy path)', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'native', db: 'mysql', packages: packagesFromList(['auth'], 'native'),
    frameworks: ['react'], tailwind: false, install: false,
  })
  assert.strictEqual(answers.orm, 'native')
  assert.strictEqual(answers.db, 'mysql')
})

test('validateJsonMode — single framework skips --primary-framework', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['react'], tailwind: true, shadcn: true, install: false,
  })
  assert.ok(!missing.includes('--primary-framework'))
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — multi-framework requires --primary-framework', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['react', 'vue'], tailwind: true, shadcn: true, install: false,
  })
  assert.ok(missing.includes('--primary-framework'))
})

test('validateJsonMode — react + tailwind=true requires --shadcn', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList([], 'prisma'),
    frameworks: ['react'], tailwind: true, install: false,
  })
  assert.ok(missing.includes('--shadcn'))
})

test('validateJsonMode — react + tailwind=false skips --shadcn', () => {
  const missing = validateJsonMode('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList([], 'prisma'),
    frameworks: ['react'], tailwind: false, install: false,
  })
  assert.ok(!missing.includes('--shadcn'))
})

// ─── resolveJsonAnswers ─────────────────────────────────────

test('resolveJsonAnswers — defaults primary to first framework when omitted', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['vue'], tailwind: false, install: false,
  })
  assert.strictEqual(answers.primary, 'vue')
})

test('resolveJsonAnswers — orm=false coerces db to sqlite (unused)', () => {
  const answers = resolveJsonAnswers('app', {
    orm: false, packages: packagesFromList([], false),
    frameworks: ['react'], tailwind: false, install: false,
  })
  assert.strictEqual(answers.db, 'sqlite')
  assert.strictEqual(answers.orm, false)
})

// ─── Recipe path (new flow) ─────────────────────────────────

test('parseFlags — --recipe=web-app sets partial.recipe', () => {
  const r = parseFlags(['my-app', '--recipe=web-app'])
  assert.strictEqual(r.partial.recipe, 'web-app')
})

test('parseFlags — invalid --recipe rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--recipe=bogus']), FlagError)
})

test('parseFlags — --framework=react sets singular frameworks + primary', () => {
  const r = parseFlags(['my-app', '--framework=react'])
  assert.deepStrictEqual(r.partial.frameworks, ['react'])
  assert.strictEqual(r.partial.primary, 'react')
})

test('parseFlags — --framework=none yields empty frameworks', () => {
  const r = parseFlags(['my-app', '--framework=none'])
  assert.deepStrictEqual(r.partial.frameworks, [])
})

test('parseFlags — invalid --framework rejected', () => {
  assert.throws(() => parseFlags(['my-app', '--framework=svelte']), FlagError)
})

test('parseFlags — --styling=tailwind+shadcn maps to tailwind+shadcn booleans', () => {
  const r = parseFlags(['my-app', '--styling=tailwind+shadcn'])
  assert.strictEqual(r.partial.tailwind, true)
  assert.strictEqual(r.partial.shadcn,   true)
})

test('parseFlags — --styling=tailwind sets tailwind only', () => {
  const r = parseFlags(['my-app', '--styling=tailwind'])
  assert.strictEqual(r.partial.tailwind, true)
  assert.strictEqual(r.partial.shadcn,   false)
})

test('parseFlags — --styling=plain disables both', () => {
  const r = parseFlags(['my-app', '--styling=plain'])
  assert.strictEqual(r.partial.tailwind, false)
  assert.strictEqual(r.partial.shadcn,   false)
})

test('parseFlags — explicit --tailwind overrides --styling', () => {
  const r = parseFlags(['my-app', '--styling=tailwind+shadcn', '--tailwind=false'])
  assert.strictEqual(r.partial.tailwind, false)
  // --styling still applies to shadcn (no explicit override)
  assert.strictEqual(r.partial.shadcn,   true)
})

test('parseFlags — --git boolean', () => {
  const t = parseFlags(['my-app', '--git=false'])
  assert.strictEqual(t.partial.git, false)
  const f = parseFlags(['my-app', '--git=true'])
  assert.strictEqual(f.partial.git, true)
})

test('parseFlags — --db-ready boolean', () => {
  const r = parseFlags(['my-app', '--db-ready=false'])
  assert.strictEqual(r.partial.dbReady, false)
})

test('validateJsonMode — --recipe=web-app shortens required flags', () => {
  const missing = validateJsonMode('app', {
    recipe:    'web-app',
    db:        'sqlite',
    framework: undefined, // ignored — singular shortcut covered by --framework flag
    frameworks: ['react'],
    install:   true,
  } as never)
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — --recipe=web-app without --framework lists it', () => {
  const missing = validateJsonMode('app', {
    recipe:  'web-app',
    db:      'sqlite',
    install: true,
  })
  assert.ok(missing.includes('--framework'))
})

test('validateJsonMode — --recipe=api-service skips --framework', () => {
  const missing = validateJsonMode('app', {
    recipe:  'api-service',
    db:      'sqlite',
    install: true,
  })
  assert.ok(!missing.includes('--framework'))
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — recipe path never requires --db for the native default', () => {
  const missing = validateJsonMode('app', {
    recipe:     'web-app',
    frameworks: ['react'],
    install:    true,
  })
  assert.ok(!missing.includes('--db'))
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — --recipe + --orm=native does not require --db (defaults to sqlite)', () => {
  const missing = validateJsonMode('app', {
    recipe:     'web-app',
    orm:        'native',
    frameworks: ['react'],
    install:    true,
  })
  assert.ok(!missing.includes('--db'))
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — --recipe + --orm=prisma still requires --db', () => {
  const missing = validateJsonMode('app', {
    recipe:     'web-app',
    orm:        'prisma',
    frameworks: ['react'],
    install:    true,
  })
  assert.ok(missing.includes('--db'))
})

test('validateJsonMode — --recipe=minimal skips --db', () => {
  const missing = validateJsonMode('app', {
    recipe:  'minimal',
    install: true,
  })
  assert.ok(!missing.includes('--db'))
  assert.deepStrictEqual(missing, [])
})

test('validateJsonMode — --recipe=custom still requires --packages', () => {
  const missing = validateJsonMode('app', {
    recipe:  'custom',
    db:      'sqlite',
    install: true,
  })
  assert.ok(missing.includes('--packages'))
})

test('resolveJsonAnswers — recipe=web-app derives auth + native (documented default)', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    db:         'sqlite',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.orm, 'native')
  assert.strictEqual(answers.db,  'sqlite')
  assert.strictEqual(answers.packages.auth, true)
  assert.strictEqual(answers.tailwind, true)
  assert.strictEqual(answers.shadcn,   true)
  assert.strictEqual(answers.recipe,   'web-app')
})

test('resolveJsonAnswers — recipe without --db derives native + sqlite', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.orm, 'native')
  assert.strictEqual(answers.db,  'sqlite')
})

test('resolveJsonAnswers — recipe + explicit non-sqlite --db stays on native', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    db:         'postgresql',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.orm, 'native', 'native supports pg/mysql since 7.9 — the pre-7.9 Prisma fallback is gone')
  assert.strictEqual(answers.db,  'postgresql')
})

test('resolveJsonAnswers — recipe + --orm=native + --db=mysql resolves native on mysql', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    orm:        'native',
    db:         'mysql',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.orm, 'native')
  assert.strictEqual(answers.db,  'mysql')
  assert.strictEqual(answers.dbReady, false)
})

test('resolveJsonAnswers — recipe + explicit --orm overrides the native default', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    orm:        'drizzle',
    db:         'mysql',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.orm, 'drizzle')
  assert.strictEqual(answers.db,  'mysql')
})

test('resolveJsonAnswers — recipe=saas adds queue + mail + notifications', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'saas',
    db:         'sqlite',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.packages.auth,          true)
  assert.strictEqual(answers.packages.queue,         true)
  assert.strictEqual(answers.packages.mail,          true)
  assert.strictEqual(answers.packages.notifications, true)
  assert.strictEqual(answers.packages.broadcast,     false)
})

test('resolveJsonAnswers — recipe=api-service has no frontend', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:  'api-service',
    db:      'sqlite',
    install: true,
  })
  assert.deepStrictEqual(answers.frameworks, [])
  assert.strictEqual(answers.tailwind, false)
  assert.strictEqual(answers.packages.http, true)
})

test('resolveJsonAnswers — recipe=minimal has no orm + no frontend', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:  'minimal',
    install: true,
  })
  assert.strictEqual(answers.orm, false)
  assert.deepStrictEqual(answers.frameworks, [])
  assert.strictEqual(answers.packages.auth, false)
})

test('resolveJsonAnswers — recipe defaults dbReady=true for sqlite', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    db:         'sqlite',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.dbReady, true)
})

test('resolveJsonAnswers — recipe defaults dbReady=false for postgres', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    db:         'postgresql',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.dbReady, false)
})

test('resolveJsonAnswers — recipe defaults git=true', () => {
  const answers = resolveJsonAnswers('app', {
    recipe:     'web-app',
    db:         'sqlite',
    frameworks: ['react'],
    install:    true,
  })
  assert.strictEqual(answers.git, true)
})

test('resolveJsonAnswers — legacy path defaults git+dbReady', () => {
  const answers = resolveJsonAnswers('app', {
    orm: 'prisma', db: 'sqlite', packages: packagesFromList(['auth'], 'prisma'),
    frameworks: ['react'], tailwind: true, shadcn: true, install: true,
  })
  assert.strictEqual(answers.git,     true)
  assert.strictEqual(answers.dbReady, true)
  assert.strictEqual(answers.recipe,  'custom')
})
