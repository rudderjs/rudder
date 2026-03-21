
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Panel }          from '../Panel.js'
import { PanelRegistry }  from '../registries/PanelRegistry.js'
import { TableRegistry }  from '../registries/TableRegistry.js'
import { FormRegistry }   from '../registries/FormRegistry.js'
import { StatsRegistry }  from '../registries/StatsRegistry.js'
import { TabsRegistry }   from '../registries/TabsRegistry.js'
import { ComputeRegistry } from '../registries/ComputeRegistry.js'
import { createRegistry } from '../registries/BaseRegistry.js'
import { Table }          from '../schema/Table.js'
import { Stats }          from '../schema/Stats.js'
import { Tabs }           from '../schema/Tabs.js'

// ─── PanelRegistry ──────────────────────────────────────────

describe('PanelRegistry', () => {
  beforeEach(() => PanelRegistry.reset())

  it('register() and all() work', () => {
    const p = Panel.make('admin')
    PanelRegistry.register(p)
    assert.equal(PanelRegistry.all().length, 1)
    assert.equal(PanelRegistry.all()[0], p)
  })

  it('get() returns panel by name', () => {
    const p = Panel.make('store')
    PanelRegistry.register(p)
    assert.equal(PanelRegistry.get('store'), p)
  })

  it('get() returns undefined for unknown name', () => {
    assert.equal(PanelRegistry.get('nope'), undefined)
  })

  it('has() works', () => {
    PanelRegistry.register(Panel.make('x'))
    assert.equal(PanelRegistry.has('x'), true)
    assert.equal(PanelRegistry.has('y'), false)
  })

  it('register() throws on duplicate name', () => {
    PanelRegistry.register(Panel.make('dup'))
    assert.throws(
      () => PanelRegistry.register(Panel.make('dup')),
      /already registered/,
    )
  })

  it('reset() clears all panels', () => {
    PanelRegistry.register(Panel.make('a'))
    PanelRegistry.reset()
    assert.equal(PanelRegistry.all().length, 0)
  })
})

// ─── TableRegistry ──────────────────────────────────────────

describe('TableRegistry', () => {
  beforeEach(() => TableRegistry.reset())

  it('register and get', () => {
    const t = Table.make('Posts')
    TableRegistry.register('admin', 'posts', t)
    assert.equal(TableRegistry.get('admin', 'posts'), t)
  })

  it('get returns undefined for missing entry', () => {
    assert.equal(TableRegistry.get('admin', 'nope'), undefined)
  })

  it('reset clears all entries', () => {
    TableRegistry.register('admin', 'posts', Table.make('Posts'))
    TableRegistry.reset()
    assert.equal(TableRegistry.get('admin', 'posts'), undefined)
  })

  it('different panels have separate namespaces', () => {
    const t1 = Table.make('A')
    const t2 = Table.make('B')
    TableRegistry.register('admin', 'tbl', t1)
    TableRegistry.register('user', 'tbl', t2)
    assert.equal(TableRegistry.get('admin', 'tbl'), t1)
    assert.equal(TableRegistry.get('user', 'tbl'), t2)
  })
})

// ─── StatsRegistry ──────────────────────────────────────────

describe('StatsRegistry', () => {
  beforeEach(() => StatsRegistry.reset())

  it('register and get', () => {
    const s = Stats.make('dash')
    StatsRegistry.register('admin', 'dash', s)
    assert.equal(StatsRegistry.get('admin', 'dash'), s)
  })

  it('get returns undefined for missing entry', () => {
    assert.equal(StatsRegistry.get('admin', 'nope'), undefined)
  })

  it('reset clears all entries', () => {
    StatsRegistry.register('admin', 'dash', Stats.make('dash'))
    StatsRegistry.reset()
    assert.equal(StatsRegistry.get('admin', 'dash'), undefined)
  })
})

// ─── TabsRegistry ───────────────────────────────────────────

