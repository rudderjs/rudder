import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Panel } from './Panel.js'
import { Page } from './Page.js'
import { Resource } from './Resource.js'
import { Field } from './Field.js'
import { Filter, SelectFilter, SearchFilter } from './Filter.js'
import { Action } from './Action.js'
import { PanelRegistry } from './PanelRegistry.js'
import { TextField } from './fields/TextField.js'
import { EmailField } from './fields/EmailField.js'
import { NumberField } from './fields/NumberField.js'
import { TextareaField } from './fields/TextareaField.js'
import { SelectField } from './fields/SelectField.js'
import { BooleanField } from './fields/BooleanField.js'
import { DateField } from './fields/DateField.js'
import { RelationField } from './fields/RelationField.js'

// ─── Helpers ────────────────────────────────────────────────

function makeResource(name = 'Post', fields: Field[] = []) {
  class R extends Resource {
    static label = name + 's'
    fields() { return fields }
  }
  Object.defineProperty(R, 'name', { value: name + 'Resource' })
  return R
}

// ─── Field ──────────────────────────────────────────────────

describe('Field', () => {
  it('auto-labels from camelCase name', () => {
    const f = TextField.make('firstName')
    assert.equal(f.getLabel(), 'First Name')
  })

  it('respects explicit label', () => {
    const f = TextField.make('n').label('Custom Label')
    assert.equal(f.getLabel(), 'Custom Label')
  })

  it('required defaults to false', () => {
    assert.equal(TextField.make('x').isRequired(), false)
  })

  it('required() sets to true', () => {
    assert.equal(TextField.make('x').required().isRequired(), true)
  })

  it('readonly() hides from create and edit', () => {
    const f = TextField.make('x').readonly()
    assert.equal(f.isReadonly(), true)
    assert.equal(f.isHiddenFrom('create'), true)
    assert.equal(f.isHiddenFrom('edit'), true)
    assert.equal(f.isHiddenFrom('table'), false)
  })

  it('sortable() sets flag', () => {
    assert.equal(TextField.make('x').sortable().isSortable(), true)
  })

  it('searchable() sets flag', () => {
    assert.equal(TextField.make('x').searchable().isSearchable(), true)
  })

  it('hideFrom() adds to hidden set', () => {
    const f = TextField.make('x').hideFrom('table', 'create')
    assert.equal(f.isHiddenFrom('table'), true)
    assert.equal(f.isHiddenFrom('create'), true)
    assert.equal(f.isHiddenFrom('edit'), false)
  })

  it('hideFromTable/Create/Edit() shortcuts work', () => {
    const f = TextField.make('x').hideFromTable().hideFromCreate().hideFromEdit()
    assert.equal(f.isHiddenFrom('table'), true)
    assert.equal(f.isHiddenFrom('create'), true)
    assert.equal(f.isHiddenFrom('edit'), true)
  })

  it('toMeta() returns correct shape', () => {
    const meta = TextField.make('title').required().sortable().toMeta()
    assert.equal(meta.name, 'title')
    assert.equal(meta.type, 'text')
    assert.equal(meta.label, 'Title')
    assert.equal(meta.required, true)
    assert.equal(meta.sortable, true)
    assert.equal(meta.searchable, false)
    assert.deepEqual(meta.hidden, [])
  })
})

// ─── Field types ────────────────────────────────────────────

describe('TextField', () => {
  it('type is text', () => assert.equal(TextField.make('x').getType(), 'text'))
})

describe('EmailField', () => {
  it('type is email', () => assert.equal(EmailField.make('x').getType(), 'email'))
})

describe('NumberField', () => {
  it('type is number', () => assert.equal(NumberField.make('x').getType(), 'number'))

  it('min/max/step stored in extra', () => {
    const f = NumberField.make('x').min(0).max(100).step(5)
    assert.equal(f.toMeta().extra['min'], 0)
    assert.equal(f.toMeta().extra['max'], 100)
    assert.equal(f.toMeta().extra['step'], 5)
  })
})

describe('TextareaField', () => {
  it('type is textarea', () => assert.equal(TextareaField.make('x').getType(), 'textarea'))

  it('rows stored in extra', () => {
    const f = TextareaField.make('x').rows(8)
    assert.equal(f.toMeta().extra['rows'], 8)
  })
})

describe('BooleanField', () => {
  it('type is boolean', () => assert.equal(BooleanField.make('x').getType(), 'boolean'))
})

