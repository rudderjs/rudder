#!/usr/bin/env node
import {
  intro, outro, text, select, multiselect, groupMultiselect, confirm, spinner, log,
  isCancel, cancel,
} from '@clack/prompts'
import fs     from 'node:fs/promises'
import os     from 'node:os'
import path   from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { getTemplates, detectPackageManager, pmExec, pmRun, pmInstall, type PackageManager, type TemplateContext } from './templates.js'
import { availableDemos } from './templates/demos/registry.js'
import { detectAgent } from './agent-detect.js'
import {
  parseFlags, validateJsonMode, resolveJsonAnswers, packagesFromList,
  FlagError, DB_GATED,
  type Answers, type PartialAnswers, type ParsedFlags,
  type Frameworks, type Orm, type Db,
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

  let orm: Orm
  if (p.orm !== undefined) orm = p.orm
  else {
    const ormAnswer = await select({
      message: 'Database ORM',
      options: [
        { value: 'prisma',  label: 'Prisma' },
        { value: 'drizzle', label: 'Drizzle' },
        { value: 'none',    label: 'None',    hint: 'no database' },
      ],
    })
    if (isCancel(ormAnswer)) { cancel('Cancelled.'); process.exit(0) }
    orm = ormAnswer === 'none' ? false : ormAnswer as 'prisma' | 'drizzle'
  }

  let db: Db = p.db ?? 'sqlite'
  if (orm && p.db === undefined) {
    const dbAnswer = await select({
      message: 'Database driver',
      options: [
        { value: 'sqlite',     label: 'SQLite' },
        { value: 'postgresql', label: 'PostgreSQL' },
        { value: 'mysql',      label: 'MySQL / MariaDB' },
      ],
    })
    if (isCancel(dbAnswer)) { cancel('Cancelled.'); process.exit(0) }
    db = dbAnswer as Db
  }

  let packages: TemplateContext['packages']
  if (p.packages !== undefined) packages = p.packages
  else {
    type Pkg = { value: string; label: string; hint?: string }
    const PACKAGE_GROUPS: Record<string, Pkg[]> = {
      'Auth & Security': [
        { value: 'auth',          label: 'Authentication',        hint: 'login, register, sessions' },
        { value: 'sanctum',       label: 'Sanctum',               hint: 'API tokens (SHA-256 + abilities)' },
        { value: 'passport',      label: 'Passport',               hint: 'OAuth2 server — requires Auth + Prisma' },
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
    packages = packagesFromList(packageAnswer as string[], orm)
  }

  if (packages.passport && (!packages.auth || orm !== 'prisma')) {
    cancel('Passport requires Auth + Prisma. Re-run and select both, or drop Passport.')
    process.exit(1)
  }

  let frameworks: Frameworks
  if (p.frameworks) frameworks = p.frameworks
  else {
    const frameworksAnswer = await multiselect({
      message: 'Frontend frameworks',
      options: [
        { value: 'react', label: 'React' },
        { value: 'vue',   label: 'Vue' },
        { value: 'solid', label: 'Solid' },
      ],
      initialValues: ['react'],
      required:      true,
    })
    if (isCancel(frameworksAnswer)) { cancel('Cancelled.'); process.exit(0) }
    frameworks = frameworksAnswer as Frameworks
  }

  let primary: 'react' | 'vue' | 'solid'
  if (p.primary) primary = p.primary
  else if (frameworks.length > 1) {
    const primaryAnswer = await select({
      message: 'Primary framework (drives main pages)',
      options: frameworks.map(f => ({ value: f, label: f.charAt(0).toUpperCase() + f.slice(1) })),
    })
    if (isCancel(primaryAnswer)) { cancel('Cancelled.'); process.exit(0) }
    primary = primaryAnswer as 'react' | 'vue' | 'solid'
  } else {
    primary = frameworks[0]!
  }

  let tailwind: boolean
  if (p.tailwind !== undefined) tailwind = p.tailwind
  else {
    const tailwindAnswer = await confirm({ message: 'Add Tailwind CSS?', initialValue: true })
    if (isCancel(tailwindAnswer)) { cancel('Cancelled.'); process.exit(0) }
    tailwind = tailwindAnswer as boolean
  }

  let shadcn = p.shadcn ?? false
  if (frameworks.includes('react') && tailwind && p.shadcn === undefined) {
    const shadcnAnswer = await confirm({ message: 'Add shadcn/ui?', initialValue: true })
    if (isCancel(shadcnAnswer)) { cancel('Cancelled.'); process.exit(0) }
    shadcn = shadcnAnswer as boolean
  }

  let demos: string[] = p.demos ?? []
  if (primary === 'react' && p.demos === undefined) {
    const demoOptions = availableDemos(orm, packages)
    if (demoOptions.length > 0) {
      const demoAnswer = await multiselect({
        message:       'Select demos to scaffold (under /demos)',
        options:       demoOptions.map(d => ({
          value: d.value,
          label: d.label,
          ...(d.hint !== undefined ? { hint: d.hint } : {}),
        })),
        initialValues: ['contact'],
        required:      false,
      })
      if (isCancel(demoAnswer)) { cancel('Cancelled.'); process.exit(0) }
      demos = demoAnswer as string[]
    }
  } else if (demos.includes('*')) {
    demos = primary === 'react' ? availableDemos(orm, packages).map(d => d.value) : []
  }

  let install: boolean
  if (p.install !== undefined) install = p.install
  else {
    const installAnswer = await confirm({ message: 'Install dependencies?', initialValue: true })
    if (isCancel(installAnswer)) { cancel('Cancelled.'); process.exit(0) }
    install = installAnswer as boolean
  }

  return { name: resolvedName, orm, db, packages, frameworks, primary, tailwind, shadcn, demos, install }
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
    pm, packages: answers.packages, demos: answers.demos,
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
      const [rcmd, ...rargs] = `${pmRun(pm, 'rudder')} providers:discover`.split(' ')
      discoverOk = await runChild(rcmd!, rargs, target, logFile)
      s3?.stop(discoverOk
        ? 'Provider manifest generated'
        : `providers:discover failed — run \`${pmRun(pm, 'rudder')} providers:discover\` manually`)
    }
  }

  return {
    target,
    filesWritten: Object.keys(templates).length,
    authViewsCopied,
    installAttempted, installOk, discoverOk,
  }
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

    const logFile = path.join(os.tmpdir(), `create-rudder-app-${Date.now()}.log`)
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
      }
      if (answers.packages.auth && !result.authViewsCopied) {
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
  intro(' create-rudder-app ')

  const answers = await gatherInteractive(parsed.name, parsed.partial)

  let result: ScaffoldResult
  try {
    result = await scaffold(answers, { pm, quiet: false })
  } catch (err) {
    if (err instanceof ScaffoldError) { cancel(err.message); process.exit(1) }
    throw err
  }

  if (answers.packages.auth && !result.authViewsCopied) {
    console.warn(
      `  ⚠ Auth views could not be vendored from @rudderjs/auth.\n` +
      `    After install, run: ${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${answers.primary}`
    )
  }

  const nextSteps = [
    `  cd ${answers.name}`,
    ...(!answers.install ? [`  ${pmInstall(pm)}`, `  ${pmRun(pm, 'rudder')} providers:discover`] : []),
    ...(answers.orm === 'prisma' ? [
      `  ${pmExec(pm, 'prisma generate')}`,
      `  ${pmExec(pm, 'prisma db push')}`,
    ] : []),
    ...(!answers.install && answers.packages.auth
      ? [`  ${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${answers.primary}`]
      : []),
    ...(answers.packages.passport ? [`  ${pmRun(pm, 'rudder')} passport:keys`] : []),
    `  ${pmRun(pm, 'dev')}`,
  ]

  const hints: string[] = []
  if (answers.packages.ai)        hints.push('  AI chat:     /ai-chat  (set ANTHROPIC_API_KEY in .env)')
  if (answers.packages.mcp)       hints.push('  MCP echo:    POST /mcp/echo  (see app/Mcp/EchoServer.ts)')
  if (answers.packages.passport)  hints.push('  OAuth2:      /oauth/authorize, /oauth/token  (run `rudder passport:client <name>` first)')
  if (answers.packages.telescope) hints.push('  Telescope:   /telescope  (debug dashboard — requests, queries, jobs, AI, mail)')
  if (answers.packages.boost)     hints.push(`  Boost:       ${pmRun(pm, 'rudder')} boost:install  (wire your AI coding assistant)`)
  if (answers.packages.terminal)  hints.push(`  Terminal:    ${pmRun(pm, 'rudder')} make:terminal <Name>  (scaffold a terminal view)`)
  const hintsStr = hints.length > 0 ? '\n\n' + hints.join('\n') : ''

  outro(
    `Done! Get started:\n\n` +
    nextSteps.join('\n') +
    hintsStr +
    `\n\n  Docs: https://github.com/rudderjs/rudder`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
