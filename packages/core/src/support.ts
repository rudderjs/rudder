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

  toJSON(): string {
    return JSON.stringify(this.items)
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
    return val === 'true' || val === '1'
  },

  has(key: string): boolean {
    return process.env[key] !== undefined
  },
}

// ─── Helpers ───────────────────────────────────────────────

/** Pause execution for a given number of milliseconds */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** Capitalize the first letter of a string */
export const ucfirst = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1)

/** Convert camelCase or PascalCase to snake_case */
export const toSnakeCase = (str: string): string =>
  str.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`).replace(/^_/, '')

/** Convert snake_case to camelCase */
export const toCamelCase = (str: string): string =>
  str.replace(/_([a-z])/g, (_, l) => l.toUpperCase())

/** Check if a value is a plain object */
export const isObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val)

/** Deep clone a plain object or array */
export const deepClone = <T>(val: T): T =>
  JSON.parse(JSON.stringify(val))

/** Pick specific keys from an object */
export const pick = <T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> =>
  keys.reduce((acc, k) => ({ ...acc, [k]: obj[k] }), {} as Pick<T, K>)

/** Omit specific keys from an object */
export const omit = <T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> => {
  const result = { ...obj }
  keys.forEach(k => delete result[k])
  return result as Omit<T, K>
}

/** Tap into a value, run a side effect, return the value */
export const tap = <T>(val: T, fn: (v: T) => void): T => {
  fn(val)
  return val
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
    return (current ?? fallback) as T
  }

  set(key: string, value: unknown): void {
    const parts = key.split('.')
    let current = this.data
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]!] = value
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  all(): Record<string, unknown> {
    return this.data
  }
}

// Module-level config singleton — set by Application.create()
let _repo: ConfigRepository | null = null

/** @internal — called by @forge/core Application */
export function setConfigRepository(repo: ConfigRepository): void {
  _repo = repo
  ;(globalThis as Record<string, unknown>)['__forge_config__'] = repo
}

/**
 * Access a config value by dot-notation key.
 * @example config('app.name') // → 'Forge'
 * @example config('database.connections.postgresql.url', '')
 */
export function config<T = unknown>(key: string, fallback?: T): T {
  const repo = _repo
    ?? (globalThis as Record<string, unknown>)['__forge_config__'] as ConfigRepository | undefined
  return (repo?.get(key, fallback) ?? fallback) as T
}

// ─── resolveOptionalPeer ───────────────────────────────────

/**
 * Dynamically import an optional peer package that is installed in the
 * user's app (process.cwd()), not in the Forge framework package itself.
 *
 * Plain `import(specifier)` resolves relative to the importing file's
 * location (inside node_modules/@forge/*), where optional peers are not
 * installed. This helper resolves the package path from the app's working
 * directory first, then imports the resolved absolute path.
 *
 * All optional peer packages must include `"default": "./dist/index.js"`
 * in their exports field so that the CJS resolver used here can find them.
 *
 * `node:module` is imported lazily so this file stays out of browser bundles.
 */
export async function resolveOptionalPeer<T = Record<string, unknown>>(specifier: string): Promise<T> {
  const { createRequire } = await import('node:module')
  const appRequire = createRequire(process.cwd() + '/package.json')
  const resolved   = appRequire.resolve(specifier)
  return import(/* @vite-ignore */ resolved) as Promise<T>
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
    throw new Error(`[Forge] Invalid environment configuration:\n${lines}`)
  }
  return parsed.data
}
