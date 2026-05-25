export { Collection } from './collection.js'

// ─── Env ───────────────────────────────────────────────────

export const Env = {
  get(key: string, fallback?: string): string {
    const val = process.env[key]
    if (val === undefined) {
      if (fallback !== undefined) return fallback
      throw new Error(`Missing environment variable: ${key}`)
    }
    return val
  },

  getNumber(key: string, fallback?: number): number {
    const val = process.env[key]
    if (val === undefined) {
      if (fallback !== undefined) return fallback
      throw new Error(`Missing environment variable: ${key}`)
    }
    const num = Number(val)
    if (isNaN(num)) throw new Error(`Env var ${key} is not a number`)
    return num
  },

  getBool(key: string, fallback?: boolean): boolean {
    const val = process.env[key]
    if (val === undefined) {
      if (fallback !== undefined) return fallback
      throw new Error(`Missing environment variable: ${key}`)
    }
    return val.toLowerCase() === 'true' || val === '1'
  },

  has(key: string): boolean {
    return process.env[key] !== undefined
  },
}

export function env(key: string, fallback?: string): string {
  return Env.get(key, fallback)
}

// ─── Debug Helpers ─────────────────────────────────────────

import type { DumpObserverRegistry } from './dump-observers.js'

// Lazy accessor — reads the process-wide singleton set by dump-observers.ts.
let _dumpObs: DumpObserverRegistry | null | undefined
function _getDumpObservers(): DumpObserverRegistry | null {
  if (_dumpObs === undefined) {
    _dumpObs = (globalThis as Record<string, unknown>)['__rudderjs_dump_observers__'] as DumpObserverRegistry | undefined ?? null
  }
  return _dumpObs
}

/** Extract caller file:line from stack trace (best-effort). */
function _getCaller(): string | undefined {
  const stack = new Error().stack
  if (!stack) return undefined
  // Skip frames: Error, _getCaller, dump/dd
  const lines = stack.split('\n')
  const frame = lines[3]
  if (!frame) return undefined
  const match = frame.match(/\((.+)\)/) ?? frame.match(/at\s+(.+)/)
  return match?.[1]?.trim()
}

export function dump(...args: unknown[]): void {
  const obs = _getDumpObservers()
  if (obs) obs.emit({ args, method: 'dump', caller: _getCaller() })
  for (const arg of args) {
    console.log(JSON.stringify(arg, null, 2))
  }
}

export function dd(...args: unknown[]): never {
  const obs = _getDumpObservers()
  if (obs) obs.emit({ args, method: 'dd', caller: _getCaller() })
  for (const arg of args) {
    console.log(JSON.stringify(arg, null, 2))
  }
  process.exit(1)
}

// ─── Helpers ───────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

export const ucfirst = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1)

