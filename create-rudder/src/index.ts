#!/usr/bin/env node
import {
  intro, outro, text, select, groupMultiselect, confirm, spinner, log,
  isCancel, cancel,
} from '@clack/prompts'
import fs     from 'node:fs/promises'
import os     from 'node:os'
import path   from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { getTemplates, detectPackageManager, pmRun, pmInstall, type PackageManager, type TemplateContext } from './templates.js'
import { detectAgent } from './agent-detect.js'
import { printLogo } from './logo.js'
import {
  parseFlags, validateJsonMode, resolveJsonAnswers, packagesFromList,
  FlagError, DB_GATED, RECIPES,
  type Answers, type PartialAnswers, type ParsedFlags,
  type Frameworks, type Orm, type Db, type Recipe,
} from './cli-flags.js'

// ──────────────────────────────────────────────────────────────
// Interactive prompt flow — only prompts for what's missing
// ──────────────────────────────────────────────────────────────

async function gatherInteractive(name: string | undefined, p: PartialAnswers): Promise<Answers> {
  let resolvedName: string
  if (p.name) resolvedName = p.name
  else if (name) {
    resolvedName = name
    console.log(`  Project name: ${name}`)
  } else {
    const answer = await text({
      message:     'Project name',
      placeholder: 'my-app',
      validate:    (v) => (v ?? '').trim().length === 0 ? 'Project name is required' : undefined,
    })
    if (isCancel(answer)) { cancel('Cancelled.'); process.exit(0) }
    resolvedName = (answer as string).trim()
  }

  // ── Recipe (the one-question replacement for the 25-option multiselect) ──
  let recipe: Recipe
  if (p.recipe) recipe = p.recipe
  else {
    const recipeAnswer = await select({
      message: 'What are you building?',
      options: [
        { value: 'web-app',     label: 'Web app',     hint: 'auth + ORM + frontend' },
        { value: 'saas',        label: 'SaaS',        hint: '+ queue + mail + notifications' },
        { value: 'api-service', label: 'API service', hint: 'ORM + auth + http, no frontend' },
        { value: 'realtime',    label: 'Realtime',    hint: '+ broadcast + sync (WebSocket)' },
        { value: 'minimal',     label: 'Minimal',     hint: 'just the framework — no extras' },
        { value: 'custom',      label: 'Custom',      hint: 'pick packages yourself' },
      ],
      initialValue: 'web-app',
    })
    if (isCancel(recipeAnswer)) { cancel('Cancelled.'); process.exit(0) }
    recipe = recipeAnswer as Recipe
  }

  const preset = recipe === 'custom' ? null : RECIPES[recipe]

  // ── Database ORM + driver ──
  let orm: Orm
  if (p.orm !== undefined) orm = p.orm
  else if (preset && !preset.needsOrm) orm = false
  else {
    const ormAnswer = await select({
      message: 'Database',
      options: recipe === 'minimal' || recipe === 'custom'
        ? [
            { value: 'native',  label: 'Native',  hint: 'built-in — SQLite/Postgres/MySQL, no external ORM' },
            { value: 'prisma',  label: 'Prisma'  },
            { value: 'drizzle', label: 'Drizzle' },
            { value: 'none',    label: 'None',    hint: 'no database' },
          ]
        : [
            { value: 'native',  label: 'Native',  hint: 'built-in — SQLite/Postgres/MySQL, no external ORM' },
            { value: 'prisma',  label: 'Prisma'  },
            { value: 'drizzle', label: 'Drizzle' },
          ],
      initialValue: 'native',
    })
    if (isCancel(ormAnswer)) { cancel('Cancelled.'); process.exit(0) }
    orm = ormAnswer === 'none' ? false : ormAnswer as 'prisma' | 'drizzle' | 'native'
  }

  let db: Db = p.db ?? 'sqlite'
  if (orm && p.db === undefined) {
    const dbAnswer = await select({
      message: 'Database driver',
      options: [
        { value: 'sqlite',     label: 'SQLite',     hint: 'recommended — no setup' },
        { value: 'postgresql', label: 'PostgreSQL' },
        { value: 'mysql',      label: 'MySQL / MariaDB' },
      ],
      initialValue: 'sqlite',
    })
    if (isCancel(dbAnswer)) { cancel('Cancelled.'); process.exit(0) }
    db = dbAnswer as Db
  }

  // ── Packages: recipe preset OR explicit Custom multiselect ──
  let packages: TemplateContext['packages']
  if (p.packages !== undefined) packages = p.packages
  else if (recipe !== 'custom') {
    packages = packagesFromList([...(preset?.packages ?? [])] as string[], orm)
  } else {
    packages = await promptCustomPackages(orm)
  }

  if (packages.passport && (!packages.auth || orm !== 'prisma')) {
    cancel('Passport requires Auth + Prisma. Re-run and select both, or drop Passport.')
    process.exit(1)
  }

  // ── Frontend framework + styling (skipped for API-service / Minimal) ──
  const wantsFrontend = preset
    ? preset.needsFrontend
    : (recipe === 'minimal' ? false : true)

  let frameworks: Frameworks
  let primary:    'react' | 'vue' | 'solid' = 'react'
  let tailwind:   boolean
  let shadcn:     boolean

  if (!wantsFrontend && p.frameworks === undefined) {
    frameworks = []
    tailwind   = false
    shadcn     = false
  } else if (p.frameworks?.length) {
    // legacy multi-framework flag path
    frameworks = p.frameworks
    primary    = p.primary ?? frameworks[0]!
    tailwind   = p.tailwind ?? true
    shadcn     = p.shadcn   ?? (frameworks.includes('react') && tailwind)
  } else {
    const frameworkAnswer = await select({
      message: 'Frontend framework',
      options: [
        { value: 'react', label: 'React', hint: 'recommended' },
        { value: 'vue',   label: 'Vue'                       },
        { value: 'solid', label: 'Solid'                     },
        { value: 'none',  label: 'None',  hint: 'server-rendered HTML only' },
      ],
      initialValue: 'react',
    })
    if (isCancel(frameworkAnswer)) { cancel('Cancelled.'); process.exit(0) }
    const fw = frameworkAnswer as 'react' | 'vue' | 'solid' | 'none'
    frameworks = fw === 'none' ? [] : [fw]
    primary    = fw === 'none' ? 'react' : fw

    if (frameworks.length === 0) {
      tailwind = p.tailwind ?? false
      shadcn   = false
    } else if (p.tailwind !== undefined) {
      tailwind = p.tailwind
      shadcn   = p.shadcn ?? (fw === 'react' && tailwind)
    } else {
      const stylingAnswer = await select({
        message: 'Styling',
        options: fw === 'react'
          ? [
              { value: 'tailwind+shadcn', label: 'Tailwind + shadcn/ui', hint: 'recommended' },
              { value: 'tailwind',        label: 'Tailwind only'                              },
              { value: 'plain',           label: 'Plain CSS',            hint: 'no framework' },
            ]
          : [
              { value: 'tailwind', label: 'Tailwind',  hint: 'recommended' },
              { value: 'plain',    label: 'Plain CSS', hint: 'no framework' },
            ],
        initialValue: fw === 'react' ? 'tailwind+shadcn' : 'tailwind',
      })
      if (isCancel(stylingAnswer)) { cancel('Cancelled.'); process.exit(0) }
      tailwind = stylingAnswer !== 'plain'
      shadcn   = stylingAnswer === 'tailwind+shadcn'
    }
  }

  // ── Smart DB-push: for non-SQLite ask once whether the DB is reachable ──
  let dbReady: boolean
  if (p.dbReady !== undefined) dbReady = p.dbReady
  else if (orm === false) dbReady = false
  else if (db === 'sqlite') dbReady = true
  else {
    const dbReadyAnswer = await confirm({
      message:      `Is your ${db === 'postgresql' ? 'Postgres' : 'MySQL'} running now? (we'll ${orm === 'native' ? 'run your migrations' : 'push the schema'} for you)`,
      initialValue: true,
    })
    if (isCancel(dbReadyAnswer)) { cancel('Cancelled.'); process.exit(0) }
    dbReady = dbReadyAnswer as boolean
  }

  let install: boolean
  if (p.install !== undefined) install = p.install
  else {
    const installAnswer = await confirm({ message: 'Install and run setup?', initialValue: true })
    if (isCancel(installAnswer)) { cancel('Cancelled.'); process.exit(0) }
    install = installAnswer as boolean
  }

  const git = p.git ?? install

  return {
    name: resolvedName, recipe, orm, db, packages, frameworks, primary, tailwind, shadcn,
    git, dbReady, install,
  }
}

