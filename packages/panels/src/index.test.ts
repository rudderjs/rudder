import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Panel } from './Panel.js'
import { Page } from './Page.js'
import { Resource } from './Resource.js'
import { Field } from './Field.js'
import { Filter, SelectFilter, SearchFilter } from './Filter.js'
import { Action } from './Action.js'
import { PanelRegistry } from './PanelRegistry.js'
import { TextField }    from './fields/TextField.js'
import { EmailField }   from './fields/EmailField.js'
import { NumberField }  from './fields/NumberField.js'
import { TextareaField } from './fields/TextareaField.js'
import { SelectField }  from './fields/SelectField.js'
import { BooleanField } from './fields/BooleanField.js'
import { DateField }    from './fields/DateField.js'
import { RelationField } from './fields/RelationField.js'
import { HasMany }       from './fields/HasMany.js'
import { PasswordField } from './fields/PasswordField.js'
import { SlugField }     from './fields/SlugField.js'
import { TagsField }     from './fields/TagsField.js'
import { HiddenField }   from './fields/HiddenField.js'
import { ToggleField }   from './fields/ToggleField.js'
import { ColorField }    from './fields/ColorField.js'
import { JsonField }     from './fields/JsonField.js'
import { RepeaterField } from './fields/RepeaterField.js'
import { BuilderField }  from './fields/BuilderField.js'
import { FileField }     from './fields/FileField.js'
import { ComputedField } from './fields/ComputedField.js'
import { Block }         from './Block.js'
import { Section }       from './Section.js'
import { Tabs }          from './Tabs.js'
import { Text }    from './schema/Text.js'
import { Heading } from './schema/Heading.js'
import { Stats, Stat } from './schema/Stats.js'
import { Table }   from './schema/Table.js'
import { getPanelI18n, getPanelDir, getActiveLocale } from './i18n/index.js'

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

  it('component() stores a key on meta', () => {
    const f = TextField.make('color').component('color-picker')
    assert.equal(f.toMeta().component, 'color-picker')
  })

  it('component is undefined by default', () => {
    const f = TextField.make('x')
    assert.equal(f.toMeta().component, undefined)
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
  it('type is belongsToMany when multiple()', () => assert.equal(RelationField.make('tags').multiple().getType(), 'belongsToMany'))

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
    assert.equal((meta.fields[0] as any).name, 'title')
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

// ─── Action (row) ───────────────────────────────────────────

describe('Action.row()', () => {
  it('row() marks action as row action', () => {
    const a = Action.make('impersonate').row()
    assert.equal(a.toMeta().row, true)
  })

  it('row defaults to false', () => {
    assert.equal(Action.make('x').toMeta().row, false)
  })

  it('bulk defaults to true', () => {
    assert.equal(Action.make('x').toMeta().bulk, true)
  })
})

// ─── Resource defaultSort ────────────────────────────────────

describe('Resource.defaultSort', () => {
  it('defaultSort defaults to undefined', () => {
    class R extends Resource { fields() { return [] } }
    assert.equal(R.defaultSort, undefined)
  })

  it('defaultSort and defaultSortDir appear in meta', () => {
    class R extends Resource {
      static defaultSort    = 'createdAt'
      static defaultSortDir = 'DESC' as const
      fields() { return [] }
    }
    const meta = new R().toMeta()
    assert.equal(meta.defaultSort, 'createdAt')
    assert.equal(meta.defaultSortDir, 'DESC')
  })
})

// ─── New field types ─────────────────────────────────────────

describe('PasswordField', () => {
  it('type is password', () => {
    assert.equal(PasswordField.make('password').toMeta().type, 'password')
  })

  it('confirm() sets confirm flag', () => {
    assert.equal(PasswordField.make('password').confirm().toMeta().extra['confirm'], true)
  })

  it('confirm defaults to false', () => {
    assert.equal(PasswordField.make('password').toMeta().extra['confirm'], false)
  })

  it('is hidden from table by default', () => {
    assert.ok(PasswordField.make('password').toMeta().hidden.includes('table'))
  })
})

describe('SlugField', () => {
  it('type is slug', () => {
    assert.equal(SlugField.make('slug').toMeta().type, 'slug')
  })

  it('from() sets source field', () => {
    assert.equal(SlugField.make('slug').from('title').toMeta().extra['from'], 'title')
  })

  it('from defaults to undefined', () => {
    assert.equal(SlugField.make('slug').toMeta().extra['from'], undefined)
  })
})

describe('TagsField', () => {
  it('type is tags', () => {
    assert.equal(TagsField.make('tags').toMeta().type, 'tags')
  })

  it('placeholder() sets placeholder', () => {
    assert.equal(TagsField.make('tags').placeholder('Add a tag').toMeta().extra['placeholder'], 'Add a tag')
  })
})

describe('HiddenField', () => {
  it('type is hidden', () => {
    assert.equal(HiddenField.make('userId').toMeta().type, 'hidden')
  })

  it('default() sets default value', () => {
    assert.equal(HiddenField.make('status').default('draft').toMeta().extra['default'], 'draft')
  })

  it('is hidden from table by default', () => {
    const meta = HiddenField.make('x').toMeta()
    assert.ok(meta.hidden.includes('table'))
  })
})

describe('ToggleField', () => {
  it('type is toggle', () => {
    assert.equal(ToggleField.make('active').toMeta().type, 'toggle')
  })

  it('onLabel/offLabel defaults', () => {
    const meta = ToggleField.make('active').toMeta()
    assert.equal(meta.extra['onLabel'],  'On')
    assert.equal(meta.extra['offLabel'], 'Off')
  })

  it('custom labels', () => {
    const meta = ToggleField.make('published')
      .onLabel('Published').offLabel('Draft').toMeta()
    assert.equal(meta.extra['onLabel'],  'Published')
    assert.equal(meta.extra['offLabel'], 'Draft')
  })
})

describe('ColorField', () => {
  it('type is color', () => {
    assert.equal(ColorField.make('brandColor').toMeta().type, 'color')
  })
})

describe('JsonField', () => {
  it('type is json', () => {
    assert.equal(JsonField.make('metadata').toMeta().type, 'json')
  })

  it('rows() sets row count', () => {
    assert.equal(JsonField.make('metadata').rows(10).toMeta().extra['rows'], 10)
  })

  it('rows defaults to 6', () => {
    assert.equal(JsonField.make('metadata').toMeta().extra['rows'], 6)
  })
})

describe('RepeaterField', () => {
  it('type is repeater', () => {
    assert.equal(RepeaterField.make('items').toMeta().type, 'repeater')
  })

  it('schema() stores field metas in extra', () => {
    const f = RepeaterField.make('features').schema([
      TextField.make('title'),
      BooleanField.make('active'),
    ])
    const meta = f.toMeta()
    const schema = meta.extra['schema'] as Array<{ type: string; name: string }>
    assert.equal(schema.length, 2)
    assert.equal(schema[0]?.type, 'text')
    assert.equal(schema[1]?.type, 'boolean')
  })

  it('addLabel() sets the add button label', () => {
    const f = RepeaterField.make('items').addLabel('Add Feature')
    assert.equal(f.toMeta().extra['addLabel'], 'Add Feature')
  })

  it('addLabel defaults to "Add item"', () => {
    assert.equal(RepeaterField.make('items').toMeta().extra['addLabel'], 'Add item')
  })

  it('maxItems() sets max', () => {
    assert.equal(RepeaterField.make('items').maxItems(5).toMeta().extra['maxItems'], 5)
  })
})

describe('Block', () => {
  it('make() sets name', () => {
    assert.equal(Block.make('hero').toMeta().name, 'hero')
  })

  it('label() sets label, defaults to name', () => {
    assert.equal(Block.make('hero').toMeta().label, 'hero')
    assert.equal(Block.make('hero').label('Hero Section').toMeta().label, 'Hero Section')
  })

  it('icon() sets icon', () => {
    assert.equal(Block.make('hero').icon('🦸').toMeta().icon, '🦸')
  })

  it('icon defaults to undefined', () => {
    assert.equal(Block.make('hero').toMeta().icon, undefined)
  })

  it('schema() stores field metas', () => {
    const b = Block.make('hero').schema([TextField.make('heading')])
    assert.equal(b.toMeta().schema.length, 1)
    assert.equal(b.toMeta().schema[0]?.name, 'heading')
  })
})

describe('BuilderField', () => {
  it('type is builder', () => {
    assert.equal(BuilderField.make('content').toMeta().type, 'builder')
  })

  it('blocks() stores block metas in extra', () => {
    const f = BuilderField.make('content').blocks([
      Block.make('hero').schema([TextField.make('heading')]),
      Block.make('text').schema([TextareaField.make('body')]),
    ])
    const blocks = f.toMeta().extra['blocks'] as Array<{ name: string }>
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0]?.name, 'hero')
    assert.equal(blocks[1]?.name, 'text')
  })

  it('addLabel defaults to "Add block"', () => {
    assert.equal(BuilderField.make('content').toMeta().extra['addLabel'], 'Add block')
  })

  it('addLabel() sets label', () => {
    assert.equal(
      BuilderField.make('content').addLabel('Add section').toMeta().extra['addLabel'],
      'Add section',
    )
  })

  it('maxItems() sets max', () => {
    assert.equal(BuilderField.make('content').maxItems(10).toMeta().extra['maxItems'], 10)
  })
})