describe('TabsRegistry', () => {
  beforeEach(() => TabsRegistry.reset())

  it('register and get', () => {
    const t = Tabs.make('projects')
    TabsRegistry.register('admin', 'projects', t)
    assert.equal(TabsRegistry.get('admin', 'projects'), t)
  })

  it('get returns undefined for missing entry', () => {
    assert.equal(TabsRegistry.get('admin', 'nope'), undefined)
  })

  it('reset clears all entries', () => {
    TabsRegistry.register('admin', 'projects', Tabs.make('projects'))
    TabsRegistry.reset()
    assert.equal(TabsRegistry.get('admin', 'projects'), undefined)
  })
})

// ─── FormRegistry ───────────────────────────────────────────

describe('FormRegistry', () => {
  beforeEach(() => FormRegistry.reset())

  it('register and get handler', () => {
    const handler = async () => {}
    FormRegistry.register('admin', 'contact', handler)
    assert.equal(FormRegistry.get('admin', 'contact'), handler)
  })

  it('get returns undefined for missing entry', () => {
    assert.equal(FormRegistry.get('admin', 'nope'), undefined)
  })

  it('registerHooks stores before/after submit hooks', () => {
    const handler = async () => {}
    const before = async (d: Record<string, unknown>) => d
    const after = async () => {}
    FormRegistry.register('admin', 'f1', handler)
    FormRegistry.registerHooks('admin', 'f1', { beforeSubmit: before, afterSubmit: after })
    const entry = FormRegistry.getEntry('admin', 'f1')
    assert.ok(entry)
    assert.equal(entry!.handler, handler)
    assert.equal(entry!.beforeSubmit, before)
    assert.equal(entry!.afterSubmit, after)
  })

  it('registerHooks creates entry when none exists', () => {
    const before = async (d: Record<string, unknown>) => d
    FormRegistry.registerHooks('admin', 'f2', { beforeSubmit: before })
    const entry = FormRegistry.getEntry('admin', 'f2')
    assert.ok(entry)
    assert.equal(entry!.beforeSubmit, before)
    assert.equal(typeof entry!.handler, 'function')
  })

  it('getEntry returns undefined for missing entry', () => {
    assert.equal(FormRegistry.getEntry('admin', 'nope'), undefined)
  })

  it('reset clears all entries', () => {
    FormRegistry.register('admin', 'f1', async () => {})
    FormRegistry.reset()
    assert.equal(FormRegistry.get('admin', 'f1'), undefined)
  })
})

// ─── createRegistry ────────────────────────────────────────

describe('createRegistry', () => {
  it('register and get by panelName:id', () => {
    const reg = createRegistry<string>()
    reg.register('admin', 'foo', 'bar')
    assert.equal(reg.get('admin', 'foo'), 'bar')
  })

  it('get returns undefined for missing entry', () => {
    const reg = createRegistry<string>()
    assert.equal(reg.get('admin', 'missing'), undefined)
  })

  it('reset clears all entries', () => {
    const reg = createRegistry<string>()
    reg.register('admin', 'foo', 'bar')
    reg.reset()
    assert.equal(reg.get('admin', 'foo'), undefined)
  })

  it('different panels are isolated', () => {
    const reg = createRegistry<string>()
    reg.register('admin', 'foo', 'bar')
    assert.equal(reg.get('other', 'foo'), undefined)
  })
})

// ─── ComputeRegistry ──────────────────────────────────────────────

describe('ComputeRegistry', () => {
  it('register and get', () => {
    ComputeRegistry.register('admin', 'form:slug', { from: ['title'], compute: ({ title }) => title })
    const entry = ComputeRegistry.get('admin', 'form:slug')
    assert.ok(entry)
    assert.deepEqual(entry!.from, ['title'])
    ComputeRegistry.reset()
  })

  it('returns undefined for missing', () => {
    assert.equal(ComputeRegistry.get('admin', 'missing'), undefined)
  })
})
