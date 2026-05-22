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
//   pnpm --filter create-rudder-app smoke                       # default: web-app + pnpm
//   pnpm --filter create-rudder-app smoke --keep                # keep tmp dir on success
//   pnpm --filter create-rudder-app smoke --profile=minimal
//   pnpm --filter create-rudder-app smoke --framework=vue
//   pnpm --filter create-rudder-app smoke --via=cli             # spawn the real CLI binary
//   pnpm --filter create-rudder-app smoke --pm=npm              # swap package manager
//   pnpm --filter create-rudder-app smoke --pm=yarn             # yarn classic (v1)
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

// `--via=cli` invokes the real `create-rudder-app` binary in JSON mode and
// hands the scaffolded directory back to the existing install + boot + render
// pipeline. Catches regressions in parseFlags / validateJsonMode /
// resolveJsonAnswers / scaffold that the direct getTemplates() path can't see.
// `--via=direct` (default) keeps the current per-recipe coverage by calling
// getTemplates() with a hand-built TemplateContext.
type Via = 'direct' | 'cli'
const VIA_RAW = argv.find((a) => a.startsWith('--via='))?.split('=')[1] ?? 'direct'
if (VIA_RAW !== 'direct' && VIA_RAW !== 'cli') {
  console.error(`unknown --via "${VIA_RAW}". options: direct, cli`)
  process.exit(2)
}
const VIA: Via = VIA_RAW as Via

// `--pm` swaps every install / exec / script invocation to the matching
// package manager AND drops the @rudderjs/* link overrides into the field
// the PM understands (pnpm.overrides / overrides / resolutions). Catches
// PM-specific failure modes — npm/yarn don't understand workspace:* the
// way pnpm does, peer-dep enforcement differs, and the .pnpm/ isolation
// trick we use for Prisma doesn't apply.
type PM = 'pnpm' | 'npm' | 'yarn'
const PM_VALID: readonly PM[] = ['pnpm', 'npm', 'yarn']
const PM_RAW = argv.find((a) => a.startsWith('--pm='))?.split('=')[1] ?? 'pnpm'
if (!PM_VALID.includes(PM_RAW as PM)) {
  console.error(`unknown --pm "${PM_RAW}". options: ${PM_VALID.join(', ')}`)
  process.exit(2)
}
const PM_FLAG = PM_RAW as PM

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
    pm:         PM_FLAG,
    packages:   emptyPackages(),
    ...overrides,
  }
}

