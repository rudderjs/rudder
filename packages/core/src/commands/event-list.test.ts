import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatcher } from '../events.js'
import { registerEventListCommand } from './event-list.js'

interface Handler {
  (args: string[]): void | Promise<void>
}

class FakeRudder {
  handler: Handler | null = null
  command(_name: string, handler: Handler): { description(text: string): unknown } {
    this.handler = handler
    return { description: () => undefined }
  }
}

class WelcomeNotification {
  handle(): void {}
}
class AuditLog {
  handle(): void {}
}
class TelescopeRecorder {
  handle(): void {}
}

const realLog = console.log
let captured: string[] = []

beforeEach(() => {
  dispatcher.reset()
  captured = []
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(' ')) }
})

afterEach(() => {
  console.log = realLog
  dispatcher.reset()
})

function runCommand(args: string[] = []): void {
  const fake = new FakeRudder()
  registerEventListCommand(fake)
  assert.ok(fake.handler, 'handler should be registered')
  fake.handler(args)
}

function joined(): string {
  return captured.join('\n')
}

describe('event:list command', () => {
  it('renders registered events with their listener class names', () => {
    dispatcher.register('UserRegistered', new WelcomeNotification(), new AuditLog())
    dispatcher.register('PaddleSubscriptionUpdated', new AuditLog())

    runCommand()

    const out = joined()
    assert.match(out, /UserRegistered/)
    assert.match(out, /WelcomeNotification/)
    assert.match(out, /AuditLog/)
    assert.match(out, /PaddleSubscriptionUpdated/)
  })

  it('surfaces wildcard listeners with the "*" row', () => {
    dispatcher.register('*', new TelescopeRecorder())
    dispatcher.register('UserRegistered', new WelcomeNotification())

    runCommand()

    const out = joined()
    assert.match(out, /\*/)
    assert.match(out, /TelescopeRecorder/)
  })

  it('--filter narrows by substring match on event name (case-insensitive)', () => {
    dispatcher.register('UserRegistered', new WelcomeNotification())
    dispatcher.register('PaddleSubscriptionUpdated', new AuditLog())
    dispatcher.register('OrderCreated', new AuditLog())

    runCommand(['--filter', 'user'])

    const out = joined()
    assert.match(out, /UserRegistered/)
    assert.doesNotMatch(out, /PaddleSubscriptionUpdated/)
    assert.doesNotMatch(out, /OrderCreated/)
  })

  it('--json emits a structured array of {event, listeners}', () => {
    dispatcher.register('UserRegistered', new WelcomeNotification())
    dispatcher.register('*', new TelescopeRecorder())

    runCommand(['--json'])

    const parsed = JSON.parse(captured[0]!) as { event: string; listeners: string[] }[]
    assert.ok(Array.isArray(parsed))
    const user = parsed.find(e => e.event === 'UserRegistered')
    assert.ok(user, 'UserRegistered should be present')
    assert.deepStrictEqual(user.listeners, ['WelcomeNotification'])

    const wildcard = parsed.find(e => e.event === '*')
    assert.ok(wildcard, 'wildcard event should be present')
    assert.deepStrictEqual(wildcard.listeners, ['TelescopeRecorder'])
  })

  it('prints the empty-state message when no events are registered', () => {
    runCommand()
    assert.match(joined(), /No events registered\./)
  })

  it('renders <anonymous> for inline ad-hoc handlers without a named class', () => {
    dispatcher.register('AdHoc', { handle: () => undefined })
    runCommand()
    assert.match(joined(), /<anonymous>/)
  })
})