describe('DateField', () => {
  it('type is date', () => assert.equal(DateField.make('x').getType(), 'date'))
  it('withTime() → datetime', () => assert.equal(DateField.make('x').withTime().getType(), 'datetime'))
})

describe('SelectField', () => {
  it('type is select', () => assert.equal(SelectField.make('x').getType(), 'select'))
  it('type is multiselect when multiple()', () => assert.equal(SelectField.make('x').multiple().getType(), 'multiselect'))

  it('normalises string options', () => {
    const meta = SelectField.make('role').options(['admin', 'user']).toMeta()
    assert.deepEqual(meta.extra['options'], [
      { label: 'admin', value: 'admin' },
      { label: 'user',  value: 'user' },
    ])
  })

  it('accepts label/value pairs', () => {
    const meta = SelectField.make('role')
      .options([{ label: 'Admin', value: 'admin' }])
      .toMeta()
    assert.deepEqual(meta.extra['options'], [{ label: 'Admin', value: 'admin' }])
  })

  it('default stored in extra', () => {
    const meta = SelectField.make('role').options(['a', 'b']).default('a').toMeta()
    assert.equal(meta.extra['default'], 'a')
  })
})

describe('RelationField', () => {
  it('type is belongsTo by default', () => assert.equal(RelationField.make('author').getType(), 'belongsTo'))
  it('type is hasMany when multiple()', () => assert.equal(RelationField.make('tags').multiple().getType(), 'hasMany'))

  it('resource/displayField stored in extra', () => {
    const meta = RelationField.make('author')
      .resource('UserResource')
      .displayField('email')
      .toMeta()
    assert.equal(meta.extra['resource'], 'UserResource')
    assert.equal(meta.extra['displayField'], 'email')
  })
})

// ─── SelectFilter ───────────────────────────────────────────

describe('SelectFilter', () => {
  it('type is select', () => assert.equal(SelectFilter.make('status').getType(), 'select'))

  it('apply() uses filter name as column by default', () => {
    const f = SelectFilter.make('status')
    assert.deepEqual(f.apply({}, 'active'), { status: 'active' })
  })

  it('apply() uses explicit column()', () => {
    const f = SelectFilter.make('status').column('is_active')
    assert.deepEqual(f.apply({}, '1'), { is_active: '1' })
  })

  it('options stored in extra', () => {
    const meta = SelectFilter.make('role')
      .options([{ label: 'Admin', value: 'admin' }])
      .toMeta()
    assert.deepEqual(meta.extra['options'], [{ label: 'Admin', value: 'admin' }])
  })

  it('apply() merges with existing query object', () => {
    const f = SelectFilter.make('role')
    const result = f.apply({ existing: 'value' }, 'admin')
    assert.deepEqual(result, { existing: 'value', role: 'admin' })
  })

  it('auto-labels from name', () => {
    assert.equal(SelectFilter.make('userRole').getLabel(), 'User Role')
  })

  it('respects explicit label', () => {
    assert.equal(SelectFilter.make('r').label('Role').getLabel(), 'Role')
  })
})

// ─── SearchFilter ───────────────────────────────────────────

describe('SearchFilter', () => {
  it('type is search', () => assert.equal(SearchFilter.make().getType(), 'search'))

  it('default name is search', () => assert.equal(SearchFilter.make().getName(), 'search'))

  it('apply() returns _search with value and columns', () => {
    const f = SearchFilter.make().columns('name', 'email')
    const result = f.apply({}, 'alice') as Record<string, unknown>
    assert.deepEqual(result['_search'], { value: 'alice', columns: ['name', 'email'] })
  })

  it('columns stored in extra', () => {
    const meta = SearchFilter.make().columns('title', 'body').toMeta()
    assert.deepEqual(meta.extra['columns'], ['title', 'body'])
  })
})

// ─── Action ─────────────────────────────────────────────────