// ─── FileField ───────────────────────────────────────────────

describe('FileField', () => {
  it('type is file by default', () => {
    assert.equal(FileField.make('attachment').getType(), 'file')
  })

  it('image() changes type to image', () => {
    assert.equal(FileField.make('photo').image().getType(), 'image')
  })

  it('accept() stores mime type', () => {
    assert.equal(FileField.make('f').accept('image/*').toMeta().extra['accept'], 'image/*')
  })

  it('maxSize() stores size in MB', () => {
    assert.equal(FileField.make('f').maxSize(5).toMeta().extra['maxSize'], 5)
  })

  it('maxSize defaults to 10', () => {
    assert.equal(FileField.make('f').toMeta().extra['maxSize'], 10)
  })

  it('multiple() sets multiple flag', () => {
    assert.equal(FileField.make('f').multiple().toMeta().extra['multiple'], true)
  })

  it('multiple defaults to false', () => {
    assert.equal(FileField.make('f').toMeta().extra['multiple'], false)
  })

  it('disk() sets disk name', () => {
    assert.equal(FileField.make('f').disk('s3').toMeta().extra['disk'], 's3')
  })

  it('disk defaults to local', () => {
    assert.equal(FileField.make('f').toMeta().extra['disk'], 'local')
  })

  it('directory() sets upload directory', () => {
    assert.equal(FileField.make('f').directory('images').toMeta().extra['directory'], 'images')
  })
})

