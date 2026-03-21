import { Field } from '../Field.js'
import type { Block } from '../Block.js'

export class BuilderField extends Field {
  constructor(name: string) {
    super(name)
    this._extra['blocks']   = []
    this._extra['addLabel'] = 'Add block'
  }

  static make(name: string): BuilderField {
    return new BuilderField(name)
  }

  /**
   * Define the available block types for this builder field.
   * @example
   * BuilderField.make('content').blocks([
   *   Block.make('hero').label('Hero').schema([...]),
   *   Block.make('text').label('Text').schema([...]),
   * ])
   */
  blocks(blocks: Block[]): this {
    this._extra['blocks'] = blocks.map((b) => b.toMeta())
    return this
  }

  /** Label for the "add block" button. Defaults to "Add block". */
  addLabel(label: string): this {
    this._extra['addLabel'] = label
    return this
  }

  /** Maximum total blocks allowed across all types. */
  maxItems(n: number): this {
    this._extra['maxItems'] = n
    return this
  }

  getType(): string { return 'builder' }
}
