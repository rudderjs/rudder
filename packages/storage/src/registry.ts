import type { StorageAdapter } from './contracts.js'

export class StorageRegistry {
  private static readonly adapters = new Map<string, StorageAdapter>()
  private static defaultDisk = 'local'

  static set(name: string, adapter: StorageAdapter): void { this.adapters.set(name, adapter) }
  static setDefault(name: string): void                   { this.defaultDisk = name }
  static defaultName(): string                            { return this.defaultDisk }

  static get(name?: string): StorageAdapter {
    const key = name ?? this.defaultDisk
    const a   = this.adapters.get(key)
    if (!a) throw new Error(`[RudderJS Storage] Disk "${key}" not found. Check your storage config.`)
    return a
  }

  /** @internal — clears all registered disks. Used for testing. */
  static reset(): void {
    this.adapters.clear()
    this.defaultDisk = 'local'
  }
}
