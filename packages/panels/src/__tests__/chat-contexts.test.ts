import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { GlobalChatContext } from '../handlers/chat/contexts/GlobalChatContext.js'
import { PageChatContext } from '../handlers/chat/contexts/PageChatContext.js'
import { resolveContext } from '../handlers/chat/contexts/resolveContext.js'
import type { ChatRequestBody } from '../handlers/chat/types.js'

// ─── Helpers ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeReq = { user: undefined, headers: {}, path: '/', body: {} } as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakePanel = { getResources: () => [], getName: () => 'admin' } as any

function deps(body: ChatRequestBody) {
  return { body, panel: fakePanel, req: fakeReq }
}

// ─── GlobalChatContext ──────────────────────────────────────

describe('GlobalChatContext', () => {
  it('has kind "global"', async () => {
    const ctx = await GlobalChatContext.create(deps({ message: 'hi' }))
    assert.equal(ctx.kind, 'global')
  })

  it('returns an empty tool set', async () => {
    const ctx = await GlobalChatContext.create(deps({ message: 'hi' }))
    assert.deepEqual(ctx.buildTools(), [])
  })

  it('loads history by default', async () => {
    const ctx = await GlobalChatContext.create(deps({ message: 'hi' }))
    assert.equal(ctx.shouldLoadHistory(), true)
  })

  it('returns identity for transformUserInput', async () => {
    const ctx = await GlobalChatContext.create(deps({ message: 'hi' }))
    assert.equal(ctx.transformUserInput('original', []), 'original')
  })

  it('builds a generic admin-panel system prompt', async () => {
    const ctx = await GlobalChatContext.create(deps({ message: 'hi' }))
    const prompt = ctx.buildSystemPrompt()
    assert.match(prompt, /admin panel/i)
  })

  it('returns empty meta when no user is present', async () => {
    const ctx = await GlobalChatContext.create(deps({ message: 'hi' }))
    assert.deepEqual(ctx.getConversationMeta(), {})
  })

  it('extracts userId from req.user', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = { user: { id: 'u-1' }, headers: {}, path: '/', body: {} } as any
    const ctx = await GlobalChatContext.create({ body: { message: 'hi' }, panel: fakePanel, req })
    assert.deepEqual(ctx.getConversationMeta(), { userId: 'u-1' })
  })
})

// ─── PageChatContext ────────────────────────────────────────

describe('PageChatContext', () => {
  it('has kind "page" and stores the slug in the prompt', async () => {
    const ctx = await PageChatContext.create(deps({ message: 'hi', pageContext: { pageSlug: 'dashboard' } }))
    assert.equal(ctx.kind, 'page')
    assert.match(ctx.buildSystemPrompt(), /dashboard/)
  })

  it('returns empty tools (placeholder for future page-tool registry)', async () => {
    const ctx = await PageChatContext.create(deps({ message: 'hi', pageContext: { pageSlug: 'dashboard' } }))
    assert.deepEqual(ctx.buildTools(), [])
  })

  it('does not persist pageSlug yet (deferred to page-chat plan)', async () => {
    const ctx = await PageChatContext.create(deps({ message: 'hi', pageContext: { pageSlug: 'dashboard' } }))
    const meta = ctx.getConversationMeta()
    // userId or empty — but never `pageSlug` (the field doesn't exist on ConversationStoreMeta yet)
    assert.equal('pageSlug' in meta, false)
  })
})

// ─── resolveContext routing ─────────────────────────────────

describe('resolveContext', () => {
  it('returns GlobalChatContext when no resource/page context is set', async () => {
    const ctx = await resolveContext(deps({ message: 'hi' }))
    assert.equal(ctx.kind, 'global')
  })

  it('returns PageChatContext when pageContext is set', async () => {
    const ctx = await resolveContext(deps({ message: 'hi', pageContext: { pageSlug: 'foo' } }))
    assert.equal(ctx.kind, 'page')
  })

  // ResourceChatContext routing is exercised end-to-end in integration tests
  // — it requires real Resource/Panel + lazy AI imports.
})
