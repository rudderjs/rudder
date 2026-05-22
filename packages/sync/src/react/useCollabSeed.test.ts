import { describe, it } from 'node:test'
import assert            from 'node:assert/strict'
import * as Y            from 'yjs'
import { seedShareTypeOnSync, SEED_ORIGIN } from './useCollabSeed.js'
import type { CollabRoom }                  from './types.js'

// ─── Test setup ──────────────────────────────────────────────
//
// The React hooks (`useCollabSeed`, `useCollabSeedText`) are thin
// wrappers around the pure async helper `seedShareTypeOnSync` — same
// posture as `CollabRoomManager` vs `useCollabRoom` (per the
// CollabRoomManager.ts module comment: "no React in the loop we can
// exhaustively unit-test the cancellation matrix"). The hooks
// themselves are not unit tested because the framework intentionally
// does not ship a React testing harness.
//
// These tests cover the seed-on-empty decision and the transact-origin
// tag — the two pieces that determine whether peers see a phantom
// seed-as-user-edit on every cold mount.

function fakeRoom(syncedPromise: Promise<void>): { room: CollabRoom; doc: Y.Doc } {
  const doc: Y.Doc = new Y.Doc()
  const room = {
    ydoc:        doc,
    provider:    null as unknown as CollabRoom['provider'],
    persistence: null,
    synced:      syncedPromise,
  } satisfies CollabRoom
  return { room, doc }
}

describe('seedShareTypeOnSync — Y.XmlFragment', () => {
  it('runs the seed callback when the fragment is empty', async () => {
    const { room, doc } = fakeRoom(Promise.resolve())
    let invoked = 0
    const ok = await seedShareTypeOnSync(
      room,
      'content',
      (d, k) => d.getXmlFragment(k),
      (_d, fragment) => {
        invoked++
        const xt = new Y.XmlText()
        xt.insert(0, 'hello')
        fragment.insert(0, [xt])
      },
    )
    assert.equal(ok, true, 'should resolve true after the synced check completes')
    assert.equal(invoked, 1, 'seedFn must run on an empty fragment')
    assert.equal(doc.getXmlFragment('content').length, 1, 'fragment should be populated')
  })

  it('skips the seed callback when the fragment is already populated', async () => {
    const { room, doc } = fakeRoom(Promise.resolve())
    // Pre-populate so the empty-check short-circuits.
    const fragment = doc.getXmlFragment('content')
    const prior    = new Y.XmlText()
    prior.insert(0, 'existing')
    fragment.insert(0, [prior])

    let invoked = 0
    await seedShareTypeOnSync(
      room,
      'content',
      (d, k) => d.getXmlFragment(k),
      () => { invoked++ },
    )
    assert.equal(invoked, 0, 'seedFn must NOT run when the fragment is non-empty')
    assert.equal(fragment.length, 1, 'fragment must keep its prior content')
  })

  it('wraps the seed write in a transact tagged with SEED_ORIGIN', async () => {
    const { room, doc } = fakeRoom(Promise.resolve())
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr) => { origins.push(tr.origin) })

    await seedShareTypeOnSync(
      room,
      'content',
      (d, k) => d.getXmlFragment(k),
      (_d, fragment) => {
        const xt = new Y.XmlText()
        xt.insert(0, 'x')
        fragment.insert(0, [xt])
      },
    )
    // Y emits afterTransaction for every transact — there may be others from
    // doc setup, but the seed transact must contribute SEED_ORIGIN to the
    // list.
    assert.ok(
      origins.includes(SEED_ORIGIN),
      `expected SEED_ORIGIN among transact origins; saw ${JSON.stringify(origins)}`,
    )
  })
})

describe('seedShareTypeOnSync — Y.Text', () => {
  it('runs the seed callback when the text is empty (CodeMirror shape)', async () => {
    const { room, doc } = fakeRoom(Promise.resolve())
    let invoked = 0
    const ok = await seedShareTypeOnSync(
      room,
      'body',
      (d, k) => d.getText(k),
      (_d, text) => {
        invoked++
        text.insert(0, 'initial content')
      },
    )
    assert.equal(ok, true)
    assert.equal(invoked, 1)
    assert.equal(doc.getText('body').toString(), 'initial content')
  })

  it('skips the seed callback when the text is already populated', async () => {
    const { room, doc } = fakeRoom(Promise.resolve())
    doc.getText('body').insert(0, 'existing')

    let invoked = 0
    await seedShareTypeOnSync(
      room,
      'body',
      (d, k) => d.getText(k),
      () => { invoked++ },
    )
    assert.equal(invoked, 0)
    assert.equal(doc.getText('body').toString(), 'existing')
  })

  it('passes a Y.Text instance to seedFn (compile-time + runtime check)', async () => {
    const { room } = fakeRoom(Promise.resolve())
    let receivedClass: string | undefined
    await seedShareTypeOnSync(
      room,
      'body',
      (d, k) => d.getText(k),
      (_d, text) => {
        // .insert() is on Y.Text. If `text` weren't a Y.Text the call would
        // throw at runtime, and the TS check would have failed at the
        // module import boundary.
        text.insert(0, 'x')
        receivedClass = text.constructor.name
      },
    )
    assert.equal(receivedClass, 'YText', `expected Y.Text instance; got ${String(receivedClass)}`)
  })
})

describe('seedShareTypeOnSync — synced promise rejection', () => {
  it('returns false (not throws) when room.synced rejects', async () => {
    const { room } = fakeRoom(Promise.reject(new Error('stopped before sync')))
    let invoked = 0
    const ok = await seedShareTypeOnSync(
      room,
      'content',
      (d, k) => d.getXmlFragment(k),
      () => { invoked++ },
    )
    assert.equal(ok, false, 'should resolve false on synced rejection')
    assert.equal(invoked, 0, 'seedFn must NOT run when the room never synced')
  })
})
