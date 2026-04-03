import { ServiceProvider, rudder, type Application } from '@rudderjs/core'
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
    if (!a) throw new Error(`[RudderJS Storage] Disk "${key}" not found. Check your storage config.`)
    return a
  }

  /** @internal — clears all registered disks. Used for testing. */
  static reset(): void {
    this.adapters.clear()
    this.defaultDisk = 'local'
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

export class LocalAdapter implements StorageAdapter {
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

// ─── S3 Driver ─────────────────────────────────────────────

export interface S3DiskConfig {
  driver:           's3'
  bucket:           string
  region?:          string
  endpoint?:        string    // S3-compatible endpoint (MinIO, Cloudflare R2, etc.)
  accessKeyId?:     string
  secretAccessKey?: string
  baseUrl?:         string    // public base URL override
  forcePathStyle?:  boolean   // required for MinIO
}

type S3Commands = {
  GetObjectCommand:     typeof import('@aws-sdk/client-s3').GetObjectCommand
  PutObjectCommand:     typeof import('@aws-sdk/client-s3').PutObjectCommand
  DeleteObjectCommand:  typeof import('@aws-sdk/client-s3').DeleteObjectCommand
  HeadObjectCommand:    typeof import('@aws-sdk/client-s3').HeadObjectCommand
  ListObjectsV2Command: typeof import('@aws-sdk/client-s3').ListObjectsV2Command
}

interface S3GetObjectResult {
  Body?: AsyncIterable<Uint8Array>
}

interface S3ListObjectsResult {
  Contents?: Array<{ Key?: string }>
}

class S3Adapter implements StorageAdapter {
  private client:  unknown
  private readonly bucket:  string
  private readonly baseUrl: string

  constructor(private readonly config: S3DiskConfig) {
    this.bucket  = config.bucket
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? ''
  }

  private async getClient(): Promise<{
    send: (cmd: unknown) => Promise<unknown>
  }> {
    if (!this.client) {
      const {
        S3Client, GetObjectCommand, PutObjectCommand,
        DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command,
      } = await import('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3')
      this.client = new S3Client({
        region: this.config.region ?? 'us-east-1',
        ...(this.config.endpoint       && { endpoint:       this.config.endpoint }),
        ...(this.config.forcePathStyle && { forcePathStyle: this.config.forcePathStyle }),
        ...(this.config.accessKeyId    && {
          credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey ?? '' },
        }),
      })
      ;(this as unknown as { _cmds: S3Commands })._cmds = { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command }
    }
    return this.client as { send: (cmd: unknown) => Promise<unknown> }
  }

  private cmds(): S3Commands { return (this as unknown as { _cmds: S3Commands })._cmds }

  async put(filePath: string, contents: Buffer | string): Promise<void> {
    const client = await this.getClient()
    await client.send(new (this.cmds().PutObjectCommand)({
      Bucket: this.bucket, Key: filePath,
      Body: typeof contents === 'string' ? Buffer.from(contents) : contents,
    }))
  }

  async get(filePath: string): Promise<Buffer | null> {
    try {
      const client = await this.getClient()
      const res = await client.send(new (this.cmds().GetObjectCommand)({ Bucket: this.bucket, Key: filePath })) as S3GetObjectResult
      if (!res.Body) return null
      const chunks: Uint8Array[] = []
      for await (const chunk of res.Body) chunks.push(chunk)
      return Buffer.concat(chunks)
    } catch { return null }
  }

  async text(filePath: string): Promise<string | null> {
    const buf = await this.get(filePath)
    return buf ? buf.toString('utf8') : null
  }

  async delete(filePath: string): Promise<void> {
    const client = await this.getClient()
    await client.send(new (this.cmds().DeleteObjectCommand)({ Bucket: this.bucket, Key: filePath }))
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const client = await this.getClient()
      await client.send(new (this.cmds().HeadObjectCommand)({ Bucket: this.bucket, Key: filePath }))
      return true
    } catch { return false }
  }

  async list(directory = ''): Promise<string[]> {
    const prefix = directory ? `${directory.replace(/\/$/, '')}/` : ''
    const client = await this.getClient()
    const res = await client.send(new (this.cmds().ListObjectsV2Command)({ Bucket: this.bucket, Prefix: prefix })) as S3ListObjectsResult
    return (res.Contents ?? []).map(o => o.Key ?? '').filter(Boolean)
  }

  url(filePath: string): string {
    if (this.baseUrl) return `${this.baseUrl}/${filePath.replace(/^\//, '')}`
    const endpoint = this.config.endpoint?.replace(/\/$/, '')
    if (endpoint && this.config.forcePathStyle) return `${endpoint}/${this.bucket}/${filePath}`
    return `https://${this.bucket}.s3.${this.config.region ?? 'us-east-1'}.amazonaws.com/${filePath}`
  }

  path(_filePath: string): string {
    throw new Error('[RudderJS Storage] path() is not available for S3 disks.')
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

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a StorageServiceProvider that boots all configured disks.
 *
 * Built-in drivers:  local (writes to filesystem), s3 (AWS S3, MinIO, Cloudflare R2)
 *
 * Usage in bootstrap/providers.ts:
 *   import { storage } from '@rudderjs/storage'
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
          adapter = new S3Adapter(diskConfig as unknown as S3DiskConfig)
        } else {
          throw new Error(`[RudderJS Storage] Unknown driver "${driver}" for disk "${name}". Available: local, s3`)
        }

        StorageRegistry.set(name, adapter)
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

  return StorageServiceProvider
}
