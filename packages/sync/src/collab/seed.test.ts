import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

import { composeRoomId } from '../index.js'
import { createCollabRoomSeeder, type CollabSeedResource } from './index.js'

// onFirstConnect's ctx is unused by the seeder; pass a minimal stub.
const CTX = { firstClient: {} as never, persistence: {} as never }

/** A duck-typed seed resource backed by an in-memory record table. */
function makeResource<Rec extends object>(
  rows: Record<string, Rec>,
  project: (record: Rec) => Record<string, unknown>,
): CollabSeedResource<Rec> {
  return {
    find: (id) => (Object.prototype.hasOwnProperty.call(rows, id) ? rows[id]! : null),
    seed: project,
  }
}

const rows = { '42': { id: '42', title: 'Hello', body: 'World' } }
const postsResource = makeResource(rows, (r) => ({ title: r.title, body: r.body }))

describe('createCollabRoomSeeder', () => {
  it('seeds an empty doc from the resolved record', async () => {
    const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
    const doc = new Y.Doc()
    await seed(composeRoomId(['posts', '42']), doc, CTX)

    const fields = doc.getMap('fields')
    assert.equal(fields.get('title'), 'Hello')
    assert.equal(fields.get('body'), 'World')
  })

  it('resolves the resource from the last two room segments (prefixed rooms)', async () => {
    const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
    const doc = new Y.Doc()
    await seed(composeRoomId(['tenant', 'posts', '42']), doc, CTX)
    assert.equal(doc.getMap('fields').get('title'), 'Hello')
  })

  it('does not overwrite a doc that already has fields (idempotent)', async () => {
    const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
    const doc = new Y.Doc()
    doc.getMap('fields').set('title', 'Existing')
    await seed(composeRoomId(['posts', '42']), doc, CTX)
    assert.equal(doc.getMap('fields').get('title'), 'Existing')
    assert.equal(doc.getMap('fields').get('body'), undefined)
  })

  it('tags seed writes with the configured transact origin', async () => {
    const seed = createCollabRoomSeeder({ resources: { posts: postsResource }, origin: 'my-seed' })
    const doc = new Y.Doc()
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin))
    await seed(composeRoomId(['posts', '42']), doc, CTX)
    assert.ok(origins.includes('my-seed'))
  })

  it('seeds into a custom map name', async () => {
    const seed = createCollabRoomSeeder({ resources: { posts: postsResource }, mapName: 'meta' })
    const doc = new Y.Doc()
    await seed(composeRoomId(['posts', '42']), doc, CTX)
    assert.equal(doc.getMap('meta').get('title'), 'Hello')
    assert.equal(doc.getMap('fields').size, 0)
  })

  it('normalizes undefined seed values to null', async () => {
    const seed = createCollabRoomSeeder({
      resources: { posts: makeResource(rows, () => ({ title: undefined })) },
    })
    const doc = new Y.Doc()
    await seed(composeRoomId(['posts', '42']), doc, CTX)
    const fields = doc.getMap('fields')
    assert.equal(fields.has('title'), true)
    assert.equal(fields.get('title'), null)
  })

  describe('clean skips (no seed, no throw)', () => {
    it('skips a room id that does not parse', async () => {
      const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
      const doc = new Y.Doc()
      await seed('lobby', doc, CTX)
      assert.equal(doc.getMap('fields').size, 0)
    })

    it('skips when no resource is resolved for the segment', async () => {
      const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
      const doc = new Y.Doc()
      await seed(composeRoomId(['videos', '42']), doc, CTX)
      assert.equal(doc.getMap('fields').size, 0)
    })

    it('skips when the record is not found', async () => {
      const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
      const doc = new Y.Doc()
      await seed(composeRoomId(['posts', '999']), doc, CTX)
      assert.equal(doc.getMap('fields').size, 0)
    })

    it('skips when seed() returns an empty object', async () => {
      const seed = createCollabRoomSeeder({ resources: { posts: makeResource(rows, () => ({})) } })
      const doc = new Y.Doc()
      await seed(composeRoomId(['posts', '42']), doc, CTX)
      assert.equal(doc.getMap('fields').size, 0)
    })

    it('never resolves a prototype method as a resource (own-property only)', async () => {
      const seed = createCollabRoomSeeder({ resources: { posts: postsResource } })
      const doc = new Y.Doc()
      await seed(composeRoomId(['constructor', '42']), doc, CTX)
      assert.equal(doc.getMap('fields').size, 0)
    })
  })

  describe('fail-loud on error (propagates for retry)', () => {
    it('propagates a find() throw', async () => {
      const seed = createCollabRoomSeeder({
        resources: { posts: { find: () => { throw new Error('db down') }, seed: () => ({}) } },
      })
      await assert.rejects(Promise.resolve(seed(composeRoomId(['posts', '42']), new Y.Doc(), CTX)), /db down/)
    })

    it('propagates a seed() throw', async () => {
      const seed = createCollabRoomSeeder({
        resources: { posts: { find: () => rows['42'], seed: () => { throw new Error('bad projection') } } },
      })
      await assert.rejects(Promise.resolve(seed(composeRoomId(['posts', '42']), new Y.Doc(), CTX)), /bad projection/)
    })
  })

  it('supports a function resolver with recordId/docName routing', async () => {
    const seen: Array<{ resource: string; recordId: string; docName: string }> = []
    const seed = createCollabRoomSeeder({
      resources: (resource, ctx) => {
        seen.push({ resource, ...ctx })
        return resource === 'posts' ? postsResource : null
      },
    })
    const doc = new Y.Doc()
    await seed(composeRoomId(['posts', '42']), doc, CTX)
    assert.equal(doc.getMap('fields').get('title'), 'Hello')
    assert.deepEqual(seen, [{ resource: 'posts', recordId: '42', docName: 'posts:42' }])
  })
})
