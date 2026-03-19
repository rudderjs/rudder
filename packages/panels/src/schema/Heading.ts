// ─── Heading schema element ─────────────────────────────────

export interface HeadingElementMeta {
  type:         'heading'
  content:      string
  level:        1 | 2 | 3
  description?: string
}

export class Heading {
  private _content:     string
  private _level:       1 | 2 | 3 = 1
  private _description?: string

  protected constructor(content: string) {
    this._content = content
  }

  static make(content: string): Heading {
    return new Heading(content)
  }

  level(n: 1 | 2 | 3): this {
    this._level = n
    return this
  }

  /** Optional description displayed below the heading. */
  description(text: string): this {
    this._description = text
    return this
  }

  getType(): 'heading' { return 'heading' }

  toMeta(): HeadingElementMeta {
    const meta: HeadingElementMeta = { type: 'heading', content: this._content, level: this._level }
    if (this._description !== undefined) meta.description = this._description
    return meta
  }
}
