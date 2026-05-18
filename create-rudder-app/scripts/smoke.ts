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
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
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

type Framework = 'react' | 'vue' | 'solid'
const FRAMEWORKS_VALID: readonly Framework[] = ['react', 'vue', 'solid']
const FRAMEWORK_RAW = argv.find((a) => a.startsWith('--framework='))?.split('=')[1]
if (FRAMEWORK_RAW !== undefined && !FRAMEWORKS_VALID.includes(FRAMEWORK_RAW as Framework)) {
  console.error(`unknown framework "${FRAMEWORK_RAW}". options: ${FRAMEWORKS_VALID.join(', ')}`)
  process.exit(2)
}
const FRAMEWORK = (FRAMEWORK_RAW ?? 'react') as Framework

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

  // Pin @prisma/client + prisma to whatever the workspace install resolved to.
  // Without this, the smoke-app picks the latest matching `^7.0.0` (e.g. 7.8.0)
  // while the link:'d @rudderjs/orm-prisma source resolves @prisma/client back
  // to the workspace's hoisted version (e.g. 7.4.2) — two engines diverge and
  // `prisma generate` outputs for one while the runtime loads the other,
  // producing "Cannot find module '.prisma/client/default'". Pinning to the
  // workspace version keeps generator + runtime on the same engine.
  // Read versions from packages/orm-prisma/node_modules since pnpm does not
  // hoist @prisma/client / prisma to the workspace root (no root-level dep).
  const ormPrismaModules = path.join(PACKAGES_DIR, 'orm-prisma', 'node_modules')
  for (const dep of ['@prisma/client', 'prisma']) {
    const wsPkg = path.join(ormPrismaModules, dep, 'package.json')
    if (!existsSync(wsPkg)) continue
    const { version } = JSON.parse(await readFile(wsPkg, 'utf8'))
    if (typeof version === 'string') overrides[dep] = version
  }

  return overrides
}

async function mirrorPrismaGeneratedClient(target: string): Promise<void> {
  // pnpm `link:` makes @rudderjs/orm-prisma's transitive resolution of
  // @prisma/client land on the workspace's hoisted copy in `worktree/node_modules/
  // .pnpm/@prisma+client@<ver>_<peerhash>/...`, NOT the copy installed inside
  // smoke-app. `prisma generate` only writes `.prisma/client/` into the latter.
  // Mirror the generated dir into every workspace copy of @prisma+client so the
  // linked source can find `default.js` at boot. Same-version copies still differ
  // by peer-suffix, so we mirror to all of them.
  const repoPnpm = path.join(REPO_ROOT, 'node_modules', '.pnpm')
  const smokePnpm = path.join(target, 'node_modules', '.pnpm')
  if (!existsSync(repoPnpm) || !existsSync(smokePnpm)) return

  const smokeEntries = await readdir(smokePnpm)
  const generatedFrom = smokeEntries
    .map((e) => path.join(smokePnpm, e, 'node_modules', '.prisma', 'client'))
    .find((p) => existsSync(p))
  if (!generatedFrom) return

  const repoEntries = await readdir(repoPnpm)
  const targets = repoEntries.filter((e) => e.startsWith('@prisma+client@'))
  for (const e of targets) {
    const dest = path.join(repoPnpm, e, 'node_modules', '.prisma', 'client')
    await mkdir(path.dirname(dest), { recursive: true })
    await cp(generatedFrom, dest, { recursive: true, force: true })
  }
}

async function pickFreePort(): Promise<number> {
  // Bind to port 0 to let the OS pick an available port, read it, then release.
  // Tiny race between close and the rudder server's bind, but CI runners are
  // single-tenant per job so collisions are not realistic.
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => {
        if (typeof addr === 'object' && addr) resolve(addr.port)
        else reject(new Error('failed to allocate port'))
      })
    })
  })
}

