
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Table2 }       from '../schema/Table2.js'
import { Column }       from '../schema/Column.js'
import { SelectFilter } from '../schema/Filter.js'
import { Action }       from '../schema/Action.js'
import { ViewMode }     from '../schema/ViewMode.js'

// ─── Mock classes ──────────────────────────────────────────

class MockModel {
  static query() { return { get: async () => [], count: async () => 0 } }
}

// ─── Table2 (extends List) ─────────────────────────────────

describe('Table2', () => {
  it('type is table', () => {
    assert.equal(Table2.make('Recent Posts').getType(), 'table')
  })

  it('getConfig returns title', () => {
    const c = Table2.make('Recent Posts').getConfig()
    assert.equal(c.title, 'Recent Posts')
  })

  it('defaults: limit 5, sortDir DESC, no resource', () => {
    const c = Table2.make('T').getConfig()
    assert.equal(c.limit, 5)
    assert.equal(c.sortDir, 'DESC')
    assert.equal(c.resourceClass, undefined)
    assert.equal(c.model, undefined)
  })

  it('fromResource() stores resourceClass and model', () => {
    class FakeModel { static query() { return {} } }
    class FakeResource { static model = FakeModel; static getSlug() { return 'fakes' } }
    const c = Table2.make('T').fromResource(FakeResource as any).columns(['name']).getConfig()
    assert.equal(c.resourceClass, FakeResource)
    assert.equal(c.model, FakeModel)
    assert.deepEqual(c.columns, ['name'])
  })

  it('fromModel() stores model only', () => {
    class FakeModel { static query() { return {} } }
    const c = Table2.make('T').fromModel(FakeModel as any).getConfig()
    assert.equal(c.model, FakeModel)
    assert.equal(c.resourceClass, undefined)
  })

  it('reorderable() sets flag and field', () => {
    const c = Table2.make('T').reorderable('order').getConfig()
    assert.equal(c.reorderable, true)
    assert.equal(c.reorderField, 'order')
  })

  it('sets limit', () => {
    const c = Table2.make('T').limit(10).getConfig()
    assert.equal(c.limit, 10)
  })

  it('sets sortBy and sortDir', () => {
    const c = Table2.make('T').sortBy('createdAt', 'ASC').getConfig()
    assert.equal(c.sortBy, 'createdAt')
    assert.equal(c.sortDir, 'ASC')
  })
})

// ─── Table2 enhancements (inherited from List) ──────────────

describe('Table2 enhancements', () => {
  it('fromArray() stores static data in config', () => {
    const data = [{ name: 'Chrome', share: 65 }, { name: 'Firefox', share: 10 }]
    const c = Table2.make('Browsers').fromArray(data).getConfig()
    assert.deepEqual(c.rows, data)
  })

  it('fromArray() stores async function in config', () => {
    const fn = async () => [{ name: 'Chrome' }]
    const c = Table2.make('Test').fromArray(fn).getConfig()
    assert.equal(typeof c.rows, 'function')
  })

  it('scope() stores scope function', () => {
    const fn = (q: unknown) => q
    const c = Table2.make('T').scope(fn).getConfig()
    assert.equal(c.scope, fn)
  })

  it('description() stored in config', () => {
    const c = Table2.make('T').description('A table').getConfig()
    assert.equal(c.description, 'A table')
  })

  it('emptyMessage() stored in config', () => {
    const c = Table2.make('T').emptyMessage('Nothing here').getConfig()
    assert.equal(c.emptyMessage, 'Nothing here')
  })

  it('href() stored in config', () => {
    const c = Table2.make('T').href('/all-posts').getConfig()
    assert.equal(c.href, '/all-posts')
  })

  it('searchable() with no args sets searchable=true', () => {
    const c = Table2.make('T').searchable().getConfig()
    assert.equal(c.searchable, true)
    assert.equal(c.searchColumns, undefined)
  })

  it('searchable(columns) stores specific columns', () => {
    const c = Table2.make('T').searchable(['name', 'email']).getConfig()
    assert.equal(c.searchable, true)
    assert.deepEqual(c.searchColumns, ['name', 'email'])
  })

  it('paginated() defaults to pages mode with perPage=15', () => {
    const c = Table2.make('T').paginated().getConfig()
    assert.equal(c.paginationType, 'pages')
    assert.equal(c.perPage, 15)
  })

  it('paginated(loadMore, 10) stores mode and perPage', () => {
    const c = Table2.make('T').paginated('loadMore', 10).getConfig()
    assert.equal(c.paginationType, 'loadMore')
    assert.equal(c.perPage, 10)
  })

  it('lazy() sets lazy=true', () => {
    const t = Table2.make('T').lazy()
    assert.equal(t.isLazy(), true)
    assert.equal(t.getConfig().lazy, true)
  })

  it('poll() stores poll interval', () => {
    const t = Table2.make('T').poll(5000)
    assert.equal(t.getPollInterval(), 5000)
    assert.equal(t.getConfig().pollInterval, 5000)
  })

  it('id() stores custom ID', () => {
    const t = Table2.make('T').id('my-table')
    assert.equal(t.getId(), 'my-table')
    assert.equal(t.getConfig().id, 'my-table')
  })

  it('getId() auto-generates from title when not set', () => {
    assert.equal(Table2.make('Recent Posts').getId(), 'recent-posts')
    assert.equal(Table2.make('All Users').getId(), 'all-users')
  })

  it('filters() stores filters', () => {
    const f = SelectFilter.make('status')
    const t = Table2.make('T').filters([f])
    assert.deepEqual(t.getFilters(), [f])
    assert.deepEqual(t.getConfig().filters, [f])
  })

  it('actions() stores actions', () => {
    const a = Action.make('delete')
    const t = Table2.make('T').actions([a])
    assert.deepEqual(t.getActions(), [a])
    assert.deepEqual(t.getConfig().actions, [a])
  })

  it('getConfig() returns all fields together', () => {
    const scopeFn = (q: unknown) => q
    const c = Table2.make('Full Table')
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
    // Table-specific
    assert.equal(c.columns.length, 2)
  })
})

