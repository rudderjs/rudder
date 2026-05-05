import nodePath from 'node:path'
import fs from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { resolveOptionalPeer } from '@rudderjs/core'
import { BaseAdapter } from '../base.js'
import { StorageNotSupportedError } from '../errors.js'
import type { TemporaryUrlOptions, TemporaryUploadUrl, Visibility } from '../contracts.js'

export interface LocalDiskConfig {
  driver:   'local'
  root:     string    // absolute or relative path to the storage root
  baseUrl?: string    // public URL prefix, e.g. '/storage' or 'https://cdn.example.com'
}

interface TempUrlConfig {
  /** Path template registered via serveTemporaryUrls (e.g. `/storage/temp/`). */
  routePrefix: string
}

const VISIBILITY_DIR = '.visibility'

export class LocalAdapter extends BaseAdapter {
  private readonly root:    string
  private readonly baseUrl: string
  /** @internal — populated by serveTemporaryUrls(). */
  _tempUrlConfig: TempUrlConfig | undefined

  constructor(config: LocalDiskConfig) {
    super()
    this.root    = nodePath.resolve(config.root)
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? '/storage'
  }

  override get driverName(): string { return 'local' }

  private abs(filePath: string): string {
    return nodePath.join(this.root, filePath)
  }

  private sidecarAbs(filePath: string): string {
    return nodePath.join(this.root, VISIBILITY_DIR, filePath)
  }

  // ─── Existing surface ───

  async put(filePath: string, contents: Buffer | string): Promise<void> {
    const abs = this.abs(filePath)
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    await fs.writeFile(abs, contents)
  }

  async get(filePath: string): Promise<Buffer | null> {
    try   { return await fs.readFile(this.abs(filePath)) }
    catch { return null }
  }

  async delete(filePath: string): Promise<void> {
    try { await fs.unlink(this.abs(filePath)) } catch { /* no-op */ }
    try { await fs.unlink(this.sidecarAbs(filePath)) } catch { /* no-op */ }
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

  // ─── Visibility ───

  async setVisibility(filePath: string, visibility: Visibility): Promise<void> {
    const abs = this.abs(filePath)
    const mode = visibility === 'public' ? 0o644 : 0o600
    try { await fs.chmod(abs, mode) } catch { /* Windows / FUSE — sidecar wins */ }
    const sidecar = this.sidecarAbs(filePath)
    await fs.mkdir(nodePath.dirname(sidecar), { recursive: true })
    await fs.writeFile(sidecar, visibility, 'utf8')
  }

  async getVisibility(filePath: string): Promise<Visibility> {
    try {
      const sidecar = await fs.readFile(this.sidecarAbs(filePath), 'utf8')
      const trimmed = sidecar.trim()
      if (trimmed === 'public' || trimmed === 'private') return trimmed
    } catch { /* fall through to mode bits */ }

    try {
      const stat = await fs.stat(this.abs(filePath))
      // Owner-write bit alone (e.g. 0o600) → private; world-readable → public.
      return (stat.mode & 0o004) ? 'public' : 'private'
    } catch {
      return 'private'
    }
  }

  // ─── Streams ───

  async readStream(filePath: string): Promise<Readable> {
    const { createReadStream } = await import('node:fs')
    return createReadStream(this.abs(filePath))
  }

  async writeStream(filePath: string, stream: Readable): Promise<void> {
    const abs = this.abs(filePath)
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    const { createWriteStream } = await import('node:fs')
    const { pipeline } = await import('node:stream/promises')
    await pipeline(stream, createWriteStream(abs))
  }

  // ─── File ops ───

  async copy(from: string, to: string): Promise<void> {
    const dst = this.abs(to)
    await fs.mkdir(nodePath.dirname(dst), { recursive: true })
    await fs.copyFile(this.abs(from), dst)
  }

  override async move(from: string, to: string): Promise<void> {
    const src = this.abs(from)
    const dst = this.abs(to)
    await fs.mkdir(nodePath.dirname(dst), { recursive: true })
    try {
      await fs.rename(src, dst)
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'EXDEV') throw err
      await fs.copyFile(src, dst)
      await fs.unlink(src)
    }
  }

  override async append(filePath: string, contents: string | Buffer): Promise<void> {
    const abs = this.abs(filePath)
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    await fs.appendFile(abs, contents)
  }

  // ─── Pre-signed URLs ───

  override async temporaryUrl(filePath: string, expiresAt: Date, _opts?: TemporaryUrlOptions): Promise<string> {
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('[RudderJS Storage] temporaryUrl: expiresAt must be in the future.')
    }
    if (!this._tempUrlConfig) {
      throw new Error(
        '[RudderJS Storage] LocalAdapter.temporaryUrl requires a route. ' +
        'Call serveTemporaryUrls(router, { disk: "<name>", routePath: "/storage/temp/*" }) in your bootstrap.',
      )
    }

    let mod: { Url?: { sign: (path: string, expiresAt?: Date) => string } }
    try {
      mod = await resolveOptionalPeer<{ Url?: { sign: (path: string, expiresAt?: Date) => string } }>('@rudderjs/router')
    } catch {
      throw new StorageNotSupportedError('local', 'temporaryUrl')
    }
    if (!mod.Url) throw new StorageNotSupportedError('local', 'temporaryUrl')

    const path = `${this._tempUrlConfig.routePrefix}${encodeURI(filePath)}`
    return mod.Url.sign(path, expiresAt)
  }

  /** @internal — invoked by serveTemporaryUrls(). */
  serveAt(routePrefix: string): void {
    this._tempUrlConfig = { routePrefix }
  }
}
