import type { PanelContext, SchemaElementLike } from '../types.js'
import { applyLazyPollMeta } from './utils.js'

export interface WidgetSize {
  w: number   // columns (1-12)
  h: number   // row units
}

export interface WidgetSettingsField {
  name:     string
  type:     'text' | 'number' | 'select' | 'toggle'
  label?:   string
  default?: unknown
  options?: (string | { label: string; value: string })[]
}

export type WidgetSchemaFn = (
  ctx: PanelContext,
  settings?: Record<string, unknown>,
) => SchemaElementLike[] | Promise<SchemaElementLike[]>

export interface WidgetMeta {
  id:             string
  label:          string
  defaultSize:    WidgetSize
  description?:   string
  icon?:          string
  minSize?:       WidgetSize
  maxSize?:       WidgetSize
  settings?:      WidgetSettingsField[]
  componentPath?: string
  lazy?:          boolean
  pollInterval?:  number
}

export class Widget {
  private _id:          string
  private _label        = ''
  private _defaultSize: WidgetSize = { w: 6, h: 2 }
  private _description?: string
  private _icon?:        string
  private _schemaFn?:    WidgetSchemaFn
  private _minSize?:     WidgetSize
  private _maxSize?:     WidgetSize
  private _settings:     WidgetSettingsField[] = []
  private _componentPath?: string
  private _lazy = false
  private _pollInterval?: number

  protected constructor(id: string) {
    this._id = id
  }

  static make(id: string): Widget {
    return new Widget(id)
  }

  label(l: string): this { this._label = l; return this }
  defaultSize(s: WidgetSize): this { this._defaultSize = s; return this }
  description(d: string): this { this._description = d; return this }
  icon(i: string): this { this._icon = i; return this }

  /**
   * Define the widget's content as schema elements.
   * Accepts a static array or an async function receiving (ctx, settings).
   *
   * @example
   * .schema([Stats.make([Stat.make('Users').value(42)])])
   * .schema(async (ctx) => [Stats.make([Stat.make('Users').value(await User.query().count())])])
   */
  schema(input: SchemaElementLike[] | WidgetSchemaFn): this {
    if (Array.isArray(input)) {
      const elements = input
      this._schemaFn = () => elements
    } else {
      this._schemaFn = input
    }
    return this
  }

  /** Defer schema resolution to client-side. Shows skeleton on initial render. */
  lazy(): this { this._lazy = true; return this }

  /** Re-fetch widget schema every N milliseconds. First render uses SSR data. */
  poll(ms: number): this { this._pollInterval = ms; return this }

  minSize(s: WidgetSize): this { this._minSize = s; return this }
  maxSize(s: WidgetSize): this { this._maxSize = s; return this }
  settings(fields: WidgetSettingsField[]): this { this._settings = fields; return this }

  /**
   * Register a custom React component for this widget.
   * @example .render('/app/widgets/OfficeMapWidget')
   */
  render(path: string): this {
    this._componentPath = path
    return this
  }

  /** Preset: { w: 3, h: 2 } */
  small(): this { this._defaultSize = { w: 3, h: 2 }; return this }
  /** Preset: { w: 6, h: 2 } */
  medium(): this { this._defaultSize = { w: 6, h: 2 }; return this }
  /** Preset: { w: 12, h: 3 } */
  large(): this { this._defaultSize = { w: 12, h: 3 }; return this }

  getType(): 'widget' { return 'widget' }
  getId(): string { return this._id }
  getLabel(): string { return this._label }
  getDefaultSize(): WidgetSize { return this._defaultSize }
  getSchemaFn(): WidgetSchemaFn | undefined { return this._schemaFn }
  getComponentPath(): string | undefined { return this._componentPath }
  isLazy(): boolean { return this._lazy }
  getPollInterval(): number | undefined { return this._pollInterval }

  toMeta(): WidgetMeta & { type: 'widget' } {
    const meta: WidgetMeta & { type: 'widget' } = {
      type:        'widget',
      id:          this._id,
      label:       this._label,
      defaultSize: this._defaultSize,
      ...(this._description !== undefined && { description: this._description }),
      ...(this._icon !== undefined && { icon: this._icon }),
      ...(this._minSize !== undefined && { minSize: this._minSize }),
      ...(this._maxSize !== undefined && { maxSize: this._maxSize }),
      ...(this._settings.length > 0 && { settings: this._settings }),
      ...(this._componentPath !== undefined && { componentPath: this._componentPath }),
    }
    applyLazyPollMeta(meta as unknown as Record<string, unknown>, this)
    return meta
  }
}
