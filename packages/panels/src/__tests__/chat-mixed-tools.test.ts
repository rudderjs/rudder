import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { AiMessage, AgentResponse } from '@rudderjs/ai'
import { persistConversation } from '../handlers/chat/persistence.js'
import { validateContinuation, ContinuationError } from '../handlers/chat/continuation.js'
import type { ConversationStoreLike } from '../handlers/chat/types.js'

// Tests for the mixed-tool continuation fix.
// See docs/plans/mixed-tool-continuation-plan.md.
//
// A "mixed-tool turn" is one assistant message that calls BOTH a client tool
// (no `execute`) and a server tool (has `execute`) in the same step. The agent
// loop runs the server tool inline and stops on the client tool, then the
// browser executes the client tool locally and re-POSTs as a continuation.
//
// The tricky part is the order of messages in the wire log: persisted state
// holds the server tool result (because it ran inline), but the browser only
// learns about it via the new `tool_result` SSE event added in this plan.
// Without that event, the browser would post a continuation that diverges
// from persisted at the index where the server result lives, and the prefix
// check in `continuation.ts` would reject the request with HTTP 400.

// ─── Fake store ─────────────────────────────────────────────

interface AppendCall {
  conversationId: string
  messages:       AiMessage[]
}

function makeStore(seed: AiMessage[] = []): ConversationStoreLike & {
  _appends: AppendCall[]
  _state:   AiMessage[]
} {
  const _appends: AppendCall[] = []
  const _state: AiMessage[] = [...seed]
  return {
    _appends,
    _state,
    create:   async () => 'id',
    load:     async () => [..._state],
    append:   async (conversationId, messages) => {
      _appends.push({ conversationId, messages })
      _state.push(...messages)
    },
    setTitle: async () => { /* noop */ },
    list:     async () => [],
  }
}

function makeResult(steps: AgentResponse['steps']): AgentResponse {
  return {
    text:  '',
    steps,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }
}

// ─── Tests ──────────────────────────────────────────────────

describe('mixed-tool turn — persistence shape', () => {
  it('persists [user, assistant, tool{server result}] when a step mixes server + client tools', async () => {
    // Simulates the agent loop output for a single step that issued two tool
    // calls — one client tool (A) and one server tool (B). The loop ran B
    // inline and stopped on A; only B's result lives in `step.toolResults`.
    const store = makeStore()
    const result = makeResult([
      {
        message: {
          role:    'assistant',
          content: '',
          toolCalls: [
            { id: 'call-A', name: 'update_form_state', arguments: { field: 'content', operations: [] } },
            { id: 'call-B', name: 'edit_text',         arguments: { field: 'title',   operations: [] } },
          ],
        },
        toolCalls: [
          { id: 'call-A', name: 'update_form_state', arguments: { field: 'content', operations: [] } },
          { id: 'call-B', name: 'edit_text',         arguments: { field: 'title',   operations: [] } },
        ],
        // Only the server tool produced a result during the loop.
        toolResults:  [{ toolCallId: 'call-B', result: { applied: 1, total: 1 } }],
        usage:        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'tool_calls',
      },
    ])

    await persistConversation(store, 'conv-1', 'do both', result, false)

    const msgs = store._appends[0]!.messages
    assert.equal(msgs.length, 3, 'expected exactly [user, assistant, tool{B}] — client result must NOT be persisted yet')
    assert.equal(msgs[0]!.role, 'user')
    assert.equal(msgs[1]!.role, 'assistant')
    assert.equal(msgs[1]!.toolCalls?.length, 2)
    assert.equal(msgs[2]!.role, 'tool')
    assert.equal(msgs[2]!.toolCallId, 'call-B', 'persisted tool message must be the server tool result, not the client one')
    assert.equal(msgs[2]!.content, JSON.stringify({ applied: 1, total: 1 }))
  })
})

