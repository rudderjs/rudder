
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Table }        from '../schema/Table.js'
import { Column }       from '../schema/Column.js'
import { SelectFilter } from '../schema/Filter.js'
import { Action }       from '../schema/Action.js'
import { Tab }          from '../schema/Tabs.js'
import { ListTab }      from '../schema/Tab.js'

// ─── Mock classes ──────────────────────────────────────────

class MockModel {
  static query() { return { get: async () => [], count: async () => 0 } }
}

// ─── Table ────────────────────────────────────────────────────

describe('Table', () => {
  it('type is table', () => {
    assert.equal(Table.make('Recent Posts').getType(), 'table')
  })

  it('getConfig returns title', () => {
    const c = Table.make('Recent Posts').getConfig()
    assert.equal(c.title, 'Recent Posts')
  })

  it('defaults: limit 5, sortDir DESC, no resource', () => {
    const c = Table.make('T').getConfig()
    assert.equal(c.limit, 5)
    assert.equal(c.sortDir, 'DESC')
    assert.equal(c.resourceClass, undefined)
    assert.equal(c.model, undefined)
  })

  it('fromResource() stores resourceClass and model', () => {
    class FakeModel { static query() { return {} } }
    class FakeResource { static model = FakeModel; static getSlug() { return 'fakes' } }
    const c = Table.make('T').fromResource(FakeResource as any).columns(['name']).getConfig()
    assert.equal(c.resourceClass, FakeResource)
    assert.equal(c.model, FakeModel)
    assert.deepEqual(c.columns, ['name'])
  })

  it('fromModel() stores model only', () => {
    class FakeModel { static query() { return {} } }
    const c = Table.make('T').fromModel(FakeModel as any).getConfig()
    assert.equal(c.model, FakeModel)
    assert.equal(c.resourceClass, undefined)
  })

  it('reorderable() sets flag and field', () => {
    const c = Table.make('T').reorderable('order').getConfig()
    assert.equal(c.reorderable, true)
    assert.equal(c.reorderField, 'order')
  })

  it('sets limit', () => {
    const c = Table.make('T').limit(10).getConfig()
    assert.equal(c.limit, 10)
  })

  it('sets sortBy and sortDir', () => {
    const c = Table.make('T').sortBy('createdAt', 'ASC').getConfig()
    assert.equal(c.sortBy, 'createdAt')
    assert.equal(c.sortDir, 'ASC')
  })
})

// ─── Table enhancements ──────────────────────────────────────

