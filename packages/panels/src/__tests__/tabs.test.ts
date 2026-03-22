
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Tabs }         from '../schema/Tabs.js'
import { Tab }          from '../schema/Tabs.js'
import { ListTab }      from '../schema/Tab.js'
import { TextField }    from '../schema/fields/TextField.js'
import { BooleanField } from '../schema/fields/BooleanField.js'

// ─── Mock classes ──────────────────────────────────────────

class MockModel {
  static query() { return { get: async () => [], count: async () => 0 } }
}
class MockResource {
  static model = MockModel
  static getSlug() { return 'mocks' }
  fields() { return [] }
}

// ─── Tabs ─────────────────────────────────────────────────────

describe('Tabs', () => {
  it('type is tabs', () => {
    assert.equal(Tabs.make().toMeta().type, 'tabs')
  })

  it('tab() adds a tab', () => {
    const tabs = Tabs.make().tab('General', TextField.make('name'))
    const meta = tabs.toMeta()
    assert.equal(meta.tabs.length, 1)
    assert.equal(meta.tabs[0]?.label, 'General')
    assert.equal(meta.tabs[0]?.fields.length, 1)
    assert.equal(meta.tabs[0]?.fields[0]?.name, 'name')
  })

  it('multiple tabs work', () => {
    const tabs = Tabs.make()
      .tab('General', TextField.make('name'))
      .tab('Settings', BooleanField.make('active'))
    const meta = tabs.toMeta()
    assert.equal(meta.tabs.length, 2)
    assert.equal(meta.tabs[1]?.label, 'Settings')
  })

  it('getFields() flattens all tab fields', () => {
    const name   = TextField.make('name')
    const active = BooleanField.make('active')
    const tabs   = Tabs.make().tab('A', name).tab('B', active)
    assert.deepEqual(tabs.getFields(), [name, active])
  })

  it('empty tabs returns empty getFields()', () => {
    assert.deepEqual(Tabs.make().getFields(), [])
  })
})

// ─── Tabs enhancements ──────────────────────────────────────

describe('Tabs enhancements', () => {
  it('fromModel() sets model', () => {
    const t = Tabs.make('x').fromModel(MockModel as any)
    assert.equal(t.getModel(), MockModel)
    assert.equal(t.isModelBacked(), true)
  })

  it('fromResource() sets model from resource', () => {
    const t = Tabs.make('x').fromResource(MockResource as any)
    assert.equal(t.getModel(), MockModel)
    assert.equal(t.getResourceClass(), MockResource)
    assert.equal(t.isModelBacked(), true)
  })

  it('title() stores title field', () => {
    const t = Tabs.make('x').title('label')
    assert.equal(t.getTitleField(), 'label')
  })

  it('title defaults to name', () => {
    assert.equal(Tabs.make('x').getTitleField(), 'name')
  })

  it('scope() stores scope function', () => {
    const fn = (q: unknown) => q
    const t = Tabs.make('x').scope(fn)
    assert.equal(t.getScope(), fn)
  })

  it('content() stores content function', () => {
    const fn = () => []
    const t = Tabs.make('x').content(fn)
    assert.equal(t.getContentFn(), fn)
  })

  it('creatable() sets flag', () => {
    const t = Tabs.make('x').creatable()
    assert.equal(t.isCreatable(), true)
  })

  it('editable() sets flag', () => {
    const t = Tabs.make('x').editable()
    assert.equal(t.isEditable(), true)
  })

  it('lazy() sets flag', () => {
    const t = Tabs.make('x').lazy()
    assert.equal(t.isLazy(), true)
  })

  it('poll() stores interval', () => {
    const t = Tabs.make('x').poll(5000)
    assert.equal(t.getPollInterval(), 5000)
  })

  it('isModelBacked() returns false when no model set', () => {
    assert.equal(Tabs.make('x').isModelBacked(), false)
  })

  it('toMeta() includes modelBacked when model set', () => {
    const meta = Tabs.make('x').fromModel(MockModel as any).toMeta()
    assert.equal(meta.modelBacked, true)
  })

  it('toMeta() includes creatable/editable when set', () => {
    const meta = Tabs.make('x').creatable().editable().toMeta()
    assert.equal(meta.creatable, true)
    assert.equal(meta.editable, true)
  })

  it('toMeta() includes lazy/pollInterval when set', () => {
    const meta = Tabs.make('x').lazy().poll(3000).toMeta()
    assert.equal(meta.lazy, true)
    assert.equal(meta.pollInterval, 3000)
  })

  it('toMeta() omits optional fields when not set', () => {
    const meta = Tabs.make().toMeta()
    assert.equal(meta.creatable, undefined)
    assert.equal(meta.editable, undefined)
    assert.equal(meta.lazy, undefined)
    assert.equal(meta.pollInterval, undefined)
    assert.equal(meta.modelBacked, undefined)
  })

  it('getId() returns id when set', () => {
    assert.equal(Tabs.make('my-tabs').getId(), 'my-tabs')
  })

  it('getId() returns undefined when not set', () => {
    assert.equal(Tabs.make().getId(), undefined)
  })
})

// ─── Tab (schema tab) ──────────────────────────────────────