const profiles: Record<string, TemplateContext> = {
  // `minimal` recipe — no packages, no ORM, no frontend. Vanilla welcome
  // via @rudderjs/view's html`` tag — see `welcomeViewVanilla`.
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

  // `api-service` recipe — auth + http + ORM, NO frontend. Same vanilla
  // welcome shell as `minimal`; the manifest hits `/` (vanilla welcome) +
  // `/api/health`.
  'api-service': baseProfile({
    frameworks: [],
    packages:   { ...emptyPackages(), auth: true, http: true },
  }),
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

// PM-specific command shapes. Keep these in one place so adding a PM (bun)
// later means filling in one row per helper rather than hunting through main().

function installArgs(pm: PM): { cmd: string; args: string[]; timeoutMs: number } {
  if (pm === 'pnpm') return { cmd: 'pnpm', args: ['install', '--no-frozen-lockfile', '--silent'], timeoutMs: 240_000 }
  if (pm === 'npm')  return { cmd: 'npm',  args: ['install', '--no-audit', '--no-fund', '--loglevel=error'], timeoutMs: 240_000 }
  // yarn classic (v1.x). Berry (v2+) defaults to Plug'n'Play which breaks Vite —
  // we keep the supported cell narrow on purpose. If yarn berry coverage ever
  // matters, add a separate `yarn-berry` PM and write a `.yarnrc.yml` with
  // `nodeLinker: node-modules` before install.
  return { cmd: 'yarn', args: ['install', '--silent'], timeoutMs: 240_000 }
}

function execArgs(pm: PM, bin: string, ...args: string[]): { cmd: string; args: string[] } {
  if (pm === 'pnpm') return { cmd: 'pnpm', args: ['exec', bin, ...args] }
  if (pm === 'npm')  return { cmd: 'npm',  args: ['exec', '--', bin, ...args] }
  return { cmd: 'yarn', args: ['exec', '--', bin, ...args] }
}

function scriptArgs(pm: PM, script: string, ...rest: string[]): { cmd: string; args: string[] } {
  if (pm === 'pnpm') return { cmd: 'pnpm', args: [script, ...rest] }
  if (pm === 'npm')  return { cmd: 'npm',  args: ['run', script, '--', ...rest] }
  return { cmd: 'yarn', args: [script, ...rest] }
}

/** Pack every workspace `@rudderjs/*` package via `pnpm -r pack` into a single
 *  destination. The resulting tarballs have `workspace:^` refs resolved to
 *  concrete versions — the same shape npm publishes, which sidesteps both
 *  yarn-classic's link:+workspace hoister bug and npm's EOVERRIDE quirks on
 *  direct deps. Returns a map of package name → absolute tarball path. */
async function packWorkspacePackages(): Promise<Record<string, string>> {
  const dest = await mkdtemp(path.join(tmpdir(), 'rudder-pack-'))
  const packResult = await run(
    'pnpm',
    ['-r', '--filter=./packages/*', '--workspace-concurrency=8', 'pack', `--pack-destination=${dest}`],
    REPO_ROOT,
    { timeoutMs: 180_000 },
  )
  if (packResult.code !== 0) {
    throw new Error(`pnpm -r pack failed:\n${packResult.stderr}\n${packResult.stdout}`)
  }

  // Tarball names are `<scope-without-@>-<name>-<version>.tgz`. Read the
  // packages dir + each package.json to build the name → tarball map; no need
  // to parse filenames since we know the version straight from the source.
  const dirs = await readdir(PACKAGES_DIR)
  const map: Record<string, string> = {}
  for (const dir of dirs) {
    const pkgJson = path.join(PACKAGES_DIR, dir, 'package.json')
    if (!existsSync(pkgJson)) continue
    const { name, version } = JSON.parse(await readFile(pkgJson, 'utf8'))
    if (typeof name !== 'string' || typeof version !== 'string') continue
    const tarName = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
    const tarPath = path.join(dest, tarName)
    if (!existsSync(tarPath)) continue
    map[name] = `file:${tarPath}`
  }
  return map
}

/** Apply the @rudderjs/* + Prisma overrides to a scaffolded `package.json` in
 *  the field the PM understands. Mutates pkg in place; caller writes the file.
 *
 *  - pnpm: `pnpm.overrides` works for both direct + transitive deps.
 *  - npm: `overrides` rejects entries that conflict with direct deps (EOVERRIDE).
 *    Rewrite the matching entries in `dependencies`/`devDependencies` directly.
 *  - yarn (classic): `resolutions` covers transitive, but a direct dep with a
 *    `latest` literal will resolve to the published version first. Rewrite
 *    direct deps for parity with npm. */
function applyOverrides(pkg: Record<string, unknown>, pm: PM, overrides: Record<string, string>): void {
  if (pm === 'pnpm') {
    const pnpm = (pkg['pnpm'] as Record<string, unknown> | undefined) ?? {}
    pnpm['overrides'] = overrides
    pkg['pnpm'] = pnpm
    return
  }

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field] as Record<string, string> | undefined
    if (!deps) continue
    for (const name of Object.keys(deps)) {
      const spec = overrides[name]
      if (spec) deps[name] = spec
    }
  }

  // yarn classic still honors `resolutions` for transitive deps that the linked
  // packages drag in (e.g. peer @rudderjs/* refs). npm has no equivalent for
  // file: paths, but transitive @rudderjs/* resolutions land on the same hoisted
  // copy regardless because every linked package is already a `file:` ref.
  if (pm === 'yarn') pkg['resolutions'] = overrides
}

