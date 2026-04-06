import type { Field } from './Field.js'
import type { Section } from './Section.js'
import type { Tabs } from './Tabs.js'
import type { FieldOrGrouping, SchemaItemMeta } from '../Resource.js'

// ─── Step meta (for UI) ───────────────────────────────────

export interface StepMeta {
  label:       string
  description: string | undefined
  icon:        string | undefined
  fields:      SchemaItemMeta[]
}

// ─── Wizard meta (for UI) ─────────────────────────────────

export interface WizardMeta {
  type:   'wizard'
  id:     string
  steps:  StepMeta[]
}

// ─── Step class ───────────────────────────────────────────

export class Step {
  protected _label:       string
  protected _description?: string
  protected _icon?:        string
  protected _fields:       FieldOrGrouping[] = []

  constructor(label: string) {
    this._label = label
  }

  static make(label: string): Step {
    return new Step(label)
  }

  description(desc: string): this {
    this._description = desc
    return this
  }

  icon(icon: string): this {
    this._icon = icon
    return this
  }

  /** Define the fields (or groupings) for this step. */
  schema(fields: FieldOrGrouping[]): this {
    this._fields = fields
    return this
  }

  getLabel(): string { return this._label }
  getFields(): FieldOrGrouping[] { return this._fields }

  toMeta(): StepMeta {
    return {
      label:       this._label,
      description: this._description,
      icon:        this._icon,
      fields:      this._fields.map(f => (f as { toMeta(): SchemaItemMeta }).toMeta()),
    }
  }
}

// ─── Wizard class ─────────────────────────────────────────

/**
 * Multi-step form wizard.
 *
 * @example
 * form(form) {
 *   return Wizard.make()
 *     .steps([
 *       Step.make('Details')
 *         .description('Basic information')
 *         .schema([
 *           TextField.make('title').required(),
 *           TextareaField.make('description'),
 *         ]),
 *       Step.make('Settings')
 *         .icon('settings')
 *         .schema([
 *           BooleanField.make('published'),
 *           DateField.make('publishedAt'),
 *         ]),
 *       Step.make('Review')
 *         .description('Review and submit')
 *         .schema([]),
 *     ])
 * }
 */
export class Wizard {
  protected _id:    string = 'wizard'
  protected _steps: Step[] = []

  static make(): Wizard {
    return new Wizard()
  }

  id(id: string): this {
    this._id = id
    return this
  }

  steps(steps: Step[]): this {
    this._steps = steps
    return this
  }

  getSteps(): Step[] { return this._steps }
  getId(): string { return this._id }

  /** Get all fields across all steps (flattened). */
  getFields(): FieldOrGrouping[] {
    return this._steps.flatMap(s => s.getFields())
  }

  getType(): string { return 'wizard' }

  toMeta(): WizardMeta {
    return {
      type:  'wizard',
      id:    this._id,
      steps: this._steps.map(s => s.toMeta()),
    }
  }
}