// ─── Section ─────────────────────────────────────────────────

describe('Section', () => {
  it('make() sets title', () => {
    assert.equal(Section.make('Details').toMeta().title, 'Details')
  })

  it('type is section', () => {
    assert.equal(Section.make('x').toMeta().type, 'section')
  })

  it('description() sets description', () => {
    assert.equal(Section.make('x').description('Extra info').toMeta().description, 'Extra info')
  })

  it('description defaults to undefined', () => {
    assert.equal(Section.make('x').toMeta().description, undefined)
  })

  it('collapsible defaults to false', () => {
    assert.equal(Section.make('x').toMeta().collapsible, false)
  })

  it('collapsible() enables collapsing', () => {
    assert.equal(Section.make('x').collapsible().toMeta().collapsible, true)
  })

  it('collapsed() sets initial state', () => {
    assert.equal(Section.make('x').collapsible().collapsed().toMeta().collapsed, true)
  })

  it('columns defaults to 1', () => {
    assert.equal(Section.make('x').toMeta().columns, 1)
  })

  it('columns() sets column count', () => {
    assert.equal(Section.make('x').columns(2).toMeta().columns, 2)
    assert.equal(Section.make('x').columns(3).toMeta().columns, 3)
  })

  it('schema() stores field metas', () => {
    const s = Section.make('Info').schema(
      TextField.make('name'),
      EmailField.make('email'),
    )
    const meta = s.toMeta()
    assert.equal(meta.fields.length, 2)
    assert.equal(meta.fields[0]?.name, 'name')
    assert.equal(meta.fields[1]?.name, 'email')
  })

  it('getFields() returns flat Field list', () => {
    const name  = TextField.make('name')
    const email = EmailField.make('email')
    const s = Section.make('x').schema(name, email)
    assert.deepEqual(s.getFields(), [name, email])
  })
})

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

// ─── Resource with Section/Tabs ───────────────────────────────