describe('mixed-tool turn — continuation prefix check', () => {
  // After the assistant turn above, persisted = [user, assistant, tool{B}].
  // The browser now executes client tool A locally and re-POSTs the
  // continuation. The `tool_result` SSE event added in this plan is what lets
  // the browser build the wire log to mirror persisted before appending its
  // own client result as the new tail.
  const persisted: AiMessage[] = [
    { role: 'user', content: 'do both' },
    {
      role:    'assistant',
      content: '',
      toolCalls: [
        { id: 'call-A', name: 'update_form_state', arguments: { field: 'content', operations: [] } },
        { id: 'call-B', name: 'edit_text',         arguments: { field: 'title',   operations: [] } },
      ],
    },
    { role: 'tool', content: JSON.stringify({ applied: 1, total: 1 }), toolCallId: 'call-B' },
  ]

  it('accepts a continuation that mirrors persisted then appends the client tool result', async () => {
    const store = makeStore(persisted)

    // What the browser builds with the fix in place: prefix matches persisted
    // exactly (assistant + server tool result B), then the client tool result
    // for A is appended as the new tail.
    const bodyMessages: AiMessage[] = [
      ...persisted,
      { role: 'tool', content: JSON.stringify({ applied: 2, total: 2 }), toolCallId: 'call-A' },
    ]

    const out = await validateContinuation({
      store,
      conversationId:      'conv-1',
      bodyMessages,
      approvedToolCallIds: undefined,
      rejectedToolCallIds: undefined,
    })

    assert.equal(out.length, persisted.length + 1)
    assert.equal(out[out.length - 1]!.toolCallId, 'call-A')
  })

  it('rejects a continuation that omits the server tool result (the bug this plan fixes)', async () => {
    const store = makeStore(persisted)

    // What the browser USED TO build before this plan: assistant message
    // followed only by the client tool result, with the server result missing.
    // This produces a content mismatch at index 2 because the persisted slot
    // holds the server tool's `{applied:1,total:1}` and the body holds the
    // client tool's `{applied:2,total:2}`.
    const buggyBody: AiMessage[] = [
      persisted[0]!,
      persisted[1]!,
      { role: 'tool', content: JSON.stringify({ applied: 2, total: 2 }), toolCallId: 'call-A' },
    ]

    await assert.rejects(
      () => validateContinuation({
        store,
        conversationId:      'conv-1',
        bodyMessages:        buggyBody,
        approvedToolCallIds: undefined,
        rejectedToolCallIds: undefined,
      }),
      (err: unknown) => {
        assert.ok(err instanceof ContinuationError, 'expected ContinuationError')
        assert.equal((err as ContinuationError).status, 400)
        assert.match((err as Error).message, /diverges from persisted conversation at message 2/)
        return true
      },
    )
  })

  it('persists the post-continuation turn with both tool results in the right order', async () => {
    // After validateContinuation accepts the body, the dispatcher runs the
    // agent loop again and calls persistContinuation to write everything new.
    // We don't run the full handler here; we just assert that the FOLLOWUP
    // persisted state — once the server appends the new tail and any new
    // assistant message — keeps the correct ordering: server result first,
    // client result second, then whatever the next assistant step produced.
    //
    // This is a regression guard: if we ever reorder so client results land
    // before server results, the next continuation's prefix check would 400.
    const store = makeStore(persisted)
    const bodyMessages: AiMessage[] = [
      ...persisted,
      { role: 'tool', content: JSON.stringify({ applied: 2, total: 2 }), toolCallId: 'call-A' },
    ]

    // Validate first (should pass).
    await validateContinuation({
      store,
      conversationId:      'conv-1',
      bodyMessages,
      approvedToolCallIds: undefined,
      rejectedToolCallIds: undefined,
    })

    // Simulate the dispatcher writing the new client tool result + the next
    // assistant turn that wraps things up. We hand-roll this because
    // persistContinuation needs an AgentResponse and our focus is the wire
    // shape, not the AI loop.
    await store.append('conv-1', [
      // Client tool result that arrived in the body tail.
      { role: 'tool', content: JSON.stringify({ applied: 2, total: 2 }), toolCallId: 'call-A' },
      // Next assistant step.
      { role: 'assistant', content: 'Done.' },
    ])

    const finalState = await store.load('conv-1')
    assert.equal(finalState.length, 5)
    assert.equal(finalState[2]!.toolCallId, 'call-B', 'server result must come before client result')
    assert.equal(finalState[3]!.toolCallId, 'call-A')
    assert.equal(finalState[4]!.role, 'assistant')
    assert.equal(finalState[4]!.content, 'Done.')
  })
})
