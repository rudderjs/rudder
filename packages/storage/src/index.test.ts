import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs/promises'
import nodePath from 'node:path'
import { LocalAdapter, Storage, StorageRegistry, storage } from './index.js'

// ─── Helpers ───────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(nodePath.join(os.tmpdir(), 'rudderjs-storage-test-'))
}

const fakeApp = { instance: () => undefined } as never

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
      /Disk "local" not found/
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
    assert.ok(Storage.path('uploads/x.txt').endsWith('uploads/x.txt'))
  })

  it('disk() returns a named adapter', () => {
    const second = new LocalAdapter({ driver: 'local', root })
    StorageRegistry.set('backup', second)
    assert.strictEqual(Storage.disk('backup'), second)
  })

  it('disk() throws for an unknown disk name', () => {
    assert.throws(() => Storage.disk('unknown'), /Disk "unknown" not found/)
  })
})

// ─── storage() provider ────────────────────────────────────

describe('storage() provider', () => {
  let root: string

  beforeEach(async () => {
    root = await makeTmpDir()
    StorageRegistry.reset()
  })

  afterEach(async () => {
    StorageRegistry.reset()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('boots with local driver and registers the disk', async () => {
    const Provider = storage({ default: 'local', disks: { local: { driver: 'local', root } } })
    await new Provider(fakeApp).boot?.()
    assert.ok(StorageRegistry.get('local') instanceof LocalAdapter)
  })

  it('sets the default disk', async () => {
    const Provider = storage({ default: 'local', disks: { local: { driver: 'local', root } } })
    await new Provider(fakeApp).boot?.()
    assert.doesNotThrow(() => StorageRegistry.get())
  })

  it('registers multiple disks', async () => {
    const root2 = await makeTmpDir()
    try {
      const Provider = storage({
        default: 'local',
        disks: {
          local:  { driver: 'local', root },
          backup: { driver: 'local', root: root2 },
        },
      })
      await new Provider(fakeApp).boot?.()
      assert.ok(StorageRegistry.get('local')  instanceof LocalAdapter)
      assert.ok(StorageRegistry.get('backup') instanceof LocalAdapter)
    } finally {
      await fs.rm(root2, { recursive: true, force: true })
    }
  })

  it('throws on an unknown driver', async () => {
    const Provider = storage({ default: 'bad', disks: { bad: { driver: 'unsupported' } } })
    await assert.rejects(
      async () => new Provider(fakeApp).boot?.(),
      /Unknown driver "unsupported"/
    )
  })

  it('register() is a no-op', () => {
    const Provider = storage({ default: 'local', disks: { local: { driver: 'local', root } } })
    assert.doesNotThrow(() => new Provider(fakeApp).register?.())
  })

  it('booted local disk can put and retrieve files', async () => {
    const Provider = storage({ default: 'local', disks: { local: { driver: 'local', root } } })
    await new Provider(fakeApp).boot?.()
    await Storage.put('test.txt', 'provider works')
    assert.strictEqual(await Storage.text('test.txt'), 'provider works')
  })
})