describe('Resource with Section/Tabs', () => {
  it('toMeta() includes section metas in fields array', () => {
    class R extends Resource {
      fields() {
        return [
          Section.make('Info').schema(TextField.make('name'), EmailField.make('email')),
        ]
      }
    }
    const meta = new R().toMeta()
    assert.equal(meta.fields.length, 1)
    assert.equal((meta.fields[0] as any).type, 'section')
    assert.equal((meta.fields[0] as any).title, 'Info')
  })

  it('toMeta() includes tabs metas in fields array', () => {
    class R extends Resource {
      fields() {
        return [
          Tabs.make()
            .tab('A', TextField.make('x'))
            .tab('B', BooleanField.make('y')),
        ]
      }
    }
    const meta = new R().toMeta()
    assert.equal(meta.fields.length, 1)
    assert.equal((meta.fields[0] as any).type, 'tabs')
    assert.equal((meta.fields[0] as any).tabs.length, 2)
  })
})

// ─── resourceData ────────────────────────────────────────────

describe('resourceData', () => {
  it('is exported from index', async () => {
    const mod = await import('./index.js')
    assert.equal(typeof mod.resourceData, 'function')
  })

  it('throws when panel not found', async () => {
    const { resourceData, PanelRegistry } = await import('./index.js')
    PanelRegistry.reset()
    await assert.rejects(
      () => resourceData({ panel: 'ghost', resource: 'x', url: '/ghost/x' }),
      /Panel "\/ghost" not found/,
    )
  })

  it('throws when resource not found', async () => {
    const { resourceData, PanelRegistry, Panel } = await import('./index.js')
    PanelRegistry.reset()
    PanelRegistry.register(Panel.make('demo').path('/demo'))
    await assert.rejects(
      () => resourceData({ panel: 'demo', resource: 'missing', url: '/demo/missing' }),
      /Resource "missing" not found/,
    )
  })

  it('returns panelMeta + resourceMeta when model is undefined', async () => {
    const { resourceData, PanelRegistry, Panel, Resource, TextField } = await import('./index.js')
    PanelRegistry.reset()
    class PostResource extends Resource {
      fields() { return [TextField.make('title')] }
    }
    PanelRegistry.register(Panel.make('blog').path('/blog').resources([PostResource]))
    const result = await resourceData({ panel: 'blog', resource: 'posts', url: '/blog/posts' })
    assert.equal(result.panelMeta.name, 'blog')
    assert.equal(result.resourceMeta.slug, 'posts')
    assert.deepEqual(result.records, [])
    assert.equal(result.pagination, null)
  })
})

// ─── HasMany ─────────────────────────────────────────────────

describe('HasMany', () => {
  it('type is hasMany', () => {
    assert.equal(HasMany.make('comments').getType(), 'hasMany')
  })

  it('is hidden from table, create, and edit by default', () => {
    const f = HasMany.make('comments').toMeta()
    assert.ok(f.hidden.includes('table'))
    assert.ok(f.hidden.includes('create'))
    assert.ok(f.hidden.includes('edit'))
  })

  it('sets resource slug', () => {
    const f = HasMany.make('comments').resource('comments').toMeta()
    assert.equal(f.extra['resource'], 'comments')
  })

  it('sets foreignKey', () => {
    const f = HasMany.make('comments').foreignKey('postId').toMeta()
    assert.equal(f.extra['foreignKey'], 'postId')
  })

  it('sets display field', () => {
    const f = HasMany.make('comments').displayField('body').toMeta()
    assert.equal(f.extra['displayField'], 'body')
  })

  it('throughMany sets flag', () => {
    const f = HasMany.make('tags').throughMany().toMeta()
    assert.equal(f.extra['throughMany'], true)
  })
})

// ─── Schema elements ─────────────────────────────────────────

describe('Text', () => {
  it('type is text', () => {
    assert.equal(Text.make('hello').getType(), 'text')
  })

  it('toMeta returns content', () => {
    const m = Text.make('Hello world').toMeta()
    assert.equal(m.type, 'text')
    assert.equal(m.content, 'Hello world')
  })
})

describe('Heading', () => {
  it('type is heading', () => {
    assert.equal(Heading.make('Title').getType(), 'heading')
  })

  it('defaults to level 1', () => {
    const m = Heading.make('Title').toMeta()
    assert.equal(m.level, 1)
  })

  it('respects explicit level', () => {
    const m = Heading.make('Subtitle').level(2).toMeta()
    assert.equal(m.level, 2)
  })

  it('toMeta includes content', () => {
    const m = Heading.make('Dashboard').toMeta()
    assert.equal(m.content, 'Dashboard')
    assert.equal(m.type, 'heading')
  })
})