describe('Table enhancements', () => {
  it('fromArray() stores static data in config', () => {
    const data = [{ name: 'Chrome', share: 65 }, { name: 'Firefox', share: 10 }]
    const c = Table.make('Browsers').fromArray(data).getConfig()
    assert.deepEqual(c.rows, data)
  })

  it('fromArray() stores async function in config', () => {
    const fn = async () => [{ name: 'Chrome' }]
    const c = Table.make('Test').fromArray(fn).getConfig()
    assert.equal(typeof c.rows, 'function')
  })

  it('scope() stores scope function', () => {
    const fn = (q: unknown) => q
    const c = Table.make('T').scope(fn).getConfig()
    assert.equal(c.scope, fn)
  })

  it('description() stored in config', () => {
    const c = Table.make('T').description('A table').getConfig()
    assert.equal(c.description, 'A table')
  })

  it('emptyMessage() stored in config', () => {
    const c = Table.make('T').emptyMessage('Nothing here').getConfig()
    assert.equal(c.emptyMessage, 'Nothing here')
  })

  it('href() stored in config', () => {
    const c = Table.make('T').href('/all-posts').getConfig()
    assert.equal(c.href, '/all-posts')
  })

  it('searchable() with no args sets searchable=true', () => {
    const c = Table.make('T').searchable().getConfig()
    assert.equal(c.searchable, true)
    assert.equal(c.searchColumns, undefined)
  })

  it('searchable(columns) stores specific columns', () => {
    const c = Table.make('T').searchable(['name', 'email']).getConfig()
    assert.equal(c.searchable, true)
    assert.deepEqual(c.searchColumns, ['name', 'email'])
  })

  it('paginated() defaults to pages mode with perPage=15', () => {
    const c = Table.make('T').paginated().getConfig()
    assert.equal(c.paginationType, 'pages')
    assert.equal(c.perPage, 15)
  })

  it('paginated(loadMore, 10) stores mode and perPage', () => {
    const c = Table.make('T').paginated('loadMore', 10).getConfig()
    assert.equal(c.paginationType, 'loadMore')
    assert.equal(c.perPage, 10)
  })

  it('lazy() sets lazy=true', () => {
    const t = Table.make('T').lazy()
    assert.equal(t.isLazy(), true)
    assert.equal(t.getConfig().lazy, true)
  })

  it('poll() stores poll interval', () => {
    const t = Table.make('T').poll(5000)
    assert.equal(t.getPollInterval(), 5000)
    assert.equal(t.getConfig().pollInterval, 5000)
  })

  it('id() stores custom ID', () => {
    const t = Table.make('T').id('my-table')
    assert.equal(t.getId(), 'my-table')
    assert.equal(t.getConfig().id, 'my-table')
  })

  it('getId() auto-generates from title when not set', () => {
    assert.equal(Table.make('Recent Posts').getId(), 'recent-posts')
    assert.equal(Table.make('All Users').getId(), 'all-users')
  })

  it('filters() stores filters', () => {
    const f = SelectFilter.make('status')
    const t = Table.make('T').filters([f])
    assert.deepEqual(t.getFilters(), [f])
    assert.deepEqual(t.getConfig().filters, [f])
  })

  it('actions() stores actions', () => {
    const a = Action.make('delete')
    const t = Table.make('T').actions([a])
    assert.deepEqual(t.getActions(), [a])
    assert.deepEqual(t.getConfig().actions, [a])
  })

  it('getConfig() returns all fields together', () => {
    const scopeFn = (q: unknown) => q
    const c = Table.make('Full Table')
      .fromModel(MockModel as any)
      .columns([Column.make('name'), Column.make('email')])
      .limit(20)
      .sortBy('name', 'ASC')
      .scope(scopeFn)
      .description('desc')
      .emptyMessage('empty')
      .href('/full')
      .searchable(['name'])
      .paginated('loadMore', 25)
      .lazy()
      .poll(3000)
      .id('full-tbl')
      .getConfig()

    assert.equal(c.title, 'Full Table')
    assert.equal(c.model, MockModel)
    assert.equal(c.limit, 20)
    assert.equal(c.sortBy, 'name')
    assert.equal(c.sortDir, 'ASC')
    assert.equal(c.scope, scopeFn)
    assert.equal(c.description, 'desc')
    assert.equal(c.emptyMessage, 'empty')
    assert.equal(c.href, '/full')
    assert.equal(c.searchable, true)
    assert.deepEqual(c.searchColumns, ['name'])
    assert.equal(c.paginationType, 'loadMore')
    assert.equal(c.perPage, 25)
    assert.equal(c.lazy, true)
    assert.equal(c.pollInterval, 3000)
    assert.equal(c.id, 'full-tbl')
  })
})

// ─── Table remember ────────────────────────────────────────

describe('Table remember', () => {
  it('defaults to false', () => {
    const t = Table.make('Test')
    assert.equal(t.getRemember(), false)
  })

  it('remember() defaults to localStorage', () => {
    const t = Table.make('Test').remember()
    assert.equal(t.getRemember(), 'localStorage')
  })

  it('remember(url) sets url mode', () => {
    const t = Table.make('Test').remember('url')
    assert.equal(t.getRemember(), 'url')
  })

  it('remember(session) sets session mode', () => {
    const t = Table.make('Test').remember('session')
    assert.equal(t.getRemember(), 'session')
  })

  it('remember(false) disables', () => {
    const t = Table.make('Test').remember('url').remember(false)
    assert.equal(t.getRemember(), false)
  })

  it('getConfig includes remember', () => {
    const config = Table.make('Test').remember('url').getConfig()
    assert.equal(config.remember, 'url')
  })

  it('getConfig remember is undefined when false', () => {
    const config = Table.make('Test').getConfig()
    assert.equal(config.remember, undefined)
  })
})

