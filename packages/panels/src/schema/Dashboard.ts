import type { Widget, WidgetMeta } from './Widget.js'

export interface DashboardTabMeta {
  id:      string
  label:   string
  widgets: WidgetMeta[]
}

export interface DashboardMeta {
  type:       'dashboard'
  id:         string
  label?:     string
  editable:   boolean
  widgets:    WidgetMeta[]
  tabs?:      DashboardTabMeta[]
}

export class DashboardTab {
  private _id:      string
  private _label    = ''
  private _widgets: Widget[] = []

  constructor(id: string) {
    this._id = id
  }

  label(l: string): this { this._label = l; return this }
  widgets(w: Widget[]): this { this._widgets = w; return this }

  getId(): string { return this._id }
  getLabel(): string { return this._label }
  getWidgets(): Widget[] { return this._widgets }

  toMeta(): DashboardTabMeta {
    return {
      id:      this._id,
      label:   this._label,
      widgets: this._widgets.map(w => w.toMeta()),
    }
  }
}

export class Dashboard {
  private _id:       string
  private _label?:   string
  private _editable  = true
  private _widgets:  Widget[] = []
  private _tabs?:    DashboardTab[]

  protected constructor(id: string) {
    this._id = id
  }

  static make(id: string): Dashboard {
    return new Dashboard(id)
  }

  static tab(id: string): DashboardTab {
    return new DashboardTab(id)
  }

  label(l: string): this { this._label = l; return this }
  editable(v = true): this { this._editable = v; return this }
  widgets(w: Widget[]): this { this._widgets = w; return this }
  tabs(t: DashboardTab[]): this { this._tabs = t; return this }

  getId(): string { return this._id }
  getLabel(): string | undefined { return this._label }
  isEditable(): boolean { return this._editable }
  getWidgets(): Widget[] { return this._widgets }
  getTabs(): DashboardTab[] | undefined { return this._tabs }
  getType(): 'dashboard' { return 'dashboard' }

  /** Collect all widgets across top-level + all tabs. */
  getAllWidgets(): Widget[] {
    const all = [...this._widgets]
    if (this._tabs) {
      for (const tab of this._tabs) all.push(...tab.getWidgets())
    }
    return all
  }

  toMeta(): DashboardMeta {
    return {
      type:     'dashboard',
      id:       this._id,
      ...(this._label !== undefined && { label: this._label }),
      editable: this._editable,
      widgets:  this._widgets.map(w => w.toMeta()),
      ...(this._tabs && { tabs: this._tabs.map(t => t.toMeta()) }),
    }
  }
}