describe('Stat', () => {
  it('toMeta returns label and value', () => {
    const m = Stat.make('Users').value(42).toMeta()
    assert.equal(m.label, 'Users')
    assert.equal(m.value, 42)
  })

  it('description is optional', () => {
    const m = Stat.make('Users').value(0).toMeta()
    assert.equal('description' in m, false)
  })

  it('includes description when set', () => {
    const m = Stat.make('Users').value(10).description('Active users').toMeta()
    assert.equal(m.description, 'Active users')
  })

  it('includes trend when set', () => {
    const m = Stat.make('Revenue').value(100).trend(5).toMeta()
    assert.equal(m.trend, 5)
  })
})

describe('Stats', () => {
  it('type is stats', () => {
    assert.equal(Stats.make([]).getType(), 'stats')
  })

  it('toMeta maps stats to meta', () => {
    const m = Stats.make([Stat.make('A').value(1), Stat.make('B').value(2)]).toMeta()
    assert.equal(m.type, 'stats')
    assert.equal(m.stats.length, 2)
    assert.equal(m.stats[0]!.label, 'A')
    assert.equal(m.stats[1]!.label, 'B')
  })
})

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
    assert.equal(c.resource, undefined)
  })

  it('sets resource and columns', () => {
    const c = Table.make('T').resource('posts').columns(['title', 'status']).getConfig()
    assert.equal(c.resource, 'posts')
    assert.deepEqual(c.columns, ['title', 'status'])
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

// ─── i18n ─────────────────────────────────────────────────────

describe('getPanelI18n', () => {
  it('returns English strings for "en"', () => {
    const i18n = getPanelI18n('en')
    assert.equal(i18n.signOut, 'Sign out')
    assert.equal(i18n.yes, 'Yes')
    assert.equal(i18n.no, 'No')
    assert.equal(i18n.cancel, 'Cancel')
  })

  it('returns Arabic strings for "ar"', () => {
    const i18n = getPanelI18n('ar')
    assert.equal(i18n.yes, 'نعم')
    assert.equal(i18n.no, 'لا')
  })

  it('falls back to English for unknown locale', () => {
    const i18n = getPanelI18n('zh')
    assert.equal(i18n.yes, 'Yes')
  })

  it('resolves base locale from full tag (e.g. "ar-SA")', () => {
    const i18n = getPanelI18n('ar-SA')
    assert.equal(i18n.yes, 'نعم')
  })
})

describe('getPanelDir', () => {
  it('returns ltr for en', () => assert.equal(getPanelDir('en'), 'ltr'))
  it('returns rtl for ar', () => assert.equal(getPanelDir('ar'), 'rtl'))
  it('returns rtl for he', () => assert.equal(getPanelDir('he'), 'rtl'))
  it('returns rtl for fa', () => assert.equal(getPanelDir('fa'), 'rtl'))
  it('returns rtl for ar-SA', () => assert.equal(getPanelDir('ar-SA'), 'rtl'))
  it('returns ltr for fr', () => assert.equal(getPanelDir('fr'), 'ltr'))
  it('returns ltr for unknown locale', () => assert.equal(getPanelDir('xyz'), 'ltr'))
})

describe('getActiveLocale', () => {
  it('returns "en" when no global config set', () => {
    const g = globalThis as Record<string, unknown>
    const prev = g['__boostkit_localization_config__']
    delete g['__boostkit_localization_config__']
    assert.equal(getActiveLocale(), 'en')
    g['__boostkit_localization_config__'] = prev
  })

  it('returns locale from global config', () => {
    const g = globalThis as Record<string, unknown>
    g['__boostkit_localization_config__'] = { locale: 'ar' }
    assert.equal(getActiveLocale(), 'ar')
    delete g['__boostkit_localization_config__']
  })
})

describe('Panel.locale()', () => {
  it('overrides locale in toMeta()', () => {
    const meta = Panel.make('x').path('/x').locale('ar').toMeta()
    assert.equal(meta.locale, 'ar')
  })

  it('sets dir to rtl for Arabic', () => {
    const meta = Panel.make('x').path('/x').locale('ar').toMeta()
    assert.equal(meta.dir, 'rtl')
  })

  it('sets dir to ltr for English', () => {
    const meta = Panel.make('x').path('/x').locale('en').toMeta()
    assert.equal(meta.dir, 'ltr')
  })

  it('i18n in toMeta() matches the set locale', () => {
    const meta = Panel.make('x').path('/x').locale('ar').toMeta()
    assert.equal(meta.i18n.yes, 'نعم')
  })

  it('falls back to getActiveLocale() when not set', () => {
    const g = globalThis as Record<string, unknown>
    const prev = g['__boostkit_localization_config__']
    delete g['__boostkit_localization_config__']
    const meta = Panel.make('x').path('/x').toMeta()
    assert.equal(meta.locale, 'en')
    g['__boostkit_localization_config__'] = prev
  })
})

// ─── Global search — i18n keys ──────────────────────────────

describe('globalSearch i18n keys', () => {
  it('en has globalSearch key', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.globalSearch, 'string')
    assert.ok(i18n.globalSearch.length > 0)
  })

  it('en globalSearchEmpty contains :query placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.globalSearchEmpty.includes(':query'))
  })

  it('en globalSearchShortcut is non-empty', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.globalSearchShortcut.length > 0)
  })

  it('ar has globalSearch key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.globalSearch.length > 0)
  })

  it('ar globalSearchEmpty contains :query placeholder', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.globalSearchEmpty.includes(':query'))
  })
})

