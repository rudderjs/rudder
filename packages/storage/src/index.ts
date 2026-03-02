import { ServiceProvider, artisan, type Application } from '@forge/core'
import nodePath from 'node:path'
import fs from 'node:fs/promises'

// ─── Adapter Contract ──────────────────────────────────────

export interface StorageAdapter {
  /** Write a file. Creates parent directories as needed. */
  put(filePath: string, contents: Buffer | string): Promise<void>

  /** Read a file. Returns null if it doesn't exist. */
  get(filePath: string): Promise<Buffer | null>

  /** Read a file as a UTF-8 string. Returns null if it doesn't exist. */
  text(filePath: string): Promise<string | null>

  /** Delete a file. No-op if it doesn't exist. */
  delete(filePath: string): Promise<void>

  /** Check if a file exists. */
  exists(filePath: string): Promise<boolean>

  /** List files in a directory (relative paths). */
  list(directory?: string): Promise<string[]>

  /** Public URL for the file. */
  url(filePath: string): string

  /** Absolute filesystem path. Throws for remote drivers. */
  path(filePath: string): string
}

export interface StorageAdapterProvider {
  create(): StorageAdapter | Promise<StorageAdapter>
}

// ─── Storage Registry ──────────────────────────────────────

export class StorageRegistry {
  private static readonly adapters = new Map<string, StorageAdapter>()
  private static defaultDisk = 'local'

  static set(name: string, adapter: StorageAdapter): void { this.adapters.set(name, adapter) }
  static setDefault(name: string): void                   { this.defaultDisk = name }

  static get(name?: string): StorageAdapter {
    const key = name ?? this.defaultDisk
    const a   = this.adapters.get(key)
    if (!a) throw new Error(`[Forge Storage] Disk "${key}" not found. Check your storage config.`)
    return a
  }
}

// ─── Storage Facade ────────────────────────────────────────

export class Storage {
  /** Access a named disk, e.g. Storage.disk('s3').put(...) */
  static disk(name: string): StorageAdapter    { return StorageRegistry.get(name) }

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
}

// ─── Local Driver ──────────────────────────────────────────

export interface LocalDiskConfig {
  driver:   'local'
  root:     string    // absolute or relative path to the storage root
  baseUrl?: string    // public URL prefix, e.g. '/storage' or 'https://cdn.example.com'
}

class LocalAdapter implements StorageAdapter {
  private readonly root:    string
  private readonly baseUrl: string

  constructor(config: LocalDiskConfig) {
    this.root    = nodePath.resolve(config.root)
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? '/storage'
  }

  private abs(filePath: string): string {
    return nodePath.join(this.root, filePath)
  }

  async put(filePath: string, contents: Buffer | string): Promise<void> {
    const abs = this.abs(filePath)
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    await fs.writeFile(abs, contents)
  }

  async get(filePath: string): Promise<Buffer | null> {
    try   { return await fs.readFile(this.abs(filePath)) }
    catch { return null }
  }

  async text(filePath: string): Promise<string | null> {
    const buf = await this.get(filePath)
    return buf ? buf.toString('utf8') : null
  }

  async delete(filePath: string): Promise<void> {
    try { await fs.unlink(this.abs(filePath)) } catch { /* no-op */ }
  }

  async exists(filePath: string): Promise<boolean> {
    try { await fs.access(this.abs(filePath)); return true } catch { return false }
  }

  async list(directory = ''): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.abs(directory), { withFileTypes: true })
      return entries
        .filter(e => e.isFile())
        .map(e => nodePath.join(directory, e.name).replace(/\\/g, '/'))
    } catch { return [] }
  }

  url(filePath: string): string  { return `${this.baseUrl}/${filePath.replace(/^\//, '')}` }
  path(filePath: string): string { return this.abs(filePath) }
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

// ─── Helpers ───────────────────────────────────────────────

function makeUnavailableAdapter(msg: string): StorageAdapter {
  const reject = (): Promise<never> => Promise.reject(new Error(msg))
  const throws = (): never => { throw new Error(msg) }
  return { put: reject, get: reject, text: reject, delete: reject, exists: reject, list: reject, url: throws, path: throws }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a StorageServiceProvider that boots all configured disks.
 *
 * Built-in drivers:  local (writes to filesystem)
 * Plugin drivers:    s3 (@forge/storage-s3) — AWS S3 + S3-compatible (MinIO, R2)
 *
 * Usage in bootstrap/providers.ts:
 *   import { storage } from '@forge/storage'
 *   import configs from '../config/index.js'
 *   export default [..., storage(configs.storage), ...]
 */
export function storage(config: StorageConfig): new (app: Application) => ServiceProvider {
  class StorageServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      StorageRegistry.setDefault(config.default)

      for (const [name, diskConfig] of Object.entries(config.disks)) {
        const driver = diskConfig['driver'] as string
        let adapter: StorageAdapter

        if (driver === 'local') {
          adapter = new LocalAdapter(diskConfig as unknown as LocalDiskConfig)
        } else if (driver === 's3') {
          let s3Mod: any
          try {
            // @ts-ignore — @forge/storage-s3 is an optional peer
            s3Mod = await import('@forge/storage-s3')
          } catch {
            // Any import failure means @forge/storage-s3 isn't available (not installed or not built).
            // Vite's module runner wraps ERR_MODULE_NOT_FOUND in a RunnerError without .code,
            // so we catch broadly and mark the disk as unavailable instead of crashing.
            const msg = `[Forge Storage] Disk "${name}" requires @forge/storage-s3. Install it: pnpm add @forge/storage-s3`
            StorageRegistry.set(name, makeUnavailableAdapter(msg))
            continue
          }
          adapter = await (s3Mod.s3 as (c: unknown) => StorageAdapterProvider)(diskConfig).create()
        } else {
          throw new Error(`[Forge Storage] Unknown driver "${driver}" for disk "${name}". Available: local, s3`)
        }

        StorageRegistry.set(name, adapter)
      }

      this.app.instance('storage', StorageRegistry.get())

      // storage:link — creates public/storage → storage/app/public symlink
      artisan.command('storage:link', async () => {
        const target = nodePath.resolve(process.cwd(), 'storage/app/public')
        const link   = nodePath.resolve(process.cwd(), 'public/storage')
        await fs.mkdir(target, { recursive: true })
        try {
          await fs.symlink(target, link)
          console.log(`[Storage] Linked: public/storage → storage/app/public`)
        } catch (err: unknown) {
          const e = err as NodeJS.ErrnoException
          if (e.code === 'EEXIST') console.log('[Storage] Link already exists.')
          else throw err
        }
      }).description('Create a symbolic link from public/storage to storage/app/public')

      const diskNames = Object.keys(config.disks).join(', ')
      console.log(`[StorageServiceProvider] booted — disks: ${diskNames}`)
    }
  }

  return StorageServiceProvider
}
