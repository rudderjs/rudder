#!/usr/bin/env node
import {
  intro, outro, text, select, multiselect, confirm, spinner,
  isCancel, cancel,
} from '@clack/prompts'
import fs     from 'node:fs/promises'
import path   from 'node:path'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { getTemplates } from './templates.js'

async function main(): Promise<void> {
  const argName = process.argv[2]

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

  // ── Install dependencies ───────────────────────────────

  const installAnswer = await confirm({
    message:      'Install dependencies? (requires pnpm)',
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

  const templates = getTemplates({ name, db, withTodo, authSecret, frameworks, primary, tailwind, shadcn })

  for (const [filePath, content] of Object.entries(templates)) {
    const abs = path.join(target, filePath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }

  s.stop(`${Object.keys(templates).length} files written`)

  // ── Install ────────────────────────────────────────────

  if (install) {
    const s2 = spinner()
    s2.start('Installing dependencies with pnpm...')
    try {
      execSync('pnpm install', { cwd: target, stdio: 'pipe' })
      s2.stop('Dependencies installed')
    } catch {
      s2.stop('pnpm install failed — run it manually')
    }
  }

  // ── Done ───────────────────────────────────────────────

  const nextSteps = [
    `  cd ${name}`,
    ...(!install ? ['  pnpm install'] : []),
    `  pnpm exec prisma generate`,
    `  pnpm exec prisma db push`,
    `  pnpm dev`,
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