// ─── Table2 remember ────────────────────────────────────────

describe('Table2 remember', () => {
  it('defaults to false', () => {
    const t = Table2.make('Test')
    assert.equal(t.getRemember(), false)
  })

  it('remember() defaults to localStorage', () => {
    const t = Table2.make('Test').remember()
    assert.equal(t.getRemember(), 'localStorage')
  })

  it('remember(url) sets url mode', () => {
    const t = Table2.make('Test').remember('url')
    assert.equal(t.getRemember(), 'url')
  })

  it('remember(session) sets session mode', () => {
    const t = Table2.make('Test').remember('session')
    assert.equal(t.getRemember(), 'session')
  })

  it('remember(false) disables', () => {
    const t = Table2.make('Test').remember('url').remember(false)
    assert.equal(t.getRemember(), false)
  })

  it('getConfig includes remember', () => {
    const config = Table2.make('Test').remember('url').getConfig()
    assert.equal(config.remember, 'url')
  })

  it('getConfig remember is undefined when false', () => {
    const config = Table2.make('Test').getConfig()
    assert.equal(config.remember, undefined)
  })
})

// ─── Table2 live ────────────────────────────────────────────

describe('Table2 live', () => {
  it('live() sets flag', () => {
    const t = Table2.make('Test').live()
    assert.equal(t.isLive(), true)
  })

  it('defaults to not live', () => {
    assert.equal(Table2.make('Test').isLive(), false)
  })

  it('live in getConfig()', () => {
    assert.equal(Table2.make('Test').live().getConfig().live, true)
  })
})

// ─── Table2 onSave ──────────────────────────────────────────

describe('Table2 onSave', () => {
  it('onSave(fn) stores handler', () => {
    const fn = async () => {}
    const t = Table2.make('T').onSave(fn)
    assert.equal(t.getOnSave(), fn)
  })

  it('getConfig includes onSave', () => {
    const fn = async () => {}
    const c = Table2.make('T').onSave(fn).getConfig()
    assert.equal(c.onSave, fn)
  })

  it('getOnSave returns undefined by default', () => {
    assert.equal(Table2.make('T').getOnSave(), undefined)
  })
})

// ─── Table2 scopes (replaces tabs) ──────────────────────────

describe('Table2 scopes', () => {
  it('scopes() stores preset array', () => {
    const c = Table2.make('T').scopes([
      { label: 'All' },
      { label: 'Published', scope: (q: any) => q.where('status', 'published') },
    ]).getConfig()
    assert.equal(c.scopes?.length, 2)
    assert.equal(c.scopes?.[0]?.label, 'All')
  })
})

