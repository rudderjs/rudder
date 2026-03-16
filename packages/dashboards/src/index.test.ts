import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Widget } from './Widget.js'
import { Dashboard, DashboardTab } from './Dashboard.js'
import { DashboardRegistry } from './DashboardRegistry.js'
import { dashboard, buildDefaultLayout } from './DashboardServiceProvider.js'

// ─── Widget ───────────────────────────────────────────────

describe('Widget', () => {
  it('creates with id', () => {
    const w = Widget.make('total-users')
    assert.equal(w.getId(), 'total-users')
  })

  it('label is settable', () => {
    assert.equal(Widget.make('x').label('Total Users').getLabel(), 'Total Users')
  })

  it('default size is { w: 6, h: 2 }', () => {
    assert.deepEqual(Widget.make('x').getDefaultSize(), { w: 6, h: 2 })
  })

  it('defaultSize accepts { w, h }', () => {
    assert.deepEqual(Widget.make('x').defaultSize({ w: 4, h: 3 }).getDefaultSize(), { w: 4, h: 3 })
  })

  it('component defaults to stat', () => {
    assert.equal(Widget.make('x').getComponent(), 'stat')
  })

  it('component is configurable', () => {
    assert.equal(Widget.make('x').component('chart').getComponent(), 'chart')
  })

  it('description is optional', () => {
    const meta = Widget.make('x').toMeta()
    assert.equal(meta.description, undefined)
  })

  it('icon is optional', () => {
    const meta = Widget.make('x').toMeta()
    assert.equal(meta.icon, undefined)
  })

  it('toMeta() returns full registration info', () => {
    const meta = Widget.make('revenue')
      .label('Revenue')
      .large()
      .component('chart')
      .description('Monthly revenue chart')
      .icon('chart-line')
      .toMeta()

    assert.equal(meta.id, 'revenue')
    assert.equal(meta.label, 'Revenue')
    assert.deepEqual(meta.defaultSize, { w: 12, h: 3 })
    assert.equal(meta.component, 'chart')
    assert.equal(meta.description, 'Monthly revenue chart')
    assert.equal(meta.icon, 'chart-line')
  })

  it('data function is stored', () => {
    const fn = async () => ({ value: 42 })
    const w = Widget.make('x').data(fn)
    assert.equal(w.getDataFn(), fn)
  })

  it('data function is optional', () => {
    assert.equal(Widget.make('x').getDataFn(), undefined)
  })

  it('fluent API is chainable', () => {
    const w = Widget.make('x')
      .label('Test')
      .small()
      .component('list')
      .description('Desc')
      .icon('star')
    assert.equal(w.getId(), 'x')
    assert.equal(w.getLabel(), 'Test')
    assert.deepEqual(w.getDefaultSize(), { w: 3, h: 2 })
    assert.equal(w.getComponent(), 'list')
  })
})

// ─── Widget — custom component ───────────────────────────

describe('Widget — custom component', () => {
  it('render() sets component to custom', () => {
    const w = Widget.make('x').render('/app/widgets/Map')
    assert.equal(w.getComponent(), 'custom')
  })

  it('componentPath in toMeta()', () => {
    const meta = Widget.make('x').render('/app/widgets/Map').toMeta()
    assert.equal(meta.component, 'custom')
    assert.equal(meta.componentPath, '/app/widgets/Map')
  })

  it('componentPath undefined by default', () => {
    assert.equal(Widget.make('x').toMeta().componentPath, undefined)
  })

  it('getComponentPath() returns the path', () => {
    const w = Widget.make('x').render('/app/widgets/Map')
    assert.equal(w.getComponentPath(), '/app/widgets/Map')
  })

  it('getComponentPath() undefined by default', () => {
    assert.equal(Widget.make('x').getComponentPath(), undefined)
  })

  it('render() is chainable with other methods', () => {
    const w = Widget.make('office-map')
      .label('Office Map')
      .render('/app/widgets/OfficeMapWidget')
      .large()
      .data(async () => ({ floors: 3 }))
    assert.equal(w.getComponent(), 'custom')
    assert.equal(w.getComponentPath(), '/app/widgets/OfficeMapWidget')
    assert.equal(w.getLabel(), 'Office Map')
    assert.deepEqual(w.getDefaultSize(), { w: 12, h: 3 })
    assert.equal(typeof w.getDataFn(), 'function')
  })
})

