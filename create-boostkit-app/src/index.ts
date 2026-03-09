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
  intro(' create-boostkit-app ')

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

  // ── Database ───────────────────────────────────────────

  const dbAnswer = await select({
    message: 'Database driver',
    options: [
      { value: 'sqlite',       label: 'SQLite',             hint: 'recommended for development' },
      { value: 'postgresql',   label: 'PostgreSQL' },
      { value: 'mysql',        label: 'MySQL / MariaDB' },
    ],
  })
  if (isCancel(dbAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const db = dbAnswer as 'sqlite' | 'postgresql' | 'mysql'

  // ── Todo module ────────────────────────────────────────

  const withTodoAnswer = await confirm({
    message:      'Include example Todo module?',
    initialValue: true,
  })
  if (isCancel(withTodoAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const withTodo = withTodoAnswer as boolean

  // ── Frontend frameworks ────────────────────────────────

  const frameworksAnswer = await multiselect({
    message:       'Frontend frameworks',
    options: [
      { value: 'react', label: 'React',   hint: 'recommended' },
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

  // ── Authentication pages ───────────────────────────────

  const withAuthAnswer = await confirm({
    message:      'Add authentication pages? (login + register)',
    initialValue: true,
  })
  if (isCancel(withAuthAnswer)) { cancel('Cancelled.'); process.exit(0) }
  const withAuth = withAuthAnswer as boolean

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

  const templates = getTemplates({ name, db, withTodo, withAuth, authSecret, frameworks, primary, tailwind, shadcn, pm })

  for (const [filePath, content] of Object.entries(templates)) {
    const abs = path.join(target, filePath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  // Copy auth pages from installer's own @boostkit/auth dependency
  if (withAuth) {
    try {
      const require      = createRequire(import.meta.url)
      const authPkgPath  = require.resolve('@boostkit/auth/package.json')
      const authPagesDir = path.join(path.dirname(authPkgPath), 'pages', primary)
      await fs.cp(authPagesDir, path.join(target, 'pages'), { recursive: true })
    } catch {
      // Package not found — user can publish manually after install
    }
  }

  s.stop(`${Object.keys(templates).length} files written`)

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
  }

  // ── Done ───────────────────────────────────────────────

  const nextSteps = [
    `  cd ${name}`,
    ...(!install ? [`  ${pmInstall(pm)}`] : []),
    `  ${pmExec(pm, 'prisma generate')}`,
    `  ${pmExec(pm, 'prisma db push')}`,
    ...(!install && withAuth ? [`  ${pmRun(pm, 'artisan')} vendor:publish --tag=auth-pages-${primary}`] : []),
    `  ${pmRun(pm, 'dev')}`,
  ]

  outro(
    `Done! Get started:\n\n` +
    nextSteps.join('\n') +
    `\n\n  Docs: https://github.com/boostkitjs/boostkit`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
