#!/usr/bin/env tsx
// Non-TTY end-to-end smoke test for create-rudder-app.
//
// Drives getTemplates() against a real package manager + filesystem, links every
// @rudderjs/* dep to the local workspace build, then runs the commands a real
// scaffolded project hits on first boot. Catches the bug classes called out in
// project_scaffolder_smoke_test memory:
//
//   (a) drift between template Prisma schema and template routes
//   (b) config fields that look like JSON but need class references at runtime
//   (c) paths into node_modules/@rudderjs/* that use src/ instead of dist/
//
// Usage:
//   pnpm --filter create-rudder-app smoke              # default profile
//   pnpm --filter create-rudder-app smoke --keep       # keep tmp dir on success
//   pnpm --filter create-rudder-app smoke --profile=minimal
//
// Pre-req: `pnpm build` has been run from repo root so packages/*/dist exists.

import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTemplates, type TemplateContext } from '../src/templates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages')

const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const PROFILE = argv.find((a) => a.startsWith('--profile='))?.split('=')[1] ?? 'default'

// ─── Profiles ────────────────────────────────────────────

const profiles: Record<string, TemplateContext> = {
  default: {
    name:       'smoke-app',
    db:         'sqlite',
    orm:        'prisma',
    authSecret: 'smoke-test-secret-' + Date.now(),
    appKey:     Buffer.from('smoke-test-app-key-padding-32b!!').toString('base64'),
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages: {
      auth: true, sanctum: false, passport: false, socialite: false,
      queue: false, storage: false, scheduler: false, image: false,
      mail: false, notifications: false, broadcast: false, sync: false,
      ai: false, mcp: false, boost: false,
      localization: false, pennant: false,
      telescope: false, pulse: false, horizon: false,
      crypt: false, http: false, process: false, concurrency: false,
    },
    demos: [],
  },
  minimal: {
    name:       'smoke-app',
    db:         'sqlite',
    orm:        false,
    authSecret: '',
    appKey:     '',
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages: {
      auth: false, sanctum: false, passport: false, socialite: false,
      queue: false, storage: false, scheduler: false, image: false,
      mail: false, notifications: false, broadcast: false, sync: false,
      ai: false, mcp: false, boost: false,
      localization: false, pennant: false,
      telescope: false, pulse: false, horizon: false,
      crypt: false, http: false, process: false, concurrency: false,
    },
    demos: [],
  },
  todos: {
    name:       'smoke-app',
    db:         'sqlite',
    orm:        'prisma',
    authSecret: 'smoke-test-secret-' + Date.now(),
    appKey:     Buffer.from('smoke-test-app-key-padding-32b!!').toString('base64'),
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages: {
      auth: true, sanctum: false, passport: false, socialite: false,
      queue: false, storage: false, scheduler: false, image: false,
      mail: false, notifications: false, broadcast: false, sync: false,
      ai: false, mcp: false, boost: false,
      localization: false, pennant: false,
      telescope: false, pulse: false, horizon: false,
      crypt: false, http: false, process: false, concurrency: false,
    },
    demos: ['todos'],
  },
  // ORM=none + every package that survives the multiselect filter. Catches
  // packages that look DB-independent in their config defaults (memory storage,
  // log driver, sync queue) but secretly require Prisma during provider boot.
  // Telescope, Pulse, Horizon are the specific Phase-6 targets — their configs
  // already default to in-memory storage, but their providers need to register
  // observers, mount routes, and avoid asking the ORM for query timings.
  'no-db': {
    name:       'smoke-app',
    db:         'sqlite',
    orm:        false,
    authSecret: '',
    appKey:     Buffer.from('smoke-test-app-key-padding-32b!!').toString('base64'),
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages: {
      auth: false, sanctum: false, passport: false, socialite: false,
      queue: true, storage: true, scheduler: true, image: true,
      mail: true, notifications: true, broadcast: false, sync: false,
      ai: false, mcp: false, boost: false,
      localization: true, pennant: true,
      telescope: true, pulse: true, horizon: true,
      crypt: true, http: true, process: true, concurrency: true,
    },
    demos: [],
  },
  // Heavy: every Phase-4 + Phase-5 demo at once. Catches cross-demo collisions
  // in routes/web.ts, routes/api.ts, AppServiceProvider boot ordering, and
  // the modules.prisma schema generation.
  'demos-all': {
    name:       'smoke-app',
    db:         'sqlite',
    orm:        'prisma',
    authSecret: 'smoke-test-secret-' + Date.now(),
    appKey:     Buffer.from('smoke-test-app-key-padding-32b!!').toString('base64'),
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages: {
      auth: true, sanctum: false, passport: false, socialite: false,
      queue: true, storage: true, scheduler: false, image: true,
      mail: true, notifications: true, broadcast: false, sync: false,
      ai: false, mcp: false, boost: false,
      localization: true, pennant: true,
      telescope: false, pulse: false, horizon: false,
      crypt: false, http: true, process: true, concurrency: true,
    },
    demos: [
      'contact', 'todos', 'polymorphic', 'avatar', 'fibonacci', 'system-info', 'pennant',
      'cache', 'queue', 'mail', 'notifications', 'localization', 'http',
    ],
  },
}

