import { AsyncLocalStorage } from 'node:async_hooks'
import { ServiceProvider, resolveOptionalPeer } from '@rudderjs/core'
import type { Application, MiddlewareHandler } from '@rudderjs/core'

// ─── Types ────────────────────────────────────────────────

interface ContextStore {
  data:   Map<string, unknown>
  hidden: Map<string, unknown>
  stacks: Map<string, unknown[]>
  memo:   Map<string, unknown>
}

export interface DehydratedContext {
  data:   Record<string, unknown>
  stacks: Record<string, unknown[]>
}

// ─── ALS ──────────────────────────────────────────────────

const _als = new AsyncLocalStorage<ContextStore>()

function store(): ContextStore | undefined {
  return _als.getStore()
}

function requireStore(): ContextStore {
  const s = store()
  if (!s) {
    throw new Error(
      '[RudderJS Context] No context scope active.\n' +
      '  Wrap the call in runWithContext() or add ContextMiddleware().'
    )
  }
  return s
}

function freshStore(): ContextStore {
  return {
    data:   new Map(),
    hidden: new Map(),
    stacks: new Map(),
    memo:   new Map(),
  }
}

function cloneStore(src: ContextStore): ContextStore {
  return {
    data:   new Map(src.data),
    hidden: new Map(src.hidden),
    stacks: new Map(Array.from(src.stacks, ([k, v]) => [k, [...v]])),
    memo:   new Map(src.memo),
  }
}

// ─── Context facade ───────────────────────────────────────

export class Context {
  // ── Public data ────────────────────────────────────────

  static add(key: string, value: unknown): void {
    requireStore().data.set(key, value)
  }

  static get<T = unknown>(key: string): T | undefined {
    return store()?.data.get(key) as T | undefined
  }

  static has(key: string): boolean {
    return store()?.data.has(key) ?? false
  }

  static all(): Record<string, unknown> {
    const s = store()
    if (!s) return {}
    return Object.fromEntries(s.data)
  }

  static forget(key: string): void {
    store()?.data.delete(key)
  }

  // ── Hidden data (not serialized to logs / queue) ───────

  static addHidden(key: string, value: unknown): void {
    requireStore().hidden.set(key, value)
  }

  static getHidden<T = unknown>(key: string): T | undefined {
    return store()?.hidden.get(key) as T | undefined
  }

  static allHidden(): Record<string, unknown> {
    const s = store()
    if (!s) return {}
    return Object.fromEntries(s.hidden)
  }

  static allWithHidden(): Record<string, unknown> {
    const s = store()
    if (!s) return {}
    return { ...Object.fromEntries(s.data), ...Object.fromEntries(s.hidden) }
  }

  // ── Stacks ─────────────────────────────────────────────

  static push(key: string, value: unknown): void {
    const s = requireStore()
    const arr = s.stacks.get(key)
    if (arr) {
      arr.push(value)
    } else {
      s.stacks.set(key, [value])
    }
  }

  static stack(key: string): unknown[] {
    return store()?.stacks.get(key) ?? []
  }

  // ── Scoped context ────────────────────────────────────

  static scope<T>(fn: () => T): T {
    const current = store()
    const child = current ? cloneStore(current) : freshStore()
    return _als.run(child, fn)
  }

  // ── Conditional ───────────────────────────────────────

  static when<T>(condition: unknown, fn: (ctx: typeof Context) => T): T | undefined {
    if (condition) return fn(Context)
    return undefined
  }

  // ── Memoize for request lifetime ──────────────────────

  static remember<T>(key: string, fn: () => T): T {
    const s = requireStore()
    if (s.memo.has(key)) return s.memo.get(key) as T
    const value = fn()
    s.memo.set(key, value)
    return value
  }

  // ── Serialization ─────────────────────────────────────

  static dehydrate(): DehydratedContext {
    const s = store()
    if (!s) return { data: {}, stacks: {} }
    return {
      data:   Object.fromEntries(s.data),
      stacks: Object.fromEntries(Array.from(s.stacks, ([k, v]) => [k, [...v]])),
    }
  }

  static hydrate(payload: DehydratedContext): void {
    const s = requireStore()
    for (const [k, v] of Object.entries(payload.data)) {
      s.data.set(k, v)
    }
    for (const [k, v] of Object.entries(payload.stacks)) {
      s.stacks.set(k, [...v])
    }
  }

  // ── Flush ─────────────────────────────────────────────

  static flush(): void {
    const s = store()
    if (!s) return
    s.data.clear()
    s.hidden.clear()
    s.stacks.clear()
    s.memo.clear()
  }
}

// ─── Helpers ──────────────────────────────────────────────

export function runWithContext<T>(fn: () => T): T {
  return _als.run(freshStore(), fn)
}

export function hasContext(): boolean {
  return store() !== undefined
}

// ─── Middleware ────────────────────────────────────────────

export function ContextMiddleware(): MiddlewareHandler {
  return function contextMiddleware(_req, _res, next) {
    return runWithContext(next) as ReturnType<typeof next>
  }
}

// ─── Service Provider factory ─────────────────────────────

export function context(): new (app: Application) => ServiceProvider {
  class ContextServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      this.app.instance('context', Context)

      // Integrate with @rudderjs/log if available — merge Context.all() into every log entry
      try {
        const logMod = await resolveOptionalPeer<{
          Log: { listen(fn: (entry: { context: Record<string, unknown> }) => void): void }
        }>('@rudderjs/log')
        logMod.Log.listen((entry) => {
          const ctx = Context.all()
          if (Object.keys(ctx).length > 0) {
            Object.assign(entry.context, ctx)
          }
        })
      } catch {
        // @rudderjs/log not installed — skip integration
      }
    }
  }
  return ContextServiceProvider
}
