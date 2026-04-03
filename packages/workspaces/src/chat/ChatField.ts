import { Field } from '@rudderjs/panels'

/**
 * ChatField — form field that embeds a chat interface.
 *
 * @example
 * form(form: Form) {
 *   return form.fields([
 *     ChatField.make('chat')
 *       .height(500)
 *   ])
 * }
 */
export class ChatField extends Field {
  private _height = 400

  static make(name: string): ChatField {
    return new ChatField(name)
  }

  getType(): string { return 'chat' }

  /** Set the chat panel height in pixels. */
  height(px: number): this {
    this._height = px
    this._extra['height'] = px
    return this
  }

  /** @internal */
  getHeight(): number { return this._height }
}
