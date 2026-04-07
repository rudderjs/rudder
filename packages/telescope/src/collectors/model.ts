import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

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
          content['attributes'] = args[0]
        } else if (event === 'deleted') {
          content['id'] = args[0]
        }

        storage.store(createEntry('model', content, {
          tags: [`model:${modelName}`, `action:${event}`],
        }))
      })
    }
  }
}
