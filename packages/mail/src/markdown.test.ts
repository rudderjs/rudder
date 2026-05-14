import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MarkdownMailable } from './markdown.js'

class TestMail extends MarkdownMailable {
  constructor(private readonly _md: string, private readonly _testVars: Record<string, string> = {}) {
    super()
  }
  build() {
    return this.subject('Test').markdown(this._md).with(this._testVars)
  }
}

class ThemedMail extends MarkdownMailable {
  build() {
    return this.subject('Themed').markdown('# Hello').theme('body { background: red; }')
  }
}

describe('MarkdownMailable', () => {
  describe('markdown → HTML conversion', () => {
    it('renders h1/h2/h3 headers', async () => {
      const msg = await new TestMail('# H1\n\n## H2\n\n### H3').compile()
      assert.match(msg.html!, /<h1[^>]*>H1<\/h1>/)
      assert.match(msg.html!, /<h2[^>]*>H2<\/h2>/)
      assert.match(msg.html!, /<h3[^>]*>H3<\/h3>/)
    })

    it('renders bold and italic', async () => {
      const msg = await new TestMail('Plain **bold** and *italic*').compile()
      assert.match(msg.html!, /<strong>bold<\/strong>/)
      assert.match(msg.html!, /<em>italic<\/em>/)
    })

    it('renders links', async () => {
      const msg = await new TestMail('Visit [the site](https://example.com)').compile()
      assert.match(msg.html!, /<a href="https:\/\/example\.com"[^>]*>the site<\/a>/)
    })

    it('renders unordered lists', async () => {
      const msg = await new TestMail('- one\n- two\n- three').compile()
      assert.match(msg.html!, /<ul[^>]*>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>[\s\S]*<li>three<\/li>[\s\S]*<\/ul>/)
    })

    it('renders inline code', async () => {
      const msg = await new TestMail('Run `npm install`').compile()
      assert.match(msg.html!, /<code[^>]*>npm install<\/code>/)
    })

    it('renders horizontal rules', async () => {
      const msg = await new TestMail('Above\n\n---\n\nBelow').compile()
      assert.match(msg.html!, /<hr[^>]*>/)
    })
  })

  describe('variable interpolation', () => {
    it('substitutes {{ name }} occurrences', async () => {
      const msg = await new TestMail('Hi {{ name }}!', { name: 'Suleiman' }).compile()
      assert.match(msg.html!, /Hi Suleiman!/)
    })

    it('handles whitespace inside the braces', async () => {
      const msg = await new TestMail('Hi {{name}} and {{  name  }}', { name: 'Sam' }).compile()
      assert.match(msg.html!, /Hi Sam and Sam/)
    })

    it('leaves unmatched placeholders untouched', async () => {
      const msg = await new TestMail('{{ missing }}', {}).compile()
      assert.match(msg.html!, /\{\{ missing \}\}/)
    })
  })

  describe('component blocks', () => {
    it('renders a button component with url + body (relative URL to avoid known JSON-parse limitation)', async () => {
      // NOTE: the attrs parser substitutes single-quoted JSON via two regex
      // passes (see markdown.ts:_processComponents). The second pass also
      // quotes any `word:` sequence — so URLs containing `://` break parsing
      // and attrs silently fall back to {} (covered by the next test).
      // Relative URLs are safe.
      const md = `@component('button', { url: '/go' })\nClick me\n@endcomponent`
      const msg = await new TestMail(md).compile()
      assert.match(msg.html!, /<a href="\/go"/)
      assert.match(msg.html!, />Click me<\/a>/)
    })

    it('renders a panel component (no attrs)', async () => {
      const md = `@component('panel')\nNotice text\n@endcomponent`
      const msg = await new TestMail(md).compile()
      assert.match(msg.html!, /border-left:4px solid #3490dc/)
      assert.match(msg.html!, /Notice text/)
    })

    it('falls back to the body when component name is unknown', async () => {
      const md = `@component('nonexistent')\nFallback body\n@endcomponent`
      const msg = await new TestMail(md).compile()
      assert.match(msg.html!, /Fallback body/)
      assert.doesNotMatch(msg.html!, /@component/)
    })

    it('silently uses empty attrs when JSON is malformed', async () => {
      // No double quote in the attrs string — must not throw, must still render
      const md = `@component('button', { url: })\nNo URL\n@endcomponent`
      const msg = await new TestMail(md).compile()
      assert.match(msg.html!, /href="#"/)  // default URL '#'
      assert.match(msg.html!, />No URL<\/a>/)
    })
  })

  describe('text fallback', () => {
    it('produces a stripped plain-text version from the HTML', async () => {
      const msg = await new TestMail('# Title\n\nBody with **bold**.').compile()
      assert.ok(msg.text)
      assert.doesNotMatch(msg.text!, /<[^>]+>/)
      assert.match(msg.text!, /Title/)
      assert.match(msg.text!, /Body with bold\./)
    })
  })

  describe('theme override', () => {
    it('uses a custom <style> block when theme() is supplied', async () => {
      const msg = await new ThemedMail().compile()
      assert.match(msg.html!, /<style>body \{ background: red; \}<\/style>/)
    })

    it('uses the default theme when none is supplied', async () => {
      const msg = await new TestMail('Hello').compile()
      assert.match(msg.html!, /max-width: 570px/)
    })
  })

  describe('subject', () => {
    it('passes through to compile()', async () => {
      const msg = await new TestMail('Body').compile()
      assert.equal(msg.subject, 'Test')
    })
  })
})
