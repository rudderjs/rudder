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
//   pnpm --filter create-rudder-app smoke              # web-app profile
//   pnpm --filter create-rudder-app smoke --keep       # keep tmp dir on success
//   pnpm --filter create-rudder-app smoke --profile=minimal
//
// Pre-req: `pnpm build` has been run from repo root so packages/*/dist exists.

import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTemplates, type TemplateContext } from '../src/templates.js'
import { getProfileRoutes } from '../src/templates/routes-manifest.js'
import { renderCheck } from './render-check.js'
import { flowCheck } from './flow-check.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages')

const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const PROFILE = argv.find((a) => a.startsWith('--profile='))?.split('=')[1] ?? 'web-app'

type Framework = 'react' | 'vue' | 'solid'
const FRAMEWORKS_VALID: readonly Framework[] = ['react', 'vue', 'solid']
const FRAMEWORK_RAW = argv.find((a) => a.startsWith('--framework='))?.split('=')[1]
if (FRAMEWORK_RAW !== undefined && !FRAMEWORKS_VALID.includes(FRAMEWORK_RAW as Framework)) {
  console.error(`unknown framework "${FRAMEWORK_RAW}". options: ${FRAMEWORKS_VALID.join(', ')}`)
  process.exit(2)
}
const FRAMEWORK = (FRAMEWORK_RAW ?? 'react') as Framework

// ─── Profiles ────────────────────────────────────────────
//
// Each profile mirrors a user-facing recipe in `src/cli-flags.ts` (RECIPES).
// Keep these in sync — if a recipe's package set changes there, update here
// too so the smoke exercises what real users actually get.

const APP_KEY = Buffer.from('smoke-test-app-key-padding-32b!!').toString('base64')

function emptyPackages(): TemplateContext['packages'] {
  return {
    auth: false, sanctum: false, passport: false, socialite: false,
    queue: false, storage: false, scheduler: false, image: false,
    mail: false, notifications: false, broadcast: false, sync: false,
    ai: false, mcp: false, boost: false,
    localization: false, pennant: false,
    telescope: false, pulse: false, horizon: false,
    crypt: false, http: false, process: false, concurrency: false,
    terminal: false,
  }
}

function baseProfile(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    name:       'smoke-app',
    db:         'sqlite',
    orm:        'prisma',
    authSecret: 'smoke-test-secret-' + Date.now(),
    appKey:     APP_KEY,
    frameworks: ['react'],
    primary:    'react',
    tailwind:   false,
    shadcn:     false,
    pm:         'pnpm',
    packages:   emptyPackages(),
    ...overrides,
  }
}

const profiles: Record<string, TemplateContext> = {
  // `minimal` recipe — no packages, no ORM, no frontend.
  minimal: baseProfile({
    orm:        false,
    authSecret: '',
    appKey:     '',
    frameworks: [],
  }),

  // `web-app` recipe — auth + ORM + frontend (the default canonical shape).
  'web-app': baseProfile({
    packages: { ...emptyPackages(), auth: true },
  }),

  // `saas` recipe — auth + queue + mail + notifications + ORM + frontend.
  saas: baseProfile({
    packages: { ...emptyPackages(), auth: true, queue: true, mail: true, notifications: true },
  }),

  // `realtime` recipe — auth + broadcast + sync + ORM + frontend.
  realtime: baseProfile({
    packages: { ...emptyPackages(), auth: true, broadcast: true, sync: true },
  }),

  // `api-service` recipe — DROPPED from the smoke. The scaffold currently
  // can't build with `frameworks: []` because Vike requires at least one
  // page ("At least one page should be defined"). Tracked for a follow-up
  // scaffolder fix — either add a vanilla `pages/_error/+Page.ts` that
  // returns plain HTML, or skip Vike entirely when the user picks the
  // no-frontend recipe. Until then, the recipe is documented in
  // `src/cli-flags.ts:RECIPES` but won't survive `pnpm build`.
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

interface BootedServer {
  baseUrl:   string
  /** Best-effort log capture — for failure messages. */
  capture:   () => { stdout: string; stderr: string }
  /** Resolves once the child process has exited. */
  exited:    Promise<number>
  /** SIGTERM → wait 3s → SIGKILL. Safe to call more than once. */
  shutdown:  () => Promise<void>
}

async function bootServer(target: string, port: number): Promise<BootedServer> {
  // Boots the scaffolded app via `node ./dist/server/index.mjs` and polls / for
  // a 200 response (readiness). Catches prod-bundle drift (missing exports,
  // top-level node: imports), Vike build output going wrong, and any provider
  // that throws at HTTP-server start time. The body assertion + cross-route
  // hydration check live downstream in renderCheck().
  const child = spawn('node', ['./dist/server/index.mjs'], {
    cwd: target,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), CI: '1' },
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (d) => { stdout += d.toString() })
  child.stderr?.on('data', (d) => { stderr += d.toString() })

  const exited = new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const readinessUrl = `${baseUrl}/`
  const deadline = Date.now() + 15_000
  let lastErr: unknown = null
  let ready = false

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `[smoke] server exited (code ${child.exitCode}) before serving /\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      )
    }
    try {
      const res = await fetch(readinessUrl, { signal: AbortSignal.timeout(2_000) })
      if (res.status === 200) { ready = true; break }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  const shutdown = async () => {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    const result = await Promise.race([
      exited,
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3_000)),
    ])
    if (result === 'timeout') child.kill('SIGKILL')
  }

  if (!ready) {
    await shutdown()
    throw new Error(
      `[smoke] server did not serve 200 within 15s on port ${port}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    )
  }

  return {
    baseUrl,
    capture:  () => ({ stdout, stderr }),
    exited,
    shutdown,
  }
}