describe('Tab (schema tab)', () => {
  it('make creates with label', () => {
    const t = Tab.make('Overview')
    assert.equal(t.getLabel(), 'Overview')
  })

  it('schema sets items', () => {
    const items = [{ getType: () => 'text' }]
    const t = Tab.make('Test').schema(items)
    assert.equal(t.getItems().length, 1)
  })

  it('icon sets icon name', () => {
    const t = Tab.make('Test').icon('home')
    assert.equal(t.getIcon(), 'home')
  })

  it('badge with static value', () => {
    const t = Tab.make('Test').badge(42)
    assert.equal(t.getBadge(), 42)
  })

  it('badge with async function', async () => {
    const t = Tab.make('Test').badge(async () => 99)
    const resolved = await t.resolveBadge()
    assert.equal(resolved, 99)
  })

  it('lazy sets flag', () => {
    const t = Tab.make('Test').lazy()
    assert.equal(t.isLazy(), true)
  })

  it('defaults: no icon, no badge, not lazy', () => {
    const t = Tab.make('Test')
    assert.equal(t.getIcon(), undefined)
    assert.equal(t.getBadge(), undefined)
    assert.equal(t.isLazy(), false)
  })

  it('toMeta includes icon and lazy when set', () => {
    const meta = Tab.make('Test').icon('star').lazy().toMeta()
    assert.equal(meta.icon, 'star')
    assert.equal(meta.lazy, true)
  })

  it('toMeta omits icon and lazy when not set', () => {
    const meta = Tab.make('Test').toMeta()
    assert.equal(meta.icon, undefined)
    assert.equal(meta.lazy, undefined)
  })

  it('hasFields returns false for schema elements', () => {
    const t = Tab.make('Test').schema([{ getType: () => 'chart' }])
    assert.equal(t.hasFields(), false)
  })
})

// ─── Tabs with Tab array ───────────────────────────────────

describe('Tabs with Tab array', () => {
  it('accepts Tab array in constructor', () => {
    const tabs = Tabs.make('my-tabs', [
      Tab.make('A').schema([]),
      Tab.make('B').schema([]),
    ])
    assert.equal(tabs.getTabs().length, 2)
    assert.equal(tabs.getTabs()[0]?.getLabel(), 'A')
  })

  it('.tab() shorthand still works', () => {
    const tabs = Tabs.make().tab('A').tab('B')
    assert.equal(tabs.getTabs().length, 2)
  })

  it('persist defaults to false', () => {
    const tabs = Tabs.make('test')
    assert.equal(tabs.getPersist(), false)
  })

  it('persist(session) sets mode', () => {
    const tabs = Tabs.make('test').persist('session')
    assert.equal(tabs.getPersist(), 'session')
  })

  it('toMeta includes persist when not false', () => {
    const meta = Tabs.make('test').persist('url').toMeta()
    assert.equal(meta.persist, 'url')
  })

  it('toMeta omits persist when false', () => {
    const meta = Tabs.make('test').toMeta()
    assert.equal(meta.persist, undefined)
  })
})

// ─── ListTab ───────────────────────────────────────────────

describe('ListTab', () => {
  it('make creates with name', () => {
    const t = ListTab.make('published')
    assert.equal(t.getName(), 'published')
  })

  it('label auto-capitalizes', () => {
    const t = ListTab.make('published')
    assert.equal(t.getLabel(), 'Published')
  })

  it('label can be overridden', () => {
    const t = ListTab.make('published').label('All Published')
    assert.equal(t.getLabel(), 'All Published')
  })

  it('icon sets icon', () => {
    const t = ListTab.make('test').icon('check')
    const meta = t.toMeta()
    assert.equal(meta.icon, 'check')
  })

  it('query stores function', () => {
    const fn = (q: any) => q
    const t = ListTab.make('test').query(fn)
    assert.equal(t.getQueryFn(), fn)
  })
})

// ─── Tab scope ──────────────────────────────────────────────

describe('Tab scope', () => {
  it('scope() stores function', () => {
    const fn = (q: unknown) => q
    const t = Tab.make('Published').scope(fn)
    assert.equal(t.getScope(), fn)
  })

  it('getScope() returns undefined by default', () => {
    assert.equal(Tab.make('All').getScope(), undefined)
  })
})

// ─── Tabs fromArray ──────────────────────────────────────────

describe('Tabs fromArray', () => {
  it('fromArray stores static data', () => {
    const data = [{ id: '1', name: 'A' }]
    const t = Tabs.make('test').fromArray(data)
    assert.equal(t.isArrayBacked(), true)
    assert.equal(t.isDynamic(), true)
    assert.deepEqual(t.getDataSource(), data)
  })

  it('fromArray stores async function', () => {
    const fn = async () => [{ id: '1', name: 'A' }]
    const t = Tabs.make('test').fromArray(fn)
    assert.equal(t.isArrayBacked(), true)
    assert.equal(typeof t.getDataSource(), 'function')
  })

  it('isArrayBacked false by default', () => {
    assert.equal(Tabs.make('test').isArrayBacked(), false)
  })

  it('isDynamic true for model-backed', () => {
    const MockModel2 = { query: () => ({}) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = Tabs.make('test').fromModel(MockModel2 as any)
    assert.equal(t.isDynamic(), true)
    assert.equal(t.isModelBacked(), true)
    assert.equal(t.isArrayBacked(), false)
  })

  it('isDynamic false for static tabs', () => {
    assert.equal(Tabs.make('test').isDynamic(), false)
  })

  it('title and content work with fromArray', () => {
    const t = Tabs.make('test')
      .fromArray([{ id: '1', name: 'A' }])
      .title('name')
      .content(() => [])
    assert.equal(t.getTitleField(), 'name')
    assert.ok(t.getContentFn())
  })
})