// ─── Table2 resource methods ────────────────────────────────

describe('Table2 resource methods', () => {
  it('softDeletes() sets flag', () => {
    const c = Table2.make('T').softDeletes().getConfig()
    assert.equal(c.softDeletes, true)
  })

  it('softDeletes(false) unsets flag', () => {
    const c = Table2.make('T').softDeletes(false).getConfig()
    assert.equal(c.softDeletes, false)
  })

  it('titleField() stores field name', () => {
    const c = Table2.make('T').titleField('name').getConfig()
    assert.equal(c.titleField, 'name')
  })

  it('emptyState() stores config', () => {
    const es = { icon: 'inbox', heading: 'No items', description: 'Create one' }
    const c = Table2.make('T').emptyState(es).getConfig()
    assert.deepEqual(c.emptyState, es)
  })

  it('creatable() defaults to true', () => {
    const c = Table2.make('T').creatable().getConfig()
    assert.equal(c.creatableUrl, true)
  })

  it('creatable(url) stores custom URL', () => {
    const c = Table2.make('T').creatable('/admin/posts/create').getConfig()
    assert.equal(c.creatableUrl, '/admin/posts/create')
  })

  it('defaults: no softDeletes, no titleField, no emptyState, no creatable', () => {
    const c = Table2.make('T').getConfig()
    assert.equal(c.softDeletes, false)
    assert.equal(c.titleField, undefined)
    assert.equal(c.emptyState, undefined)
    assert.equal(c.creatableUrl, undefined)
  })
})

// ─── Table2 new List features ───────────────────────────────