describe('Action', () => {
  it('auto-labels from camelCase name', () => {
    assert.equal(Action.make('markComplete').getLabel(), 'Mark Complete')
  })

  it('respects explicit label', () => {
    assert.equal(Action.make('x').label('Do Thing').getLabel(), 'Do Thing')
  })

  it('bulk defaults to true', () => {
    assert.equal(Action.make('x').isBulk(), true)
  })

  it('bulk(false) sets to false', () => {
    assert.equal(Action.make('x').bulk(false).isBulk(), false)
  })

  it('toMeta() defaults', () => {
    const meta = Action.make('delete').toMeta()
    assert.equal(meta.destructive, false)
    assert.equal(meta.requiresConfirm, false)
    assert.equal(meta.confirmMessage, undefined)
    assert.equal(meta.bulk, true)
  })

  it('toMeta() with destructive + confirm', () => {
    const meta = Action.make('del')
      .destructive()
      .confirm('Sure?')
      .toMeta()
    assert.equal(meta.destructive, true)
    assert.equal(meta.requiresConfirm, true)
    assert.equal(meta.confirmMessage, 'Sure?')
  })

  it('confirm() defaults to "Are you sure?"', () => {
    const meta = Action.make('x').confirm().toMeta()
    assert.equal(meta.confirmMessage, 'Are you sure?')
  })

  it('execute() calls handler with records', async () => {
    const called: unknown[][] = []
    const action = Action.make('x').handler(async (records) => { called.push(records) })
    await action.execute([{ id: '1' }])
    assert.equal(called.length, 1)
    assert.deepEqual(called[0], [{ id: '1' }])
  })

  it('execute() throws when no handler', async () => {
    await assert.rejects(
      () => Action.make('x').execute([]),
      /no handler/,
    )
  })
})

// ─── Resource ───────────────────────────────────────────────

describe('Resource', () => {
  it('getSlug() derives from class name (removes Resource suffix, pluralises)', () => {
    class TodoResource extends Resource { fields() { return [] } }
    assert.equal(TodoResource.getSlug(), 'todos')
  })

  it('getSlug() handles multi-word class names', () => {
    class BlogPostResource extends Resource { fields() { return [] } }
    assert.equal(BlogPostResource.getSlug(), 'blog-posts')
  })

  it('getSlug() uses static slug override', () => {
    class X extends Resource {
      static slug = 'custom-slug'
      fields() { return [] }
    }
    assert.equal(X.getSlug(), 'custom-slug')
  })

  it('getLabel() derives from class name', () => {
    class BlogPostResource extends Resource { fields() { return [] } }
    assert.equal(BlogPostResource.getLabel(), 'Blog Post')
  })

  it('getLabel() uses static label override', () => {
    class X extends Resource {
      static label = 'My Items'
      fields() { return [] }
    }
    assert.equal(X.getLabel(), 'My Items')
  })

  it('getLabelSingular() strips trailing s', () => {
    class TodoResource extends Resource { fields() { return [] } }
    assert.equal(TodoResource.getLabelSingular(), 'Todo')
  })

  it('getLabelSingular() uses static override', () => {
    class X extends Resource {
      static labelSingular = 'Entry'
      fields() { return [] }
    }
    assert.equal(X.getLabelSingular(), 'Entry')
  })

  it('toMeta() includes fields, filters, actions', () => {
    class PostResource extends Resource {
      static label = 'Posts'
      fields() { return [TextField.make('title')] }
      filters() { return [SelectFilter.make('status').options(['draft', 'published'])] }
      actions() { return [Action.make('publish').label('Publish').handler(async () => {})] }
    }
    const meta = new PostResource().toMeta()
    assert.equal(meta.label, 'Posts')
    assert.equal(meta.fields.length, 1)
    assert.equal(meta.fields[0]!.name, 'title')
    assert.equal(meta.filters.length, 1)
    assert.equal(meta.filters[0]!.name, 'status')
    assert.equal(meta.actions.length, 1)
    assert.equal(meta.actions[0]!.name, 'publish')
  })

  it('policy() defaults to true for all actions', async () => {
    const r = new (makeResource())()
    const ctx = { user: undefined, headers: {}, path: '/' }
    assert.equal(await r.policy('viewAny', ctx), true)
    assert.equal(await r.policy('delete',  ctx), true)
  })

  it('filters() defaults to []', () => {
    assert.deepEqual(new (makeResource())().filters(), [])
  })

  it('actions() defaults to []', () => {
    assert.deepEqual(new (makeResource())().actions(), [])
  })
})

// ─── Panel ──────────────────────────────────────────────────

