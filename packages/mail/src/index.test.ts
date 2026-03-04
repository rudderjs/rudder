import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Mail,
  MailPendingSend,
  MailRegistry,
  Mailable,
  type MailAdapter,
  type SendOptions,
} from './index.js'

describe('Mail contract baseline', () => {
  beforeEach(() => {
    ;(MailRegistry as unknown as { adapter: MailAdapter | null }).adapter = null
    MailRegistry.setFrom({ address: 'noreply@example.com' })
  })

  it('MailRegistry set/get and setFrom/getFrom work as expected', () => {
    const adapter: MailAdapter = { send: async () => undefined }
    MailRegistry.set(adapter)
    MailRegistry.setFrom({ address: 'from@example.com', name: 'BoostKit' })

    assert.strictEqual(MailRegistry.get(), adapter)
    assert.deepStrictEqual(MailRegistry.getFrom(), { address: 'from@example.com', name: 'BoostKit' })
  })

  it('Mailable.compile() builds subject/html/text from build()', async () => {
    class WelcomeMail extends Mailable {
      build() {
        return this.subject('Welcome').html('<h1>Hello</h1>').text('Hello')
      }
    }

    const compiled = await new WelcomeMail().compile()
    assert.deepStrictEqual(compiled, { subject: 'Welcome', html: '<h1>Hello</h1>', text: 'Hello' })
  })

  it('Mail.to() returns MailPendingSend', () => {
    const pending = Mail.to('alice@example.com')
    assert.ok(pending instanceof MailPendingSend)
  })

  it('MailPendingSend.send() throws when no adapter is registered', async () => {
    class TestMail extends Mailable {
      build() { return this.subject('Test').text('Body') }
    }

    await assert.rejects(
      () => Mail.to('alice@example.com').send(new TestMail()),
      /No mail adapter registered/
    )
  })

  it('MailPendingSend.send() forwards recipients and from data to adapter', async () => {
    const calls: Array<{ options: SendOptions }> = []
    const adapter: MailAdapter = {
      send: async (_mailable, options) => { calls.push({ options }) },
    }
    MailRegistry.set(adapter)
    MailRegistry.setFrom({ address: 'sender@example.com', name: 'BoostKit' })

    class TestMail extends Mailable {
      build() { return this.subject('Hello').text('World') }
    }

    await Mail.to('a@example.com', 'b@example.com').cc('c@example.com').bcc('d@example.com').send(new TestMail())

    assert.deepStrictEqual(calls[0]?.options, {
      to: ['a@example.com', 'b@example.com'],
      from: { address: 'sender@example.com', name: 'BoostKit' },
      cc: ['c@example.com'],
      bcc: ['d@example.com'],
    })
  })
})
