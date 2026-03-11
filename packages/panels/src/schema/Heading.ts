// ─── Heading schema element ─────────────────────────────────

export interface HeadingElementMeta {
  type:    'heading'
  content: string
  level:   1 | 2 | 3
}

export class Heading {
  private _content: string
  private _level: 1 | 2 | 3 = 1

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

  getType(): 'heading' { return 'heading' }

  toMeta(): HeadingElementMeta {
    return { type: 'heading', content: this._content, level: this._level }
  }
}