// ─── Search — searchable field detection ────────────────────

describe('search — searchable field detection', () => {
  it('identifies searchable fields correctly', () => {
    const fields = [
      TextField.make('name').searchable(),
      EmailField.make('email').searchable(),
      TextField.make('internal'),
    ]
    const searchable = fields.filter(f => f.isSearchable()).map(f => f.getName())
    assert.deepEqual(searchable, ['name', 'email'])
  })

  it('non-searchable fields are excluded', () => {
    const fields = [
      NumberField.make('count'),
      DateField.make('created_at'),
    ]
    const searchable = fields.filter(f => f.isSearchable())
    assert.equal(searchable.length, 0)
  })

  it('resource with no searchable fields returns empty array', () => {
    class NoSearchResource extends Resource {
      fields() { return [TextField.make('title'), NumberField.make('count')] }
    }
    const resource = new NoSearchResource()
    const cols = resource.fields().filter(f => (f as Field).isSearchable())
    assert.equal(cols.length, 0)
  })

  it('resource with searchable fields returns them', () => {
    class SearchResource extends Resource {
      fields() {
        return [
          TextField.make('title').searchable(),
          TextField.make('body').searchable(),
          TextField.make('slug'),
        ]
      }
    }
    const resource = new SearchResource()
    const cols = resource.fields()
      .filter(f => (f as Field).isSearchable())
      .map(f => (f as Field).getName())
    assert.deepEqual(cols, ['title', 'body'])
  })
})

// ─── Bulk delete — i18n keys ────────────────────────────────

describe('bulk delete i18n keys', () => {
  it('en has deleteSelected key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.deleteSelected.includes(':n'))
  })

  it('en has bulkDeleteConfirm key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.bulkDeleteConfirm.includes(':n'))
  })

  it('en has bulkDeletedToast key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.bulkDeletedToast.includes(':n'))
  })

  it('ar has deleteSelected key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.deleteSelected.length > 0)
  })
})

// ─── Conditional fields ──────────────────────────────────────

describe('conditional fields', () => {
  it('showWhen equality condition', () => {
    const f = TextField.make('x').showWhen('status', 'published')
    assert.deepEqual(f.toMeta().conditions, [
      { type: 'show', field: 'status', op: '=', value: 'published' },
    ])
  })

  it('showWhen with explicit operator', () => {
    const f = TextField.make('x').showWhen('views', '>', 100)
    assert.deepEqual(f.toMeta().conditions, [
      { type: 'show', field: 'views', op: '>', value: 100 },
    ])
  })

  it('showWhen with array uses "in"', () => {
    const f = TextField.make('x').showWhen('status', ['draft', 'review'])
    assert.deepEqual(f.toMeta().conditions, [
      { type: 'show', field: 'status', op: 'in', value: ['draft', 'review'] },
    ])
  })

  it('hideWhen stores hide condition', () => {
    const f = TextField.make('x').hideWhen('featured', true)
    assert.deepEqual(f.toMeta().conditions, [
      { type: 'hide', field: 'featured', op: '=', value: true },
    ])
  })

  it('disabledWhen stores disabled condition', () => {
    const f = TextField.make('x').disabledWhen('verified', true)
    assert.deepEqual(f.toMeta().conditions, [
      { type: 'disabled', field: 'verified', op: '=', value: true },
    ])
  })

  it('truthy/falsy operators', () => {
    const f = TextField.make('x').showWhen('name', 'truthy')
    assert.deepEqual(f.toMeta().conditions, [
      { type: 'show', field: 'name', op: 'truthy', value: null },
    ])
  })

  it('no conditions → conditions absent from meta', () => {
    assert.equal(TextField.make('x').toMeta().conditions, undefined)
  })

  it('multiple conditions stack', () => {
    const f = TextField.make('x').showWhen('a', '1').hideWhen('b', '2')
    assert.equal(f.toMeta().conditions?.length, 2)
  })
})

