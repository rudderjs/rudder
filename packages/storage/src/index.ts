import { ServiceProvider, rudder, config, app } from '@rudderjs/core'
import nodePath from 'node:path'
import fs from 'node:fs/promises'
import type { Readable } from 'node:stream'

import { LocalAdapter, type LocalDiskConfig } from './adapters/local.js'
import { S3Adapter, type S3DiskConfig } from './adapters/s3.js'
import { FakeAdapter } from './adapters/fake.js'
import { StorageRegistry } from './registry.js'
import type {
  StorageAdapter,
  TemporaryUrlOptions,
  TemporaryUploadUrl,
  Visibility,
} from './contracts.js'

// ─── Re-exports ────────────────────────────────────────────

export { BaseAdapter } from './base.js'
export { LocalAdapter, type LocalDiskConfig } from './adapters/local.js'
export { S3Adapter, type S3DiskConfig } from './adapters/s3.js'
export { FakeAdapter } from './adapters/fake.js'
export { StorageRegistry } from './registry.js'
export { StorageNotSupportedError } from './errors.js'
export { serveTemporaryUrls, type ServeTemporaryUrlsOptions } from './serveTemporaryUrls.js'
export type {
  StorageAdapter,
  StorageAdapterProvider,
  TemporaryUrlOptions,
  TemporaryUploadUrl,
  Visibility,
} from './contracts.js'

// ─── Storage Facade ────────────────────────────────────────

export class Storage {
  private static _originalDisks = new Map<string, StorageAdapter>()
  private static _fakes         = new Map<string, FakeAdapter>()

  /** Access a named disk, e.g. Storage.disk('s3').put(...) */
  static disk(name?: string): StorageAdapter { return StorageRegistry.get(name) }

  static put(filePath: string, contents: Buffer | string): Promise<void> {
    return StorageRegistry.get().put(filePath, contents)
  }
  static get(filePath: string): Promise<Buffer | null>   { return StorageRegistry.get().get(filePath) }
  static text(filePath: string): Promise<string | null>  { return StorageRegistry.get().text(filePath) }
  static delete(filePath: string): Promise<void>         { return StorageRegistry.get().delete(filePath) }
  static exists(filePath: string): Promise<boolean>      { return StorageRegistry.get().exists(filePath) }
  static list(directory?: string): Promise<string[]>     { return StorageRegistry.get().list(directory) }
  static url(filePath: string): string                   { return StorageRegistry.get().url(filePath) }
  static path(filePath: string): string                  { return StorageRegistry.get().path(filePath) }

  static temporaryUrl(filePath: string, expiresAt: Date, opts?: TemporaryUrlOptions): Promise<string> {
    return StorageRegistry.get().temporaryUrl(filePath, expiresAt, opts)
  }
  static temporaryUploadUrl(filePath: string, expiresAt: Date): Promise<TemporaryUploadUrl> {
    return StorageRegistry.get().temporaryUploadUrl(filePath, expiresAt)
  }
  static setVisibility(filePath: string, visibility: Visibility): Promise<void> {
    return StorageRegistry.get().setVisibility(filePath, visibility)
  }
  static getVisibility(filePath: string): Promise<Visibility> {
    return StorageRegistry.get().getVisibility(filePath)
  }
  static readStream(filePath: string): Promise<Readable> {
    return StorageRegistry.get().readStream(filePath)
  }
  static writeStream(filePath: string, stream: Readable): Promise<void> {
    return StorageRegistry.get().writeStream(filePath, stream)
  }
  static copy(from: string, to: string): Promise<void> {
    return StorageRegistry.get().copy(from, to)
  }
  static move(from: string, to: string): Promise<void> {
    return StorageRegistry.get().move(from, to)
  }
  static append(filePath: string, contents: string | Buffer): Promise<void> {
    return StorageRegistry.get().append(filePath, contents)
  }
  static prepend(filePath: string, contents: string | Buffer): Promise<void> {
    return StorageRegistry.get().prepend(filePath, contents)
  }

  /**
   * Replace a disk with an in-memory `FakeAdapter` for tests. Returns the
   * `FakeAdapter` instance so assertion helpers (`assertExists`, etc.) can
   * be called fluently. Idempotent: calling `fake()` twice returns the same
   * instance with its in-memory store reset.
   *
   * @example
   * const disk = Storage.fake()
   * await Storage.put('a.txt', 'hi')
   * disk.assertExists('a.txt')
   * Storage.restoreFakes()      // afterEach
   */
  static fake(name?: string): FakeAdapter {
    const key = name ?? StorageRegistry.defaultName()
    if (!Storage._originalDisks.has(key)) {
      try { Storage._originalDisks.set(key, StorageRegistry.get(key)) }
      catch { /* disk wasn't registered — fake fills the slot */ }
    }
    const existing = Storage._fakes.get(key)
    if (existing) {
      existing.reset()
      StorageRegistry.set(key, existing)
      try { app().instance(`storage.${key}`, existing) } catch { /* no app bound */ }
      return existing
    }
    const fake = new FakeAdapter()
    Storage._fakes.set(key, fake)
    StorageRegistry.set(key, fake)
    try { app().instance(`storage.${key}`, fake) } catch { /* no app bound */ }
    return fake
  }

  /** Reverse all `Storage.fake()` swaps. Call in `afterEach`. */
  static restoreFakes(): void {
    for (const [k, orig] of Storage._originalDisks) {
      StorageRegistry.set(k, orig)
      try { app().instance(`storage.${k}`, orig) } catch { /* no app bound */ }
    }
    Storage._originalDisks.clear()
    Storage._fakes.clear()
  }
}

// ─── Config ────────────────────────────────────────────────

export interface StorageDiskConfig {
  driver: string
  [key: string]: unknown
}

export interface StorageConfig {
  /** The default disk name */
  default: string
  /** Named disk configurations */
  disks: Record<string, StorageDiskConfig>
}

// ─── Service Provider ──────────────────────────────────────

/**
 * Boots all configured disks and registers the storage facade in the DI container.
 *
 * Built-in drivers:  local (writes to filesystem), s3 (AWS S3, MinIO, Cloudflare R2)
 *
 * Usage in bootstrap/providers.ts:
 *   import { defaultProviders } from '@rudderjs/core'
 *   export default [...(await defaultProviders())]
 */
export class StorageProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<StorageConfig>('storage')
    StorageRegistry.setDefault(cfg.default)

    for (const [name, diskConfig] of Object.entries(cfg.disks)) {
      const driver = diskConfig['driver'] as string
      let adapter: StorageAdapter

      if (driver === 'local') {
        adapter = new LocalAdapter(diskConfig as unknown as LocalDiskConfig)
      } else if (driver === 's3') {
        adapter = new S3Adapter(diskConfig as unknown as S3DiskConfig)
      } else {
        throw new Error(`[RudderJS Storage] Unknown driver "${driver}" for disk "${name}". Available: local, s3`)
      }

      StorageRegistry.set(name, adapter)
      this.app.instance(`storage.${name}`, adapter)
    }

    this.app.instance('storage', StorageRegistry.get())

    // storage:link — creates public/storage → storage/app/public symlink
    rudder.command('storage:link', async () => {
      const target = nodePath.resolve(process.cwd(), 'storage/app/public')
      const link   = nodePath.resolve(process.cwd(), 'public/storage')
      await fs.mkdir(target, { recursive: true })
      try {
        await fs.symlink(target, link)
        console.log(`Linked: public/storage → storage/app/public`)
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        if (e.code === 'EEXIST') console.log('Link already exists.')
        else throw err
      }
    }).description('Create a symbolic link from public/storage to storage/app/public')
  }
}
