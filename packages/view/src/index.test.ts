import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { escapeHtml, html, SafeString, view, isViewResponse, ViewResponse } from './index.js'

describe('escapeHtml()', () => {
  it('escapes the five HTML-sensitive characters', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('escapes ampersand first to avoid double-encoding', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b')
    assert.equal(escapeHtml('&amp;'), '&amp;amp;')
  })

  it('escapes single quotes', () => {
    assert.equal(escapeHtml("it's"), 'it&#39;s')
  })

  it('returns empty string for null/undefined', () => {
    assert.equal(escapeHtml(null),      '')
    assert.equal(escapeHtml(undefined), '')
  })

  it('stringifies non-strings before escaping', () => {
    assert.equal(escapeHtml(42),    '42')
    assert.equal(escapeHtml(true),  'true')
    assert.equal(escapeHtml(false), 'false')
  })
})

describe('html`` tagged template', () => {
  it('returns a SafeString', () => {
    const result = html`<p>hi</p>`
    assert.ok(result instanceof SafeString)
    assert.equal(result.value, '<p>hi</p>')
    assert.equal(String(result), '<p>hi</p>')
  })

  it('escapes string interpolations', () => {
    const name = '<script>alert(1)</script>'
    const result = html`<h1>${name}</h1>`
    assert.equal(result.value, '<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>')
  })

  it('escapes number interpolations', () => {
    const result = html`<p>${42}</p>`
    assert.equal(result.value, '<p>42</p>')
  })

  it('renders null / undefined / false as empty strings', () => {
    assert.equal(html`a${null}b${undefined}c${false}d`.value, 'abcd')
  })

  it('passes SafeString values through without re-escaping', () => {
    const inner = new SafeString('<b>bold</b>')
    const result = html`<p>${inner}</p>`
    assert.equal(result.value, '<p><b>bold</b></p>')
  })

  it('composes nested html`` without double-escaping', () => {
    const greeting = html`<strong>${'<hi>'}</strong>`
    const outer    = html`<p>${greeting}</p>`
    assert.equal(outer.value, '<p><strong>&lt;hi&gt;</strong></p>')
  })

  it('joins array values, escaping primitives but passing through SafeStrings', () => {
    const rows = [
      html`<tr><td>${'Alice <>'}</td></tr>`,
      html`<tr><td>${'Bob'}</td></tr>`,
    ]
    const table = html`<table>${rows}</table>`
    assert.equal(
      table.value,
      '<table><tr><td>Alice &lt;&gt;</td></tr><tr><td>Bob</td></tr></table>',
    )
  })

  it('escapes primitives inside arrays', () => {
    const items = ['<a>', '<b>', '<c>']
    const result = html`<ul>${items}</ul>`
    assert.equal(result.value, '<ul>&lt;a&gt;&lt;b&gt;&lt;c&gt;</ul>')
  })

  it('handles an interpolation-only template', () => {
    assert.equal(html`${'<x>'}`.value, '&lt;x&gt;')
  })

  it('handles an empty template', () => {
    assert.equal(html``.value, '')
  })
})

describe('view() + isViewResponse()', () => {
  it('view() returns a ViewResponse', () => {
    const r = view('home', { x: 1 })
    assert.ok(r instanceof ViewResponse)
    assert.equal(r.id, 'home')
    assert.deepEqual(r.props, { x: 1 })
  })

  it('isViewResponse() detects via static marker', () => {
    assert.equal(isViewResponse(view('home')), true)
    assert.equal(isViewResponse({}),            false)
    assert.equal(isViewResponse(null),          false)
  })
})
