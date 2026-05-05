import assert from 'node:assert'
import { Readable } from 'node:stream'
import { BaseAdapter } from '../base.js'
import { StorageNotSupportedError } from '../errors.js'
import type { TemporaryUploadUrl, Visibility } from '../contracts.js'

/**
 * In-memory storage adapter used by `Storage.fake()`. Implements the full
 * `StorageAdapter` contract with assertion helpers for tests.
 */
export class FakeAdapter extends BaseAdapter {
  private files        = new Map<string, Buffer>()
  private visibilities = new Map<string, Visibility>()

  override get driverName(): string { return 'fake' }

  async put(p: string, c: Buffer | string): Promise<void> {
    this.files.set(p, typeof c === 'string' ? Buffer.from(c) : c)
  }
  async get(p: string): Promise<Buffer | null> { return this.files.get(p) ?? null }
  async delete(p: string): Promise<void> {
    this.files.delete(p)
    this.visibilities.delete(p)
  }
  async exists(p: string): Promise<boolean> { return this.files.has(p) }
  async list(dir = ''): Promise<string[]> {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : ''
    return [...this.files.keys()].filter(k => k.startsWith(prefix))
  }
  url(p: string): string { return `/fake/${p}` }
  path(): string         { throw new StorageNotSupportedError('fake', 'path') }

  async setVisibility(p: string, v: Visibility): Promise<void> {
    this.visibilities.set(p, v)
  }
  async getVisibility(p: string): Promise<Visibility> {
    return this.visibilities.get(p) ?? 'private'
  }

  async readStream(p: string): Promise<Readable> {
    const buf = this.files.get(p)
    if (!buf) throw new Error(`[RudderJS Storage] FakeAdapter.readStream: "${p}" not found.`)
    return Readable.from(buf)
  }
  async writeStream(p: string, stream: Readable): Promise<void> {
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
    this.files.set(p, Buffer.concat(chunks))
  }

  override async temporaryUrl(p: string, expiresAt: Date): Promise<string> {
    return `/fake/${p}?expires=${Math.floor(expiresAt.getTime() / 1000)}`
  }
  override async temporaryUploadUrl(p: string, expiresAt: Date): Promise<TemporaryUploadUrl> {
    return {
      url:     `/fake/upload/${p}?expires=${Math.floor(expiresAt.getTime() / 1000)}`,
      headers: {},
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const buf = this.files.get(from)
    if (!buf) throw new Error(`[RudderJS Storage] FakeAdapter.copy: "${from}" not found.`)
    this.files.set(to, Buffer.from(buf))
  }

  // ─── Assertions ───

  assertExists(p: string): void {
    assert.ok(this.files.has(p), `Expected "${p}" to exist on the fake disk.`)
  }
  assertMissing(p: string): void {
    assert.ok(!this.files.has(p), `Expected "${p}" to be missing on the fake disk.`)
  }
  assertCount(dir: string, n: number): void {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : ''
    const count  = [...this.files.keys()].filter(k => k.startsWith(prefix)).length
    assert.equal(count, n, `Expected ${n} files in "${dir}" on the fake disk, got ${count}.`)
  }
  assertDirectoryEmpty(dir: string): void { this.assertCount(dir, 0) }

  /** Wipe all files + visibility state. Called by `Storage.fake()` on re-fake. */
  reset(): void {
    this.files.clear()
    this.visibilities.clear()
  }
}