// ─── Table live ────────────────────────────────────────────────────

describe('Table live', () => {
  it('live() sets flag', () => {
    const t = Table.make('Test').live()
    assert.equal(t.isLive(), true)
  })

  it('defaults to not live', () => {
    assert.equal(Table.make('Test').isLive(), false)
  })

  it('live in getConfig()', () => {
    assert.equal(Table.make('Test').live().getConfig().live, true)
  })
})

// ─── Column editable ────────────────────────────────────────────────

describe('Column editable', () => {
  it('editable() sets editable with default inline mode', () => {
    const col = Column.make('name').editable()
    assert.equal(col.isEditable(), true)
    assert.equal(col.getEditMode(), undefined) // resolved in toMeta
  })

  it('editable("popover") forces popover mode', () => {
    const col = Column.make('name').editable('popover')
    assert.equal(col.isEditable(), true)
    assert.equal(col.getEditMode(), 'popover')
  })

  it('editable(field) sets custom field with auto mode', () => {
    const fakeField = { getType: () => 'textarea', toMeta: () => ({ name: 'bio', type: 'textarea', label: 'Bio', required: false, readonly: false, sortable: false, searchable: false, hidden: [], extra: {} }) }
    const col = Column.make('bio').editable(fakeField as any)
    assert.equal(col.isEditable(), true)
    assert.equal(col.getEditField(), fakeField)
    assert.equal(col.getEditMode(), undefined) // resolved in toMeta
  })

  it('editable(field, "modal") sets custom field + forced mode', () => {
    const fakeField = { getType: () => 'text', toMeta: () => ({ name: 'x', type: 'text', label: '', required: false, readonly: false, sortable: false, searchable: false, hidden: [], extra: {} }) }
    const col = Column.make('x').editable(fakeField as any, 'modal')
    assert.equal(col.isEditable(), true)
    assert.equal(col.getEditField(), fakeField)
    assert.equal(col.getEditMode(), 'modal')
  })

  it('editable().onSave(fn) stores handler', () => {
    const fn = async () => {}
    const col = Column.make('name').editable().onSave(fn)
    assert.equal(col.getOnSaveFn(), fn)
  })

  it('toMeta() includes editable properties', () => {
    const meta = Column.make('name').editable().toMeta()
    assert.equal(meta.editable, true)
    assert.equal(meta.editMode, 'inline')
    assert.ok(meta.editField)
    assert.equal(meta.editField!.name, 'name')
    assert.equal(meta.editField!.type, 'text')
  })

  it('toMeta() excludes editable when not set', () => {
    const meta = Column.make('name').toMeta()
    assert.equal(meta.editable, undefined)
    assert.equal(meta.editMode, undefined)
    assert.equal(meta.editField, undefined)
  })

  it('edit mode auto-detection: textarea → popover', () => {
    const fakeField = { getType: () => 'textarea', toMeta: () => ({ name: 'bio', type: 'textarea', label: '', required: false, readonly: false, sortable: false, searchable: false, hidden: [], extra: {} }) }
    const meta = Column.make('bio').editable(fakeField as any).toMeta()
    assert.equal(meta.editMode, 'popover')
  })

  it('edit mode auto-detection: select → inline', () => {
    const fakeField = { getType: () => 'select', toMeta: () => ({ name: 'status', type: 'select', label: '', required: false, readonly: false, sortable: false, searchable: false, hidden: [], extra: {} }) }
    const meta = Column.make('status').editable(fakeField as any).toMeta()
    assert.equal(meta.editMode, 'inline')
  })

  it('edit mode auto-detection: richcontent → modal', () => {
    const fakeField = { getType: () => 'richcontent', toMeta: () => ({ name: 'body', type: 'richcontent', label: '', required: false, readonly: false, sortable: false, searchable: false, hidden: [], extra: {} }) }
    const meta = Column.make('body').editable(fakeField as any).toMeta()
    assert.equal(meta.editMode, 'modal')
  })

  it('default editField for numeric column', () => {
    const meta = Column.make('price').numeric().editable().toMeta()
    assert.equal(meta.editField!.type, 'number')
  })

  it('default editField for boolean column', () => {
    const meta = Column.make('active').boolean().editable().toMeta()
    assert.equal(meta.editField!.type, 'toggle')
  })

  it('default editField for date column', () => {
    const meta = Column.make('createdAt').date().editable().toMeta()
    assert.equal(meta.editField!.type, 'date')
  })
})

