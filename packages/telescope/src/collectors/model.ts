import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records model lifecycle events (created, updated, deleted) via Model.on().
 *
 * Registers on all models discovered through the ModelRegistry.
 */
export class ModelCollector implements Collector {
  readonly name = 'Model Collector'
  readonly type = 'model' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const orm = await import('@rudderjs/orm')
      type Observable = { on(event: string, handler: (...args: unknown[]) => void): void }
      const registry = orm.ModelRegistry as unknown as {
        all(): Map<string, Observable>
        onRegister?(listener: (name: string, ModelClass: Observable) => void): () => void
      }
      if (!registry.all) return

      for (const [name, ModelClass] of registry.all()) {
        this.observeModel(name, ModelClass)
      }

      // Also pick up models registered after Telescope boots — e.g. models
      // that aren't eagerly registered in a service provider and only show
      // up on first query during request handling.
      registry.onRegister?.((name, ModelClass) => {
        this.observeModel(name, ModelClass)
      })
    } catch {
      // @rudderjs/orm not installed — skip
    }
  }

  /**
   * Safely converts a model instance to a plain object. If the value has
   * a `toJSON()` method (e.g. RudderJS Model), use it. Otherwise try
   * JSON round-trip with a circular-reference guard. Falls back to
   * `String(value)` if all else fails.
   */
  private observeModel(
    modelName: string,
    ModelClass: { on(event: string, handler: (...args: unknown[]) => void): void },
  ): void {
    const storage = this.storage

    // Track in-flight update payloads by id so we can pair `updating` (which
    // has the diff) with `updated` (which confirms the row was actually
    // written). Only the latter fires the entry, so failed updates don't
    // produce phantom entries.
    const pendingUpdates = new Map<unknown, Record<string, unknown>>()

    ModelClass.on('updating', (...args: unknown[]) => {
      const id      = args[0]
      const payload = args[1] as Record<string, unknown> | undefined
      if (id !== undefined && payload && typeof payload === 'object') {
        pendingUpdates.set(id, safeSerialize(payload) as Record<string, unknown>)
      }
    })

    ModelClass.on('created', (...args: unknown[]) => {
      const attributes = safeSerialize(args[0])
      const content: Record<string, unknown> = {
        model:  modelName,
        action: 'created',
        after:  attributes,
      }
      if (attributes && typeof attributes === 'object') {
        const idValue = (attributes as Record<string, unknown>)['id']
        if (idValue !== undefined) content['modelId'] = idValue
      }
      storage.store(createEntry('model', content, {
        tags: [`model:${modelName}`, 'action:created'],
        ...batchOpts(),
      }))
    })

    ModelClass.on('updated', (...args: unknown[]) => {
      const record = safeSerialize(args[0]) as Record<string, unknown> | undefined
      const id     = record && typeof record === 'object' ? record['id'] : undefined
      const changes = id !== undefined ? pendingUpdates.get(id) : undefined
      if (id !== undefined) pendingUpdates.delete(id)

      const content: Record<string, unknown> = {
        model:  modelName,
        action: 'updated',
      }
      if (id !== undefined) content['modelId'] = id
      if (changes) content['changes'] = changes
      storage.store(createEntry('model', content, {
        tags: [`model:${modelName}`, 'action:updated'],
        ...batchOpts(),
      }))
    })

    ModelClass.on('deleted', (...args: unknown[]) => {
      storage.store(createEntry('model', {
        model:   modelName,
        action:  'deleted',
        modelId: args[0],
      }, {
        tags: [`model:${modelName}`, 'action:deleted'],
        ...batchOpts(),
      }))
    })
  }
}

/**
 * Safely extract plain attributes from a model instance. Model objects
 * may contain circular references (Prisma relations, back-references)
 * that cause `JSON.stringify` / `createEntry` to blow the stack.
 */
function safeSerialize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  // If the model has toJSON(), trust it — RudderJS Models strip hidden fields
  if (typeof (value as Record<string, unknown>)['toJSON'] === 'function') {
    try { return (value as { toJSON(): unknown }).toJSON() } catch { /* fall through */ }
  }

  // JSON round-trip with circular reference guard
  try {
    const seen = new WeakSet()
    return JSON.parse(JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    }))
  } catch {
    return String(value)
  }
}