async function buildOverrides(pm: PM): Promise<Record<string, string>> {
  // Map every workspace @rudderjs/* package to a local spec. Without this,
  // install would fetch published versions, missing any unreleased changes the
  // smoke test should validate.
  //
  // - pnpm uses `link:` symlinks — the linked packages' `workspace:^` refs
  //   resolve against the parent workspace transparently. Fast iteration.
  // - npm / yarn use packed tarballs (via `pnpm pack`) where `workspace:^`
  //   has already been rewritten to concrete versions. Avoids npm's EOVERRIDE
  //   on direct deps and yarn-classic's link:+workspace hoister bug
  //   ("could not find a copy of X to link"). Adds ~5-15s of pack time but
  //   matches what published-registry installs look like.
  const overrides: Record<string, string> = pm === 'pnpm' ? {} : await packWorkspacePackages()

  if (pm === 'pnpm') {
    const dirs = await readdir(PACKAGES_DIR)
    for (const dir of dirs) {
      const pkgJson = path.join(PACKAGES_DIR, dir, 'package.json')
      if (!existsSync(pkgJson)) continue
      const { name } = JSON.parse(await readFile(pkgJson, 'utf8'))
      if (typeof name !== 'string') continue
      overrides[name] = `link:${path.join(PACKAGES_DIR, dir)}`
    }
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

  console.log(`\n[create-rudder-app smoke] profile=${PROFILE} framework=${FRAMEWORK} via=${VIA} pm=${PM_FLAG}`)

  const work = await mkdtemp(path.join(tmpdir(), 'rudder-smoke-'))
  const target = path.join(work, ctx.name)
  // `--via=cli` lets the CLI create the directory (it errors if the target
  // exists). `--via=direct` writes files itself, so it needs the dir up front.
  if (VIA === 'direct') await mkdir(target, { recursive: true })
  console.log(`  tmp: ${target}`)

  let success = false
  try {
    // ── Scaffold ──
    if (VIA === 'cli') {
      // Drive the actual `create-rudder-app` CLI in JSON mode — exercises
      // parseFlags → validateJsonMode → resolveJsonAnswers → scaffold, the
      // path real users hit. Smoke profile maps to `--recipe=<profile>`.
      // `--via=cli` only supports profiles that are valid recipe names.
      const validRecipes = ['minimal', 'web-app', 'saas', 'api-service', 'realtime']
      if (!validRecipes.includes(PROFILE)) {
        throw new Error(`--via=cli requires a profile that matches a recipe (one of: ${validRecipes.join(', ')}); got "${PROFILE}"`)
      }
      const cliEntry = path.join(REPO_ROOT, 'create-rudder-app', 'dist', 'index.js')
      const args = [
        cliEntry, ctx.name,
        '--json',
        `--recipe=${PROFILE}`,
        `--framework=${FRAMEWORK}`,
        '--db=sqlite',
        '--install=false',
        '--git=false',
      ]
      const done0 = step(`create-rudder-app --recipe=${PROFILE}`)
      const cliResult = await run('node', args, work, { timeoutMs: 60_000 })
      done0(cliResult)
      // The CLI prints one JSON line to stdout on success; surface it for
      // diagnostics so a future regression's exact output lands in logs.
      const lastLine = cliResult.stdout.trim().split('\n').filter(l => l.startsWith('{')).pop() ?? ''
      try {
        const payload = JSON.parse(lastLine) as { success: boolean; directory?: string; files?: number }
        if (!payload.success) throw new Error(`CLI reported success=false: ${lastLine}`)
        console.log(`  cli scaffold: ${payload.files ?? 0} files written to ${payload.directory ?? target}`)
      } catch (e) {
        throw new Error(`could not parse CLI JSON output: ${e instanceof Error ? e.message : String(e)}\nlast line: ${lastLine}`)
      }
    } else {
      const files = getTemplates(ctx)
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(target, rel)
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, content, 'utf8')
      }
      console.log(`  ${Object.keys(files).length} files written`)
    }

    // Inject overrides so the project resolves @rudderjs/* + Prisma to the local
    // checkout. The scaffolded package.json is a template fragment, not a workspace
    // member, so overrides must live on the project itself. The field varies per PM:
    // pnpm.overrides | overrides (npm) | resolutions (yarn). See applyOverrides().
    // Equally important for `--via=cli` runs — the CLI emits `latest` versions
    // that the PM would otherwise fetch from npm, missing any unreleased changes.
    const pkgJsonPath = path.join(target, 'package.json')
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
    const overrides = await buildOverrides(PM_FLAG)
    applyOverrides(pkg, PM_FLAG, overrides)
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  ${Object.keys(overrides).length} packages linked into ${PM_FLAG} overrides`)

    // pnpm needs a workspace marker so it doesn't walk up and pick up the parent
    // rudderjs workspace. npm + yarn use the `workspaces` field in package.json
    // and never walk up, so the marker is pnpm-only.
    if (PM_FLAG === 'pnpm') {
      await writeFile(path.join(target, 'pnpm-workspace.yaml'), 'packages: ["."]\n')
    }

    // Mirror the auth-view vendor step from create-rudder-app's interactive
    // scaffold flow — without it, /login resolves to a missing view at boot.
    // Only react has vendored views today; for vue/solid the manifest skips
    // auth routes, so a no-op here is fine.
    if (ctx.packages.auth) {
      const ok = await vendorAuthViews(target, ctx.primary)
      console.log(`  auth views: ${ok ? `vendored from @rudderjs/auth/views/${ctx.primary}/` : 'skipped (no views for this framework)'}`)
    }

    // ── Steps ──
    const install = installArgs(PM_FLAG)
    const done1 = step(`${PM_FLAG} install`)
    done1(await run(install.cmd, install.args, target, { timeoutMs: install.timeoutMs }))

    if (ctx.orm === 'prisma') {
      const prismaGen = execArgs(PM_FLAG, 'prisma', 'generate')
      const done2 = step('prisma generate')
      done2(await run(prismaGen.cmd, prismaGen.args, target, { timeoutMs: 120_000 }))
      // .pnpm/ isolation only exists under pnpm; npm + yarn write the generated
      // client straight into node_modules/.prisma/client/ and the mirror is a no-op.
      if (PM_FLAG === 'pnpm') await mirrorPrismaGeneratedClient(target)

      // db push catches schema validity + Prisma generator parity.
      const prismaPush = execArgs(PM_FLAG, 'prisma', 'db', 'push', '--accept-data-loss')
      const done3 = step('prisma db push')
      done3(await run(prismaPush.cmd, prismaPush.args, target, { timeoutMs: 120_000 }))
    }

    // providers:discover catches the rudder script path bug (src/ vs dist/) and
    // any provider-package metadata issues. Skips bootApp() so it's fast.
    const provDisc = scriptArgs(PM_FLAG, 'rudder', 'providers:discover')
    const done4 = step('rudder providers:discover')
    done4(await run(provDisc.cmd, provDisc.args, target, { timeoutMs: 60_000 }))

    // rudder db:generate + db:push exercise the chicken-and-egg-safe path used
    // by the create-rudder-app auto-cascade: both must succeed via the rudder
    // CLI (skip-boot) even before @prisma/client exists. Catches regressions
    // where db: commands accidentally fall back into bootApp().
    if (ctx.orm === 'prisma') {
      const dbGen = scriptArgs(PM_FLAG, 'rudder', 'db:generate')
      const done4a = step('rudder db:generate (skip-boot)')
      done4a(await run(dbGen.cmd, dbGen.args, target, { timeoutMs: 60_000 }))
      if (PM_FLAG === 'pnpm') await mirrorPrismaGeneratedClient(target)

      const dbPush = scriptArgs(PM_FLAG, 'rudder', 'db:push')
      const done4b = step('rudder db:push (skip-boot)')
      done4b(await run(dbPush.cmd, dbPush.args, target, { timeoutMs: 60_000 }))
    }

    // command:list does a full bootApp() — boots every provider with real config.
    // Catches: drift between Prisma schema and routes (ORM init), config string-
    // vs-class refs (provider register/boot), missing dist exports (resolveOptionalPeer).
    const cmdList = scriptArgs(PM_FLAG, 'rudder', 'command:list')
    const done5 = step('rudder command:list (full boot)')
    done5(await run(cmdList.cmd, cmdList.args, target, { timeoutMs: 60_000 }))

    // build + node ./dist/server/index.mjs + GET / — the actual user path.
    // Catches prod-bundle drift the dev mode hides: missing `exports` conditions
    // (see feedback_esm_only_peer_require_bug.md), top-level node:* imports the
    // Vite build externalizes wrong, provider boot failures that surface only
    // when the HTTP server starts accepting connections.
    const build = scriptArgs(PM_FLAG, 'build')
    const done6 = step(`${PM_FLAG} build`)
    done6(await run(build.cmd, build.args, target, { timeoutMs: 300_000 }))

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
