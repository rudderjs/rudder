import { Field } from '../Field.js'

export class ContentField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['blockTypes'] = [
      'paragraph', 'heading', 'image', 'divider', 'code', 'quote', 'list', 'table',
    ]
  }

  static make(name: string): ContentField {
    return new ContentField(name)
  }

  /** Restrict which block types are available. */
  blockTypes(types: string[]): this {
    this._extra['blockTypes'] = types
    return this
  }

  /** Placeholder text for empty editor. */
  placeholder(text: string): this {
    this._extra['placeholder'] = text
    return this
  }

  /** Maximum blocks allowed. */
  maxBlocks(n: number): this {
    this._extra['maxBlocks'] = n
    return this
  }

  getType(): string { return 'content' }
}
