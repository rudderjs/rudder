// ─── Text schema element ────────────────────────────────────

export interface TextElementMeta {
  type:    'text'
  content: string
}

export class Text {
  private _content: string

  protected constructor(content: string) {
    this._content = content
  }

  static make(content: string): Text {
    return new Text(content)
  }

  getType(): 'text' { return 'text' }

  toMeta(): TextElementMeta {
    return { type: 'text', content: this._content }
  }
}
