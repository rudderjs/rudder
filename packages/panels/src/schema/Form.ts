import type { Field } from './Field.js'
import type { Section } from './Section.js'
import type { Tabs } from './Tabs.js'
import type { PanelContext } from '../types.js'

// ─── Types ──────────────────────────────────────────────────

export type FormSubmitFn = (
  data: Record<string, unknown>,
  ctx: PanelContext,
) => Promise<void | Record<string, unknown>>

/** A field, section, or tabs group — any valid child of a Form. */
export type FormItem = Field | Section | Tabs

export interface FormElementMeta {
  type:            'form'
  id:              string
  fields:          unknown[]      // FieldMeta | SectionMeta | TabsMeta
  submitLabel?:    string
  successMessage?: string
  description?:    string
  method?:         string
  action?:         string
  initialValues?:  Record<string, unknown>
  /** Yjs collaborative editing config (SSR-resolved) */
  yjs?:            boolean
  wsLivePath?:     string | null
  docName?:        string | null
  liveProviders?:  string[]
  /** True when field was placed directly in schema (no Form wrapper) */
  standalone?:     boolean
}

// ─── Form class ─────────────────────────────────────────────

/**
 * Standalone form schema element.
 * Can be embedded anywhere in a panel schema (homepage, Page, Section, Tab).
 * Uses the existing field system — all field types work.
 * Sections and Tabs can be used to group fields.
 * NOT tied to a model/resource — general purpose.
 *
 * @example
 * Form.make('contact')
 *   .fields([
 *     TextField.make('name').label('Name').required(),
 *     EmailField.make('email').label('Email').required(),
 *     TextareaField.make('message').label('Message'),
 *   ])
 *   .onSubmit(async (data, ctx) => {
 *     await Mail.to('admin@example.com').send(new ContactMail(data))
 *   })
 *   .successMessage('Thanks! We'll be in touch.')
 */
export class Form {
  private _id:              string
  private _fields:          FormItem[]      = []
  private _onSubmit?:       FormSubmitFn
  private _submitLabel?:    string
  private _successMessage?: string
  private _description?:    string
  private _method:          'POST' | 'PUT' = 'POST'
  private _action?:         string
  private _dataFn?:         (ctx: PanelContext) => Promise<Record<string, unknown>>
  private _beforeSubmit?:   (data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>
  private _afterSubmit?:    (result: Record<string, unknown>, ctx: PanelContext) => Promise<void>

  private constructor(id: string) {
    this._id = id
  }

  static make(id: string): Form {
    return new Form(id)
  }

  fields(fields: FormItem[]): this {
    this._fields = fields
    return this
  }

  onSubmit(fn: FormSubmitFn): this {
    this._onSubmit = fn
    return this
  }

  /** Label for the submit button (default: 'Submit'). */
  submitLabel(label: string): this {
    this._submitLabel = label
    return this
  }

  /** Message shown after successful submission (default: 'Submitted successfully.'). */
  successMessage(msg: string): this {
    this._successMessage = msg
    return this
  }

  /** Description text shown above the form fields. */
  description(text: string): this {
    this._description = text
    return this
  }

  /** HTTP method for form submission. Default: POST. */
  method(m: 'POST' | 'PUT'): this {
    this._method = m
    return this
  }

  /** Custom action URL. Overrides the default `_forms/:id/submit` endpoint. */
  action(url: string): this {
    this._action = url
    return this
  }

  /**
   * Provide initial values for the form fields.
   * Called during SSR — the returned object populates field defaults.
   */
  data(fn: (ctx: PanelContext) => Promise<Record<string, unknown>>): this {
    this._dataFn = fn
    return this
  }

  /** Transform data before validation and submission. Return the transformed data. */
  beforeSubmit(fn: (data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>): this {
    this._beforeSubmit = fn
    return this
  }

  /** Run after successful submission. */
  afterSubmit(fn: (result: Record<string, unknown>, ctx: PanelContext) => Promise<void>): this {
    this._afterSubmit = fn
    return this
  }

  getId(): string                        { return this._id }
  getFields(): FormItem[]                { return this._fields }
  getSubmitHandler(): FormSubmitFn | undefined { return this._onSubmit }
  getType(): 'form'                      { return 'form' }
  getDataFn(): ((ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined { return this._dataFn }
  getBeforeSubmit(): ((data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined { return this._beforeSubmit }
  getAfterSubmit(): ((result: Record<string, unknown>, ctx: PanelContext) => Promise<void>) | undefined { return this._afterSubmit }

  /** @internal — serialized for the meta endpoint */
  toMeta(): FormElementMeta {
    const meta: FormElementMeta = {
      type:   'form',
      id:     this._id,
      fields: this._fields.map(f => (f as { toMeta(): unknown }).toMeta()),
    }
    if (this._submitLabel    !== undefined) meta.submitLabel    = this._submitLabel
    if (this._successMessage !== undefined) meta.successMessage = this._successMessage
    if (this._description    !== undefined) meta.description    = this._description
    if (this._method !== 'POST')           meta.method          = this._method
    if (this._action         !== undefined) meta.action          = this._action
    return meta
  }
}
