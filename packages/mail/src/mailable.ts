// ─── Mail Message ──────────────────────────────────────────

export interface MailMessage {
  subject: string
  html?:   string
  text?:   string
}

// ─── Mailable ──────────────────────────────────────────────

export abstract class Mailable {
  protected _subject = ''
  private _html?: string
  private _text?: string

  /** Set the email subject */
  protected subject(subject: string): this { this._subject = subject; return this }

  /** Set the HTML body */
  protected html(html: string): this { this._html = html; return this }

  /** Set the plain-text body */
  protected text(text: string): this { this._text = text; return this }

  /** Build the mailable — called before sending. Override to set subject/html/text. */
  abstract build(): this | Promise<this>

  /** Called by the adapter — builds then returns the compiled message */
  async compile(): Promise<MailMessage> {
    await this.build()
    const msg: MailMessage = { subject: this._subject }
    if (this._html !== undefined) msg.html = this._html
    if (this._text !== undefined) msg.text = this._text
    return msg
  }

  /**
   * @internal — read the current subject. Used by `MarkdownMailable.compile()`
   * which overrides `compile()` and needs to read the subject set by the
   * subclass's `build()` without going through the closed `compile()` flow.
   */
  protected getSubject(): string { return this._subject }
}