async function bootAndProbe(target: string, port: number): Promise<RunResult> {
  // Boots the scaffolded app via `node ./dist/server/index.mjs`, polls / for a
  // 200 response, and asserts the welcome page marker is in the body. Catches
  // prod-bundle drift (missing exports, top-level node: imports), Vike build
  // output going wrong, and any provider that throws at HTTP-server start time.
  const child = spawn('node', ['./dist/server/index.mjs'], {
    cwd: target,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), CI: '1' },
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (d) => { stdout += d.toString() })
  child.stderr?.on('data', (d) => { stderr += d.toString() })

  const exitPromise = new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })

  try {
    const url = `http://127.0.0.1:${port}/`
    const deadline = Date.now() + 15_000
    let lastErr: unknown = null
    let body: string | null = null

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        return {
          code: 1,
          stdout,
          stderr: stderr + `\n[smoke] server exited (code ${child.exitCode}) before serving /`,
        }
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
        if (res.status === 200) {
          body = await res.text()
          break
        }
        lastErr = new Error(`HTTP ${res.status}`)
      } catch (e) {
        lastErr = e
      }
      await new Promise((r) => setTimeout(r, 250))
    }

    if (body === null) {
      return {
        code: 1,
        stdout,
        stderr: stderr + `\n[smoke] server did not serve 200 within 15s on port ${port}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      }
    }

    const marker = 'Built with RudderJS'
    if (!body.includes(marker)) {
      return {
        code: 1,
        stdout,
        stderr: stderr + `\n[smoke] response body missing marker "${marker}"\n--- body (first 500 chars) ---\n${body.slice(0, 500)}`,
      }
    }

    return { code: 0, stdout, stderr }
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      const result = await Promise.race([
        exitPromise,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3_000)),
      ])
      if (result === 'timeout') child.kill('SIGKILL')
    }
  }
}

// ─── Main ───────────────────────────────────────────────

async function main(): Promise<void> {
  const baseCtx = profiles[PROFILE]
  if (!baseCtx) {
    console.error(`unknown profile "${PROFILE}". options: ${Object.keys(profiles).join(', ')}`)
    process.exit(2)
  }

  // Apply --framework= override. Single-framework smoke (the matrix is the caller's
  // job, not this script's). The demos-all profile defines a demos list that is
  // currently react-only — when running against vue/solid we drop the demos so
  // the scaffold compiles. See plan: docs/plans/2026-05-19-scaffolder-render-e2e.md.
  const ctx: TemplateContext = {
    ...baseCtx,
    frameworks: [FRAMEWORK],
    primary:    FRAMEWORK,
    demos:      FRAMEWORK === 'react' ? baseCtx.demos : [],
  }

  console.log(`\n[create-rudder-app smoke] profile=${PROFILE} framework=${FRAMEWORK}`)

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
      await mirrorPrismaGeneratedClient(target)

      // db push catches schema validity + Prisma generator parity.
      const done3 = step('prisma db push')
      done3(await run('pnpm', ['exec', 'prisma', 'db', 'push', '--accept-data-loss'], target, { timeoutMs: 120_000 }))
    }

    // providers:discover catches the rudder script path bug (src/ vs dist/) and
    // any provider-package metadata issues. Skips bootApp() so it's fast.
    const done4 = step('rudder providers:discover')
    done4(await run('pnpm', ['rudder', 'providers:discover'], target, { timeoutMs: 60_000 }))

    // rudder db:generate + db:push exercise the chicken-and-egg-safe path used
    // by the create-rudder-app auto-cascade: both must succeed via the rudder
    // CLI (skip-boot) even before @prisma/client exists. Catches regressions
    // where db: commands accidentally fall back into bootApp().
    if (ctx.orm === 'prisma') {
      const done4a = step('rudder db:generate (skip-boot)')
      done4a(await run('pnpm', ['rudder', 'db:generate'], target, { timeoutMs: 60_000 }))
      await mirrorPrismaGeneratedClient(target)

      const done4b = step('rudder db:push (skip-boot)')
      done4b(await run('pnpm', ['rudder', 'db:push'], target, { timeoutMs: 60_000 }))
    }

    // command:list does a full bootApp() — boots every provider with real config.
    // Catches: drift between Prisma schema and routes (ORM init), config string-
    // vs-class refs (provider register/boot), missing dist exports (resolveOptionalPeer).
    const done5 = step('rudder command:list (full boot)')
    done5(await run('pnpm', ['rudder', 'command:list'], target, { timeoutMs: 60_000 }))

    // pnpm build + node ./dist/server/index.mjs + GET / — the actual user path.
    // Catches prod-bundle drift the dev mode hides: missing `exports` conditions
    // (see feedback_esm_only_peer_require_bug.md), top-level node:* imports the
    // Vite build externalizes wrong, provider boot failures that surface only
    // when the HTTP server starts accepting connections.
    const done6 = step('pnpm build')
    done6(await run('pnpm', ['build'], target, { timeoutMs: 300_000 }))

    const port = await pickFreePort()
    const done7 = step(`boot + GET / on port ${port}`)
    done7(await bootAndProbe(target, port))

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
