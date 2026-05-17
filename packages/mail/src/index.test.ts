import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository, getConfigRepository } from '@rudderjs/core'
import {
  Mail,
  MailPendingSend,
  MailRegistry,
  LogAdapter,
  Mailable,
  MailProvider,
  type MailAdapter,
  type MailConfig,
  type SendOptions,
} from './index.js'

function withMailConfig(cfg: MailConfig): () => void {
  const previous = getConfigRepository()
  setConfigRepository(new ConfigRepository({ mail: cfg }))
  return () => setConfigRepository(previous ?? new ConfigRepository({}))
}

// ─── Helpers ───────────────────────────────────────────────

class SimpleMail extends Mailable {
  build() { return this.subject('Hello').text('World') }
}

class RichMail extends Mailable {
  build() {
    return this.subject('Welcome').html('<h1>Hello</h1>').text('Hello')
  }
}

class AsyncMail extends Mailable {
  async build() {
    await Promise.resolve()
    return this.subject('Async').text('Body')
  }
}

class SubjectOnlyMail extends Mailable {
  build() { return this.subject('Just a subject') }
}

const fakeApp = { instance: () => undefined } as never

const defaultConfig = {
  default: 'log',
  from: { address: 'noreply@example.com', name: 'RudderJS' },
  mailers: { log: { driver: 'log' } },
}

// ─── Mailable ──────────────────────────────────────────────

describe('Mailable', () => {
  it('compile() returns subject, html, and text', async () => {
    const msg = await new RichMail().compile()
    assert.deepStrictEqual(msg, { subject: 'Welcome', html: '<h1>Hello</h1>', text: 'Hello' })
  })

  it('compile() omits html when not set', async () => {
    const msg = await new SimpleMail().compile()
    assert.deepStrictEqual(msg, { subject: 'Hello', text: 'World' })
    assert.ok(!('html' in msg))
  })

  it('compile() omits text when not set', async () => {
    class HtmlOnly extends Mailable {
      build() { return this.subject('Hi').html('<p>Hi</p>') }
    }
    const msg = await new HtmlOnly().compile()
    assert.ok(!('text' in msg))
    assert.strictEqual(msg.html, '<p>Hi</p>')
  })

  it('compile() returns empty subject when not set', async () => {
    class NoSubject extends Mailable {
      build() { return this.text('body') }
    }
    const msg = await new NoSubject().compile()
    assert.strictEqual(msg.subject, '')
  })

  it('compile() supports async build()', async () => {
    const msg = await new AsyncMail().compile()
    assert.strictEqual(msg.subject, 'Async')
    assert.strictEqual(msg.text, 'Body')
  })

  it('compile() can be called multiple times (idempotent values)', async () => {
    const m = new SimpleMail()
    const a = await m.compile()
    const b = await m.compile()
    assert.deepStrictEqual(a, b)
  })
})

// ─── MailRegistry ──────────────────────────────────────────

