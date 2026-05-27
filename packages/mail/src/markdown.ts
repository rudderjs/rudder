import { Mailable, type MailMessage } from './mailable.js'
import { stripHtmlTags } from './strip-html.js'

// ─── Markdown Components ────────────────────────────────────

const COMPONENTS: Record<string, (attrs: Record<string, string>, body: string) => string> = {
  button: (attrs, body) => {
    const url   = attrs['url'] ?? '#'
    const color = attrs['color'] ?? '#3490dc'
    return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td align="center" style="padding: 16px 0;">
        <a href="${_escHtml(url)}" style="display:inline-block;padding:12px 24px;background-color:${_escHtml(color)};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${_escHtml(body)}</a>
      </td></tr>
    </table>`
  },

  panel: (_attrs, body) => {
    return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td style="padding:16px;background-color:#f8fafc;border-left:4px solid #3490dc;border-radius:4px;">
        ${_mdToHtml(body)}
      </td></tr>
    </table>`
  },

  table: (_attrs, body) => {
    const rows = body.trim().split('\n').filter(r => r.trim())
    if (rows.length === 0) return ''

    const headerCells = rows[0]!.split('|').map(c => c.trim()).filter(Boolean)
    const dataRows    = rows.slice(2) // skip header + separator

    let html = '<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">'
    html += '<thead><tr>'
    for (const cell of headerCells) {
      html += `<th style="border-bottom:2px solid #dee2e6;text-align:left;padding:8px;">${_escHtml(cell)}</th>`
    }
    html += '</tr></thead><tbody>'
    for (const row of dataRows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean)
      html += '<tr>'
      for (const cell of cells) {
        html += `<td style="border-bottom:1px solid #dee2e6;padding:8px;">${_escHtml(cell)}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    return html
  },

  header: (_attrs, body) => {
    return `<div style="padding:24px 0;text-align:center;border-bottom:1px solid #e8e5ef;">
      <h1 style="margin:0;font-size:20px;color:#333;">${_escHtml(body)}</h1>
    </div>`
  },

  footer: (_attrs, body) => {
    return `<div style="padding:16px 0;text-align:center;border-top:1px solid #e8e5ef;color:#999;font-size:12px;">
      ${_mdToHtml(body)}
    </div>`
  },
}

// ─── MarkdownMailable ───────────────────────────────────────

/**
 * A mailable that renders markdown content into responsive HTML email.
 * Supports special components: `@component('name', { attrs })` ... `@endcomponent`
 *
 * @example
 * class WelcomeMail extends MarkdownMailable {
 *   build() {
 *     return this.subject('Welcome!')
 *       .markdown(`
 * # Welcome, {{ name }}!
 *
 * Thanks for signing up.
 *
 * @component('button', { url: '{{ url }}' })
 * Get Started
 * @endcomponent
 *
 * @component('panel')
 * If you didn't create this account, no action is needed.
 * @endcomponent
 * `)
 *       .with({ name: this.user.name, url: 'https://example.com/dashboard' })
 *   }
 * }
 */
export abstract class MarkdownMailable extends Mailable {
  private _markdown = ''
  private _vars: Record<string, string> = {}
  private _theme?: string

  /** Set the markdown content */
  protected markdown(content: string): this {
    this._markdown = content
    return this
  }

  /** Set template variables — replaces `{{ key }}` in the markdown */
  protected with(vars: Record<string, string>): this {
    Object.assign(this._vars, vars)
    return this
  }

  /** Set the theme (CSS overrides). Default: built-in responsive layout. */
  protected theme(css: string): this {
    this._theme = css
    return this
  }

  async compile(): Promise<MailMessage> {
    await this.build()

    // Interpolate variables
    let md = this._markdown
    for (const [key, value] of Object.entries(this._vars)) {
      md = md.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value)
    }

    // Process components
    md = _processComponents(md)

    // Convert remaining markdown to HTML
    const bodyHtml = _mdToHtml(md)

    // Wrap in responsive email layout
    const html = _wrapLayout(bodyHtml, this._theme)

    return {
      subject: this.getSubject(),
      html,
      text: _stripHtml(bodyHtml),
    }
  }
}

// ─── Internal helpers ───────────────────────────────────────

function _escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function _stripHtml(html: string): string {
  return stripHtmlTags(html)
}

function _processComponents(md: string): string {
  // Match @component('name', { attrs }) ... @endcomponent
  return md.replace(
    /@component\('(\w+)'(?:,\s*(\{[^}]*\}))?\)\s*\n([\s\S]*?)@endcomponent/g,
    (_match, name: string, attrsStr: string | undefined, body: string) => {
      const handler = COMPONENTS[name]
      if (!handler) return body

      let attrs: Record<string, string> = {}
      if (attrsStr) {
        try {
          // Parse simple { key: 'value' } objects
          attrs = JSON.parse(attrsStr.replace(/'/g, '"').replace(/(\w+):/g, '"$1":')) as Record<string, string>
        } catch { /* use empty attrs */ }
      }

      return handler(attrs, body.trim())
    }
  )
}

function _mdToHtml(md: string): string {
  let html = md

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 8px;color:#333;">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 8px;color:#333;">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin:24px 0 12px;color:#333;">$1</h1>')

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#3490dc;">$1</a>')

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:13px;">$1</code>')

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul style="margin:8px 0;padding-left:24px;">$&</ul>')

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e8e5ef;margin:24px 0;">')

  // Paragraphs (double newline)
  html = html.replace(/\n\n+/g, '</p><p style="margin:12px 0;line-height:1.6;color:#555;">')

  // Wrap in paragraph if not already wrapped in a block element
  if (!html.startsWith('<')) {
    html = `<p style="margin:12px 0;line-height:1.6;color:#555;">${html}</p>`
  }

  return html
}

function _wrapLayout(body: string, customCss?: string): string {
  const css = customCss ?? `
    body { margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .wrapper { width: 100%; padding: 40px 0; background-color: #f4f4f7; }
    .content { max-width: 570px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .inner { padding: 32px; }
  `

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${css}</style>
</head>
<body>
  <div class="wrapper">
    <div class="content">
      <div class="inner">
        ${body}
      </div>
    </div>
  </div>
</body>
</html>`
}