// ─── Widget — v2 sizing ──────────────────────────────────

describe('Widget — v2 sizing', () => {
  it('default size is { w: 6, h: 2 }', () => {
    assert.deepEqual(Widget.make('x').toMeta().defaultSize, { w: 6, h: 2 })
  })

  it('defaultSize accepts { w, h }', () => {
    assert.deepEqual(Widget.make('x').defaultSize({ w: 4, h: 3 }).toMeta().defaultSize, { w: 4, h: 3 })
  })

  it('small() → { w: 3, h: 2 }', () => {
    assert.deepEqual(Widget.make('x').small().toMeta().defaultSize, { w: 3, h: 2 })
  })

  it('medium() → { w: 6, h: 2 }', () => {
    assert.deepEqual(Widget.make('x').medium().toMeta().defaultSize, { w: 6, h: 2 })
  })

  it('large() → { w: 12, h: 3 }', () => {
    assert.deepEqual(Widget.make('x').large().toMeta().defaultSize, { w: 12, h: 3 })
  })

  it('minSize / maxSize in toMeta()', () => {
    const meta = Widget.make('x').minSize({ w: 3, h: 2 }).maxSize({ w: 12, h: 6 }).toMeta()
    assert.deepEqual(meta.minSize, { w: 3, h: 2 })
    assert.deepEqual(meta.maxSize, { w: 12, h: 6 })
  })

  it('minSize / maxSize undefined by default', () => {
    const meta = Widget.make('x').toMeta()
    assert.equal(meta.minSize, undefined)
    assert.equal(meta.maxSize, undefined)
  })
})

// ─── Widget — settings ───────────────────────────────────

describe('Widget — settings', () => {
  it('no settings by default', () => {
    assert.equal(Widget.make('x').toMeta().settings, undefined)
  })

  it('settings fields in meta', () => {
    const meta = Widget.make('x').settings([
      { name: 'period', type: 'select', options: ['7d', '30d'], default: '30d' },
      { name: 'showTrend', type: 'toggle', default: true },
    ]).toMeta()
    assert.equal(meta.settings!.length, 2)
    assert.equal(meta.settings![0]!.name, 'period')
    assert.equal(meta.settings![0]!.type, 'select')
    assert.equal(meta.settings![1]!.name, 'showTrend')
  })

  it('data fn can receive settings', () => {
    const fn = async (_ctx: unknown, _settings: unknown) => ({ value: 42 })
    const w = Widget.make('x').data(fn)
    assert.equal(typeof w.getDataFn(), 'function')
  })
})

// ─── DashboardRegistry — v2 ─────────────────────────────