describe('MailRegistry', () => {
  beforeEach(() => MailRegistry.reset())

  it('get() returns null when no adapter is registered', () => {
    assert.strictEqual(MailRegistry.get(), null)
  })

  it('set() + get() registers and retrieves the adapter', () => {
    const adapter: MailAdapter = { send: async () => {} }
    MailRegistry.set(adapter)
    assert.strictEqual(MailRegistry.get(), adapter)
  })

  it('reset() clears the adapter', () => {
    MailRegistry.set({ send: async () => {} })
    MailRegistry.reset()
    assert.strictEqual(MailRegistry.get(), null)
  })

  it('setFrom() + getFrom() stores and returns the from address', () => {
    MailRegistry.setFrom({ address: 'from@example.com', name: 'Test' })
    assert.deepStrictEqual(MailRegistry.getFrom(), { address: 'from@example.com', name: 'Test' })
  })

  it('getFrom() returns a copy — mutations do not affect stored value', () => {
    MailRegistry.setFrom({ address: 'a@b.com' })
    const from = MailRegistry.getFrom()
    from.address = 'mutated@b.com'
    assert.strictEqual(MailRegistry.getFrom().address, 'a@b.com')
  })

  it('reset() restores default from address', () => {
    MailRegistry.setFrom({ address: 'custom@x.com' })
    MailRegistry.reset()
    assert.strictEqual(MailRegistry.getFrom().address, 'noreply@example.com')
  })

  it('state lives on globalThis so it survives a second copy of @rudderjs/mail', () => {
    // Vite-bundled server apps inline `@rudderjs/mail` (Mail.to(...).send()
    // reads MailRegistry) into entry.mjs, but `MailProvider.boot()` and
    // driver packages are externalized via the provider auto-discovery
    // manifest. Without a globalThis-routed store, `set()` from the
    // externalized copy would never be visible to `get()` from the bundled
    // copy. This test pins the contract: writes from this module copy are
    // visible on a global key the second copy would also read from.
    const adapter: MailAdapter = { send: async () => {} }
    MailRegistry.set(adapter)
    MailRegistry.setFrom({ address: 'global@example.com', name: 'Global' })
    const store = (globalThis as Record<string, unknown>)['__rudderjs_mail_registry__'] as { adapter: unknown; from: { address: string } } | undefined
    assert.ok(store, 'global store should exist after MailRegistry.set()')
    assert.strictEqual(store.adapter, adapter)
    assert.strictEqual(store.from.address, 'global@example.com')
  })
})

// ─── MailPendingSend ───────────────────────────────────────

describe('MailPendingSend', () => {
  let sent: Array<{ mailable: Mailable; options: SendOptions }> = []

  beforeEach(() => {
    sent = []
    MailRegistry.reset()
    MailRegistry.set({ send: async (m, o) => { sent.push({ mailable: m, options: o }) } })
    MailRegistry.setFrom({ address: 'sender@example.com', name: 'RudderJS' })
  })

  it('Mail.to() returns a MailPendingSend', () => {
    assert.ok(Mail.to('a@b.com') instanceof MailPendingSend)
  })

  it('send() dispatches to the registered adapter', async () => {
    await Mail.to('user@example.com').send(new SimpleMail())
    assert.strictEqual(sent.length, 1)
  })

  it('send() passes correct to recipients', async () => {
    await Mail.to('a@example.com', 'b@example.com').send(new SimpleMail())
    assert.deepStrictEqual(sent[0]!.options.to, ['a@example.com', 'b@example.com'])
  })

  it('send() passes the from address from MailRegistry', async () => {
    await Mail.to('x@example.com').send(new SimpleMail())
    assert.deepStrictEqual(sent[0]!.options.from, { address: 'sender@example.com', name: 'RudderJS' })
  })

  it('cc() sets CC recipients', async () => {
    await Mail.to('a@example.com').cc('b@example.com', 'c@example.com').send(new SimpleMail())
    assert.deepStrictEqual(sent[0]!.options.cc, ['b@example.com', 'c@example.com'])
  })

  it('bcc() sets BCC recipients', async () => {
    await Mail.to('a@example.com').bcc('hidden@example.com').send(new SimpleMail())
    assert.deepStrictEqual(sent[0]!.options.bcc, ['hidden@example.com'])
  })

  it('cc() and bcc() are chainable', async () => {
    await Mail.to('a@example.com')
      .cc('cc@example.com')
      .bcc('bcc@example.com')
      .send(new SimpleMail())
    assert.deepStrictEqual(sent[0]!.options.cc,  ['cc@example.com'])
    assert.deepStrictEqual(sent[0]!.options.bcc, ['bcc@example.com'])
  })

  it('send() passes the compiled mailable to the adapter', async () => {
    await Mail.to('x@example.com').send(new RichMail())
    assert.ok(sent[0]!.mailable instanceof RichMail)
  })

  it('send() throws when no adapter is registered', async () => {
    MailRegistry.reset()
    await assert.rejects(
      async () => Mail.to('x@example.com').send(new SimpleMail()),
      /No mail adapter registered/
    )
  })
})