// ──────────────────────────────────────────────────────────────
// Custom-recipe package picker — only shown for `recipe = 'custom'`
// ──────────────────────────────────────────────────────────────

async function promptCustomPackages(orm: Orm): Promise<TemplateContext['packages']> {
  type Pkg = { value: string; label: string; hint?: string }
  const PACKAGE_GROUPS: Record<string, Pkg[]> = {
    'Auth & Security': [
      { value: 'auth',          label: 'Authentication',        hint: 'login, register, sessions' },
      { value: 'sanctum',       label: 'Sanctum',               hint: 'API tokens (SHA-256 + abilities)' },
      { value: 'passport',      label: 'Passport',              hint: 'OAuth2 server — requires Auth + Prisma' },
      { value: 'socialite',     label: 'Socialite',             hint: 'social login: GitHub, Google, Facebook, Apple' },
      { value: 'crypt',         label: 'Crypt',                 hint: 'AES-256-CBC + HMAC encryption' },
    ],
    'Infrastructure': [
      { value: 'queue',         label: 'Queue',                 hint: 'background jobs' },
      { value: 'storage',       label: 'Storage',               hint: 'file uploads (local + S3)' },
      { value: 'scheduler',     label: 'Scheduler',             hint: 'cron-like task scheduling' },
    ],
    'Communication': [
      { value: 'mail',          label: 'Mail',                  hint: 'SMTP + log driver' },
      { value: 'notifications', label: 'Notifications',         hint: 'multi-channel notifications' },
      { value: 'broadcast',     label: 'WebSocket / Broadcast', hint: 'real-time channels' },
      { value: 'sync',          label: 'Sync (Yjs CRDT)',       hint: 'collaborative documents' },
    ],
    'Internationalization': [
      { value: 'localization',  label: 'Localization',          hint: 'i18n — trans(), setLocale()' },
    ],
    'Developer Experience': [
      { value: 'pennant',       label: 'Pennant',               hint: 'feature flags' },
      { value: 'http',          label: 'HTTP',                  hint: 'fluent fetch client — retries, timeouts, pools' },
      { value: 'process',       label: 'Process',               hint: 'shell execution — run, pool, pipe' },
      { value: 'concurrency',   label: 'Concurrency',           hint: 'parallel execution via worker threads' },
      { value: 'terminal',      label: 'Terminal',              hint: 'rich terminal UIs from CLI commands (Ink)' },
    ],
    'Media': [
      { value: 'image',         label: 'Image',                 hint: 'resize, crop, convert (sharp wrapper)' },
    ],
    'Observability': [
      { value: 'telescope',     label: 'Telescope',             hint: 'debug dashboard — requests, queries, jobs, exceptions' },
      { value: 'pulse',         label: 'Pulse',                 hint: 'metrics dashboard — throughput, latency, hit rates' },
      { value: 'horizon',       label: 'Horizon',               hint: 'queue monitoring — lifecycle, workers, retry/delete' },
    ],
    'AI & Tooling': [
      { value: 'ai',            label: 'AI',                    hint: 'LLM providers (Anthropic, OpenAI, Google, Ollama)' },
      { value: 'mcp',           label: 'MCP',                   hint: 'Model Context Protocol — expose tools/resources to LLMs' },
      { value: 'boost',         label: 'Boost',                 hint: 'AI coding DX (Claude Code/Cursor/Copilot)' },
    ],
  }

  if (orm === false) log.info('Database not selected — auth, sanctum, and passport options are hidden.')

  const groupedOptions: Record<string, Pkg[]> = {}
  for (const [group, pkgs] of Object.entries(PACKAGE_GROUPS)) {
    const visible = orm === false ? pkgs.filter(p => !DB_GATED.has(p.value)) : pkgs
    if (visible.length > 0) groupedOptions[group] = visible
  }

  const packageAnswer = await groupMultiselect({
    message:          'Select packages',
    options:          groupedOptions,
    initialValues:    orm === false ? [] : ['auth'],
    required:         false,
    selectableGroups: false,
  })
  if (isCancel(packageAnswer)) { cancel('Cancelled.'); process.exit(0) }
  return packagesFromList(packageAnswer as string[], orm)
}

