import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeRedirect, safeRedirectTarget } from './safe-redirect.js'

describe('isSafeRedirect', () => {
  it('accepts plain same-origin absolute paths', () => {
    assert.equal(isSafeRedirect('/'), true)
    assert.equal(isSafeRedirect('/dashboard'), true)
    assert.equal(isSafeRedirect('/a/b/c'), true)
    assert.equal(isSafeRedirect('/path?next=/x&y=1'), true)
    assert.equal(isSafeRedirect('/path#section'), true)
    assert.equal(isSafeRedirect('/%2Fnot-a-host'), true)
  })

  it('rejects protocol-relative URLs', () => {
    assert.equal(isSafeRedirect('//evil.com'), false)
    assert.equal(isSafeRedirect('//evil.com/path'), false)
  })

  it('rejects absolute URLs with a scheme', () => {
    assert.equal(isSafeRedirect('https://evil.com'), false)
    assert.equal(isSafeRedirect('http://evil.com'), false)
    assert.equal(isSafeRedirect('javascript:alert(1)'), false)
    assert.equal(isSafeRedirect('data:text/html,<script>'), false)
  })

  it('rejects backslash-smuggled variants', () => {
    assert.equal(isSafeRedirect('/\\evil.com'), false)
    assert.equal(isSafeRedirect('\\evil.com'), false)
    assert.equal(isSafeRedirect('\\\\evil.com'), false)
    assert.equal(isSafeRedirect('\\/evil.com'), false)
  })

  it('rejects whitespace- and control-char-smuggled targets', () => {
    assert.equal(isSafeRedirect('\x20\x20//evil.com'), false)
    assert.equal(isSafeRedirect('/\tevil'), false)
    assert.equal(isSafeRedirect('/foo\nbar'), false)
    assert.equal(isSafeRedirect('/\r//evil.com'), false)
    assert.equal(isSafeRedirect('\x20/evil'), false)
    assert.equal(isSafeRedirect('\x00/evil'), false)
  })

  it('rejects non-paths and non-strings', () => {
    assert.equal(isSafeRedirect(''), false)
    assert.equal(isSafeRedirect('dashboard'), false)
    assert.equal(isSafeRedirect('relative/path'), false)
    assert.equal(isSafeRedirect(undefined), false)
    assert.equal(isSafeRedirect(null), false)
    assert.equal(isSafeRedirect(42), false)
    assert.equal(isSafeRedirect({}), false)
  })
})

describe('safeRedirectTarget', () => {
  it('returns the target when safe', () => {
    assert.equal(safeRedirectTarget('/dashboard'), '/dashboard')
  })

  it('falls back to "/" by default when unsafe', () => {
    assert.equal(safeRedirectTarget('//evil.com'), '/')
    assert.equal(safeRedirectTarget('https://evil.com'), '/')
    assert.equal(safeRedirectTarget(undefined), '/')
  })

  it('honors a custom fallback', () => {
    assert.equal(safeRedirectTarget('https://evil.com', '/login'), '/login')
    assert.equal(safeRedirectTarget('/\\evil.com', '/home'), '/home')
  })
})
