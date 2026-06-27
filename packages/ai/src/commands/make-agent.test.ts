import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeAgentSpec } from './make-agent.js'

describe('@rudderjs/ai make:agent spec', () => {
  it('describes the make:agent command', () => {
    assert.equal(makeAgentSpec.command, 'make:agent')
    assert.equal(makeAgentSpec.suffix, 'Agent')
    assert.equal(makeAgentSpec.directory, 'app/Agents')
  })

  it('stubs an Agent subclass extending the @gemstack/ai-sdk engine', () => {
    const out = makeAgentSpec.stub('SupportAgent')
    assert.match(out, /export class SupportAgent extends Agent/)
    assert.match(out, /from '@gemstack\/ai-sdk'/)
    assert.match(out, /implements HasTools/)
  })
})