// ──────────────────────────────────────────────────────────────
// Scaffolding (file generation + optional install)
// ──────────────────────────────────────────────────────────────

interface ScaffoldOptions {
  pm:         PackageManager
  /** When true, no console output during scaffolding (JSON mode). */
  quiet:      boolean
  /** When set, install logs are appended here for failure diagnostics. */
  logFile?:   string
}

interface ScaffoldResult {
  target:           string
  filesWritten:     number
  authViewsCopied:  boolean
  installAttempted: boolean
  installOk:        boolean
  discoverOk:       boolean
  /** `rudder db:generate` — null = skipped (no ORM / install failed). */
  dbGenerateOk:     boolean | null
  /** `rudder db:push` — null = skipped (no ORM / non-SQLite + dbReady=false). */
  dbPushOk:         boolean | null
  /** `rudder vendor:publish --tag=auth-views-*` — null = skipped (no auth). */
  vendorPublishOk:  boolean | null
  /** `rudder passport:keys` — null = skipped (no passport). */
  passportKeysOk:   boolean | null
  /** `git init` + initial commit — null = skipped (user opted out, or git not available). */
  gitInitOk:        boolean | null
}

async function scaffold(answers: Answers, opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const { pm, quiet, logFile } = opts
  const target     = path.resolve(process.cwd(), answers.name)
  const authSecret = randomBytes(32).toString('hex')
  const appKey     = randomBytes(32).toString('base64')

  // Make sure target directory doesn't exist
  try {
    await fs.access(target)
    throw new ScaffoldError(`Directory "${answers.name}" already exists.`)
  } catch (e) {
    if (e instanceof ScaffoldError) throw e
    // ENOENT — good, directory doesn't exist
  }

  const s = quiet ? null : spinner()
  s?.start('Scaffolding project files...')

  const templates = getTemplates({
    name: answers.name, db: answers.db, orm: answers.orm,
    authSecret, appKey,
    frameworks: answers.frameworks, primary: answers.primary,
    tailwind: answers.tailwind, shadcn: answers.shadcn,
    pm, packages: answers.packages,
  })

  for (const [filePath, content] of Object.entries(templates)) {
    const abs = path.join(target, filePath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  let authViewsCopied = true
  if (answers.packages.auth) {
    try {
      const require      = createRequire(import.meta.url)
      const authPkgPath  = require.resolve('@rudderjs/auth/package.json')
      const authViewsDir = path.join(path.dirname(authPkgPath), 'views', answers.primary)
      await fs.cp(authViewsDir, path.join(target, 'app', 'Views', 'Auth'), { recursive: true })
    } catch {
      authViewsCopied = false
    }
  }

  s?.stop(`${Object.keys(templates).length} files written`)

  let installAttempted = false, installOk = false, discoverOk = false
  let dbGenerateOk: boolean | null    = null
  let dbPushOk: boolean | null        = null
  let vendorPublishOk: boolean | null = null
  let passportKeysOk: boolean | null  = null
  let gitInitOk: boolean | null       = null

  if (answers.install) {
    installAttempted = true
    const s2 = quiet ? null : spinner()
    s2?.start(`Installing dependencies with ${pm}...`)
    const [cmd, ...args] = pmInstall(pm).split(' ')
    installOk = await runChild(cmd!, args, target, logFile)
    s2?.stop(installOk ? 'Dependencies installed' : `${pmInstall(pm)} failed — run it manually`)

    if (installOk) {
      const s3 = quiet ? null : spinner()
      s3?.start('Discovering framework providers...')
      discoverOk = await runRudder(pm, 'providers:discover', target, logFile)
      s3?.stop(discoverOk
        ? 'Provider manifest generated'
        : `providers:discover failed — run \`${pmRun(pm, 'rudder')} providers:discover\` manually`)

      // ── Auto-cascade — only when install + providers:discover both succeed ──
      if (discoverOk && answers.orm === 'native') {
        // Native engine: no client to generate, and db:push is prisma/drizzle-only.
        // `migrate` creates/connects the database, applies the scaffolded
        // migrations, and writes the typed schema (app/Models/__schema/
        // registry.d.ts). dbPushOk carries the result through to the
        // manual-steps panel below. On pg/mysql this needs a live server, so
        // it honors dbReady the same way the db:push path does (sqlite is
        // always "ready" — the driver creates the file).
        if (answers.dbReady) {
          const s4 = quiet ? null : spinner()
          s4?.start('Applying migrations...')
          dbPushOk = await runRudder(pm, 'migrate', target, logFile)
          s4?.stop(dbPushOk
            ? 'Migrations applied'
            : `migrate failed — run \`${pmRun(pm, 'rudder')} migrate\` manually`)
        }
      } else {
        if (discoverOk && answers.orm) {
          const s4 = quiet ? null : spinner()
          s4?.start('Generating database client...')
          dbGenerateOk = await runRudder(pm, 'db:generate', target, logFile)
          s4?.stop(dbGenerateOk
            ? (answers.orm === 'prisma' ? 'Prisma client generated' : 'Client step skipped (Drizzle)')
            : `db:generate failed — run \`${pmRun(pm, 'rudder')} db:generate\` manually`)
        }

        if (discoverOk && answers.orm && answers.dbReady) {
          const s5 = quiet ? null : spinner()
          s5?.start('Pushing schema to database...')
          dbPushOk = await runRudder(pm, 'db:push', target, logFile)
          const niceDb = answers.db === 'sqlite' ? 'dev.db ready' : 'schema pushed'
          s5?.stop(dbPushOk
            ? niceDb
            : `db:push failed — start your database and run \`${pmRun(pm, 'rudder')} db:push\``)
        }
      }

      if (discoverOk && answers.packages.auth && !authViewsCopied) {
        const s6 = quiet ? null : spinner()
        s6?.start('Publishing auth views...')
        vendorPublishOk = await runRudder(pm, `vendor:publish --tag=auth-views-${answers.primary}`, target, logFile)
        s6?.stop(vendorPublishOk
          ? 'Auth views published'
          : `vendor:publish failed — run \`${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${answers.primary}\``)
      }

      if (discoverOk && answers.packages.passport) {
        const s7 = quiet ? null : spinner()
        s7?.start('Generating Passport keys...')
        passportKeysOk = await runRudder(pm, 'passport:keys', target, logFile)
        s7?.stop(passportKeysOk
          ? 'Passport keys generated'
          : `passport:keys failed — run \`${pmRun(pm, 'rudder')} passport:keys\` manually`)
      }
    }
  }

  // ── git init — independent of install; runs whenever user opted in ──
  if (answers.git) {
    const s8 = quiet ? null : spinner()
    s8?.start('Initializing git repository...')
    gitInitOk = await runGitInit(target, logFile)
    s8?.stop(gitInitOk
      ? 'Git initialized'
      : 'git init skipped — git not available or already a repo')
  }

  return {
    target,
    filesWritten: Object.keys(templates).length,
    authViewsCopied,
    installAttempted, installOk, discoverOk,
    dbGenerateOk, dbPushOk, vendorPublishOk, passportKeysOk, gitInitOk,
  }
}

/** Run a `rudder <subcommand>` in the target dir. Subcommand may include flags. */
async function runRudder(pm: PackageManager, subcommand: string, cwd: string, logFile?: string): Promise<boolean> {
  const [cmd, ...args] = `${pmRun(pm, 'rudder')} ${subcommand}`.split(' ').filter(Boolean)
  return runChild(cmd!, args, cwd, logFile)
}

/** `git init` + first commit. Returns false if git isn't on $PATH or the dir is already a repo. */
async function runGitInit(cwd: string, logFile?: string): Promise<boolean> {
  // Probe `git --version` first so we don't write a half-init repo on systems without git.
  const hasGit = await runChild('git', ['--version'], cwd, logFile)
  if (!hasGit) return false
  // If `.git/` exists (rare in scaffolded apps but possible) bail rather than commit blindly.
  try { await fs.access(path.join(cwd, '.git')); return false } catch { /* good — no existing repo */ }

  if (!await runChild('git', ['init', '-q'],                                      cwd, logFile)) return false
  if (!await runChild('git', ['add', '.'],                                        cwd, logFile)) return false
  // -q silences the commit summary; --no-gpg-sign avoids pgp prompts on fresh machines.
  if (!await runChild('git', ['commit', '-q', '-m', 'Initial commit (create-rudder)', '--no-gpg-sign'], cwd, logFile)) return false
  return true
}

class ScaffoldError extends Error {}

function runChild(cmd: string, args: string[], cwd: string, logFile?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe' })
    if (logFile) {
      child.stdout?.on('data', (b: Buffer) => { void fs.appendFile(logFile, b) })
      child.stderr?.on('data', (b: Buffer) => { void fs.appendFile(logFile, b) })
    }
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

async function readLogTail(logFile: string, lines = 40): Promise<string> {
  try {
    const text = await fs.readFile(logFile, 'utf8')
    return text.split('\n').slice(-lines).join('\n')
  } catch {
    return ''
  }
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const pm   = detectPackageManager()

  let parsed: ParsedFlags
  try {
    parsed = parseFlags(argv)
  } catch (err) {
    if (err instanceof FlagError) {
      // Always emit JSON for flag errors when an agent is detected; otherwise
      // print a friendly message and exit 1.
      const agent = detectAgent()
      if (agent.detected) {
        process.stdout.write(JSON.stringify({
          success: false,
          error:   err.message,
          ...(agent.name !== undefined ? { agent: agent.name } : {}),
        }) + '\n')
        process.exit(1)
      }
      console.error(`\n  ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }

  const agent    = detectAgent()
  const jsonMode = !parsed.forceInteractive && (parsed.jsonRequested || agent.detected)

  if (jsonMode) {
    const missing = validateJsonMode(parsed.name, parsed.partial)
    if (missing.length > 0) {
      process.stdout.write(JSON.stringify({
        success:        false,
        error:          `Missing required flags for non-interactive mode: ${missing.join(', ')}`,
        requiredFlags:  missing,
        ...(agent.name !== undefined ? { agent: agent.name } : {}),
      }) + '\n')
      process.exit(1)
    }

    const answers = resolveJsonAnswers(parsed.name!, parsed.partial)

    if (answers.packages.passport && (!answers.packages.auth || answers.orm !== 'prisma')) {
      process.stdout.write(JSON.stringify({
        success: false,
        error:   'Passport requires --packages to include auth and --orm=prisma.',
        ...(agent.name !== undefined ? { agent: agent.name } : {}),
      }) + '\n')
      process.exit(1)
    }

    // Create a private, randomly-named temp dir (mkdtemp → 0700, unguessable
    // suffix) and write the log inside it, rather than a predictable
    // `create-rudder-<timestamp>.log` directly in the shared temp dir. The old
    // name was guessable, so a local attacker could pre-plant a file/symlink at
    // that path before we wrote (TOCTOU). The OS reaps the temp dir; it's
    // single-use per run.
    const logDir  = await fs.mkdtemp(path.join(os.tmpdir(), 'create-rudder-'))
    const logFile = path.join(logDir, 'scaffold.log')
    await fs.writeFile(logFile, '')

    try {
      const result = await scaffold(answers, { pm, quiet: true, logFile })
      const payload: Record<string, unknown> = {
        success:   true,
        name:      answers.name,
        directory: result.target,
        files:     result.filesWritten,
      }
      if (agent.name) payload['agent'] = agent.name
      if (result.installAttempted) {
        payload['installed'] = result.installOk
        payload['providersDiscovered'] = result.discoverOk
        if (result.dbGenerateOk    !== null) payload['dbGenerated']    = result.dbGenerateOk
        if (result.dbPushOk        !== null) payload['dbPushed']       = result.dbPushOk
        if (result.vendorPublishOk !== null) payload['authViewsPublished'] = result.vendorPublishOk
        if (result.passportKeysOk  !== null) payload['passportKeysGenerated'] = result.passportKeysOk
      }
      if (result.gitInitOk !== null) payload['gitInitialized'] = result.gitInitOk
      if (answers.packages.auth && !result.authViewsCopied && result.vendorPublishOk !== true) {
        payload['warning'] = `Auth views could not be vendored. Run: ${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${answers.primary}`
      }
      process.stdout.write(JSON.stringify(payload) + '\n')
      try { await fs.unlink(logFile) } catch { /* ignore */ }
      process.exit(0)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const tail    = await readLogTail(logFile)
      process.stdout.write(JSON.stringify({
        success: false,
        error:   message,
        logFile,
        logTail: tail,
        ...(agent.name !== undefined ? { agent: agent.name } : {}),
      }) + '\n')
      process.exit(1)
    }
  }

  // ── Interactive flow ────────────────────────────────────
  console.log()
  printLogo()
  console.log()
  // Soft deprecation nudge — only when the user invoked the legacy bin.
  // The `create-rudder-app` stub sets RUDDER_INVOKED_AS=create-rudder-app
  // so we can detect users who are still on the old install command.
  if (process.env['RUDDER_INVOKED_AS'] === 'create-rudder-app') {
    log.info('This scaffolder now ships as `create-rudder` — use `npm create rudder@latest` next time.')
  }
  intro(' create-rudder ')

  const answers = await gatherInteractive(parsed.name, parsed.partial)

  let result: ScaffoldResult
  try {
    result = await scaffold(answers, { pm, quiet: false })
  } catch (err) {
    if (err instanceof ScaffoldError) { cancel(err.message); process.exit(1) }
    throw err
  }

  // ── Build the "manual steps" list ─ only includes things the auto-cascade
  // either didn't run or couldn't finish. The goal: when everything succeeded,
  // the panel has exactly one line (`cd app && pnpm dev`).
  const manual: string[] = []
  if (!answers.install) {
    manual.push(`  ${pmInstall(pm)}`)
    manual.push(`  ${pmRun(pm, 'rudder')} providers:discover`)
  }
  // Native has no client-generate step — db:generate is prisma/drizzle-only.
  if (answers.orm && answers.orm !== 'native' && (result.dbGenerateOk === false || (result.dbGenerateOk === null && !answers.install))) {
    manual.push(`  ${pmRun(pm, 'rudder')} db:generate`)
  }
  if (answers.orm === 'native') {
    // Native uses `migrate` instead of db:push. dbPushOk carries the migrate result.
    if (result.dbPushOk === null && !answers.dbReady) {
      manual.push(`  ${pmRun(pm, 'rudder')} migrate   ${result.installOk ? '# once your database is running' : ''}`)
    } else if (result.dbPushOk === false) {
      manual.push(`  ${pmRun(pm, 'rudder')} migrate   # retry${answers.db === 'sqlite' ? '' : ' after starting your database'}`)
    } else if (result.dbPushOk === null && !answers.install) {
      manual.push(`  ${pmRun(pm, 'rudder')} migrate`)
    }
  } else if (answers.orm && result.dbPushOk !== true) {
    // dbPushOk is null when we deliberately skipped (e.g. user said DB not running)
    if (result.dbPushOk === null && !answers.dbReady) {
      manual.push(`  ${pmRun(pm, 'rudder')} db:push   ${result.installOk ? '# once your database is running' : ''}`)
    } else if (result.dbPushOk === false) {
      manual.push(`  ${pmRun(pm, 'rudder')} db:push   # retry after starting your database`)
    } else if (result.dbPushOk === null && !answers.install) {
      manual.push(`  ${pmRun(pm, 'rudder')} db:push`)
    }
  }
  if (answers.packages.auth && result.vendorPublishOk !== true && !result.authViewsCopied) {
    manual.push(`  ${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${answers.primary}`)
  }
  if (answers.packages.passport && result.passportKeysOk !== true) {
    manual.push(`  ${pmRun(pm, 'rudder')} passport:keys`)
  }

  const hints: string[] = []
  if (answers.packages.ai)        hints.push('  AI chat:     /ai-chat  (set ANTHROPIC_API_KEY in .env)')
  if (answers.packages.mcp)       hints.push('  MCP echo:    POST /mcp/echo  (see app/Mcp/EchoServer.ts)')
  if (answers.packages.passport)  hints.push('  OAuth2:      /oauth/authorize, /oauth/token  (run `rudder passport:client <name>` first)')
  if (answers.packages.telescope) hints.push('  Telescope:   /telescope  (debug dashboard — requests, queries, jobs, AI, mail)')
  if (answers.packages.boost)     hints.push(`  Boost:       ${pmRun(pm, 'rudder')} boost:install  (wire your AI coding assistant)`)
  if (answers.packages.terminal)  hints.push(`  Terminal:    ${pmRun(pm, 'rudder')} make:terminal <Name>  (scaffold a terminal view)`)
  const hintsStr = hints.length > 0 ? '\n\n' + hints.join('\n') : ''

  // GitHub's tree view of the framework playground (15 working demo views,
  // every package wired up) is the actual examples gallery today. The
  // rudderjs.com/examples URL was vaporware in the original scaffolder copy.
  const exampleLink = '\n\n  Examples: https://github.com/rudderjs/rudder/tree/main/playground'

  // The happy-path output — auto-cascade succeeded, no manual remediation.
  if (manual.length === 0) {
    outro(
      `Done!\n\n` +
      `  cd ${answers.name} && ${pmRun(pm, 'dev')}` +
      hintsStr +
      exampleLink
    )
    return
  }

  // Something needs the user's attention — print remediation steps explicitly.
  outro(
    `Done! A few things still need your attention:\n\n` +
    `  cd ${answers.name}\n` +
    manual.join('\n') + '\n' +
    `  ${pmRun(pm, 'dev')}` +
    hintsStr +
    exampleLink
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
