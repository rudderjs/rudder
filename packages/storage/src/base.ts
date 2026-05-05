import type { Readable } from 'node:stream'
import type {
  StorageAdapter,
  TemporaryUrlOptions,
  TemporaryUploadUrl,
  Visibility,
} from './contracts.js'
import { StorageNotSupportedError } from './errors.js'

/**
 * Abstract base for storage adapters. Provides default implementations for
 * `move / append / prepend / text` so adapters only have to implement what
 * they have a faster path for.
 *
 * Methods that genuinely cannot be implemented for a given driver should
 * throw `StorageNotSupportedError`.
 */
export abstract class BaseAdapter implements StorageAdapter {
  abstract put(filePath: string, contents: Buffer | string): Promise<void>
  abstract get(filePath: string): Promise<Buffer | null>
  abstract delete(filePath: string): Promise<void>
  abstract exists(filePath: string): Promise<boolean>
  abstract list(directory?: string): Promise<string[]>
  abstract url(filePath: string): string
  abstract path(filePath: string): string

  abstract setVisibility(filePath: string, visibility: Visibility): Promise<void>
  abstract getVisibility(filePath: string): Promise<Visibility>

  abstract readStream(filePath: string): Promise<Readable>
  abstract writeStream(filePath: string, stream: Readable): Promise<void>

  abstract copy(from: string, to: string): Promise<void>

  protected get driverName(): string { return this.constructor.name.replace(/Adapter$/, '').toLowerCase() }

  async text(filePath: string): Promise<string | null> {
    const buf = await this.get(filePath)
    return buf ? buf.toString('utf8') : null
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to)
    await this.delete(from)
  }

  async append(filePath: string, contents: string | Buffer): Promise<void> {
    const existing = await this.get(filePath)
    const next = existing
      ? Buffer.concat([existing, typeof contents === 'string' ? Buffer.from(contents) : contents])
      : (typeof contents === 'string' ? Buffer.from(contents) : contents)
    await this.put(filePath, next)
  }

  async prepend(filePath: string, contents: string | Buffer): Promise<void> {
    const existing = await this.get(filePath)
    const head = typeof contents === 'string' ? Buffer.from(contents) : contents
    const next = existing ? Buffer.concat([head, existing]) : head
    await this.put(filePath, next)
  }

  async temporaryUrl(_filePath: string, _expiresAt: Date, _opts?: TemporaryUrlOptions): Promise<string> {
    throw new StorageNotSupportedError(this.driverName, 'temporaryUrl')
  }

  async temporaryUploadUrl(_filePath: string, _expiresAt: Date): Promise<TemporaryUploadUrl> {
    throw new StorageNotSupportedError(this.driverName, 'temporaryUploadUrl')
  }
}