// ─── Table onSave ────────────────────────────────────────────────

describe('Table onSave', () => {
  it('onSave(fn) stores handler', () => {
    const fn = async () => {}
    const t = Table.make('T').onSave(fn)
    assert.equal(t.getOnSave(), fn)
  })

  it('getConfig includes onSave', () => {
    const fn = async () => {}
    const c = Table.make('T').onSave(fn).getConfig()
    assert.equal(c.onSave, fn)
  })

  it('getOnSave returns undefined by default', () => {
    assert.equal(Table.make('T').getOnSave(), undefined)
  })
})

// ─── Column compute/display ────────────────────────────────────────

describe('Column compute/display', () => {
  it('compute stores function', () => {
    const fn = (r: Record<string, unknown>) => r.title
    const col = Column.make('x').compute(fn)
    assert.equal(col.getComputeFn(), fn)
  })

  it('display stores function', () => {
    const fn = (v: unknown) => `$${v}`
    const col = Column.make('x').display(fn)
    assert.equal(col.getDisplayFn(), fn)
  })

  it('compute not set by default', () => {
    assert.equal(Column.make('x').getComputeFn(), undefined)
  })

  it('display not set by default', () => {
    assert.equal(Column.make('x').getDisplayFn(), undefined)
  })
})

// ─── Table tabs ─────────────────────────────────────────────

describe('Table tabs', () => {
  it('tabs() stores Tab array', () => {
    const tabs = [Tab.make('All'), Tab.make('Published').scope((q: any) => q)]
    const t = Table.make('T').tabs(tabs)
    assert.equal(t.getTabs().length, 2)
    assert.equal(t.getTabs()[0]?.getLabel(), 'All')
  })

  it('getTabs() defaults to empty', () => {
    assert.deepEqual(Table.make('T').getTabs(), [])
  })

  it('getConfig includes tabs', () => {
    const tabs = [Tab.make('All')]
    const c = Table.make('T').tabs(tabs).getConfig()
    assert.equal(c.tabs.length, 1)
  })

  it('listTabs() stores ListTab array', () => {
    const tabs = [ListTab.make('all'), ListTab.make('active')]
    const t = Table.make('T').listTabs(tabs)
    assert.equal(t.getListTabs().length, 2)
  })
})

// ─── Table resource methods ─────────────────────────────────

describe('Table resource methods', () => {
  it('softDeletes() sets flag', () => {
    const c = Table.make('T').softDeletes().getConfig()
    assert.equal(c.softDeletes, true)
  })

  it('softDeletes(false) unsets flag', () => {
    const c = Table.make('T').softDeletes(false).getConfig()
    assert.equal(c.softDeletes, false)
  })

  it('titleField() stores field name', () => {
    const c = Table.make('T').titleField('name').getConfig()
    assert.equal(c.titleField, 'name')
  })

  it('emptyState() stores config', () => {
    const es = { icon: 'inbox', heading: 'No items', description: 'Create one' }
    const c = Table.make('T').emptyState(es).getConfig()
    assert.deepEqual(c.emptyState, es)
  })

  it('creatable() defaults to true', () => {
    const c = Table.make('T').creatable().getConfig()
    assert.equal(c.creatableUrl, true)
  })

  it('creatable(url) stores custom URL', () => {
    const c = Table.make('T').creatable('/admin/posts/create').getConfig()
    assert.equal(c.creatableUrl, '/admin/posts/create')
  })

  it('defaults: no softDeletes, no titleField, no emptyState, no creatable', () => {
    const c = Table.make('T').getConfig()
    assert.equal(c.softDeletes, false)
    assert.equal(c.titleField, undefined)
    assert.equal(c.emptyState, undefined)
    assert.equal(c.creatableUrl, undefined)
  })
})