// ─── Utilities ──────────────────────────────────────────

interface RunResult { code: number; stdout: string; stderr: string }

function run(cmd: string, args: string[], cwd: string, opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe', env: { ...process.env, CI: '1' } })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    const timer = opts.timeoutMs
      ? setTimeout(() => { child.kill('SIGKILL'); resolve({ code: 124, stdout, stderr: stderr + '\n[smoke] timed out' }) }, opts.timeoutMs)
      : null
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }) })
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: 1, stdout, stderr: stderr + '\n' + String(e) }) })
  })
}

function step(name: string): (result: RunResult) => void {
  process.stdout.write(`  · ${name} … `)
  const start = Date.now()
  return (result) => {
    const ms = Date.now() - start
    if (result.code === 0) {
      process.stdout.write(`ok (${ms}ms)\n`)
    } else {
      process.stdout.write(`FAIL (${ms}ms, exit ${result.code})\n`)
      if (result.stdout.trim()) process.stderr.write('--- stdout ---\n' + result.stdout + '\n')
      if (result.stderr.trim()) process.stderr.write('--- stderr ---\n' + result.stderr + '\n')
      throw new Error(`step "${name}" failed`)
    }
  }
}

async function buildOverrides(): Promise<Record<string, string>> {
  // Map every workspace @rudderjs/* package to a link: into the local checkout.
  // Without this, pnpm install would try to fetch the published versions, missing
  // any unreleased changes the smoke test should validate.
  const dirs = await readdir(PACKAGES_DIR)
  const overrides: Record<string, string> = {}
  for (const dir of dirs) {
    const pkgJson = path.join(PACKAGES_DIR, dir, 'package.json')
    if (!existsSync(pkgJson)) continue
    const { name } = JSON.parse(await readFile(pkgJson, 'utf8'))
    if (typeof name !== 'string') continue
    overrides[name] = `link:${path.join(PACKAGES_DIR, dir)}`
  }
  return overrides
}

// ─── Main ───────────────────────────────────────────────

async function main(): Promise<void> {
  const ctx = profiles[PROFILE]
  if (!ctx) {
    console.error(`unknown profile "${PROFILE}". options: ${Object.keys(profiles).join(', ')}`)
    process.exit(2)
  }

  console.log(`\n[create-rudder-app smoke] profile=${PROFILE}`)

  const work = await mkdtemp(path.join(tmpdir(), 'rudder-smoke-'))
  const target = path.join(work, ctx.name)
  await mkdir(target, { recursive: true })
  console.log(`  tmp: ${target}`)

  let success = false
  try {
    // ── Scaffold ──
    const files = getTemplates(ctx)
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(target, rel)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }

    // Inject pnpm.overrides so the project resolves @rudderjs/* to the local checkout.
    // The scaffolded package.json is a template fragment, not a workspace member, so
    // overrides must live on the project itself (not the smoke script's package).
    const pkgJsonPath = path.join(target, 'package.json')
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
    pkg.pnpm = pkg.pnpm ?? {}
    pkg.pnpm.overrides = await buildOverrides()
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  ${Object.keys(files).length} files written, ${Object.keys(pkg.pnpm.overrides).length} packages linked`)

    // pnpm needs a workspace marker even for a single project so it doesn't walk
    // up and pick up the parent rudderjs workspace.
    await writeFile(path.join(target, 'pnpm-workspace.yaml'), 'packages: ["."]\n')

    // ── Steps ──
    const done1 = step('pnpm install')
    done1(await run('pnpm', ['install', '--no-frozen-lockfile', '--silent'], target, { timeoutMs: 240_000 }))

    if (ctx.orm === 'prisma') {
      const done2 = step('prisma generate')
      done2(await run('pnpm', ['exec', 'prisma', 'generate'], target, { timeoutMs: 120_000 }))

      // db push catches schema validity + Prisma generator parity.
      const done3 = step('prisma db push')
      done3(await run('pnpm', ['exec', 'prisma', 'db', 'push', '--accept-data-loss'], target, { timeoutMs: 120_000 }))
    }

    // providers:discover catches the rudder script path bug (src/ vs dist/) and
    // any provider-package metadata issues. Skips bootApp() so it's fast.
    const done4 = step('rudder providers:discover')
    done4(await run('pnpm', ['rudder', 'providers:discover'], target, { timeoutMs: 60_000 }))

    // command:list does a full bootApp() — boots every provider with real config.
    // Catches: drift between Prisma schema and routes (ORM init), config string-
    // vs-class refs (provider register/boot), missing dist exports (resolveOptionalPeer).
    const done5 = step('rudder command:list (full boot)')
    done5(await run('pnpm', ['rudder', 'command:list'], target, { timeoutMs: 60_000 }))

    success = true
    console.log(`\n[create-rudder-app smoke] OK\n`)
  } finally {
    if (success && !KEEP) {
      await rm(work, { recursive: true, force: true })
    } else if (!success) {
      console.error(`\n[create-rudder-app smoke] FAILED — tmp dir kept at ${work}\n`)
    } else {
      console.log(`  --keep set; tmp dir at ${work}\n`)
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
