// ─── Example schema element ─────────────────────────────────
// Live preview + expandable code block.
// The preview renders actual schema elements (interactive).
// The code panel is collapsed by default with a "View Code" toggle.
//
//   Example.make('Inline Edit')
//     .description('Click cell values to edit directly.')
//     .code(`
//       Column.make('name').editable()
//     `)
//     .language('ts')
//     .schema([
//       Table.make('Users').fromModel(User).columns([...])
//     ])

export interface ExampleElementMeta {
  type:         'example'
  title:        string
  description?: string
  code?:        string
  language?:    string
  /** Resolved schema elements for the live preview */
  elements:     unknown[]
}

export class Example {
  private _title:       string
  private _description?: string
  private _code?:       string
  private _language:    string = 'ts'
  private _schema:      { getType(): string; toMeta(): unknown }[] = []

  protected constructor(title: string) {
    this._title = title
  }

  static make(title: string): Example {
    return new Example(title)
  }

  /** Description text shown below the title. */
  description(text: string): this {
    this._description = text
    return this
  }

  /** Source code to display in the collapsible code panel. */
  code(code: string): this {
    this._code = code.trim()
    return this
  }

  /** Code language for syntax highlighting. Default: 'ts'. */
  language(lang: string): this {
    this._language = lang
    return this
  }

  /** Schema elements to render in the live preview area. */
  schema(elements: { getType(): string; toMeta(): unknown }[]): this {
    this._schema = elements
    return this
  }

  getType(): 'example' { return 'example' }
  getSchema(): { getType(): string; toMeta(): unknown }[] { return this._schema }

  toMeta(): ExampleElementMeta {
    const meta: ExampleElementMeta = {
      type:     'example',
      title:    this._title,
      elements: [],  // resolved by resolveSchema
    }
    if (this._description !== undefined) meta.description = this._description
    if (this._code        !== undefined) meta.code        = this._code
    if (this._code        !== undefined) meta.language     = this._language
    return meta
  }
}