describe('Panel', () => {
  it('make() sets name and default path', () => {
    const p = Panel.make('admin')
    assert.equal(p.getName(), 'admin')
    assert.equal(p.getPath(), '/admin')
    assert.equal(p.getApiBase(), '/admin/api')
  })

  it('path() overrides with leading slash normalisation', () => {
    assert.equal(Panel.make('x').path('dashboard').getPath(), '/dashboard')
    assert.equal(Panel.make('x').path('/dashboard').getPath(), '/dashboard')
  })

  it('layout() defaults to sidebar', () => {
    assert.equal(Panel.make('x').getLayout(), 'sidebar')
  })

  it('layout() accepts topbar', () => {
    assert.equal(Panel.make('x').layout('topbar').getLayout(), 'topbar')
  })

  it('branding() merges options', () => {
    const p = Panel.make('x').branding({ title: 'My App' }).branding({ logo: '/logo.svg' })
    assert.equal(p.getBranding().title, 'My App')
    assert.equal(p.getBranding().logo, '/logo.svg')
  })

  it('guard() stores guard fn', () => {
    const fn = async () => true
    const p = Panel.make('x').guard(fn)
    assert.equal(p.getGuard(), fn)
  })

  it('guard() is undefined by default', () => {
    assert.equal(Panel.make('x').getGuard(), undefined)
  })

  it('resources() stores resource classes', () => {
    const R = makeResource()
    const p = Panel.make('x').resources([R])
    assert.deepEqual(p.getResources(), [R])
  })

  it('toMeta() includes layout in output', () => {
    const meta = Panel.make('admin').layout('topbar').toMeta()
    assert.equal(meta.layout, 'topbar')
  })

  it('toMeta() includes resources', () => {
    const R = makeResource('Post', [TextField.make('title')])
    const meta = Panel.make('blog').resources([R]).toMeta()
    assert.equal(meta.resources.length, 1)
    assert.equal(meta.resources[0]!.label, 'Posts')
  })

  it('pages() defaults to []', () => {
    assert.deepEqual(Panel.make('x').getPages(), [])
  })

  it('pages() stores page classes', () => {
    class DashboardPage extends Page { static label = 'Dashboard' }
    const p = Panel.make('x').pages([DashboardPage])
    assert.deepEqual(p.getPages(), [DashboardPage])
  })

  it('toMeta() includes pages', () => {
    class DashboardPage extends Page { static label = 'Dashboard' }
    class SettingsPage extends Page { static label = 'Settings' }
    const meta = Panel.make('admin').pages([DashboardPage, SettingsPage]).toMeta()
    assert.equal(meta.pages.length, 2)
    assert.equal(meta.pages[0]!.slug, 'dashboard')
    assert.equal(meta.pages[1]!.slug, 'settings')
  })

  it('toMeta() pages defaults to empty array', () => {
    const meta = Panel.make('x').toMeta()
    assert.deepEqual(meta.pages, [])
  })
})

// ─── Page ───────────────────────────────────────────────────

describe('Page', () => {
  it('getSlug() strips Page suffix and lowercases', () => {
    class DashboardPage extends Page {}
    assert.equal(DashboardPage.getSlug(), 'dashboard')
  })

  it('getSlug() handles multi-word class names', () => {
    class SalesReportPage extends Page {}
    assert.equal(SalesReportPage.getSlug(), 'salesreport')
  })

  it('getSlug() uses static slug override', () => {
    class X extends Page { static slug = 'my-custom-slug' }
    assert.equal(X.getSlug(), 'my-custom-slug')
  })

  it('getLabel() derives from class name', () => {
    class AnalyticsPage extends Page {}
    assert.equal(AnalyticsPage.getLabel(), 'Analytics')
  })

  it('getLabel() handles multi-word class names', () => {
    class SalesReportPage extends Page {}
    assert.equal(SalesReportPage.getLabel(), 'Sales Report')
  })

  it('getLabel() uses static label override', () => {
    class X extends Page { static label = 'My Page' }
    assert.equal(X.getLabel(), 'My Page')
  })

  it('toMeta() returns correct shape', () => {
    class DashboardPage extends Page {
      static label = 'Dashboard'
      static icon  = '📊'
    }
    const meta = DashboardPage.toMeta()
    assert.equal(meta.slug, 'dashboard')
    assert.equal(meta.label, 'Dashboard')
    assert.equal(meta.icon, '📊')
  })

  it('toMeta() icon is undefined when not set', () => {
    class X extends Page {}
    assert.equal(X.toMeta().icon, undefined)
  })
})

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

