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
      const registry = orm.ModelRegistry as unknown as {
        all(): Map<string, { on(event: string, handler: (...args: unknown[]) => void): void }>
      }
      if (!registry.all) return

      for (const [name, ModelClass] of registry.all()) {
        this.observeModel(name, ModelClass)
      }
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

    for (const event of ['created', 'updated', 'deleted'] as const) {
      ModelClass.on(event, (...args: unknown[]) => {
        const content: Record<string, unknown> = {
          model:  modelName,
          action: event,
        }

        if (event === 'created' || event === 'updated') {
          // Safely extract plain attributes — model instances may have
          // circular references (e.g. Prisma relations) that blow the stack.
          content['attributes'] = safeSerialize(args[0])
        } else if (event === 'deleted') {
          content['id'] = args[0]
        }

        storage.store(createEntry('model', content, {
          tags: [`model:${modelName}`, `action:${event}`],
          ...batchOpts(),
        }))
      })
    }
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