describe('DashboardRegistry — v2', () => {
  beforeEach(() => {
    DashboardRegistry.reset()
  })

  it('starts empty', () => {
    assert.equal(DashboardRegistry.all().length, 0)
  })

  it('register and get by panel + id', () => {
    const d = Dashboard.make('overview')
    DashboardRegistry.register('admin', d)
    assert.equal(DashboardRegistry.get('admin', 'overview'), d)
  })

  it('get returns undefined for unknown panel or id', () => {
    DashboardRegistry.register('admin', Dashboard.make('x'))
    assert.equal(DashboardRegistry.get('admin', 'nope'), undefined)
    assert.equal(DashboardRegistry.get('other', 'x'), undefined)
  })

  it('has()', () => {
    DashboardRegistry.register('admin', Dashboard.make('x'))
    assert.equal(DashboardRegistry.has('admin', 'x'), true)
    assert.equal(DashboardRegistry.has('admin', 'y'), false)
    assert.equal(DashboardRegistry.has('other', 'x'), false)
  })

  it('allForPanel()', () => {
    DashboardRegistry.register('admin', Dashboard.make('a'))
    DashboardRegistry.register('admin', Dashboard.make('b'))
    DashboardRegistry.register('other', Dashboard.make('c'))
    assert.equal(DashboardRegistry.allForPanel('admin').length, 2)
    assert.equal(DashboardRegistry.allForPanel('other').length, 1)
    assert.equal(DashboardRegistry.allForPanel('nope').length, 0)
  })

  it('all() returns all dashboards across panels', () => {
    DashboardRegistry.register('admin', Dashboard.make('a'))
    DashboardRegistry.register('other', Dashboard.make('b'))
    assert.equal(DashboardRegistry.all().length, 2)
  })

  it('overwrites dashboard with same panel + id', () => {
    DashboardRegistry.register('admin', Dashboard.make('x').label('Old'))
    DashboardRegistry.register('admin', Dashboard.make('x').label('New'))
    assert.equal(DashboardRegistry.all().length, 1)
    assert.equal(DashboardRegistry.get('admin', 'x')?.getLabel(), 'New')
  })

  it('reset() clears all', () => {
    DashboardRegistry.register('admin', Dashboard.make('x'))
    DashboardRegistry.register('other', Dashboard.make('y'))
    DashboardRegistry.reset()
    assert.equal(DashboardRegistry.all().length, 0)
  })
})

// ─── dashboard() factory — v2 ───────────────────────────

describe('dashboard() factory — v2', () => {
  beforeEach(() => {
    DashboardRegistry.reset()
  })

  it('returns a ServiceProvider class (constructor)', () => {
    const Provider = dashboard()
    assert.equal(typeof Provider, 'function')
    assert.equal(typeof Provider.prototype.register, 'function')
  })

  it('register() resets the DashboardRegistry', () => {
    DashboardRegistry.register('admin', Dashboard.make('old'))
    const Provider = dashboard()
    const provider = new Provider({} as any)
    provider.register()
    assert.equal(DashboardRegistry.all().length, 0)
  })

  it('boot() does not throw when panels not available', async () => {
    const Provider = dashboard()
    const provider = new Provider({} as any)
    provider.register()
    // panels peer dep not loaded — should silently return
    await assert.doesNotReject(() => provider.boot!() as Promise<void>)
  })
})

// ─── buildDefaultLayout ──────────────────────────────────

describe('buildDefaultLayout', () => {
  it('generates layout entries from widgets', () => {
    const widgets = [
      Widget.make('a').label('A').small(),
      Widget.make('b').label('B').large(),
      Widget.make('c').label('C'),
    ]
    const layout = buildDefaultLayout(widgets)

    assert.equal(layout.length, 3)
    assert.equal(layout[0]!.widgetId, 'a')
    assert.deepEqual(layout[0]!.size, { w: 3, h: 2 })
    assert.equal(layout[0]!.position, 0)
    assert.equal(layout[1]!.widgetId, 'b')
    assert.deepEqual(layout[1]!.size, { w: 12, h: 3 })
    assert.equal(layout[1]!.position, 1)
    assert.equal(layout[2]!.widgetId, 'c')
    assert.deepEqual(layout[2]!.size, { w: 6, h: 2 })
    assert.equal(layout[2]!.position, 2)
  })

  it('returns empty array for no widgets', () => {
    const layout = buildDefaultLayout([])
    assert.deepStrictEqual(layout, [])
  })
})

// ─── Dashboard schema element ────────────────────────────────