// ─── List query logic (unit-tested via mock query builder) ──

describe('List query logic', () => {
  // Simulate how PanelServiceProvider builds the query from URL params.
  // We extract the logic into a pure function here and test it independently.

  interface MockQuery {
    _wheres:  Array<{ col: string; op: string; val: unknown }>
    _orWheres: Array<{ col: string; val: unknown }>
    _orders:  Array<{ col: string; dir: string }>
    where(col: string, val: unknown): MockQuery
    where(col: string, op: string, val: unknown): MockQuery
    orWhere(col: string, val: unknown): MockQuery
    orderBy(col: string, dir: string): MockQuery
  }

  function mockQuery(): MockQuery {
    const q: MockQuery = {
      _wheres: [],
      _orWheres: [],
      _orders: [],
      where(col: string, opOrVal: unknown, val?: unknown) {
        if (val !== undefined) {
          q._wheres.push({ col, op: opOrVal as string, val })
        } else {
          q._wheres.push({ col, op: '=', val: opOrVal })
        }
        return q
      },
      orWhere(col: string, val: unknown) {
        q._orWheres.push({ col, val })
        return q
      },
      orderBy(col: string, dir: string) {
        q._orders.push({ col, dir })
        return q
      },
    }
    return q
  }

  function applySort(
    q: MockQuery,
    sort: string | undefined,
    dir: 'ASC' | 'DESC',
    sortableFields: string[],
  ): MockQuery {
    if (sort && sortableFields.includes(sort)) {
      q = q.orderBy(sort, dir)
    }
    return q
  }

  function applySearch(
    q: MockQuery,
    search: string | undefined,
    searchableCols: string[],
  ): MockQuery {
    if (search && searchableCols.length > 0) {
      q = q.where(searchableCols[0]!, 'LIKE', `%${search}%`)
      for (let i = 1; i < searchableCols.length; i++) {
        q = q.orWhere(searchableCols[i]!, `%${search}%`)
      }
    }
    return q
  }

  it('sort applied for sortable field', () => {
    const q = applySort(mockQuery(), 'name', 'DESC', ['name', 'email'])
    assert.deepEqual(q._orders, [{ col: 'name', dir: 'DESC' }])
  })

  it('sort ignored for non-sortable field', () => {
    const q = applySort(mockQuery(), 'password', 'ASC', ['name'])
    assert.deepEqual(q._orders, [])
  })

  it('sort ignored when undefined', () => {
    const q = applySort(mockQuery(), undefined, 'ASC', ['name'])
    assert.deepEqual(q._orders, [])
  })

  it('search adds LIKE where on first column', () => {
    const q = applySearch(mockQuery(), 'alice', ['name'])
    assert.deepEqual(q._wheres, [{ col: 'name', op: 'LIKE', val: '%alice%' }])
    assert.deepEqual(q._orWheres, [])
  })

  it('search adds orWhere for additional columns', () => {
    const q = applySearch(mockQuery(), 'alice', ['name', 'email'])
    assert.deepEqual(q._wheres, [{ col: 'name', op: 'LIKE', val: '%alice%' }])
    assert.deepEqual(q._orWheres, [{ col: 'email', val: '%alice%' }])
  })

  it('search does nothing when empty', () => {
    const q = applySearch(mockQuery(), '', ['name'])
    assert.deepEqual(q._wheres, [])
  })

  it('search does nothing when no searchable cols', () => {
    const q = applySearch(mockQuery(), 'alice', [])
    assert.deepEqual(q._wheres, [])
  })

  it('SelectFilter.apply() produces correct where clause', () => {
    const filter = SelectFilter.make('role').options(['admin', 'user'])
    const q = mockQuery()
    const applied = filter.apply({}, 'admin') as Record<string, unknown>
    // simulate the service provider loop
    for (const [col, val] of Object.entries(applied)) {
      q.where(col, val)
    }
    assert.deepEqual(q._wheres, [{ col: 'role', op: '=', val: 'admin' }])
  })

  it('SearchFilter.apply() produces _search key', () => {
    const filter = SearchFilter.make().columns('title', 'body')
    const applied = filter.apply({}, 'hello') as Record<string, unknown>
    const search = applied['_search'] as { value: string; columns: string[] }
    assert.equal(search.value, 'hello')
    assert.deepEqual(search.columns, ['title', 'body'])
  })
})
