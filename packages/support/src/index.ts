// ─── Collection ────────────────────────────────────────────

export class Collection<T> {
  private items: T[]

  constructor(items: T[] = []) {
    this.items = [...items]
  }

  static of<T>(items: T[]): Collection<T> {
    return new Collection(items)
  }

  all(): T[] {
    return this.items
  }

  count(): number {
    return this.items.length
  }

  first(): T | undefined {
    return this.items[0]
  }

  last(): T | undefined {
    return this.items[this.items.length - 1]
  }

  map<U>(fn: (item: T, index: number) => U): Collection<U> {
    return new Collection(this.items.map(fn))
  }

  filter(fn: (item: T) => boolean): Collection<T> {
    return new Collection(this.items.filter(fn))
  }

  find(fn: (item: T) => boolean): T | undefined {
    return this.items.find(fn)
  }

  each(fn: (item: T, index: number) => void): this {
    this.items.forEach(fn)
    return this
  }

  pluck<K extends keyof T>(key: K): Collection<T[K]> {
    return new Collection(this.items.map(item => item[key]))
  }

  groupBy<K extends keyof T>(key: K): Record<string, T[]> {
    return this.items.reduce((acc, item) => {
      const group = String(item[key])
      acc[group] = [...(acc[group] ?? []), item]
      return acc
    }, {} as Record<string, T[]>)
  }

  contains(fn: (item: T) => boolean): boolean {
    return this.items.some(fn)
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  toArray(): T[] {
    return [...this.items]
  }

  toJSON(): T[] {
    return this.items
  }
}

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

export function dump(...args: unknown[]): void {
  for (const arg of args) {
    console.log(JSON.stringify(arg, null, 2))
  }
}

export function dd(...args: unknown[]): never {
  dump(...args)
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
 * Uses createRequire anchored to the app root so optional peers installed
 * in the user's project are resolvable regardless of where @rudderjs/* lives.
 *
 * All optional peer packages must include `"default": "./dist/index.js"`
 * in their exports field so the CJS resolver can find them.
 *
 * `node:module` is imported lazily to stay out of browser bundles.
 */
export async function resolveOptionalPeer<T = Record<string, unknown>>(specifier: string): Promise<T> {
  const { createRequire } = await import('node:module')
  const appRequire = createRequire(process.cwd() + '/package.json')
  const resolved   = appRequire.resolve(specifier)
  return import(/* @vite-ignore */ resolved) as Promise<T>
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
