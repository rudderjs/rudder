import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { buildEditorUrl, resolveEditor, _resetEditorWarnings, type EditorName } from './editor-launch.js'
import { renderErrorPage } from './error-page.js'
import type { AppRequest } from '@rudderjs/contracts'

const POSIX_PATH = '/Users/alice/projects/app/src/handler.ts'
const WIN_PATH   = 'C:\\Users\\alice\\projects\\app\\src\\handler.ts'

describe('buildEditorUrl', () => {
  it('emits vscode://file/<path>:<line>', () => {
    assert.equal(
      buildEditorUrl('vscode', POSIX_PATH, 42),
      'vscode://file/Users/alice/projects/app/src/handler.ts:42',
    )
  })

  it('emits cursor://file/<path>:<line>', () => {
    assert.equal(
      buildEditorUrl('cursor', POSIX_PATH, 7),
      'cursor://file/Users/alice/projects/app/src/handler.ts:7',
    )
  })

  it('emits jetbrains-style webstorm://open?file=<encoded>&line=<line>', () => {
    const url = buildEditorUrl('webstorm', POSIX_PATH, 99)!
    assert.match(url, /^webstorm:\/\/open\?file=.+&line=99$/)
    // The path is URL-encoded — slashes survive (they're safe chars) but
    // spaces / unicode would be encoded if present.
    assert.ok(url.includes(encodeURIComponent(POSIX_PATH)))
  })

  it('emits phpstorm + idea schemes for the JetBrains family', () => {
    assert.match(buildEditorUrl('phpstorm', POSIX_PATH, 1)!, /^phpstorm:\/\/open\?file=/)
    assert.match(buildEditorUrl('idea',     POSIX_PATH, 1)!, /^idea:\/\/open\?file=/)
  })

  it('emits sublime + atom schemes', () => {
    assert.match(buildEditorUrl('sublime', POSIX_PATH, 1)!, /^subl:\/\/open\?url=file:\/\//)
    assert.match(buildEditorUrl('atom',    POSIX_PATH, 1)!, /^atom:\/\/core\/open\/file\?filename=/)
  })

  it('returns null when editor is "none"', () => {
    assert.equal(buildEditorUrl('none', POSIX_PATH, 1), null)
  })

  it('returns null for unrecognized editors (defensive — caller should pre-resolve)', () => {
    assert.equal(buildEditorUrl('emacs' as EditorName, POSIX_PATH, 1), null)
  })

  it('forward-slashes Windows paths before emitting the URL', () => {
    const url = buildEditorUrl('vscode', WIN_PATH, 12)!
    // Backslashes flipped, drive letter preserved.
    assert.ok(url.includes('C:/Users/alice/projects/app/src/handler.ts'))
    assert.ok(!url.includes('\\'), 'no backslashes should remain')
    assert.ok(url.endsWith(':12'))
  })

  it('forward-slashes Windows paths before URL-encoding (JetBrains family)', () => {
    const url = buildEditorUrl('webstorm', WIN_PATH, 12)!
    // After forward-slashing → C:/Users/alice/..., then encoded — the encoded
    // form preserves slashes (they're safe chars).
    assert.ok(url.includes(encodeURIComponent('C:/Users/alice/projects/app/src/handler.ts')))
  })
})

describe('resolveEditor', () => {
  beforeEach(() => _resetEditorWarnings())

  it('defaults to vscode when APP_EDITOR is unset', () => {
    assert.equal(resolveEditor(undefined), 'vscode')
  })

  it('honors APP_EDITOR=cursor', () => {
    assert.equal(resolveEditor('cursor'), 'cursor')
  })

  it('honors APP_EDITOR=none (opt-out)', () => {
    assert.equal(resolveEditor('none'), 'none')
  })

  it('is case-insensitive', () => {
    assert.equal(resolveEditor('CURSOR'),   'cursor')
    assert.equal(resolveEditor('WebStorm'), 'webstorm')
  })

  it('falls back to vscode + warns on unknown name', () => {
    const captured: string[] = []
    const originalWarn = console.warn
    console.warn = (msg: string) => { captured.push(msg) }
    try {
      assert.equal(resolveEditor('emacs'), 'vscode')
    } finally {
      console.warn = originalWarn
    }
    assert.equal(captured.length, 1)
    assert.ok(captured[0]!.includes('emacs'))
    assert.ok(captured[0]!.includes('vscode'))
  })

  it('warns at most once per unknown value (process-scoped)', () => {
    const captured: string[] = []
    const originalWarn = console.warn
    console.warn = (msg: string) => { captured.push(msg) }
    try {
      resolveEditor('weird')
      resolveEditor('weird')
      resolveEditor('weird')
    } finally {
      console.warn = originalWarn
    }
    assert.equal(captured.length, 1, 'unknown value should warn once per process')
  })
})

describe('renderErrorPage — editor-launch integration', () => {
  function makeReq(): AppRequest {
    return {
      method: 'GET', url: '/test', path: '/test',
      query: {}, params: {}, headers: {}, body: null, raw: null,
    } as unknown as AppRequest
  }

  it('wraps stack frames in vscode:// links by default', () => {
    delete process.env['APP_EDITOR']
    const err = new Error('boom')
    err.stack = `Error: boom
    at handler (/app/src/handler.ts:42:5)
    at app.fetch (/app/src/server.ts:10:3)`
    const html = renderErrorPage(err, makeReq())
    assert.match(html, /href="vscode:\/\/file\/app\/src\/handler\.ts:42"/)
    assert.match(html, /class="frame-file-link"/)
  })

  it('honors APP_EDITOR=cursor', () => {
    process.env['APP_EDITOR'] = 'cursor'
    const err = new Error('boom')
    err.stack = `Error: boom
    at handler (/app/src/handler.ts:42:5)`
    const html = renderErrorPage(err, makeReq())
    assert.match(html, /href="cursor:\/\/file\/app\/src\/handler\.ts:42"/)
    delete process.env['APP_EDITOR']
  })

  it('renders plain text frames when APP_EDITOR=none', () => {
    process.env['APP_EDITOR'] = 'none'
    const err = new Error('boom')
    err.stack = `Error: boom
    at handler (/app/src/handler.ts:42:5)`
    const html = renderErrorPage(err, makeReq())
    assert.ok(!html.includes('href="vscode:'),     'should not emit vscode link')
    assert.ok(!html.includes('href="cursor:'),     'should not emit cursor link')
    assert.ok(!html.includes('href="webstorm:'),   'should not emit webstorm link')
    // The CSS class definition `.frame-file-link` lives in the <style> block
    // and is always present; assert on the attribute (`class="frame-file-link"`)
    // which only fires when a real anchor wraps a frame.
    assert.ok(!html.includes('class="frame-file-link"'), 'should not emit any frame anchor')
    // Plain file:line still rendered
    assert.match(html, /handler\.ts:42/)
    delete process.env['APP_EDITOR']
  })
})
