// ─── Playground schema element ───────────────────────────────
// Interactive demo with controls that update a live preview.
// Controls are fields (Select, Toggle, TextField, etc.).
// Preview re-renders client-side when controls change — no server round-trip.
//
//   Playground.make('Toggle Field')
//     .controls([
//       SelectField.make('variant').options(['default', 'card']).default('default'),
//       ToggleField.make('disabled').default(false),
//       TextField.make('label').default('Subscribe'),
//     ])
//     .preview((props) => [
//       ToggleField.make('demo').label(props.label),
//     ])

import type { Field } from './Field.js'

type PreviewFn = (props: Record<string, unknown>) => { getType(): string; toMeta(): unknown }[]

export interface PlaygroundElementMeta {
  type:         'playground'
  title:        string
  description?: string
  controls:     unknown[]   // FieldMeta[]
  /** Default values for controls (resolved from field defaults) */
  defaults:     Record<string, unknown>
  /** SSR-resolved preview elements (using default control values) */
  elements:     unknown[]
  /** Code string showing current configuration (optional) */
  code?:        string
}

export class Playground {
  private _title:       string
  private _description?: string
  private _controls:    Field[] = []
  private _previewFn?:  PreviewFn
  private _code?:       string

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Playground {
    return new Playground(title)
  }

  description(text: string): this {
    this._description = text
    return this
  }

  /** Define control fields. Their values are passed to the preview function. */
  controls(fields: Field[]): this {
    this._controls = fields
    return this
  }

  /** Preview function — receives current control values, returns schema elements. */
  preview(fn: PreviewFn): this {
    this._previewFn = fn
    return this
  }

  /** Optional code template. Use `:propName` placeholders that update with control values. */
  code(code: string): this {
    this._code = code
    return this
  }

  getType(): 'playground' { return 'playground' }
  getControls(): Field[] { return this._controls }
  getPreviewFn(): PreviewFn | undefined { return this._previewFn }

  /** Get default values from control fields. */
  getDefaults(): Record<string, unknown> {
    const defaults: Record<string, unknown> = {}
    for (const field of this._controls) {
      const meta = field.toMeta()
      const name = meta.name
      if (meta.defaultValue !== undefined) {
        defaults[name] = meta.defaultValue
      } else if (meta.extra?.['default'] !== undefined) {
        defaults[name] = meta.extra['default']
      } else if (meta.type === 'boolean' || meta.type === 'toggle') {
        defaults[name] = false
      } else {
        defaults[name] = ''
      }
    }
    return defaults
  }

  toMeta(): PlaygroundElementMeta {
    const defaults = this.getDefaults()
    const meta: PlaygroundElementMeta = {
      type:     'playground',
      title:    this._title,
      controls: this._controls.map(f => f.toMeta()),
      defaults,
      elements: [],  // resolved by resolveSchema with default values
    }
    if (this._description) meta.description = this._description
    if (this._code) meta.code = this._code
    return meta
  }
}
