import { Field } from '@boostkit/panels'

/**
 * CanvasField — form field that renders a mini 3D workspace canvas.
 *
 * The field value is a JSON string containing the flat node map.
 * Saves to the `nodes` column on the Workspace model.
 *
 * @example
 * form(form: Form) {
 *   return form.fields([
 *     TextField.make('name').required(),
 *     CanvasField.make('nodes')
 *       .editable()
 *       .collaborative()
 *       .height(500)
 *   ])
 * }
 */
export class CanvasField extends Field {
  private _editable = false
  private _height = 400

  static make(name: string): CanvasField {
    return new CanvasField(name)
  }

  getType(): string { return 'canvas' }

  /** Allow drag/drop, add/delete nodes, edit connections. */
  editable(): this {
    this._editable = true
    this._extra['editable'] = true
    return this
  }

  /** Set the canvas height in pixels. */
  height(px: number): this {
    this._height = px
    this._extra['height'] = px
    return this
  }

  /** @internal */
  getHeight(): number { return this._height }
  isEditable(): boolean { return this._editable }
}
