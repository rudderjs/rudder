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

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

export const ucfirst = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1)

export const toSnakeCase = (str: string): string =>
  str.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`).replace(/^_/, '')

export const toCamelCase = (str: string): string =>
  str.replace(/_([a-z])/g, (_, l) => l.toUpperCase())

export const isObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val)

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

let _repo: ConfigRepository | null = null

/** @internal — called by @boostkit/core Application */
export function setConfigRepository(repo: ConfigRepository): void {
  _repo = repo
  ;(globalThis as Record<string, unknown>)['__boostkit_config__'] = repo
}

export function config<T = unknown>(key: string, fallback?: T): T {
  const repo = _repo
    ?? (globalThis as Record<string, unknown>)['__boostkit_config__'] as ConfigRepository | undefined
  return (repo?.get(key, fallback) ?? fallback) as T
}

// ─── resolveOptionalPeer ───────────────────────────────────

/**
 * Dynamically import an optional peer package installed in the user's app
 * (process.cwd()), not inside node_modules/@boostkit/*.
 *
 * Uses createRequire anchored to the app root so optional peers installed
 * in the user's project are resolvable regardless of where @boostkit/* lives.
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
    throw new Error(`[BoostKit] Invalid environment configuration:\n${lines}`)
  }
  return parsed.data
}