// ─── ComputedField ───────────────────────────────────────────

describe('ComputedField', () => {
  it('type is "computed"', () => {
    const f = ComputedField.make('x').compute(() => '')
    assert.equal(f.toMeta().type, 'computed')
  })

  it('is auto-readonly and hidden from create/edit', () => {
    const meta = ComputedField.make('x').compute(() => '').toMeta()
    assert.equal(meta.readonly, true)
    assert.ok(meta.hidden.includes('create'))
    assert.ok(meta.hidden.includes('edit'))
  })

  it('apply() calls compute function', () => {
    const f = ComputedField.make('fullName')
      .compute((r) => `${(r as any).first} ${(r as any).last}`)
    assert.equal(f.apply({ first: 'Jane', last: 'Doe' }), 'Jane Doe')
  })

  it('can chain .display()', () => {
    const f = ComputedField.make('wordCount')
      .compute((r) => ((r as any).body ?? '').split(/\s+/).length)
      .display((v) => `${v} words`)
    assert.equal(f.toMeta().displayTransformed, true)
    assert.equal(f.apply({ body: 'hello world foo' }), 3)
    assert.equal(f.applyDisplay(3, {}), '3 words')
  })
})

// ─── Display transformer ─────────────────────────────────────

describe('display transformer', () => {
  it('display() sets displayTransformed in meta', () => {
    const f = NumberField.make('price').display((v) => `$${v}`)
    assert.equal(f.toMeta().displayTransformed, true)
  })

  it('displayTransformed absent without display()', () => {
    assert.equal(NumberField.make('price').toMeta().displayTransformed, undefined)
  })

  it('applyDisplay transforms value', () => {
    const f = NumberField.make('price').display((v) => `$${((v as number) / 100).toFixed(2)}`)
    assert.equal(f.applyDisplay(1999, {}), '$19.99')
  })

  it('applyDisplay receives the full record', () => {
    const f = TextField.make('title').display((v, r) => `${v} (${(r as any).status})`)
    assert.equal(f.applyDisplay('Hello', { status: 'draft' }), 'Hello (draft)')
  })
})

// ─── Per-field validation ────────────────────────────────────

describe('per-field validation', () => {
  it('validate() async validator returning true passes', async () => {
    const f = TextField.make('slug')
      .validate(async (value) => value ? true : 'Slug is required')
    assert.equal(await f.runValidate('hello', {}), true)
  })

  it('validate() returns error string when invalid', async () => {
    const f = TextField.make('slug')
      .validate(async (value) => value ? true : 'Slug is required')
    assert.equal(await f.runValidate('', {}), 'Slug is required')
  })

  it('validate() receives full form data', async () => {
    const f = TextField.make('endDate')
      .validate(async (value, data) => {
        if ((value as string) < (data as any).startDate) return 'End must be after start'
        return true
      })
    const result = await f.runValidate('2020-01-01', { startDate: '2021-01-01' })
    assert.equal(result, 'End must be after start')
  })

  it('without validate(), runValidate returns true', async () => {
    const f = TextField.make('x')
    assert.equal(await f.runValidate('anything', {}), true)
  })
})

// ─── Field-level access control ─────────────────────────────

