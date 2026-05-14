import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Mailable } from './mailable.js'
import { mailPreview } from './preview.js'

// ─── Test helpers ──────────────────────────────────────────

class HtmlMail extends Mailable {
  build() { return this.subject('Welcome').html('<h1>Hi</h1>').text('Hi') }
}

class TextOnlyMail extends Mailable {
  build() { return this.subject('Plain Notice').text('Hello there') }
}

class EmptyMail extends Mailable {
  build() { return this.subject('Empty') }
}

class HostileMail extends Mailable {
  build() { return this.subject('<script>alert(1)</script>').html('<p>safe</p>') }
}

function fakeRes() {
  const calls: { status: number; body: string }[] = []
  const res = {
    status(code: number) {
      return {
        send(body: string) {
          calls.push({ status: code, body })
        },
      }
    },
  }
  return { res, calls }
}

// ─── mailPreview() ─────────────────────────────────────────

describe('mailPreview()', () => {
  it('returns a handler function', () => {
    const handler = mailPreview(() => new HtmlMail())
    assert.equal(typeof handler, 'function')
  })

  it('responds 200 with HTML for an html mailable', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => new HtmlMail())(null, res)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.status, 200)
    assert.match(calls[0]!.body, /<!DOCTYPE html>/)
    assert.match(calls[0]!.body, /Subject:/)
    assert.match(calls[0]!.body, /Welcome/)
    assert.match(calls[0]!.body, /Type:.*HTML/s)
  })

  it('renders text-only mailable wrapped in <pre>', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => new TextOnlyMail())(null, res)
    assert.equal(calls[0]!.status, 200)
    // The text body is wrapped in <pre> inside an iframe srcdoc — find it
    assert.match(calls[0]!.body, /Plain Notice/)
    assert.match(calls[0]!.body, /Type:.*Plain Text/s)
    assert.match(calls[0]!.body, /&lt;pre&gt;Hello there&lt;\/pre&gt;/)
  })

  it('renders "(no content)" placeholder when mailable has no html or text', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => new EmptyMail())(null, res)
    assert.equal(calls[0]!.status, 200)
    assert.match(calls[0]!.body, /\(no content\)/)
  })

  it('escapes XSS in subject', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => new HostileMail())(null, res)
    assert.equal(calls[0]!.status, 200)
    assert.doesNotMatch(calls[0]!.body, /<script>alert\(1\)<\/script>/)
    assert.match(calls[0]!.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })

  it('accepts an async factory', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(async () => {
      await Promise.resolve()
      return new HtmlMail()
    })(null, res)
    assert.equal(calls[0]!.status, 200)
  })

  it('responds 500 when the factory throws synchronously', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => { throw new Error('boom-sync') })(null, res)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.status, 500)
    assert.match(calls[0]!.body, /Mail preview error/)
    assert.match(calls[0]!.body, /boom-sync/)
  })

  it('responds 500 when the factory rejects', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(async () => { throw new Error('boom-async') })(null, res)
    assert.equal(calls[0]!.status, 500)
    assert.match(calls[0]!.body, /boom-async/)
  })

  it('responds 500 when build() throws inside the mailable', async () => {
    class BrokenMail extends Mailable {
      build(): this { throw new Error('build-failed') }
    }
    const { res, calls } = fakeRes()
    await mailPreview(() => new BrokenMail())(null, res)
    assert.equal(calls[0]!.status, 500)
    assert.match(calls[0]!.body, /build-failed/)
  })

  it('escapes the error message in the 500 response', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => { throw new Error('<img src=x onerror=alert(1)>') })(null, res)
    assert.equal(calls[0]!.status, 500)
    assert.doesNotMatch(calls[0]!.body, /<img src=x onerror=alert\(1\)>/)
    assert.match(calls[0]!.body, /&lt;img src=x onerror=alert\(1\)&gt;/)
  })

  it('stringifies non-Error thrown values for the 500 response', async () => {
    const { res, calls } = fakeRes()
    await mailPreview(() => { throw 'plain-string-rejection' })(null, res)
    assert.equal(calls[0]!.status, 500)
    assert.match(calls[0]!.body, /plain-string-rejection/)
  })
})