describe('Table2 List features', () => {
  it('titleField/descriptionField/imageField', () => {
    const c = Table2.make('T').titleField('name').descriptionField('bio').imageField('avatar').getConfig()
    assert.equal(c.titleField, 'name')
    assert.equal(c.descriptionField, 'bio')
    assert.equal(c.imageField, 'avatar')
  })

  it('groupBy stores field', () => {
    const c = Table2.make('T').groupBy('status').getConfig()
    assert.equal(c.groupBy, 'status')
  })

  it('folder stores parent field', () => {
    const c = Table2.make('T').folder('parentId').getConfig()
    assert.equal(c.folderField, 'parentId')
  })

  it('onRecordClick stores handler', () => {
    const c = Table2.make('T').onRecordClick('edit').getConfig()
    assert.equal(c.onRecordClick, 'edit')
  })

  it('onRecordClick with function', () => {
    const fn = (r: Record<string, unknown>) => `/custom/${r.id}`
    const c = Table2.make('T').onRecordClick(fn).getConfig()
    assert.equal(c.onRecordClick, fn)
  })

  it('exportable() defaults to true', () => {
    const c = Table2.make('T').exportable().getConfig()
    assert.equal(c.exportable, true)
  })

  it('exportable(formats) stores explicit formats', () => {
    const c = Table2.make('T').exportable(['csv', 'json']).getConfig()
    assert.deepEqual(c.exportable, ['csv', 'json'])
  })

  it('views stores view definitions from presets', () => {
    const c = Table2.make('T').views(['list', 'grid']).getConfig()
    assert.equal(c.views.length, 2)
    assert.equal(c.views[0]?.getName(), 'list')
    assert.equal(c.views[1]?.getName(), 'grid')
  })

  it('views stores ViewMode instances', () => {
    const c = Table2.make('T').views([
      ViewMode.list(),
      ViewMode.grid(),
      ViewMode.table([Column.make('name')]),
    ]).getConfig()
    assert.equal(c.views.length, 3)
    assert.equal(c.views[2]?.getType(), 'table')
    assert.equal(c.views[2]?.getColumns()?.length, 1)
  })

  it('views mixes presets and ViewMode instances', () => {
    const c = Table2.make('T').views([
      'list',
      ViewMode.make('cards').icon('credit-card').render(() => []),
    ]).getConfig()
    assert.equal(c.views.length, 2)
    assert.equal(c.views[0]?.getType(), 'list')
    assert.equal(c.views[1]?.getType(), 'custom')
    assert.equal(c.views[1]?.getIcon(), 'credit-card')
  })

  it('defaultView stores breakpoint map', () => {
    const c = Table2.make('T').defaultView({ sm: 'list', lg: 'grid' }).getConfig()
    assert.deepEqual(c.defaultView, { sm: 'list', lg: 'grid' })
  })

  it('render stores function', () => {
    const fn = (r: Record<string, unknown>) => []
    const c = Table2.make('T').render(fn).getConfig()
    assert.equal(c.renderFn, fn)
  })

  it('sortable with string array', () => {
    const c = Table2.make('T').sortable(['title', 'createdAt']).getConfig()
    assert.equal(c.sortableOptions?.length, 2)
    assert.equal(c.sortableOptions?.[0]?.field, 'title')
    assert.equal(c.sortableOptions?.[0]?.label, 'Title')
    assert.equal(c.sortableOptions?.[1]?.field, 'createdAt')
    assert.equal(c.sortableOptions?.[1]?.label, 'Created At')
  })

  it('sortable with custom labels', () => {
    const c = Table2.make('T').sortable([
      { field: 'title', label: 'العنوان' },
      { field: 'date', label: 'التاريخ' },
    ]).getConfig()
    assert.equal(c.sortableOptions?.[0]?.label, 'العنوان')
    assert.equal(c.sortableOptions?.[1]?.label, 'التاريخ')
  })

  it('sortable with mix of strings and objects', () => {
    const c = Table2.make('T').sortable([
      'title',
      { field: 'createdAt', label: 'Date Created' },
    ]).getConfig()
    assert.equal(c.sortableOptions?.[0]?.label, 'Title')
    assert.equal(c.sortableOptions?.[1]?.label, 'Date Created')
  })

  it('scopes stores preset array', () => {
    const scopeFn = (q: any) => q.where('status', 'published')
    const c = Table2.make('T').scopes([
      { label: 'All' },
      { label: 'Published', icon: 'circle-check', scope: scopeFn },
      { label: 'Drafts', icon: 'pencil-line', scope: (q: any) => q.where('status', 'draft') },
    ]).getConfig()
    assert.equal(c.scopes?.length, 3)
    assert.equal(c.scopes?.[0]?.label, 'All')
    assert.equal(c.scopes?.[0]?.scope, undefined)
    assert.equal(c.scopes?.[1]?.label, 'Published')
    assert.equal(c.scopes?.[1]?.icon, 'circle-check')
    assert.equal(c.scopes?.[1]?.scope, scopeFn)
  })

  it('scope() and scopes() work together', () => {
    const baseFn = (q: any) => q.where('tenant', '1')
    const presetFn = (q: any) => q.where('featured', true)
    const c = Table2.make('T')
      .scope(baseFn)
      .scopes([
        { label: 'All' },
        { label: 'Featured', scope: presetFn },
      ])
      .getConfig()
    assert.equal(c.scope, baseFn)
    assert.equal(c.scopes?.length, 2)
    assert.equal(c.scopes?.[1]?.scope, presetFn)
  })
})

// ─── Table2 _cloneWithScope ─────────────────────────────────

describe('Table2 _cloneWithScope', () => {
  it('clones all List + Table fields', () => {
    const scopeFn = (q: any) => q.where('active', true)
    const original = Table2.make('T')
      .fromModel(MockModel as any)
      .columns([Column.make('name')])
      .limit(10)
      .sortBy('name', 'ASC')
      .searchable(['name'])
      .paginated('pages', 20)
      .remember('session')
      .softDeletes()
      .titleField('name')
      .groupBy('status')
      .exportable(['csv'])

    const clone = original._cloneWithScope('clone-id', scopeFn)
    const c = clone.getConfig()

    assert.equal(c.id, 'clone-id')
    assert.equal(c.model, MockModel)
    assert.equal(c.limit, 10)
    assert.equal(c.sortBy, 'name')
    assert.equal(c.searchable, true)
    assert.equal(c.paginationType, 'pages')
    assert.equal(c.perPage, 20)
    assert.equal(c.remember, 'session')
    assert.equal(c.softDeletes, true)
    assert.equal(c.titleField, 'name')
    assert.equal(c.groupBy, 'status')
    assert.deepEqual(c.exportable, ['csv'])
    assert.equal(c.columns.length, 1)
    assert.equal(c.scope, scopeFn)
    // Clone preserves config
    assert.equal(c.reorderable, false)
  })
})
