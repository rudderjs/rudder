import { Field } from '../Field.js'
import type { BlockMeta } from '../Block.js'

export class RichContentField extends Field {
  protected _blocks: BlockMeta[] = []

  static make(name: string): RichContentField {
    return new RichContentField(name)
  }

  /** Placeholder text shown when the editor is empty. */
  placeholder(text: string): this {
    this._extra['placeholder'] = text
    return this
  }

  /** Register custom block types (Payload CMS-style). */
  blocks(blocks: { toMeta(): BlockMeta }[]): this {
    this._blocks = blocks.map(b => b.toMeta())
    this._extra['blocks'] = this._blocks
    return this
  }

  getType(): string { return 'richcontent' }
}
