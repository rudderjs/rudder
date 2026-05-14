import { describe, it, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { Mailable } from './mailable.js'
import { nodemailer, isNodemailerConfig, type NodemailerConfig } from './nodemailer-adapter.js'
import type { MailConnectionConfig } from './index.js'

// ─── Test setup ────────────────────────────────────────────
//
// `resolveOptionalPeer('nodemailer')` resolves to an absolute file path
// via `createRequire(...).resolve(...)`, then dynamic-imports that path —
// so mock.module() needs to target the resolved path/URL, not the bare
// `'nodemailer'` specifier.
//
// Node's `mock.module()` cannot be installed twice for the same target
// (throws "already mocked") and `mock.reset()` does not unregister module
// mocks — so we install one mock at file load that reads its capture
// state from shared arrays, and reset the arrays in beforeEach.

interface SendMailArg {
  from: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  html?: string
  text?: string
}

interface CreateTransportArg {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
}

const sendMailCalls:        SendMailArg[]        = []
const createTransportCalls: CreateTransportArg[] = []

function clearCalls() {
  sendMailCalls.length        = 0
  createTransportCalls.length = 0
}

// Install at module scope — `before()` outside a describe runs once per
// describe in Node 22, which would trip mock.module's "already mocked" guard.
// Node normalizes the import specifier to a file:// URL internally, so we
// mock that form (the absolute path form is silently aliased).
{
  const req     = createRequire(process.cwd() + '/package.json')
  const nmUrl   = pathToFileURL(req.resolve('nodemailer')).href

  const createTransport = (config: CreateTransportArg) => {
    createTransportCalls.push(config)
    return {
      sendMail(msg: SendMailArg) {
        sendMailCalls.push(msg)
        return Promise.resolve({ messageId: 'test-id' })
      },
    }
  }

  mock.module(nmUrl, {
    namedExports:  { createTransport },
    defaultExport: { createTransport },
  })
}

beforeEach(clearCalls)

class SimpleMail extends Mailable {
  build() { return this.subject('Hello').text('Plain body') }
}

class RichMail extends Mailable {
  build() { return this.subject('Welcome').html('<h1>Hello</h1>').text('Hello') }
}

const baseConfig: NodemailerConfig = {
  driver: 'smtp',
  host:   'smtp.example.com',
  port:   587,
}

// ─── isNodemailerConfig() ──────────────────────────────────

describe('isNodemailerConfig()', () => {
  it('accepts a valid smtp config', () => {
    assert.equal(isNodemailerConfig({ driver: 'smtp', host: 'h', port: 587 }), true)
  })

  it('rejects non-smtp drivers', () => {
    assert.equal(isNodemailerConfig({ driver: 'log' } as MailConnectionConfig), false)
  })

  it('rejects when host is missing', () => {
    assert.equal(
      isNodemailerConfig({ driver: 'smtp', port: 587 } as MailConnectionConfig),
      false,
    )
  })

  it('rejects when port is missing', () => {
    assert.equal(
      isNodemailerConfig({ driver: 'smtp', host: 'h' } as MailConnectionConfig),
      false,
    )
  })

  it('rejects when port is the wrong type', () => {
    assert.equal(
      isNodemailerConfig({ driver: 'smtp', host: 'h', port: '587' } as unknown as MailConnectionConfig),
      false,
    )
  })
})

// ─── nodemailer() factory ──────────────────────────────────

describe('nodemailer() factory', () => {
  it('returns a provider whose create() yields a fresh adapter each call', () => {
    const provider = nodemailer(baseConfig, { address: 'a@b.com' })
    assert.equal(typeof provider.create, 'function')
    assert.notStrictEqual(provider.create(), provider.create())
  })
})

// ─── NodemailerAdapter.send() — happy paths ────────────────

describe('NodemailerAdapter.send() — SMTP wire shape', () => {
  it('lazily loads nodemailer and calls createTransport with the config', async () => {
    const adapter = nodemailer(baseConfig, { address: 'noreply@example.com' }).create()

    await adapter.send(new SimpleMail(), {
      to:   ['user@example.com'],
      from: { address: 'noreply@example.com' },
    })

    assert.equal(createTransportCalls.length, 1)
    assert.deepStrictEqual(createTransportCalls[0], {
      host:   'smtp.example.com',
      port:   587,
      secure: false,
    })
    assert.equal(sendMailCalls.length, 1)
  })

  it('formats from as "Name <addr>" when name is provided', async () => {
    const adapter = nodemailer(baseConfig, { address: 'noreply@example.com', name: 'RudderJS' }).create()

    await adapter.send(new SimpleMail(), {
      to:   ['user@example.com'],
      from: { address: 'noreply@example.com', name: 'RudderJS' },
    })

    assert.equal(sendMailCalls[0]!.from, 'RudderJS <noreply@example.com>')
  })

  it('formats from as bare address when name is omitted', async () => {
    const adapter = nodemailer(baseConfig, { address: 'noreply@example.com' }).create()

    await adapter.send(new SimpleMail(), {
      to:   ['user@example.com'],
      from: { address: 'noreply@example.com' },
    })

    assert.equal(sendMailCalls[0]!.from, 'noreply@example.com')
  })

  it('joins multiple recipients with ", "', async () => {
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()

    await adapter.send(new SimpleMail(), {
      to:   ['a@example.com', 'b@example.com', 'c@example.com'],
      from: { address: 'a@b.com' },
    })

    assert.equal(sendMailCalls[0]!.to, 'a@example.com, b@example.com, c@example.com')
  })

  it('joins cc / bcc when provided; omits them when empty', async () => {
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()

    await adapter.send(new SimpleMail(), {
      to:   ['u@example.com'],
      cc:   ['cc1@example.com', 'cc2@example.com'],
      bcc:  ['bcc@example.com'],
      from: { address: 'a@b.com' },
    })
    await adapter.send(new SimpleMail(), {
      to:   ['u@example.com'],
      cc:   [],
      bcc:  [],
      from: { address: 'a@b.com' },
    })

    assert.equal(sendMailCalls[0]!.cc,  'cc1@example.com, cc2@example.com')
    assert.equal(sendMailCalls[0]!.bcc, 'bcc@example.com')
    assert.equal('cc'  in sendMailCalls[1]!, false)
    assert.equal('bcc' in sendMailCalls[1]!, false)
  })

  it('passes html and text from the compiled mailable', async () => {
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()

    await adapter.send(new RichMail(), {
      to:   ['u@example.com'],
      from: { address: 'a@b.com' },
    })

    assert.equal(sendMailCalls[0]!.subject, 'Welcome')
    assert.equal(sendMailCalls[0]!.html,    '<h1>Hello</h1>')
    assert.equal(sendMailCalls[0]!.text,    'Hello')
  })

  it('omits html/text fields when the mailable did not set them', async () => {
    class SubjectOnly extends Mailable {
      build() { return this.subject('Just a subject') }
    }
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()

    await adapter.send(new SubjectOnly(), {
      to:   ['u@example.com'],
      from: { address: 'a@b.com' },
    })

    assert.equal('html' in sendMailCalls[0]!, false)
    assert.equal('text' in sendMailCalls[0]!, false)
  })

  it('memoizes the transporter — createTransport runs once for repeated sends', async () => {
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()

    await adapter.send(new SimpleMail(), { to: ['u1@example.com'], from: { address: 'a@b.com' } })
    await adapter.send(new SimpleMail(), { to: ['u2@example.com'], from: { address: 'a@b.com' } })
    await adapter.send(new SimpleMail(), { to: ['u3@example.com'], from: { address: 'a@b.com' } })

    assert.equal(createTransportCalls.length, 1)
  })
})

// ─── NodemailerAdapter — transport config ──────────────────

describe('NodemailerAdapter — transport config wiring', () => {
  it('sets secure: true when encryption === "ssl"', async () => {
    const adapter = nodemailer(
      { ...baseConfig, encryption: 'ssl' },
      { address: 'a@b.com' },
    ).create()
    await adapter.send(new SimpleMail(), { to: ['u@example.com'], from: { address: 'a@b.com' } })

    assert.equal(createTransportCalls[0]!.secure, true)
  })

  it('sets secure: false when encryption === "tls"', async () => {
    const adapter = nodemailer(
      { ...baseConfig, encryption: 'tls' },
      { address: 'a@b.com' },
    ).create()
    await adapter.send(new SimpleMail(), { to: ['u@example.com'], from: { address: 'a@b.com' } })

    assert.equal(createTransportCalls[0]!.secure, false)
  })

  it('sets secure: false when encryption is unspecified', async () => {
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()
    await adapter.send(new SimpleMail(), { to: ['u@example.com'], from: { address: 'a@b.com' } })

    assert.equal(createTransportCalls[0]!.secure, false)
  })

  it('attaches auth when username is provided', async () => {
    const adapter = nodemailer(
      { ...baseConfig, username: 'alice', password: 's3cret' },
      { address: 'a@b.com' },
    ).create()
    await adapter.send(new SimpleMail(), { to: ['u@example.com'], from: { address: 'a@b.com' } })

    assert.deepStrictEqual(createTransportCalls[0]!.auth, { user: 'alice', pass: 's3cret' })
  })

  it('defaults password to empty string when only username is set', async () => {
    const adapter = nodemailer(
      { ...baseConfig, username: 'alice' },
      { address: 'a@b.com' },
    ).create()
    await adapter.send(new SimpleMail(), { to: ['u@example.com'], from: { address: 'a@b.com' } })

    assert.deepStrictEqual(createTransportCalls[0]!.auth, { user: 'alice', pass: '' })
  })

  it('omits auth entirely when username is absent', async () => {
    const adapter = nodemailer(baseConfig, { address: 'a@b.com' }).create()
    await adapter.send(new SimpleMail(), { to: ['u@example.com'], from: { address: 'a@b.com' } })

    assert.equal('auth' in createTransportCalls[0]!, false)
  })
})