describe('Dashboard schema element', () => {
  it('type is dashboard', () => {
    assert.equal(Dashboard.make('main').getType(), 'dashboard')
  })

  it('defaults — editable, no widgets, no tabs, no label', () => {
    const d = Dashboard.make('main')
    assert.equal(d.getId(), 'main')
    assert.equal(d.getLabel(), undefined)
    assert.equal(d.isEditable(), true)
    assert.deepEqual(d.getWidgets(), [])
    assert.equal(d.getTabs(), undefined)
  })

  it('label + editable', () => {
    const d = Dashboard.make('x').label('Overview').editable(false)
    assert.equal(d.getLabel(), 'Overview')
    assert.equal(d.isEditable(), false)
  })

  it('widgets only (no tabs)', () => {
    const d = Dashboard.make('x').widgets([Widget.make('a'), Widget.make('b')])
    assert.equal(d.getWidgets().length, 2)
    assert.equal(d.getTabs(), undefined)
  })

  it('tabs only (no top-level widgets)', () => {
    const d = Dashboard.make('x').tabs([
      Dashboard.tab('t1').label('Tab 1').widgets([Widget.make('a')]),
      Dashboard.tab('t2').label('Tab 2').widgets([Widget.make('b')]),
    ])
    assert.equal(d.getWidgets().length, 0)
    assert.equal(d.getTabs()!.length, 2)
    assert.equal(d.getTabs()![0]!.getLabel(), 'Tab 1')
  })

  it('widgets + tabs combined', () => {
    const d = Dashboard.make('x')
      .widgets([Widget.make('top')])
      .tabs([Dashboard.tab('t1').widgets([Widget.make('inner')])])
    assert.equal(d.getWidgets().length, 1)
    assert.equal(d.getTabs()!.length, 1)
  })

  it('getAllWidgets() collects from top-level + tabs', () => {
    const d = Dashboard.make('x')
      .widgets([Widget.make('a')])
      .tabs([
        Dashboard.tab('t1').widgets([Widget.make('b'), Widget.make('c')]),
        Dashboard.tab('t2').widgets([Widget.make('d')]),
      ])
    assert.equal(d.getAllWidgets().length, 4)
  })

  it('toMeta() — widgets only', () => {
    const meta = Dashboard.make('main').label('Overview')
      .widgets([Widget.make('a').label('A')])
      .toMeta()
    assert.equal(meta.type, 'dashboard')
    assert.equal(meta.id, 'main')
    assert.equal(meta.label, 'Overview')
    assert.equal(meta.editable, true)
    assert.equal(meta.widgets.length, 1)
    assert.equal(meta.tabs, undefined)
  })

  it('toMeta() — no label omits it', () => {
    const meta = Dashboard.make('x').toMeta()
    assert.equal(meta.label, undefined)
  })

  it('toMeta() — with tabs', () => {
    const meta = Dashboard.make('x')
      .widgets([Widget.make('top')])
      .tabs([Dashboard.tab('t1').label('Tab 1').widgets([Widget.make('inner')])])
      .toMeta()
    assert.equal(meta.widgets.length, 1)
    assert.equal(meta.tabs!.length, 1)
    assert.equal(meta.tabs![0]!.id, 't1')
    assert.equal(meta.tabs![0]!.label, 'Tab 1')
    assert.equal(meta.tabs![0]!.widgets.length, 1)
  })
})

describe('Dashboard.tab()', () => {
  it('creates a tab with id', () => {
    const tab = Dashboard.tab('overview')
    assert.equal(tab.getId(), 'overview')
  })

  it('fluent API', () => {
    const tab = Dashboard.tab('x').label('Analytics').widgets([Widget.make('a')])
    assert.equal(tab.getLabel(), 'Analytics')
    assert.equal(tab.getWidgets().length, 1)
  })

  it('toMeta()', () => {
    const meta = Dashboard.tab('t1').label('Tab').widgets([Widget.make('w1').label('W')]).toMeta()
    assert.equal(meta.id, 't1')
    assert.equal(meta.label, 'Tab')
    assert.equal(meta.widgets.length, 1)
    assert.equal(meta.widgets[0]!.label, 'W')
  })
})
