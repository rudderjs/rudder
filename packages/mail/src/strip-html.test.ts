import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stripHtmlTags } from './strip-html.js'

describe('stripHtmlTags', () => {
  it('removes tags and collapses whitespace', () => {
    assert.equal(stripHtmlTags('<p>Hello   <b>world</b></p>'), 'Hello world')
  })

  it('strips nested/adjacent tags', () => {
    assert.equal(stripHtmlTags('<div><span>a</span><span>b</span></div>'), 'ab')
  })

  it('is idempotent — output is a fixed point (no residual strippable tags)', () => {
    const once = stripHtmlTags('<a href="#"><b>x</b></a> y <i>z</i>')
    assert.equal(stripHtmlTags(once), once)
  })

  it('returns plain text unchanged', () => {
    assert.equal(stripHtmlTags('just text'), 'just text')
  })
})