describe('field-level access control', () => {
  it('readableBy stores function — not in meta', () => {
    const fn = (ctx: any) => ctx.user?.role === 'admin'
    const f = TextField.make('x').readableBy(fn)
    assert.equal((f.toMeta().extra as any)['readableBy'], undefined)
    assert.ok(f.canRead({ user: { role: 'admin' } }))
    assert.equal(f.canRead({ user: { role: 'user' } }), false)
  })

  it('editableBy stores function — not in meta', () => {
    const f = TextField.make('x').editableBy((ctx: any) => ctx.user?.role === 'admin')
    assert.ok(f.canEdit({ user: { role: 'admin' } }))
    assert.equal(f.canEdit({ user: { role: 'user' } }), false)
  })

  it('without readableBy, canRead returns true', () => {
    assert.ok(TextField.make('x').canRead({}))
  })

  it('without editableBy, canEdit returns true', () => {
    assert.ok(TextField.make('x').canEdit({}))
  })
})

// ─── Duplicate — i18n keys ───────────────────────────────────

describe('duplicate i18n keys', () => {
  it('en has duplicate key', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.duplicate, 'string')
    assert.ok(i18n.duplicate.length > 0)
  })

  it('ar has duplicate key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.duplicate.length > 0)
  })
})

// ─── Schema files ─────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema')

describe('panels schema files', () => {
  it('ships panels.prisma with PanelVersion and PanelGlobal', () => {
    const file = join(schemaDir, 'panels.prisma')
    assert.ok(existsSync(file), 'panels.prisma should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('model PanelVersion'), 'should contain PanelVersion model')
    assert.ok(content.includes('model PanelGlobal'), 'should contain PanelGlobal model')
  })

  it('ships drizzle schemas for all 3 drivers', () => {
    for (const variant of ['sqlite', 'pg', 'mysql']) {
      const file = join(schemaDir, `panels.drizzle.${variant}.ts`)
      assert.ok(existsSync(file), `panels.drizzle.${variant}.ts should exist`)
      const content = readFileSync(file, 'utf8')
      assert.ok(content.includes('export const panelVersion'), `${variant}: should export panelVersion`)
      assert.ok(content.includes('export const panelGlobal'), `${variant}: should export panelGlobal`)
    }
  })

  it('sqlite schema imports from sqlite-core', () => {
    const content = readFileSync(join(schemaDir, 'panels.drizzle.sqlite.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/sqlite-core'))
  })

  it('pg schema imports from pg-core', () => {
    const content = readFileSync(join(schemaDir, 'panels.drizzle.pg.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/pg-core'))
  })

  it('mysql schema imports from mysql-core', () => {
    const content = readFileSync(join(schemaDir, 'panels.drizzle.mysql.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/mysql-core'))
  })
})

describe('Resource — navigation group', () => {
  it('navigationGroup defaults to undefined', () => {
    class R extends Resource { fields() { return [] } }
    assert.strictEqual(new R().toMeta().navigationGroup, undefined)
  })

  it('navigationGroup is included in meta when set', () => {
    class R extends Resource {
      static navigationGroup = 'Content'
      fields() { return [] }
    }
    assert.strictEqual(new R().toMeta().navigationGroup, 'Content')
  })
})

describe('Resource — navigation badge color', () => {
  it('navigationBadgeColor defaults to undefined', () => {
    class R extends Resource { fields() { return [] } }
    assert.strictEqual(new R().toMeta().navigationBadgeColor, undefined)
  })

  it('navigationBadgeColor is included in meta when set', () => {
    class R extends Resource {
      static navigationBadgeColor = 'danger' as const
      fields() { return [] }
    }
    assert.strictEqual(new R().toMeta().navigationBadgeColor, 'danger')
  })
})

describe('Resource — empty state', () => {
  it('emptyState fields default to undefined', () => {
    class R extends Resource { fields() { return [] } }
    const meta = new R().toMeta()
    assert.strictEqual(meta.emptyStateIcon, undefined)
    assert.strictEqual(meta.emptyStateHeading, undefined)
    assert.strictEqual(meta.emptyStateDescription, undefined)
  })

  it('emptyState fields are included in meta when set', () => {
    class R extends Resource {
      static emptyStateIcon = '📝'
      static emptyStateHeading = 'No :label yet'
      static emptyStateDescription = 'Create your first article to get started.'
      fields() { return [] }
    }
    const meta = new R().toMeta()
    assert.strictEqual(meta.emptyStateIcon, '📝')
    assert.strictEqual(meta.emptyStateHeading, 'No :label yet')
    assert.strictEqual(meta.emptyStateDescription, 'Create your first article to get started.')
  })
})