// ─── LogAdapter ────────────────────────────────────────────

describe('LogAdapter', () => {
  it('send() compiles and delivers without throwing', async () => {
    const adapter = new LogAdapter()
    await assert.doesNotReject(() =>
      adapter.send(new RichMail(), {
        to:   ['user@example.com'],
        from: { address: 'noreply@example.com', name: 'App' },
      })
    )
  })

  it('send() handles text-only mailable without throwing', async () => {
    const adapter = new LogAdapter()
    await assert.doesNotReject(() =>
      adapter.send(new SimpleMail(), {
        to:   ['user@example.com'],
        from: { address: 'noreply@example.com' },
      })
    )
  })

  it('send() handles subject-only mailable without throwing', async () => {
    const adapter = new LogAdapter()
    await assert.doesNotReject(() =>
      adapter.send(new SubjectOnlyMail(), {
        to:   ['user@example.com'],
        from: { address: 'noreply@example.com' },
      })
    )
  })

  it('can be used standalone without the provider', async () => {
    const adapter = new LogAdapter()
    assert.ok(typeof adapter.send === 'function')
  })
})

// ─── MailProvider ──────────────────────────────────────────

describe('MailProvider', () => {
  let restore: () => void
  beforeEach(() => MailRegistry.reset())
  afterEach(() => restore?.())

  it('boots with log driver and registers adapter', async () => {
    restore = withMailConfig(defaultConfig)
    await new MailProvider(fakeApp).boot?.()
    assert.ok(MailRegistry.get() !== null)
  })

  it('sets the from address on the registry', async () => {
    restore = withMailConfig(defaultConfig)
    await new MailProvider(fakeApp).boot?.()
    assert.deepStrictEqual(MailRegistry.getFrom(), { address: 'noreply@example.com', name: 'RudderJS' })
  })

  it('falls back to log driver when mailer config is missing', async () => {
    restore = withMailConfig({ ...defaultConfig, default: 'missing', mailers: {} })
    await new MailProvider(fakeApp).boot?.()
    assert.ok(MailRegistry.get() instanceof LogAdapter)
  })

  it('boots log driver explicitly', async () => {
    restore = withMailConfig(defaultConfig)
    await new MailProvider(fakeApp).boot?.()
    assert.ok(MailRegistry.get() instanceof LogAdapter)
  })

  it('throws on an unknown driver', async () => {
    restore = withMailConfig({
      ...defaultConfig,
      default: 'bad',
      mailers: { bad: { driver: 'unsupported' } },
    })
    await assert.rejects(
      async () => new MailProvider(fakeApp).boot?.(),
      /Unknown driver "unsupported"/
    )
  })

  it('throws on smtp driver with missing host', async () => {
    restore = withMailConfig({
      ...defaultConfig,
      default: 'smtp',
      mailers: { smtp: { driver: 'smtp', port: 587 } },
    })
    await assert.rejects(
      async () => new MailProvider(fakeApp).boot?.(),
      /Invalid SMTP config/
    )
  })

  it('throws on smtp driver with missing port', async () => {
    restore = withMailConfig({
      ...defaultConfig,
      default: 'smtp',
      mailers: { smtp: { driver: 'smtp', host: 'smtp.example.com' } },
    })
    await assert.rejects(
      async () => new MailProvider(fakeApp).boot?.(),
      /Invalid SMTP config/
    )
  })

  it('register() is a no-op', () => {
    restore = withMailConfig(defaultConfig)
    assert.doesNotThrow(() => new MailProvider(fakeApp).register?.())
  })

  it('booted log adapter can send mail end-to-end', async () => {
    restore = withMailConfig(defaultConfig)
    await new MailProvider(fakeApp).boot?.()
    await assert.doesNotReject(() => Mail.to('user@example.com').send(new SimpleMail()))
  })
})
