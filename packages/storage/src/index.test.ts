import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs/promises'
import nodePath from 'node:path'
import { Readable } from 'node:stream'
import { ConfigRepository, setConfigRepository, getConfigRepository } from '@rudderjs/core'
import {
  LocalAdapter,
  S3Adapter,
  FakeAdapter,
  Storage,
  StorageRegistry,
  StorageProvider,
  StorageNotSupportedError,
  StoragePathTraversalError,
  serveTemporaryUrls,
  type StorageConfig,
  type Visibility,
} from './index.js'

function withStorageConfig(cfg: StorageConfig): () => void {
  const previous = getConfigRepository()
  setConfigRepository(new ConfigRepository({ storage: cfg }))
  return () => setConfigRepository(previous ?? new ConfigRepository({}))
}

// ─── Helpers ───────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(nodePath.join(os.tmpdir(), 'rudderjs-storage-test-'))
}

const fakeApp = { instance: () => undefined } as never

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : c)
  return Buffer.concat(chunks)
}

// ─── LocalAdapter ──────────────────────────────────────────

describe('LocalAdapter', () => {
  let root: string
  let adapter: LocalAdapter

  beforeEach(async () => {
    root    = await makeTmpDir()
    adapter = new LocalAdapter({ driver: 'local', root })
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('put() + get() round-trips a string', async () => {
    await adapter.put('hello.txt', 'world')
    const buf = await adapter.get('hello.txt')
    assert.ok(buf !== null)
    assert.strictEqual(buf.toString('utf8'), 'world')
  })

  it('put() + get() round-trips a Buffer', async () => {
    const contents = Buffer.from([0x01, 0x02, 0x03])
    await adapter.put('bin.bin', contents)
    const result = await adapter.get('bin.bin')
    assert.ok(result !== null)
    assert.deepStrictEqual(result, contents)
  })

  it('put() creates nested directories automatically', async () => {
    await adapter.put('a/b/c/file.txt', 'deep')
    const result = await adapter.text('a/b/c/file.txt')
    assert.strictEqual(result, 'deep')
  })

  // ─── Path traversal containment ───
  // Every fs-touching method routes through abs()/sidecarAbs(), which reject
  // any path that resolves outside the disk root.

  it('put() rejects a relative traversal that escapes the root', async () => {
    await assert.rejects(
      () => adapter.put('../escaped.txt', 'nope'),
      StoragePathTraversalError,
    )
    // The file must NOT have been written outside the root.
    assert.strictEqual(await fs.access(nodePath.join(root, '..', 'escaped.txt')).then(() => true, () => false), false)
  })

  it('put() contains an absolute path inside the root instead of escaping', async () => {
    // join() neutralizes the leading separator, so an absolute path is written
    // *inside* the disk root, never at its real absolute location.
    const outside = nodePath.join(os.tmpdir(), `rudder-escape-${Date.now()}.txt`)
    await adapter.put(outside, 'ok')
    assert.strictEqual(await adapter.text(outside), 'ok')                                  // same key round-trips
    assert.strictEqual(await fs.access(outside).then(() => true, () => false), false)      // not at the real tmp path
  })

  it('get()/delete()/exists() reject traversal too', async () => {
    await assert.rejects(() => adapter.get('../../etc/passwd'), StoragePathTraversalError)
    await assert.rejects(() => adapter.delete('../../etc/passwd'), StoragePathTraversalError)
    await assert.rejects(() => adapter.exists('../secret'), StoragePathTraversalError)
  })

  it('copy()/move() reject traversal in either argument', async () => {
    await adapter.put('src.txt', 'data')
    await assert.rejects(() => adapter.copy('src.txt', '../leak.txt'), StoragePathTraversalError)
    await assert.rejects(() => adapter.move('../../x', 'dst.txt'), StoragePathTraversalError)
  })

  it('allows a path that uses .. but stays within the root', async () => {
    // a/b/../c.txt normalizes to a/c.txt — inside the root, so it's fine.
    await adapter.put('a/b/../c.txt', 'ok')
    assert.strictEqual(await adapter.text('a/c.txt'), 'ok')
  })

  it('list("") still resolves to the root itself', async () => {
    await adapter.put('top.txt', 'x')
    const files = await adapter.list('')
    assert.ok(files.includes('top.txt'))
  })

  it('get() returns null for a missing file', async () => {
    assert.strictEqual(await adapter.get('missing.txt'), null)
  })

  it('text() returns string content of a file', async () => {
    await adapter.put('note.txt', 'hello')
    assert.strictEqual(await adapter.text('note.txt'), 'hello')
  })

  it('text() returns null for a missing file', async () => {
    assert.strictEqual(await adapter.text('missing.txt'), null)
  })

  it('exists() returns true for an existing file', async () => {
    await adapter.put('exists.txt', 'yes')
    assert.strictEqual(await adapter.exists('exists.txt'), true)
  })

  it('exists() returns false for a missing file', async () => {
    assert.strictEqual(await adapter.exists('missing.txt'), false)
  })

  it('delete() removes a file', async () => {
    await adapter.put('delete-me.txt', 'bye')
    await adapter.delete('delete-me.txt')
    assert.strictEqual(await adapter.exists('delete-me.txt'), false)
  })

  it('delete() is a no-op for a missing file', async () => {
    await assert.doesNotReject(() => adapter.delete('ghost.txt'))
  })

  it('list() returns files in a directory', async () => {
    await adapter.put('dir/a.txt', 'a')
    await adapter.put('dir/b.txt', 'b')
    const files = await adapter.list('dir')
    assert.ok(files.includes('dir/a.txt'))
    assert.ok(files.includes('dir/b.txt'))
    assert.strictEqual(files.length, 2)
  })

  it('list() returns root-level files when called without args', async () => {
    await adapter.put('root.txt', 'r')
    const files = await adapter.list()
    assert.ok(files.includes('root.txt'))
  })

  it('list() does not include subdirectories', async () => {
    await adapter.put('dir/sub/nested.txt', 'n')
    await adapter.put('dir/file.txt', 'f')
    const files = await adapter.list('dir')
    assert.ok(files.includes('dir/file.txt'))
    assert.ok(!files.some(f => f.includes('sub')))
  })

  it('list() returns [] for a missing directory', async () => {
    assert.deepStrictEqual(await adapter.list('nonexistent'), [])
  })

  it('url() returns the correct public URL with default baseUrl', async () => {
    assert.strictEqual(adapter.url('avatars/photo.jpg'), '/storage/avatars/photo.jpg')
  })

  it('url() uses custom baseUrl', async () => {
    const a = new LocalAdapter({ driver: 'local', root, baseUrl: 'https://cdn.example.com' })
    assert.strictEqual(a.url('img/logo.png'), 'https://cdn.example.com/img/logo.png')
  })

  it('url() strips leading slash from filePath', async () => {
    assert.strictEqual(adapter.url('/avatars/photo.jpg'), '/storage/avatars/photo.jpg')
  })

  it('path() returns the absolute path', async () => {
    const abs = adapter.path('uploads/file.txt')
    assert.strictEqual(abs, nodePath.join(root, 'uploads/file.txt'))
  })

  it('overwriting a file replaces its contents', async () => {
    await adapter.put('file.txt', 'first')
    await adapter.put('file.txt', 'second')
    assert.strictEqual(await adapter.text('file.txt'), 'second')
  })

  // ─── New: visibility ───

  it('setVisibility / getVisibility round-trip via sidecar', async () => {
    await adapter.put('a.txt', 'x')
    await adapter.setVisibility('a.txt', 'public')
    assert.strictEqual(await adapter.getVisibility('a.txt'), 'public')

    await adapter.setVisibility('a.txt', 'private')
    assert.strictEqual(await adapter.getVisibility('a.txt'), 'private')
  })

  it('getVisibility falls back to mode bits when sidecar is missing', { skip: process.platform === 'win32' ? 'POSIX mode bits; Windows uses ACLs' : false }, async () => {
    await adapter.put('a.txt', 'x')
    await fs.chmod(adapter.path('a.txt'), 0o600)
    assert.strictEqual(await adapter.getVisibility('a.txt'), 'private')
  })

  it('getVisibility defaults to private when file does not exist', async () => {
    assert.strictEqual(await adapter.getVisibility('missing.txt'), 'private')
  })

  it('delete() also removes the sidecar visibility entry', async () => {
    await adapter.put('a.txt', 'x')
    await adapter.setVisibility('a.txt', 'public')
    await adapter.delete('a.txt')
    assert.strictEqual(await adapter.getVisibility('a.txt'), 'private')
  })

  // ─── New: streams ───

  it('readStream / writeStream round-trip a 1 MB random buffer', async () => {
    const big = Buffer.alloc(1 * 1024 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 13) & 0xff
    await adapter.writeStream('big.bin', Readable.from(big))
    const stream = await adapter.readStream('big.bin')
    const out = await readAll(stream)
    assert.deepStrictEqual(out, big)
  })

  it('writeStream creates parent directories', async () => {
    await adapter.writeStream('nested/deep/x.bin', Readable.from(Buffer.from('hi')))
    assert.strictEqual(await adapter.text('nested/deep/x.bin'), 'hi')
  })

  // ─── New: file ops ───

  it('copy() creates a new file with the same contents', async () => {
    await adapter.put('src.txt', 'data')
    await adapter.copy('src.txt', 'dst/copy.txt')
    assert.strictEqual(await adapter.text('dst/copy.txt'), 'data')
    assert.strictEqual(await adapter.text('src.txt'), 'data')
  })

  it('move() copies and deletes', async () => {
    await adapter.put('src.txt', 'data')
    await adapter.move('src.txt', 'dst.txt')
    assert.strictEqual(await adapter.exists('src.txt'), false)
    assert.strictEqual(await adapter.text('dst.txt'), 'data')
  })

  it('move() falls through EXDEV to copyFile + unlink', async () => {
    await adapter.put('a.txt', 'cross-device')
    let renameCalled = false
    const renameMock = mock.method(fs, 'rename', async () => {
      renameCalled = true
      const err: NodeJS.ErrnoException = new Error('EXDEV') as NodeJS.ErrnoException
      err.code = 'EXDEV'
      throw err
    })
    try {
      await adapter.move('a.txt', 'b.txt')
    } finally {
      renameMock.mock.restore()
    }
    assert.ok(renameCalled)
    assert.strictEqual(await adapter.exists('a.txt'), false)
    assert.strictEqual(await adapter.text('b.txt'), 'cross-device')
  })

  it('move() carries the visibility sidecar to the new path', async () => {
    await adapter.put('a.txt', 'data')
    await adapter.setVisibility('a.txt', 'private')

    await adapter.move('a.txt', 'b.txt')

    // The destination must report the same visibility the source had.
    assert.strictEqual(await adapter.getVisibility('b.txt'), 'private')

    // The source sidecar must NOT be left behind — otherwise a future
    // put(from) at the freed path would surface a stale visibility.
    await assert.rejects(
      () => fs.access(nodePath.join(root, '.visibility', 'a.txt')),
      /ENOENT/,
    )
  })

  it('move() with no source sidecar does not throw and leaves no destination sidecar', async () => {
    await adapter.put('a.txt', 'data')
    // Never called setVisibility — no sidecar exists.
    await adapter.move('a.txt', 'b.txt')
    assert.strictEqual(await adapter.text('b.txt'), 'data')
    await assert.rejects(
      () => fs.access(nodePath.join(root, '.visibility', 'b.txt')),
      /ENOENT/,
    )
  })

  it('append() creates a new file or appends to an existing one', async () => {
    await adapter.append('log.txt', 'one\n')
    await adapter.append('log.txt', 'two\n')
    assert.strictEqual(await adapter.text('log.txt'), 'one\ntwo\n')
  })

  it('prepend() places contents before existing file body', async () => {
    await adapter.put('changelog.md', '# 1.0.0\n')
    await adapter.prepend('changelog.md', '# 2.0.0\n')
    assert.strictEqual(await adapter.text('changelog.md'), '# 2.0.0\n# 1.0.0\n')
  })

  // ─── New: temporaryUrl gates ───

  it('temporaryUrl throws when serveTemporaryUrls() has not been called', async () => {
    await assert.rejects(
      () => adapter.temporaryUrl('a.txt', new Date(Date.now() + 60_000)),
      /requires a route/,
    )
  })

  it('temporaryUploadUrl throws StorageNotSupportedError', async () => {
    await assert.rejects(
      () => adapter.temporaryUploadUrl('a.txt', new Date(Date.now() + 60_000)),
      StorageNotSupportedError,
    )
  })
})

// ─── serveTemporaryUrls() routePath shapes ─────────────────

describe('serveTemporaryUrls()', () => {
  let root: string
  let adapter: LocalAdapter

  beforeEach(async () => {
    root    = await makeTmpDir()
    adapter = new LocalAdapter({ driver: 'local', root })
    StorageRegistry.set('local-temp-test', adapter)
  })

  afterEach(async () => {
    StorageRegistry.reset()
    await fs.rm(root, { recursive: true, force: true })
  })

  // Minimal RouterLike — the function only needs `get(path, handler)`.
  type Registered = { path: string; handler: (req: { url: string; params?: Record<string, string> }) => Promise<unknown> | unknown }
  const makeRouter = (): { calls: Registered[]; get: Registered['handler'] extends infer H ? (path: string, handler: H) => unknown : never } => {
    const calls: Registered[] = []
    return {
      calls,
      get(path, handler) { calls.push({ path, handler }); return undefined },
    }
  }

  it('accepts a `/foo/*` routePath and stores the prefix without the splat', async () => {
    const router = makeRouter()
    await serveTemporaryUrls(router, { disk: 'local-temp-test', routePath: '/storage/temp/*' })

    assert.strictEqual(adapter._tempUrlConfig?.routePrefix, '/storage/temp/')
    assert.strictEqual(router.calls[0]?.path, '/storage/temp/*')
  })

  it('accepts the documented `/foo/:path*` form (regression — previously threw)', async () => {
    const router = makeRouter()
    await serveTemporaryUrls(router, { disk: 'local-temp-test', routePath: '/storage/temp/:path*' })

    assert.strictEqual(adapter._tempUrlConfig?.routePrefix, '/storage/temp/')
    assert.strictEqual(router.calls[0]?.path, '/storage/temp/:path*')
  })

  it('rejects a routePath that does not end in a splat', async () => {
    const router = makeRouter()
    await assert.rejects(
      () => serveTemporaryUrls(router, { disk: 'local-temp-test', routePath: '/storage/temp' }),
      /must end in/,
    )
  })
})

// ─── BaseAdapter via FakeAdapter ────────────────────────────

describe('BaseAdapter defaults (via FakeAdapter)', () => {
  let fake: FakeAdapter
  beforeEach(() => { fake = new FakeAdapter() })

  it('move() = copy() + delete()', async () => {
    await fake.put('a.txt', 'x')
    await fake.move('a.txt', 'b.txt')
    assert.strictEqual(await fake.exists('a.txt'), false)
    assert.strictEqual(await fake.text('b.txt'), 'x')
  })

  it('append() creates the file when missing', async () => {
    await fake.append('a.txt', 'first\n')
    assert.strictEqual(await fake.text('a.txt'), 'first\n')
  })

  it('prepend() concatenates head + existing', async () => {
    await fake.put('a.txt', 'tail')
    await fake.prepend('a.txt', 'head-')
    assert.strictEqual(await fake.text('a.txt'), 'head-tail')
  })

  it('text() returns null for missing file', async () => {
    assert.strictEqual(await fake.text('ghost.txt'), null)
  })
})

// ─── StorageRegistry global store ─────────────────────────────────────────

describe('StorageRegistry global store', () => {
  afterEach(() => StorageRegistry.reset())

  it('state lives on globalThis so it survives a second copy of @rudderjs/storage', async () => {
    // Vite-bundled server apps inline `@rudderjs/storage` (Storage.*, Storage.disk(...))
    // into entry.mjs, but `StorageProvider.boot()` runs from a node_modules
    // copy of `@rudderjs/storage` resolved via the provider auto-discovery
    // manifest. Without a globalThis-routed store, `set()` from the
    // externalized copy would never be visible to `get()` from the bundled
    // copy. This test pins the contract: writes from this module copy are
    // visible on a global key the second copy would also read from.
    const root = await makeTmpDir()
    try {
      const adapter = new LocalAdapter({ driver: 'local', root })
      StorageRegistry.set('audit', adapter)
      StorageRegistry.setDefault('audit')
      const store = (globalThis as Record<string, unknown>)['__rudderjs_storage_registry__'] as { adapters: Map<string, unknown>; defaultDisk: string } | undefined
      assert.ok(store, 'global store should exist after StorageRegistry.set()')
      assert.strictEqual(store.adapters.get('audit'), adapter)
      assert.strictEqual(store.defaultDisk, 'audit')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

// ─── FakeAdapter / Storage.fake() ───────────────────────────

describe('FakeAdapter + Storage.fake()', () => {
  let root: string

  beforeEach(async () => {
    root = await makeTmpDir()
    StorageRegistry.reset()
    StorageRegistry.set('local', new LocalAdapter({ driver: 'local', root }))
    StorageRegistry.setDefault('local')
  })

  afterEach(async () => {
    Storage.restoreFakes()
    StorageRegistry.reset()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('Storage.fake() returns a FakeAdapter and replaces the default disk', () => {
    const fake = Storage.fake()
    assert.ok(fake instanceof FakeAdapter)
    assert.strictEqual(Storage.disk(), fake)
  })

  it('Storage.fake("name") replaces only the named disk', () => {
    const otherRoot = nodePath.join(root, 'other')
    StorageRegistry.set('backup', new LocalAdapter({ driver: 'local', root: otherRoot }))
    const fake = Storage.fake('backup')
    assert.strictEqual(Storage.disk('backup'), fake)
    assert.notStrictEqual(Storage.disk('local'), fake)
  })

  it('Storage.fake() is idempotent — same instance, in-memory store reset', async () => {
    const fake1 = Storage.fake()
    await fake1.put('a.txt', 'first')
    const fake2 = Storage.fake()
    assert.strictEqual(fake1, fake2)
    assert.strictEqual(await fake2.exists('a.txt'), false)
  })

  it('Storage.restoreFakes() puts the original disks back', () => {
    const original = StorageRegistry.get('local')
    Storage.fake()
    Storage.restoreFakes()
    assert.strictEqual(StorageRegistry.get('local'), original)
  })

  it('FakeAdapter assertExists / assertMissing / assertCount', async () => {
    const fake = Storage.fake()
    await fake.put('logs/1.txt', 'a')
    await fake.put('logs/2.txt', 'b')
    fake.assertExists('logs/1.txt')
    fake.assertMissing('ghost.txt')
    fake.assertCount('logs', 2)
    fake.assertDirectoryEmpty('archive')

    assert.throws(() => fake.assertMissing('logs/1.txt'), /to be missing/)
    assert.throws(() => fake.assertExists('ghost.txt'),    /to exist/)
    assert.throws(() => fake.assertCount('logs', 0),       /Expected 0 files/)
  })

  it('FakeAdapter readStream / writeStream round-trip', async () => {
    const fake = Storage.fake()
    await fake.writeStream('big.bin', Readable.from(Buffer.from('streamed-bytes')))
    const out = await readAll(await fake.readStream('big.bin'))
    assert.strictEqual(out.toString('utf8'), 'streamed-bytes')
  })

  it('FakeAdapter copy / move', async () => {
    const fake = Storage.fake()
    await fake.put('a.txt', 'x')
    await fake.copy('a.txt', 'b.txt')
    assert.strictEqual(await fake.text('b.txt'), 'x')

    await fake.move('a.txt', 'c.txt')
    assert.strictEqual(await fake.exists('a.txt'), false)
    assert.strictEqual(await fake.text('c.txt'), 'x')
  })

  it('FakeAdapter copy throws when source missing', async () => {
    const fake = Storage.fake()
    await assert.rejects(() => fake.copy('ghost.txt', 'b.txt'), /not found/)
  })

  it('FakeAdapter readStream throws when file missing', async () => {
    const fake = Storage.fake()
    await assert.rejects(() => fake.readStream('ghost.txt'), /not found/)
  })

  it('FakeAdapter getVisibility defaults to private', async () => {
    const fake = Storage.fake()
    await fake.put('a.txt', 'x')
    assert.strictEqual(await fake.getVisibility('a.txt'), 'private')
  })

  it('FakeAdapter setVisibility round-trip', async () => {
    const fake = Storage.fake()
    await fake.put('a.txt', 'x')
    await fake.setVisibility('a.txt', 'public')
    assert.strictEqual(await fake.getVisibility('a.txt'), 'public')
  })

  it('FakeAdapter temporaryUrl returns deterministic shape', async () => {
    const fake = Storage.fake()
    const url = await fake.temporaryUrl('a.txt', new Date(1234567890_000))
    assert.strictEqual(url, '/fake/a.txt?expires=1234567890')
  })

  it('FakeAdapter temporaryUploadUrl returns { url, headers }', async () => {
    const fake = Storage.fake()
    const result = await fake.temporaryUploadUrl('a.txt', new Date(1234567890_000))
    assert.deepStrictEqual(result, { url: '/fake/upload/a.txt?expires=1234567890', headers: {} })
  })

  it('FakeAdapter url() returns /fake/<path>', () => {
    const fake = Storage.fake()
    assert.strictEqual(fake.url('a/b.txt'), '/fake/a/b.txt')
  })

  it('FakeAdapter path() throws StorageNotSupportedError', () => {
    const fake = Storage.fake()
    assert.throws(() => fake.path(), StorageNotSupportedError)
  })

  it('Storage facade methods route through the fake disk', async () => {
    Storage.fake()
    await Storage.put('a.txt', 'hi')
    assert.strictEqual(await Storage.text('a.txt'), 'hi')
    await Storage.append('a.txt', '!')
    assert.strictEqual(await Storage.text('a.txt'), 'hi!')
  })
})

// ─── StorageRegistry ───────────────────────────────────────

describe('StorageRegistry', () => {
  let root: string

  beforeEach(async () => {
    root = await makeTmpDir()
    StorageRegistry.reset()
  })

  afterEach(async () => {
    StorageRegistry.reset()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('get() throws when the disk is not registered', () => {
    assert.throws(
      () => StorageRegistry.get('local'),
      /Disk "local" not found/,
    )
  })

  it('set() + get() registers and retrieves a named disk', () => {
    const adapter = new LocalAdapter({ driver: 'local', root })
    StorageRegistry.set('local', adapter)
    assert.strictEqual(StorageRegistry.get('local'), adapter)
  })

  it('get() without args returns the default disk', () => {
    const adapter = new LocalAdapter({ driver: 'local', root })
    StorageRegistry.set('local', adapter)
    StorageRegistry.setDefault('local')
    assert.strictEqual(StorageRegistry.get(), adapter)
  })

  it('setDefault() changes which disk get() returns', () => {
    const a = new LocalAdapter({ driver: 'local', root })
    const b = new LocalAdapter({ driver: 'local', root })
    StorageRegistry.set('a', a)
    StorageRegistry.set('b', b)
    StorageRegistry.setDefault('b')
    assert.strictEqual(StorageRegistry.get(), b)
  })

  it('defaultName() returns the default disk name', () => {
    StorageRegistry.setDefault('s3')
    assert.strictEqual(StorageRegistry.defaultName(), 's3')
  })

  it('reset() clears all disks and resets defaultDisk to "local"', () => {
    StorageRegistry.set('local', new LocalAdapter({ driver: 'local', root }))
    StorageRegistry.reset()
    assert.throws(() => StorageRegistry.get(), /Disk "local" not found/)
  })
})

// ─── Storage facade ────────────────────────────────────────

describe('Storage facade', () => {
  let root: string

  beforeEach(async () => {
    root = await makeTmpDir()
    StorageRegistry.reset()
    StorageRegistry.set('local', new LocalAdapter({ driver: 'local', root }))
    StorageRegistry.setDefault('local')
  })

  afterEach(async () => {
    StorageRegistry.reset()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('throws when no disk is registered', () => {
    StorageRegistry.reset()
    assert.throws(() => Storage.put('f.txt', 'v'), /Disk "local" not found/)
  })

  it('put() + text() round-trips a value', async () => {
    await Storage.put('msg.txt', 'hello')
    assert.strictEqual(await Storage.text('msg.txt'), 'hello')
  })

  it('get() returns a Buffer', async () => {
    await Storage.put('buf.bin', Buffer.from([1, 2, 3]))
    const result = await Storage.get('buf.bin')
    assert.ok(Buffer.isBuffer(result))
  })

  it('get() returns null for a missing file', async () => {
    assert.strictEqual(await Storage.get('missing.txt'), null)
  })

  it('exists() returns true for an existing file', async () => {
    await Storage.put('e.txt', 'x')
    assert.strictEqual(await Storage.exists('e.txt'), true)
  })

  it('exists() returns false for a missing file', async () => {
    assert.strictEqual(await Storage.exists('missing.txt'), false)
  })

  it('delete() removes a file', async () => {
    await Storage.put('del.txt', 'bye')
    await Storage.delete('del.txt')
    assert.strictEqual(await Storage.exists('del.txt'), false)
  })

  it('list() returns files in a directory', async () => {
    await Storage.put('docs/a.txt', 'a')
    await Storage.put('docs/b.txt', 'b')
    const files = await Storage.list('docs')
    assert.strictEqual(files.length, 2)
  })

  it('url() delegates to the adapter', () => {
    assert.strictEqual(Storage.url('img/x.png'), '/storage/img/x.png')
  })

  it('path() delegates to the adapter', () => {
    assert.ok(Storage.path('uploads/x.txt').replace(/\\/g, '/').endsWith('uploads/x.txt'))
  })

  it('disk() returns a named adapter', () => {
    const second = new LocalAdapter({ driver: 'local', root })
    StorageRegistry.set('backup', second)
    assert.strictEqual(Storage.disk('backup'), second)
  })

  it('disk() throws for an unknown disk name', () => {
    assert.throws(() => Storage.disk('unknown'), /Disk "unknown" not found/)
  })

  it('copy / move / append / prepend delegate to the adapter', async () => {
    await Storage.put('a.txt', 'data')
    await Storage.copy('a.txt', 'b.txt')
    assert.strictEqual(await Storage.text('b.txt'), 'data')

    await Storage.move('a.txt', 'c.txt')
    assert.strictEqual(await Storage.exists('a.txt'), false)

    await Storage.append('log.txt', 'one\n')
    await Storage.prepend('log.txt', '0\n')
    assert.strictEqual(await Storage.text('log.txt'), '0\none\n')
  })

  it('setVisibility / getVisibility delegate to the adapter', async () => {
    await Storage.put('a.txt', 'x')
    await Storage.setVisibility('a.txt', 'public')
    const v: Visibility = await Storage.getVisibility('a.txt')
    assert.strictEqual(v, 'public')
  })

  it('readStream / writeStream delegate to the adapter', async () => {
    await Storage.writeStream('a.bin', Readable.from(Buffer.from('streamed')))
    const out = await readAll(await Storage.readStream('a.bin'))
    assert.strictEqual(out.toString('utf8'), 'streamed')
  })

  it('temporaryUrl() rejects when adapter does not support it', async () => {
    await assert.rejects(
      () => Storage.temporaryUrl('a.txt', new Date(Date.now() + 60_000)),
      /requires a route/,
    )
  })
})

// ─── S3Adapter (mocked SDK) ────────────────────────────────

describe('S3Adapter (with mocked SDK client)', () => {
  let recorded: Array<{ command: string; input: Record<string, unknown> }>
  let s3:       S3Adapter

  beforeEach(() => {
    recorded = []
    s3 = new S3Adapter({ driver: 's3', bucket: 'b', region: 'us-east-1' })

    const mockClient = {
      send: async (cmd: { __name: string; input: Record<string, unknown> }) => {
        recorded.push({ command: cmd.__name, input: cmd.input })
        if (cmd.__name === 'GetObject') return { Body: Readable.from(Buffer.from('s3-content')) }
        if (cmd.__name === 'GetObjectAcl') {
          return {
            Grants: [{
              Grantee:    { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
              Permission: 'READ',
            }],
          }
        }
        return {}
      },
    }
    function commandFactory(name: string) {
      return class MockCommand {
        __name: string
        input:  Record<string, unknown>
        constructor(input: Record<string, unknown>) {
          this.__name = name
          this.input  = input
        }
      } as unknown as new (input: Record<string, unknown>) => unknown
    }
    const cmds = {
      GetObjectCommand:     commandFactory('GetObject'),
      PutObjectCommand:     commandFactory('PutObject'),
      DeleteObjectCommand:  commandFactory('DeleteObject'),
      HeadObjectCommand:    commandFactory('HeadObject'),
      ListObjectsV2Command: commandFactory('ListObjectsV2'),
      CopyObjectCommand:    commandFactory('CopyObject'),
      PutObjectAclCommand:  commandFactory('PutObjectAcl'),
      GetObjectAclCommand:  commandFactory('GetObjectAcl'),
    }
    ;(s3 as unknown as { client: unknown; _cmds: Record<string, unknown> }).client = mockClient
    ;(s3 as unknown as { client: unknown; _cmds: Record<string, unknown> })._cmds  = cmds
  })

  it('put() sends a PutObjectCommand with bucket + key', async () => {
    await s3.put('k.txt', 'data')
    assert.strictEqual(recorded[0]?.command, 'PutObject')
    assert.strictEqual(recorded[0]?.input['Bucket'], 'b')
    assert.strictEqual(recorded[0]?.input['Key'], 'k.txt')
  })

  it('get() reads Body and returns a Buffer', async () => {
    const out = await s3.get('k.txt')
    assert.ok(out !== null)
    assert.strictEqual(out.toString('utf8'), 's3-content')
  })

  it('setVisibility("public") sends PutObjectAcl with ACL: public-read', async () => {
    await s3.setVisibility('k.txt', 'public')
    assert.strictEqual(recorded[0]?.command, 'PutObjectAcl')
    assert.strictEqual(recorded[0]?.input['ACL'], 'public-read')
  })

  it('setVisibility("private") sends PutObjectAcl with ACL: private', async () => {
    await s3.setVisibility('k.txt', 'private')
    assert.strictEqual(recorded[0]?.input['ACL'], 'private')
  })

  it('getVisibility parses Grants and returns "public" for AllUsers READ', async () => {
    const v = await s3.getVisibility('k.txt')
    assert.strictEqual(v, 'public')
  })

  it('readStream returns the Body', async () => {
    const stream = await s3.readStream('k.txt')
    const out = await readAll(stream)
    assert.strictEqual(out.toString('utf8'), 's3-content')
  })

  it('copy sends CopyObjectCommand with CopySource preserving path separators', async () => {
    await s3.copy('a/b.txt', 'c/d.txt')
    assert.strictEqual(recorded[0]?.command, 'CopyObject')
    assert.strictEqual(recorded[0]?.input['CopySource'], 'b/a/b.txt')
    assert.strictEqual(recorded[0]?.input['Key'], 'c/d.txt')
  })

  it('copy encodes special characters in CopySource path segments', async () => {
    await s3.copy('folder/file with spaces.txt', 'dst.txt')
    assert.strictEqual(recorded[0]?.input['CopySource'], 'b/folder/file%20with%20spaces.txt')
  })

  it('temporaryUrl rejects when expiresAt is in the past', async () => {
    await assert.rejects(
      () => s3.temporaryUrl('k.txt', new Date(Date.now() - 1000)),
      /must be in the future/,
    )
  })

  it('temporaryUploadUrl rejects when expiresAt is in the past', async () => {
    await assert.rejects(
      () => s3.temporaryUploadUrl('k.txt', new Date(Date.now() - 1000)),
      /must be in the future/,
    )
  })
})

// ─── storage() provider ────────────────────────────────────

describe('storage() provider', () => {
  let root: string
  let restore: () => void

  beforeEach(async () => {
    root = await makeTmpDir()
    StorageRegistry.reset()
  })

  afterEach(async () => {
    restore?.()
    StorageRegistry.reset()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('boots with local driver and registers the disk', async () => {
    restore = withStorageConfig({ default: 'local', disks: { local: { driver: 'local', root } } })
    await new StorageProvider(fakeApp).boot?.()
    assert.ok(StorageRegistry.get('local') instanceof LocalAdapter)
  })

  it('sets the default disk', async () => {
    restore = withStorageConfig({ default: 'local', disks: { local: { driver: 'local', root } } })
    await new StorageProvider(fakeApp).boot?.()
    assert.doesNotThrow(() => StorageRegistry.get())
  })

  it('registers multiple disks', async () => {
    const root2 = await makeTmpDir()
    try {
      restore = withStorageConfig({
        default: 'local',
        disks: {
          local:  { driver: 'local', root },
          backup: { driver: 'local', root: root2 },
        },
      })
      await new StorageProvider(fakeApp).boot?.()
      assert.ok(StorageRegistry.get('local')  instanceof LocalAdapter)
      assert.ok(StorageRegistry.get('backup') instanceof LocalAdapter)
    } finally {
      await fs.rm(root2, { recursive: true, force: true })
    }
  })

  it('throws on an unknown driver', async () => {
    restore = withStorageConfig({ default: 'bad', disks: { bad: { driver: 'unsupported' } } })
    await assert.rejects(
      async () => new StorageProvider(fakeApp).boot?.(),
      /Unknown driver "unsupported"/,
    )
  })

  it('register() is a no-op', () => {
    restore = withStorageConfig({ default: 'local', disks: { local: { driver: 'local', root } } })
    assert.doesNotThrow(() => new StorageProvider(fakeApp).register?.())
  })

  it('booted local disk can put and retrieve files', async () => {
    restore = withStorageConfig({ default: 'local', disks: { local: { driver: 'local', root } } })
    await new StorageProvider(fakeApp).boot?.()
    await Storage.put('test.txt', 'provider works')
    assert.strictEqual(await Storage.text('test.txt'), 'provider works')
  })
})