export const toSnakeCase = (str: string): string =>
  str.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`).replace(/^_/, '')

export const toCamelCase = (str: string): string =>
  str.replace(/_([a-z])/g, (_, l) => l.toUpperCase())

export const isObject = (val: unknown): val is Record<string, unknown> => {
  if (typeof val !== 'object' || val === null) return false
  const proto = Object.getPrototypeOf(val) as unknown
  return proto === Object.prototype || proto === null
}

export const deepClone = <T>(val: T): T =>
  JSON.parse(JSON.stringify(val))

export const pick = <T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> =>
  keys.reduce((acc, k) => ({ ...acc, [k]: obj[k] }), {} as Pick<T, K>)

export const omit = <T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> => {
  const result = { ...obj }
  keys.forEach(k => delete result[k])
  return result as Omit<T, K>
}

export const tap = <T>(val: T, fn: (v: T) => void): T => {
  fn(val)
  return val
}

/**
 * Simple i18n template interpolation.
 * Replaces `:key` placeholders with values from the vars object.
 *
 * @example
 * t('Hello :name, you have :n items', { name: 'Alice', n: 5 })
 * // → 'Hello Alice, you have 5 items'
 */
export function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/:([a-z]+)/g, (_, k: string) => String(vars[k] ?? `:${k}`))
}

// ─── ConfigRepository ──────────────────────────────────────

export class ConfigRepository {
  constructor(private readonly data: Record<string, unknown>) {}

  get<T = unknown>(key: string, fallback?: T): T {
    const parts = key.split('.')
    let current: unknown = this.data
    for (const part of parts) {
      if (current === null || typeof current !== 'object' || !(part in (current as object))) {
        return fallback as T
      }
      current = (current as Record<string, unknown>)[part]
    }
    return (current !== undefined ? current : fallback) as T
  }

  set(key: string, value: unknown): void {
    const parts = key.split('.')
    const dangerous = new Set(['__proto__', 'constructor', 'prototype'])
    if (parts.some(p => dangerous.has(p))) return
    let current = this.data
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] ?? ''
      if (typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1] ?? ''] = value
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  all(): Record<string, unknown> {
    return this.data
  }
}

let _repo: ConfigRepository | null = null

/** @internal — called by @rudderjs/core Application */
export function setConfigRepository(repo: ConfigRepository): void {
  _repo = repo
  ;(globalThis as Record<string, unknown>)['__rudderjs_config__'] = repo
}

/** @internal — used by @rudderjs/testing for snapshot/restore */
export function getConfigRepository(): ConfigRepository | null {
  return _repo
    ?? ((globalThis as Record<string, unknown>)['__rudderjs_config__'] as ConfigRepository | undefined)
    ?? null
}

export function config<T = unknown>(key: string, fallback?: T): T {
  const repo = _repo
    ?? (globalThis as Record<string, unknown>)['__rudderjs_config__'] as ConfigRepository | undefined
  return (repo?.get(key, fallback) ?? fallback) as T
}

// ─── resolveOptionalPeer ───────────────────────────────────

/**
 * Dynamically import an optional peer package installed in the user's app
 * (process.cwd()), not inside node_modules/@rudderjs/*.
 *
 * Resolution strategy (in order):
 *   1. CJS resolver via createRequire — works for packages that ship a
 *      `require` or `default` exports condition.
 *   2. ESM-aware fallback — walks node_modules from cwd up, reads the
 *      package's `exports['.']['import']` (or `exports.import`) field,
 *      resolves to an absolute path, and dynamic-imports it. Required
 *      for packages that only expose an `import` condition.
 *
 * `node:module` and `node:fs` are imported lazily to stay out of browser bundles.
 */
export async function resolveOptionalPeer<T = Record<string, unknown>>(specifier: string): Promise<T> {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const appRequire = createRequire(process.cwd() + '/package.json')

  // Fast path — works when the package has a `require` or `default` condition.
  try {
    const resolved = appRequire.resolve(specifier)
    // Convert absolute paths to file:// URLs — Node's ESM loader rejects
    // raw absolute paths on Windows ("Only URLs with a scheme in: file, data,
    // and node are supported"). pathToFileURL is a no-op for bare specifiers
    // (CJS resolver returns paths, but pathToFileURL handles both).
    return import(/* @vite-ignore */ pathToFileURL(resolved).href) as Promise<T>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Only fall through for the specific exports-condition mismatch.
    // Other errors (MODULE_NOT_FOUND etc.) re-throw immediately.
    if (!message.includes('No "exports" main defined') && !message.includes('Package subpath')) {
      throw err
    }
  }

  // ESM-aware fallback — read the package's exports field manually.
  const fs = await import('node:fs/promises')
  const path = await import('node:path')

  const { pkgName, subpath } = parseSpecifier(specifier)
  const pkgInfo = await findPackageJson(pkgName, process.cwd(), fs, path)
  if (!pkgInfo) {
    throw new Error(`Cannot find package "${pkgName}" from ${process.cwd()}`)
  }

  const entry = readImportEntry(pkgInfo.data, subpath)
  if (!entry) {
    throw new Error(
      subpath === '.'
        ? `Package "${pkgName}" has no resolvable ESM entry point in its exports field`
        : `Package "${pkgName}" subpath "${subpath}" is not defined in its exports field`,
    )
  }

  const absolute = path.resolve(path.dirname(pkgInfo.path), entry)
  return import(/* @vite-ignore */ pathToFileURL(absolute).href) as Promise<T>
}

/**
 * Split a bare import specifier into its package name and subpath.
 *   "foo"            → { pkgName: "foo",        subpath: "."        }
 *   "foo/bar"        → { pkgName: "foo",        subpath: "./bar"    }
 *   "@scope/name"    → { pkgName: "@scope/name", subpath: "."       }
 *   "@scope/name/x"  → { pkgName: "@scope/name", subpath: "./x"     }
 */
function parseSpecifier(specifier: string): { pkgName: string; subpath: string } {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    const pkgName = parts.slice(0, 2).join('/')
    const rest = parts.slice(2).join('/')
    return { pkgName, subpath: rest ? `./${rest}` : '.' }
  }
  const slash = specifier.indexOf('/')
  if (slash < 0) return { pkgName: specifier, subpath: '.' }
  return { pkgName: specifier.slice(0, slash), subpath: `./${specifier.slice(slash + 1)}` }
}

async function findPackageJson(
  name: string,
  startDir: string,
  fs:   typeof import('node:fs/promises'),
  path: typeof import('node:path'),
): Promise<{ path: string; data: Record<string, unknown> } | null> {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json')
    try {
      const raw = await fs.readFile(candidate, 'utf-8')
      return { path: candidate, data: JSON.parse(raw) as Record<string, unknown> }
    } catch { /* not here, walk up */ }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readImportEntry(pkg: Record<string, unknown>, subpath: string): string | null {
  const exports = pkg['exports']

  // String shorthand: only valid for the root subpath.
  if (typeof exports === 'string') {
    return subpath === '.' ? exports : null
  }

  if (exports && typeof exports === 'object') {
    const exportsMap = exports as Record<string, unknown>
    // Node spec: if any key starts with '.', exports is a subpath map; otherwise
    // it's a single conditional export for the root subpath.
    const isSubpathMap = Object.keys(exportsMap).some(k => k.startsWith('.'))
    const entry = isSubpathMap ? exportsMap[subpath] : (subpath === '.' ? exportsMap : null)

    if (typeof entry === 'string') return entry
    if (entry && typeof entry === 'object') {
      const r = entry as Record<string, unknown>
      const candidate = r['import'] ?? r['default'] ?? r['node']
      if (typeof candidate === 'string') return candidate
    }
  }

  // Fall back to legacy `main` field — only for the root subpath.
  if (subpath === '.') {
    const main = pkg['main']
    return typeof main === 'string' ? main : null
  }
  return null
}

// ─── validateSerializable ──────────────────────────────────

const isDev = typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production'

/**
 * Dev-mode validation: walk a data tree and warn about values that will fail
 * SSR serialization (functions, Dates, Maps, class instances, etc.).
 * Zero cost in production.
 *
 * @param data  - The object tree to validate
 * @param label - A label for the error message (e.g. 'resolveSchema')
 * @param tag   - Optional prefix tag for the log (defaults to 'rudderjs')
 */
export function validateSerializable(data: unknown, label: string, tag = 'rudderjs'): void {
  if (!isDev) return

  const problems: string[] = []
  const seen = new WeakSet()

  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return
    const t = typeof value
    if (t === 'string' || t === 'number' || t === 'boolean') return
    if (t === 'function') { problems.push(`${path} — function`); return }
    if (t === 'symbol')   { problems.push(`${path} — Symbol`); return }
    if (t === 'bigint')   { problems.push(`${path} — BigInt`); return }

    if (typeof value === 'object') {
      if (seen.has(value as object)) { problems.push(`${path} — circular reference`); return }
      seen.add(value as object)

      if (value instanceof Date)   return // Date is serializable by devalue
      if (value instanceof RegExp) return // RegExp is serializable by devalue
      if (value instanceof Map)    { problems.push(`${path} — Map`); return }
      if (value instanceof Set)    { problems.push(`${path} — Set`); return }

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) walk(value[i], `${path}[${i}]`)
        return
      }

      const proto = Object.getPrototypeOf(value) as object | null
      if (proto !== null && proto !== Object.prototype) {
        const name = (proto.constructor as { name?: string })?.name ?? 'unknown'
        problems.push(`${path} — class instance (${name}), expected plain object`)
        return
      }

      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, `${path}.${k}`)
      }
    }
  }

  walk(data, label)

  if (problems.length > 0) {
    console.error(
      `\n[${tag}] Non-serializable values detected in ${label}:\n` +
      problems.map(p => `  • ${p}`).join('\n') +
      '\n\nThese will cause hydration errors on the client.\n' +
      'Fix the code that produces these values.\n',
    )
  }
}

// ─── defineEnv ─────────────────────────────────────────────

import { z } from 'zod'

export { Str } from './str.js'
export { Num } from './num.js'
export { isWebContainer } from './runtime.js'

export function defineEnv<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>
): z.infer<z.ZodObject<T>> {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`[RudderJS] Invalid environment configuration:\n${lines}`)
  }
  return parsed.data
}

// ─── resolveIoredisClass ───────────────────────────────────

/**
 * Resolves the `Redis` constructor across the CJS/ESM interop variants
 * `ioredis` ships. Pass the result of `import('ioredis')` (dynamic) or
 * `import * as _ioredis from 'ioredis'` (static) and get back the class.
 *
 * Why: under NodeNext + `esModuleInterop: false`, `import { Redis } from
 * 'ioredis'` resolves the named export at the type level but throws at
 * runtime because ioredis's CJS shape doesn't expose `Redis` as a named
 * export. The fallback chain handles every shape we've seen:
 *
 *   1. `mod.Redis`             — the typed named re-export (works in some envs)
 *   2. `mod.default`           — when default IS the Redis class
 *   3. `mod.default.Redis`     — when default is a namespace wrapping the class
 *
 * Throws when none match — surfaces an ioredis upgrade-shape change loudly
 * rather than silently constructing an undefined.
 *
 * Shared by `@rudderjs/cache` (RedisAdapter) and `@rudderjs/broadcast-redis`
 * (RedisDriver). Apps don't normally call this.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveIoredisClass<R = unknown>(mod: unknown): new (...args: any[]) => R {
  const m = mod as {
    Redis?:   unknown
    default?: unknown
  }
  if (typeof m.Redis === 'function') {
    return m.Redis as new (...args: unknown[]) => R
  }
  if (typeof m.default === 'function') {
    return m.default as new (...args: unknown[]) => R
  }
  if (m.default && typeof (m.default as { Redis?: unknown }).Redis === 'function') {
    return (m.default as { Redis: new (...args: unknown[]) => R }).Redis
  }
  throw new Error(
    '[RudderJS] Unable to resolve `Redis` class from `ioredis` — unexpected export shape. ' +
    'This usually means an ioredis upgrade changed its module shape; please file an issue.',
  )
}

// ─── reusableConnection ────────────────────────────────────

interface ReusableConnectionEntry<T> { signature: string; promise: Promise<T> }

/**
 * Reuse one long-lived connection (a DB pool, Redis client, …) across Vite dev
 * HMR re-boots instead of opening a fresh one on every edit.
 *
 * The `@rudderjs/vite` watcher re-runs every provider's `boot()` on each `app/`
 * edit, so a provider that opens a connection in `boot()` (or in a driver it
 * constructs there) leaks one per edit — racing toward the server's connection
 * cap (the orm-prisma MySQL `max_connections` wedge, #652). This caches the live
 * connection on `globalThis[cacheKey]` (surviving SSR module re-evaluation),
 * keyed by a caller-computed `signature` (e.g. the connection URL / host:port):
 *
 *   • same signature  → reuse the live connection (no new one opened)
 *   • changed signature (a `config/*.ts` edit) → build a fresh one and dispose
 *     the superseded one (fire-and-forget — the new connection doesn't wait)
 *
 * The promise is cached (not just the resolved value) so concurrent first-callers
 * within one boot dedupe onto a single build. No-op in production: a single boot
 * means one build, never re-entered.
 *
 * Mirrors the inlined reuse in `@rudderjs/orm-prisma` (#652) / `@rudderjs/orm-drizzle`;
 * use this for new connection-owning providers instead of re-inlining the pattern.
 *
 * @param cacheKey   a unique `globalThis` key per connection kind, e.g. `'__rudderjs_cache_redis__'`
 * @param signature  changes iff a new connection is required (URL / host:port:db)
 * @param build      opens the connection (async); only called on a cache miss
 * @param dispose    closes a superseded connection (`client.quit()`, `pool.end()`, …)
 */
export function reusableConnection<T>(
  cacheKey: string,
  signature: string,
  build: () => Promise<T>,
  dispose: (value: T) => unknown,
): Promise<T> {
  const g = globalThis as Record<string, unknown>
  const cached = g[cacheKey] as ReusableConnectionEntry<T> | undefined
  if (cached) {
    if (cached.signature === signature) return cached.promise
    void cached.promise.then((v) => dispose(v)).catch(() => { /* best effort — releasing a superseded connection */ })
    delete g[cacheKey]
  }
  const promise = Promise.resolve().then(build)
  // Drop a rejected build so the next call retries instead of caching the failure.
  promise.catch(() => { if ((g[cacheKey] as ReusableConnectionEntry<T> | undefined)?.promise === promise) delete g[cacheKey] })
  g[cacheKey] = { signature, promise } satisfies ReusableConnectionEntry<T>
  return promise
}
