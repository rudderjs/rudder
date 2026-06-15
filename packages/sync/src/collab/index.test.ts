import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { composeRoomId, type SyncAuthRequest } from '../index.js'
import {
  createCollabRoomAuth,
  defaultParseCollabRoom,
  type CollabResource,
} from './index.js'

// A minimal request stub — the builder only forwards it to `resolveUser`.
const req: SyncAuthRequest = { headers: {}, url: '/ws-sync/default:posts:42' }

/** A duck-typed resource backed by an in-memory record table. */
function makeResource<Rec extends object>(
  rows: Record<string, Rec>,
  policy: (user: unknown, record: Rec) => boolean | Promise<boolean>,
  extra: Partial<CollabResource<unknown, Rec>> = {},
): CollabResource<unknown, Rec> {
  return {
    find: (id) => (Object.prototype.hasOwnProperty.call(rows, id) ? rows[id]! : null),
    canView: policy,
    ...extra,
  }
}

describe('defaultParseCollabRoom', () => {
  it('takes the last two segments as [resource, recordId]', () => {
    assert.deepStrictEqual(defaultParseCollabRoom('posts:42'), { resource: 'posts', recordId: '42' })
    assert.deepStrictEqual(defaultParseCollabRoom('tenant:posts:42'), { resource: 'posts', recordId: '42' })
  })

  it('returns null for a non-record-scoped (single-segment) room', () => {
    assert.equal(defaultParseCollabRoom('lobby'), null)
  })

  it('returns null when a segment is empty', () => {
    assert.equal(defaultParseCollabRoom('posts:'), null)
    assert.equal(defaultParseCollabRoom(':42'), null)
  })

  it('honors a custom separator', () => {
    assert.deepStrictEqual(defaultParseCollabRoom('posts|42', '|'), { resource: 'posts', recordId: '42' })
  })
})

describe('createCollabRoomAuth', () => {
  const rows = { '42': { id: '42', ownerId: 'u1' } }

  it('allows when the record exists and the policy passes', async () => {
    const onAuth = createCollabRoomAuth({
      resources: { posts: makeResource(rows, (u: any, r: any) => u?.id === r.ownerId) },
      resolveUser: () => ({ id: 'u1' }),
    })
    assert.equal(await onAuth(req, composeRoomId(['default', 'posts', '42'])), true)
  })

  it('denies when the policy fails (wrong owner)', async () => {
    const onAuth = createCollabRoomAuth({
      resources: { posts: makeResource(rows, (u: any, r: any) => u?.id === r.ownerId) },
      resolveUser: () => ({ id: 'someone-else' }),
    })
    assert.equal(await onAuth(req, 'default:posts:42'), false)
  })

  it('denies when the room id does not parse to a record room', async () => {
    const onAuth = createCollabRoomAuth({
      resources: { posts: makeResource(rows, () => true) },
      resolveUser: () => ({ id: 'u1' }),
    })
    assert.equal(await onAuth(req, 'lobby'), false)
  })

  it('denies when no resource matches the segment', async () => {
    const onAuth = createCollabRoomAuth({
      resources: { posts: makeResource(rows, () => true) },
      resolveUser: () => ({ id: 'u1' }),
    })
    assert.equal(await onAuth(req, 'default:comments:42'), false)
  })

  it('denies when the record is not found', async () => {
    const onAuth = createCollabRoomAuth({
      resources: { posts: makeResource(rows, () => true) },
      resolveUser: () => ({ id: 'u1' }),
    })
    assert.equal(await onAuth(req, 'default:posts:999'), false)
  })

  it('never resolves an Object.prototype method as a resource (prototype-pollution guard)', async () => {
    const onAuth = createCollabRoomAuth({
      resources: { posts: makeResource(rows, () => true) },
      resolveUser: () => ({ id: 'u1' }),
    })
    assert.equal(await onAuth(req, 'default:constructor:42'), false)
    assert.equal(await onAuth(req, 'default:hasOwnProperty:42'), false)
  })

  describe('fail-closed on anonymous / errors', () => {
    it('denies an anonymous socket by default (no allowGuests)', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => true) },
        resolveUser: () => null,
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })

    it('admits a guest when allowGuests is set, forwarding null to canView', async () => {
      let sawUser: unknown = 'unset'
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, (u) => { sawUser = u; return true }) },
        resolveUser: () => undefined,
        allowGuests: true,
      })
      assert.equal(await onAuth(req, 'default:posts:42'), true)
      assert.equal(sawUser, null)
    })

    it('per-resource allowGuests:false overrides a builder-wide allowGuests:true', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => true, { allowGuests: false }) },
        resolveUser: () => null,
        allowGuests: true,
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })

    it('per-resource allowGuests:true overrides a builder-wide default of off', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => true, { allowGuests: true }) },
        resolveUser: () => null,
      })
      assert.equal(await onAuth(req, 'default:posts:42'), true)
    })

    it('denies when resolveUser throws', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => true) },
        resolveUser: () => { throw new Error('session backend down') },
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })

    it('denies when find throws', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: { find: () => { throw new Error('db down') }, canView: () => true } },
        resolveUser: () => ({ id: 'u1' }),
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })

    it('denies when canView throws', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => { throw new Error('policy boom') }) },
        resolveUser: () => ({ id: 'u1' }),
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })

    it('denies when canView returns a truthy non-boolean (only literal true allows)', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => 'yes' as unknown as boolean) },
        resolveUser: () => ({ id: 'u1' }),
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })

    it('denies when the resolved resource is not a valid CollabResource', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: { find: () => ({}) } as unknown as CollabResource },
        resolveUser: () => ({ id: 'u1' }),
      })
      assert.equal(await onAuth(req, 'default:posts:42'), false)
    })
  })

  describe('function resolver + custom parseRoom', () => {
    it('routes through a function resolver, receiving recordId + docName', async () => {
      let seen: { resource: string; recordId: string; docName: string } | null = null
      const onAuth = createCollabRoomAuth({
        resources: (resource, ctx) => {
          seen = { resource, recordId: ctx.recordId, docName: ctx.docName }
          return resource === 'posts' ? makeResource(rows, () => true) : null
        },
        resolveUser: () => ({ id: 'u1' }),
      })
      assert.equal(await onAuth(req, 'default:posts:42'), true)
      assert.deepStrictEqual(seen, { resource: 'posts', recordId: '42', docName: 'default:posts:42' })
    })

    it('a custom parseRoom can scope by tenant prefix and deny a mismatch', async () => {
      const onAuth = createCollabRoomAuth({
        resources: { posts: makeResource(rows, () => true) },
        resolveUser: () => ({ id: 'u1' }),
        parseRoom: (docName) => {
          const [tenant, resource, recordId] = docName.split(':')
          if (tenant !== 'acme' || !resource || !recordId) return null
          return { resource, recordId }
        },
      })
      assert.equal(await onAuth(req, 'acme:posts:42'), true)
      assert.equal(await onAuth(req, 'evil:posts:42'), false)
    })
  })
})
