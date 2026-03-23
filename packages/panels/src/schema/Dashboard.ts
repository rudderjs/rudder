import type { Widget, WidgetMeta } from './Widget.js'

export interface DashboardMeta {
  type:       'dashboard'
  id:         string
  label?:     string
  editable:   boolean
  widgets:    WidgetMeta[]
}

export class Dashboard {
  private _id:       string
  private _label?:   string
  private _editable  = true
  private _widgets:  Widget[] = []

  protected constructor(id: string) {
    this._id = id
  }

  static make(id: string): Dashboard {
    return new Dashboard(id)
  }

  label(l: string): this { this._label = l; return this }
  editable(v = true): this { this._editable = v; return this }
  widgets(w: Widget[]): this { this._widgets = w; return this }

  getId(): string { return this._id }
  getLabel(): string | undefined { return this._label }
  isEditable(): boolean { return this._editable }
  getWidgets(): Widget[] { return this._widgets }
  getType(): 'dashboard' { return 'dashboard' }

  toMeta(): DashboardMeta {
    return {
      type:     'dashboard',
      id:       this._id,
      ...(this._label !== undefined && { label: this._label }),
      editable: this._editable,
      widgets:  this._widgets.map(w => w.toMeta()),
    }
  }
}
