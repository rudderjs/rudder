#!/usr/bin/env node
import {
  intro, outro, text, select, multiselect, confirm, spinner,
  isCancel, cancel,
} from '@clack/prompts'
import fs     from 'node:fs/promises'
import path   from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { getTemplates, detectPackageManager, pmExec, pmRun, pmInstall } from './templates.js'

async function main(): Promise<void> {
  const argName = process.argv[2]
  const pm      = detectPackageManager()

  console.log()
  intro(' create-rudder-app ')

  // ── Project name ───────────────────────────────────────

  let name: string
  if (argName) {
    name = argName
    console.log(`  Project name: ${name}`)
  } else {
    const answer = await text({
      message:     'Project name',
      placeholder: 'my-app',
      validate:    (v) => (v ?? '').trim().length === 0 ? 'Project name is required' : undefined,
    })
    if (isCancel(answer)) { cancel('Cancelled.'); process.exit(0) }
    name = (answer as string).trim()
  }

  // ── Database ORM ─────────────────────────────────────────

  const ormAnswer = await select({
    message: 'Database ORM',
    options: [
      { value: 'prisma',  label: 'Prisma' },
      { value: 'drizzle', label: 'Drizzle' },
      { value: 'none',    label: 'None',    hint: 'no database' },
    ],
  })
  if (isCancel(ormAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const orm = ormAnswer === 'none' ? false : ormAnswer as 'prisma' | 'drizzle'

  // ── Database driver (only if ORM selected) ───────────────

  let db: 'sqlite' | 'postgresql' | 'mysql' = 'sqlite'
  if (orm) {
    const dbAnswer = await select({
      message: 'Database driver',
      options: [
        { value: 'sqlite',       label: 'SQLite' },
        { value: 'postgresql',   label: 'PostgreSQL' },
        { value: 'mysql',        label: 'MySQL / MariaDB' },
      ],
    })
    if (isCancel(dbAnswer)) { cancel('Cancelled.'); process.exit(0) }
    db = dbAnswer as 'sqlite' | 'postgresql' | 'mysql'
  }

  // ── Package checklist ────────────────────────────────────

  const packageAnswer = await multiselect({
    message: 'Select packages to include',
    options: [
      { value: 'auth',          label: 'Authentication',   hint: 'login, register, sessions' },
      { value: 'cache',         label: 'Cache',            hint: 'memory + Redis drivers' },
      { value: 'queue',         label: 'Queue',            hint: 'background jobs' },
      { value: 'storage',       label: 'Storage',          hint: 'file uploads (local + S3)' },
      { value: 'mail',          label: 'Mail',             hint: 'SMTP + log driver' },
      { value: 'notifications', label: 'Notifications',    hint: 'multi-channel notifications' },
      { value: 'scheduler',     label: 'Scheduler',        hint: 'cron-like task scheduling' },
      { value: 'broadcast',     label: 'WebSocket',        hint: 'real-time channels' },
      { value: 'live',          label: 'Real-time Collab',  hint: 'Yjs CRDT sync' },
      { value: 'ai',            label: 'AI',               hint: 'LLM providers (Anthropic, OpenAI, Google, Ollama)' },
      { value: 'mcp',           label: 'MCP',              hint: 'Model Context Protocol servers — expose tools/resources to LLMs' },
      { value: 'passport',      label: 'Passport (OAuth2)', hint: 'OAuth 2 server with JWT — requires Auth + Prisma' },
      { value: 'localization',  label: 'Localization',     hint: 'i18n — trans(), setLocale()' },
    ],
    initialValues: ['auth', 'cache'],
    required: false,
  })
  if (isCancel(packageAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const selectedPackages = packageAnswer as string[]

  const packages = {
    auth:          selectedPackages.includes('auth'),
    cache:         selectedPackages.includes('cache'),
    queue:         selectedPackages.includes('queue'),
    storage:       selectedPackages.includes('storage'),
    mail:          selectedPackages.includes('mail'),
    notifications: selectedPackages.includes('notifications'),
    scheduler:     selectedPackages.includes('scheduler'),
    broadcast:     selectedPackages.includes('broadcast'),
    live:          selectedPackages.includes('live'),
    ai:            selectedPackages.includes('ai'),
    mcp:           selectedPackages.includes('mcp'),
    passport:      selectedPackages.includes('passport'),
    localization:  selectedPackages.includes('localization'),
  }

  // Passport requires auth + prisma at runtime. Warn and drop silently if missing.
  if (packages.passport && (!packages.auth || orm !== 'prisma')) {
    cancel('Passport requires Auth + Prisma. Re-run and select both, or drop Passport.')
    process.exit(1)
  }

  const withTodo = false

  // ── Frontend frameworks ────────────────────────────────

  const frameworksAnswer = await multiselect({
    message:       'Frontend frameworks',
    options: [
      { value: 'react', label: 'React' },
      { value: 'vue',   label: 'Vue' },
      { value: 'solid', label: 'Solid' },
    ],
    initialValues: ['react'],
    required:      true,
  })
  if (isCancel(frameworksAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const frameworks = frameworksAnswer as ('react' | 'vue' | 'solid')[]

  // ── Primary framework (only when >1 selected) ──────────

  let primary: 'react' | 'vue' | 'solid'
  if (frameworks.length > 1) {
    const primaryAnswer = await select({
      message: 'Primary framework (drives main pages)',
      options: frameworks.map(f => ({
        value: f,
        label: f.charAt(0).toUpperCase() + f.slice(1),
      })),
    })
    if (isCancel(primaryAnswer)) { cancel('Cancelled.'); process.exit(0) }
    primary = primaryAnswer as 'react' | 'vue' | 'solid'
  } else {
    primary = frameworks[0]!
  }

  // ── Tailwind CSS ───────────────────────────────────────

  const tailwindAnswer = await confirm({
    message:      'Add Tailwind CSS?',
    initialValue: true,
  })
  if (isCancel(tailwindAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const tailwind = tailwindAnswer as boolean

  // ── shadcn/ui ──────────────────────────────────────────

  let shadcn = false
  if (frameworks.includes('react') && tailwind) {
    const shadcnAnswer = await confirm({
      message:      'Add shadcn/ui?',
      initialValue: true,
    })
    if (isCancel(shadcnAnswer)) { cancel('Cancelled.'); process.exit(0) }
    shadcn = shadcnAnswer as boolean
  }

  // ── Install dependencies ───────────────────────────────

  const installAnswer = await confirm({
    message:      `Install dependencies?`,
    initialValue: true,
  })
  if (isCancel(installAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const install = installAnswer as boolean

  // ── Generate ───────────────────────────────────────────

  const target     = path.resolve(process.cwd(), name)
  const authSecret = randomBytes(32).toString('hex')

  // Make sure target directory doesn't exist
  try {
    await fs.access(target)
    cancel(`Directory "${name}" already exists. Choose a different name.`)
    process.exit(1)
  } catch {
    // Good — directory doesn't exist
  }

  const s = spinner()
  s.start('Scaffolding project files...')

  const templates = getTemplates({ name, db, orm, withTodo, authSecret, frameworks, primary, tailwind, shadcn, pm, packages })

  for (const [filePath, content] of Object.entries(templates)) {
    const abs = path.join(target, filePath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  // Copy auth views from installer's own @rudderjs/auth dependency.
  // Views are consumed via `registerAuthRoutes(Route)` from @rudderjs/auth/routes
  // — the generated routes/web.ts wires this automatically.
  let authViewsCopied = true
  if (packages.auth) {
    try {
      const require      = createRequire(import.meta.url)
      const authPkgPath  = require.resolve('@rudderjs/auth/package.json')
      const authViewsDir = path.join(path.dirname(authPkgPath), 'views', primary)
      await fs.cp(authViewsDir, path.join(target, 'app', 'Views', 'Auth'), { recursive: true })
    } catch {
      authViewsCopied = false
    }
  }

  s.stop(`${Object.keys(templates).length} files written`)

  if (packages.auth && !authViewsCopied) {
    console.warn(
      `  ⚠ Auth views could not be vendored from @rudderjs/auth.\n` +
      `    After install, run: ${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${primary}`
    )
  }

  // ── Install ────────────────────────────────────────────

  if (install) {
    const s2 = spinner()
    s2.start(`Installing dependencies with ${pm}...`)
    const [cmd, ...args] = pmInstall(pm).split(' ')
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(cmd!, args, { cwd: target, stdio: 'pipe' })
      child.on('close', (code) => resolve(code === 0))
      child.on('error', () => resolve(false))
    })
    s2.stop(ok ? 'Dependencies installed' : `${pmInstall(pm)} failed — run it manually`)

    // Generate the provider manifest so the app boots on first `dev`
    if (ok) {
      const s3 = spinner()
      s3.start('Discovering framework providers...')
      const [rcmd, ...rargs] = `${pmRun(pm, 'rudder')} providers:discover`.split(' ')
      const discovered = await new Promise<boolean>((resolve) => {
        const child = spawn(rcmd!, rargs, { cwd: target, stdio: 'pipe' })
        child.on('close', (code) => resolve(code === 0))
        child.on('error', () => resolve(false))
      })
      s3.stop(discovered
        ? 'Provider manifest generated'
        : `providers:discover failed — run \`${pmRun(pm, 'rudder')} providers:discover\` manually`)
    }
  }

  // ── Done ───────────────────────────────────────────────

  const nextSteps = [
    `  cd ${name}`,
    ...(!install ? [`  ${pmInstall(pm)}`, `  ${pmRun(pm, 'rudder')} providers:discover`] : []),
    ...(orm === 'prisma' ? [
      `  ${pmExec(pm, 'prisma generate')}`,
      `  ${pmExec(pm, 'prisma db push')}`,
    ] : []),
    ...(!install && packages.auth ? [`  ${pmRun(pm, 'rudder')} vendor:publish --tag=auth-views-${primary}`] : []),
    ...(packages.passport ? [`  ${pmRun(pm, 'rudder')} passport:keys`] : []),
    `  ${pmRun(pm, 'dev')}`,
  ]

  const hints: string[] = []
  if (packages.ai)       hints.push('  AI chat:     /ai-chat  (set ANTHROPIC_API_KEY in .env)')
  if (packages.mcp)      hints.push('  MCP echo:    POST /mcp/echo  (see app/Mcp/EchoServer.ts)')
  if (packages.passport) hints.push('  OAuth2:      /oauth/authorize, /oauth/token  (run `rudder passport:client <name>` first)')
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
