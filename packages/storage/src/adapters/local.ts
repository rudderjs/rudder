import nodePath from 'node:path'
import fs from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { resolveOptionalPeer } from '@rudderjs/core'
import { BaseAdapter } from '../base.js'
import { StorageNotSupportedError, StoragePathTraversalError } from '../errors.js'
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

  // Join `filePath` onto `base` and reject anything that escapes it.
  // `path.join` (not `path.resolve`) is deliberate: it collapses `..`
  // segments AND neutralizes an absolute `filePath` by treating it as
  // relative (`join('/root', '/etc/x')` → '/root/etc/x'), so it stays
  // anchored to the disk root — including against a Windows drive/UNC
  // override that `resolve` would honour. The `startsWith` check then
  // rejects any `..` sequence that still climbs above the root. Every
  // filesystem-touching method routes through abs()/sidecarAbs(), so this
  // is the single choke point for traversal.
  private contain(base: string, filePath: string): string {
    const joined = nodePath.join(base, filePath)
    const baseWithSep = base.endsWith(nodePath.sep) ? base : base + nodePath.sep
    if (joined !== base && !joined.startsWith(baseWithSep)) {
      throw new StoragePathTraversalError(filePath)
    }
    return joined
  }

  private abs(filePath: string): string {
    return this.contain(this.root, filePath)
  }

  private sidecarAbs(filePath: string): string {
    return this.contain(nodePath.join(this.root, VISIBILITY_DIR), filePath)
  }

  // ─── Existing surface ───

  async put(filePath: string, contents: Buffer | string): Promise<void> {
    const abs = this.abs(filePath)
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    await fs.writeFile(abs, contents)
  }

  async get(filePath: string): Promise<Buffer | null> {
    // Resolve (and traversal-check) before the try so an escaping path throws
    // loudly rather than being swallowed into a `null` "not found".
    const abs = this.abs(filePath)
    try   { return await fs.readFile(abs) }
    catch { return null }
  }

  async delete(filePath: string): Promise<void> {
    const abs     = this.abs(filePath)
    const sidecar = this.sidecarAbs(filePath)
    try { await fs.unlink(abs) } catch { /* no-op */ }
    try { await fs.unlink(sidecar) } catch { /* no-op */ }
  }

  async exists(filePath: string): Promise<boolean> {
    const abs = this.abs(filePath)
    try { await fs.access(abs); return true } catch { return false }
  }

  async list(directory = ''): Promise<string[]> {
    const abs = this.abs(directory)
    try {
      const entries = await fs.readdir(abs, { withFileTypes: true })
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
    const sidecarPath = this.sidecarAbs(filePath)
    const absPath     = this.abs(filePath)
    try {
      const sidecar = await fs.readFile(sidecarPath, 'utf8')
      const trimmed = sidecar.trim()
      if (trimmed === 'public' || trimmed === 'private') return trimmed
    } catch { /* fall through to mode bits */ }

    try {
      const stat = await fs.stat(absPath)
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

    // Move the visibility sidecar alongside the file, so getVisibility(to)
    // returns whatever setVisibility(from) had set, and a later put(from) on
    // the freed path doesn't surface a stale value through a leaked sidecar.
    // Missing sidecar (no prior setVisibility) is the common case — silently no-op.
    const srcSidecar = this.sidecarAbs(from)
    const dstSidecar = this.sidecarAbs(to)
    try {
      await fs.mkdir(nodePath.dirname(dstSidecar), { recursive: true })
      await fs.rename(srcSidecar, dstSidecar)
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return
      if (e.code !== 'EXDEV') throw err
      try {
        await fs.copyFile(srcSidecar, dstSidecar)
        await fs.unlink(srcSidecar)
      } catch (err2: unknown) {
        const e2 = err2 as NodeJS.ErrnoException
        if (e2.code !== 'ENOENT') throw err2
      }
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
