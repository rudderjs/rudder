import type { StorageAdapter } from './contracts.js'

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/storage` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/storage` inline (`Storage.*` /
 * `Storage.disk(...)` reads `StorageRegistry`), but `StorageProvider.boot()`
 * runs from a `node_modules` copy of `@rudderjs/storage` resolved via the
 * provider auto-discovery manifest. Without a shared store, `set()` from the
 * externalized copy would land on a different class than the one `Storage.*`
 * reads from inside the bundle, producing a misleading
 * `Disk "<name>" not found` error on every storage call in prod. Same pattern
 * as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`),
 * PR #501 (`@rudderjs/cache`), PR #502 (`@rudderjs/queue`), and PR #503
 * (`@rudderjs/mail`).
 */
interface StorageRegistryStore {
  adapters:    Map<string, StorageAdapter>
  defaultDisk: string
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_storage_registry__']) {
  _g['__rudderjs_storage_registry__'] = {
    adapters:    new Map(),
    defaultDisk: 'local',
  } satisfies StorageRegistryStore
}
const _store = _g['__rudderjs_storage_registry__'] as StorageRegistryStore

export class StorageRegistry {
  static set(name: string, adapter: StorageAdapter): void { _store.adapters.set(name, adapter) }
  static setDefault(name: string): void                   { _store.defaultDisk = name }
  static defaultName(): string                            { return _store.defaultDisk }

  static get(name?: string): StorageAdapter {
    const key = name ?? _store.defaultDisk
    const a   = _store.adapters.get(key)
    if (!a) throw new Error(`[RudderJS Storage] Disk "${key}" not found. Check your storage config.`)
    return a
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    _store.adapters.clear()
    _store.defaultDisk = 'local'
  }
}
