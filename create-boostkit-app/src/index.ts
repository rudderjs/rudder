#!/usr/bin/env node
import {
  intro, outro, text, select, confirm, spinner,
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

  const templates = getTemplates({ name, db, withTodo, authSecret })

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
    `\n\n  Docs: https://github.com/your-org/forge`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