async function vendorAuthViews(target: string, primary: 'react' | 'vue' | 'solid'): Promise<boolean> {
  // Mirrors the auth-view copy step in create-rudder-app/src/index.ts. The
  // smoke calls getTemplates() directly (not scaffold()), so without this the
  // scaffolded /login route would resolve to a missing view at boot. Only
  // packages/auth/views/react/ exists today — vue/solid scaffolds skip auth UI
  // routes in the manifest, so the missing cp() here is silently OK for them.
  const require = createRequire(import.meta.url)
  try {
    const authPkgPath = require.resolve('@rudderjs/auth/package.json')
    const authViewsDir = path.join(path.dirname(authPkgPath), 'views', primary)
    if (!existsSync(authViewsDir)) return false
    await cp(authViewsDir, path.join(target, 'app', 'Views', 'Auth'), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// ─── Main ───────────────────────────────────────────────

async function main(): Promise<void> {
  const baseCtx = profiles[PROFILE]
  if (!baseCtx) {
    console.error(`unknown profile "${PROFILE}". options: ${Object.keys(profiles).join(', ')}`)
    process.exit(2)
  }

  // Apply --framework= override. Single-framework smoke (the matrix is the
  // caller's job, not this script's). Preserve the profile's `frameworks: []`
  // shape (api-service) — that's the no-frontend signal the manifest relies on.
  const hasFrontend = baseCtx.frameworks.length > 0
  const ctx: TemplateContext = {
    ...baseCtx,
    frameworks: hasFrontend ? [FRAMEWORK] : [],
    primary:    FRAMEWORK,
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

    // Mirror the auth-view vendor step from create-rudder-app's interactive
    // scaffold flow — without it, /login resolves to a missing view at boot.
    // Only react has vendored views today; for vue/solid the manifest skips
    // auth routes, so a no-op here is fine.
    if (ctx.packages.auth) {
      const ok = await vendorAuthViews(target, ctx.primary)
      console.log(`  auth views: ${ok ? `vendored from @rudderjs/auth/views/${ctx.primary}/` : 'skipped (no views for this framework)'}`)
    }

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
    const routes = getProfileRoutes(ctx)
    console.log(`  render-check manifest: ${routes.length} route(s) — ${routes.map(r => r.path).join(', ')}`)

    const done7 = step(`boot server on port ${port}`)
    const server = await bootServer(target, port).then(
      (s) => { done7({ code: 0, stdout: '', stderr: '' }); return s },
      (e: Error) => { done7({ code: 1, stdout: '', stderr: e.message }); throw e },
    )

    try {
      const done8 = step(`render-check (${routes.length} routes via chromium)`)
      const result = await renderCheck(server.baseUrl, routes)
      const { stdout: srvOut, stderr: srvErr } = server.capture()
      done8({
        code:   result.ok ? 0 : 1,
        stdout: srvOut,
        stderr: result.ok ? srvErr : `${result.summary}\n--- server stderr ---\n${srvErr}`,
      })

      // Phase 4 — auth-flow E2E. Single-cell scope: react + web-app profile,
      // the canonical auth-on shape every user-facing recipe inherits from.
      // The selectors and flow are react-specific; vue/solid lack vendored
      // auth views, and api-service has no frontend at all.
      const runFlowCheck = FRAMEWORK === 'react' && PROFILE === 'web-app'
      if (runFlowCheck) {
        const done9 = step('flow-check (register → home → sign-out via chromium)')
        const flow = await flowCheck(server.baseUrl)
        const { stdout: fOut, stderr: fErr } = server.capture()
        done9({
          code:   flow.ok ? 0 : 1,
          stdout: fOut,
          stderr: flow.ok ? fErr : `${flow.summary}\n--- server stderr ---\n${fErr}`,
        })
      }
    } finally {
      await server.shutdown()
    }

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
