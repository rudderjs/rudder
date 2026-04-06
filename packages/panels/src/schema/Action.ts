import { toTitleCase } from './utils.js'

// ─── Action meta (for UI) ──────────────────────────────────

export interface ActionMeta {
  name:            string
  label:           string
  icon:            string | undefined
  destructive:     boolean
  requiresConfirm: boolean
  confirmMessage:  string | undefined
  bulk:            boolean
  row:             boolean
  url?:            string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formFields?:     any[]
}

// ─── Action handler type ───────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionHandler = (records: any[], formData?: Record<string, unknown>) => Promise<void> | void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FieldLike = { getName(): string; toMeta(): any }

// ─── Action class ──────────────────────────────────────────

export class Action {
  protected _name:           string
  protected _label:          string | undefined
  protected _icon?:          string
  protected _destructive     = false
  protected _confirm?:       string
  protected _bulk            = true
  protected _row             = false
  protected _handler?:       ActionHandler
  protected _url?:           string
  protected _formFields:     FieldLike[] = []

  constructor(name: string) {
    this._name = name
  }

  static make(name: string): Action {
    return new Action(name)
  }

  label(label: string): this {
    this._label = label
    return this
  }

  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Mark this action as destructive — UI shows a red button. */
  destructive(value = true): this {
    this._destructive = value
    return this
  }

  /** Show a confirmation dialog before running. */
  confirm(message?: string): this {
    this._confirm = message ?? 'Are you sure?'
    return this
  }

  /** Whether this action can run on multiple selected records (default: true). */
  bulk(value = true): this {
    this._bulk = value
    return this
  }

  /** Show this action as a button on each table row. */
  row(value = true): this {
    this._row = value
    return this
  }

  /** The function to execute. Receives an array of selected records. */
  handler(fn: ActionHandler): this {
    this._handler = fn
    return this
  }

  /** Client-side navigation instead of server handler. Supports :param placeholders. */
  url(pattern: string): this {
    this._url = pattern
    return this
  }

  /**
   * Define form fields shown in a modal dialog before executing the action.
   * Handler receives the form data as the second argument.
   *
   * @example
   * Action.make('change-status')
   *   .form([
   *     SelectField.make('status').options(['active', 'inactive']).required(),
   *     TextareaField.make('reason').label('Reason for change'),
   *   ])
   *   .handler(async (records, formData) => {
   *     for (const record of records) {
   *       await record.update({ status: formData.status })
   *     }
   *   })
   */
  form(fields: FieldLike[]): this {
    this._formFields = fields
    return this
  }

  // ── Getters ────────────────────────────────────────────

  getName(): string  { return this._name }
  isBulk():  boolean { return this._bulk }
  isRow():   boolean { return this._row }

  getLabel(): string {
    if (this._label) return this._label
    return toTitleCase(this._name)
  }

  hasForm(): boolean { return this._formFields.length > 0 }

  async execute(records: unknown[], formData?: Record<string, unknown>): Promise<void> {
    if (!this._handler) throw new Error(`[RudderJS Panels] Action "${this._name}" has no handler defined.`)
    await this._handler(records, formData)
  }

  toMeta(): ActionMeta {
    return {
      name:            this._name,
      label:           this.getLabel(),
      icon:            this._icon,
      destructive:     this._destructive,
      requiresConfirm: this._confirm !== undefined,
      confirmMessage:  this._confirm,
      bulk:            this._bulk,
      row:             this._row,
      ...(this._url !== undefined ? { url: this._url } : {}),
      ...(this._formFields.length > 0 ? { formFields: this._formFields.map(f => f.toMeta()) } : {}),
    }
  }
}
