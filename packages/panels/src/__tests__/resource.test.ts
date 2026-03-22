
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Resource }     from '../Resource.js'
import { Panel }        from '../Panel.js'
import { Page }         from '../Page.js'
import { Field }        from '../schema/Field.js'
import { TextField }    from '../schema/fields/TextField.js'
import { EmailField }   from '../schema/fields/EmailField.js'
import { NumberField }  from '../schema/fields/NumberField.js'
import { DateField }    from '../schema/fields/DateField.js'
import { BooleanField } from '../schema/fields/BooleanField.js'
import { SelectFilter, SearchFilter } from '../schema/Filter.js'
import { Action }       from '../schema/Action.js'
import { Section }      from '../schema/Section.js'
import { Tabs }         from '../schema/Tabs.js'
import { Tab }          from '../schema/Tabs.js'
import { Stats, Stat }  from '../schema/Stats.js'
import { Table }        from '../schema/Table.js'
import { Form }         from '../schema/Form.js'
import { Column }       from '../schema/Column.js'
import { ListTab }      from '../schema/Tab.js'

// ─── Helpers ────────────────────────────────────────────────

function makeResource(name = 'Post', fields: Field[] = []) {
  class R extends Resource {
    static label = name + 's'
    form(form: Form) { return form.fields(fields) }
  }
  Object.defineProperty(R, 'name', { value: name + 'Resource' })
  return R
}

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

// ─── Resource ───────────────────────────────────────────────

describe('Resource', () => {
  it('getSlug() derives from class name (removes Resource suffix, pluralises)', () => {
    class TodoResource extends Resource {}
    assert.equal(TodoResource.getSlug(), 'todos')
  })

  it('getSlug() handles multi-word class names', () => {
    class BlogPostResource extends Resource {}
    assert.equal(BlogPostResource.getSlug(), 'blog-posts')
  })

  it('getSlug() uses static slug override', () => {
    class X extends Resource {
      static slug = 'custom-slug'

    }
    assert.equal(X.getSlug(), 'custom-slug')
  })

  it('getLabel() derives from class name', () => {
    class BlogPostResource extends Resource {}
    assert.equal(BlogPostResource.getLabel(), 'Blog Post')
  })

  it('getLabel() uses static label override', () => {
    class X extends Resource {
      static label = 'My Items'

    }
    assert.equal(X.getLabel(), 'My Items')
  })

  it('getLabelSingular() strips trailing s', () => {
    class TodoResource extends Resource {}
    assert.equal(TodoResource.getLabelSingular(), 'Todo')
  })

  it('getLabelSingular() uses static override', () => {
    class X extends Resource {
      static labelSingular = 'Entry'

    }
    assert.equal(X.getLabelSingular(), 'Entry')
  })

  it('toMeta() includes fields, filters, actions', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      static label = 'Posts'
      table(table: Table) {
        return table
          .filters([SelectFilter.make('status').options(['draft', 'published'])])
          .actions([Action.make('publish').label('Publish').handler(async () => {})])
      }
      form(form: Form) { return form.fields([TextField.make('title')]) }
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
    const ctx = { user: undefined, headers: {}, path: '/', params: {} }
    assert.equal(await r.policy('viewAny', ctx), true)
    assert.equal(await r.policy('delete',  ctx), true)
  })
})

// ─── Resource defaultSort ────────────────────────────────────

describe('Resource.defaultSort', () => {
  it('defaultSort defaults to undefined', () => {
    class R extends Resource {
      static model = MockModel as any
    }
    assert.equal(new R().toMeta().defaultSort, undefined)
  })

  it('defaultSort and defaultSortDir appear in meta via table()', () => {
    class R extends Resource {
      static model = MockModel as any
      table(table: Table) { return table.sortBy('createdAt', 'DESC') }
    }
    const meta = new R().toMeta()
    assert.equal(meta.defaultSort, 'createdAt')
    assert.equal(meta.defaultSortDir, 'DESC')
  })
})

// ─── Resource with Section/Tabs ───────────────────────────────

describe('Resource with Section/Tabs', () => {
  it('toMeta() includes section metas in fields array', () => {
    class R extends Resource {
      form(form: Form) {
        return form.fields([
          Section.make('Info').schema(TextField.make('name'), EmailField.make('email')),
        ])
      }
    }
    const meta = new R().toMeta()
    assert.equal(meta.fields.length, 1)
    assert.equal((meta.fields[0] as any).type, 'section')
    assert.equal((meta.fields[0] as any).title, 'Info')
  })

  it('toMeta() includes tabs metas in fields array', () => {
    class R extends Resource {
      form(form: Form) {
        return form.fields([
          Tabs.make()
            .tab('A', TextField.make('x'))
            .tab('B', BooleanField.make('y')),
        ])
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
    const mod = await import('../index.js')
    assert.equal(typeof mod.resourceData, 'function')
  })

  it('throws when panel not found', async () => {
    const { resourceData, PanelRegistry } = await import('../index.js')
    PanelRegistry.reset()
    await assert.rejects(
      () => resourceData({ panel: 'ghost', resource: 'x', url: '/ghost/x' }),
      /Panel "\/ghost" not found/,
    )
  })

  it('throws when resource not found', async () => {
    const { resourceData, PanelRegistry, Panel } = await import('../index.js')
    PanelRegistry.reset()
    PanelRegistry.register(Panel.make('demo').path('/demo'))
    await assert.rejects(
      () => resourceData({ panel: 'demo', resource: 'missing', url: '/demo/missing' }),
      /Resource "missing" not found/,
    )
  })

  it('returns panelMeta + resourceMeta when model is undefined', async () => {
    const { resourceData, PanelRegistry, Panel, Resource, TextField } = await import('../index.js')
    PanelRegistry.reset()
    class PostResource extends Resource {
      form(form: Form) { return form.fields([TextField.make('title')]) }
    }
    PanelRegistry.register(Panel.make('blog').path('/blog').resources([PostResource]))
    const result = await resourceData({ panel: 'blog', resource: 'posts', url: '/blog/posts' })
    assert.equal(result.panelMeta.name, 'blog')
    assert.equal(result.resourceMeta.slug, 'posts')
    assert.deepEqual(result.records, [])
    assert.equal(result.pagination, null)
  })
})

// ─── Resource — navigation group ────────────────────────────

describe('Resource — navigation group', () => {
  it('navigationGroup defaults to undefined', () => {
    class R extends Resource {}
    assert.strictEqual(new R().toMeta().navigationGroup, undefined)
  })

  it('navigationGroup is included in meta when set', () => {
    class R extends Resource {
      static navigationGroup = 'Content'

    }
    assert.strictEqual(new R().toMeta().navigationGroup, 'Content')
  })
})

describe('Resource — navigation badge color', () => {
  it('navigationBadgeColor defaults to undefined', () => {
    class R extends Resource {}
    assert.strictEqual(new R().toMeta().navigationBadgeColor, undefined)
  })

  it('navigationBadgeColor is included in meta when set', () => {
    class R extends Resource {
      static navigationBadgeColor = 'danger' as const

    }
    assert.strictEqual(new R().toMeta().navigationBadgeColor, 'danger')
  })
})

// ─── Resource — autosave & draftRecovery ──────────────────

describe('Resource — autosave', () => {
  it('defaults to autosave=false', () => {
    class R extends Resource {}
    const meta = new R().toMeta()
    assert.equal(meta.autosave, false)
    assert.equal(meta.autosaveInterval, 30000)
  })

  it('static autosave = true', () => {
    class R extends Resource {
      static autosave = true

    }
    const meta = new R().toMeta()
    assert.equal(meta.autosave, true)
    assert.equal(meta.autosaveInterval, 30000)
  })

  it('static autosave = { interval: 10000 }', () => {
    class R extends Resource {
      static autosave = { interval: 10000 }

    }
    const meta = new R().toMeta()
    assert.equal(meta.autosave, true)
    assert.equal(meta.autosaveInterval, 10000)
  })

  it('static autosave object without interval uses default', () => {
    class R extends Resource {
      static autosave = {} as { interval?: number }

    }
    const meta = new R().toMeta()
    assert.equal(meta.autosave, true)
    assert.equal(meta.autosaveInterval, 30000)
  })
})

describe('Resource — draftRecovery', () => {
  it('defaults to false', () => {
    class R extends Resource {}
    const meta = new R().toMeta()
    assert.equal(meta.draftRecovery, false)
  })

  it('static draftRecovery = true', () => {
    class R extends Resource {
      static draftRecovery = true

    }
    const meta = new R().toMeta()
    assert.equal(meta.draftRecovery, true)
  })
})

// ─── Resource — yjs derived from fields ──────────────────────

describe('Resource — yjs flag', () => {
  it('yjs=false when no fields use yjs', () => {
    class R extends Resource {
      form(form: Form) { return form.fields([TextField.make('title')]) }
    }
    assert.equal(new R().toMeta().yjs, false)
  })

  it('yjs=true when a field has .collaborative()', () => {
    class R extends Resource {
      form(form: Form) { return form.fields([TextField.make('title').collaborative()]) }
    }
    assert.equal(new R().toMeta().yjs, true)
  })

  it('yjs=true when a field has .persist("websocket")', () => {
    class R extends Resource {
      form(form: Form) { return form.fields([TextField.make('title').persist('websocket')]) }
    }
    assert.equal(new R().toMeta().yjs, true)
  })

  it('yjs=true when a field has .persist("indexeddb")', () => {
    class R extends Resource {
      form(form: Form) { return form.fields([TextField.make('title').persist('indexeddb')]) }
    }
    assert.equal(new R().toMeta().yjs, true)
  })

  it('yjs=false when field only has .persist() (localStorage)', () => {
    class R extends Resource {
      form(form: Form) { return form.fields([TextField.make('title').persist()]) }
    }
    assert.equal(new R().toMeta().yjs, false)
  })

  it('yjs derived through Section grouping', () => {
    class R extends Resource {
      form(form: Form) {
        return form.fields([Section.make('Content').schema(
          TextField.make('title').persist('websocket'),
        )])
      }
    }
    assert.equal(new R().toMeta().yjs, true)
  })

  it('yjs derived through Tabs grouping', () => {
    class R extends Resource {
      form(form: Form) {
        return form.fields([Tabs.make().tab('Main',
          TextField.make('title').collaborative(),
        )])
      }
    }
    assert.equal(new R().toMeta().yjs, true)
  })
})

// ─── Resource — empty state ─────────────────────────────────

describe('Resource — empty state', () => {
  it('emptyState fields default to undefined', () => {
    class R extends Resource {}
    const meta = new R().toMeta()
    assert.strictEqual(meta.emptyStateIcon, undefined)
    assert.strictEqual(meta.emptyStateHeading, undefined)
    assert.strictEqual(meta.emptyStateDescription, undefined)
  })

  it('emptyState fields are included in meta when set via table()', () => {
    class R extends Resource {
      static model = MockModel as any
      table(table: Table) {
        return table.emptyState({
          icon: '📝',
          heading: 'No :label yet',
          description: 'Create your first article to get started.',
        })
      }
    }
    const meta = new R().toMeta()
    assert.strictEqual(meta.emptyStateIcon, '📝')
    assert.strictEqual(meta.emptyStateHeading, 'No :label yet')
    assert.strictEqual(meta.emptyStateDescription, 'Create your first article to get started.')
  })
})

// ─── Resource — detail() ────────────────────────────────────

describe('Resource — detail()', () => {
  it('defaults to empty array', () => {
    class R extends Resource {}
    assert.deepEqual(new R().detail(), [])
  })

  it('returns schema elements when overridden', () => {
    class R extends Resource {
      detail() {
        return [Stats.make([Stat.make('Views').value(42)])]
      }
    }
    const d = new R().detail()
    assert.equal(d.length, 1)
    assert.equal((d[0] as any).getType(), 'stats')
  })

  it('receives record parameter', () => {
    class R extends Resource {
      detail(record?: Record<string, unknown>) {
        return [
          Stats.make([Stat.make('Title Length').value(String(record?.title ?? '').length)]),
        ]
      }
    }
    const d = new R().detail({ title: 'Hello World' })
    const meta = (d[0] as any).toMeta()
    assert.equal(meta.stats[0].value, 11)
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

// ─── List query logic ──────────────────────────────────────

describe('List query logic', () => {
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

  it('resource with no searchable form fields returns empty array', () => {
    class NoSearchResource extends Resource {
      form(form: Form) { return form.fields([TextField.make('title'), NumberField.make('count')]) }
    }
    const resource = new NoSearchResource()
    const formFields = resource._resolveForm().getFields() as Field[]
    const cols = formFields.filter(f => f.isSearchable())
    assert.equal(cols.length, 0)
  })

  it('resource with searchable form fields returns them', () => {
    class SearchResource extends Resource {
      form(form: Form) {
        return form.fields([
          TextField.make('title').searchable(),
          TextField.make('body').searchable(),
          TextField.make('slug'),
        ])
      }
    }
    const resource = new SearchResource()
    const formFields = resource._resolveForm().getFields() as Field[]
    const cols = formFields
      .filter(f => f.isSearchable())
      .map(f => f.getName())
    assert.deepEqual(cols, ['title', 'body'])
  })
})

// ─── Mock model for _resolveTable tests ─────────────────────

class MockModel {
  static query() { return { get: async () => [], count: async () => 0 } }
}

// ─── Resource — new table()/form()/detail() API ─────────────

describe('Resource — table() override', () => {
  it('_resolveTable() uses table() when overridden', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      table(table: Table) {
        return table
          .columns([Column.make('title').sortable()])
          .searchable(['title'])
          .softDeletes()
      }

    }
    const table = new PostResource()._resolveTable()
    const config = table.getConfig()
    assert.equal(config.columns.length, 1)
    assert.equal(config.searchable, true)
    assert.equal(config.softDeletes, true)
  })

  it('table() receives pre-configured Table with model', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      table(table: Table) {
        // Verify the table already has the model wired
        assert.equal(table.getConfig().model, MockModel)
        return table
      }

    }
    new PostResource()._resolveTable()
  })

  it('table() with tabs', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      table(table: Table) {
        return table.tabs([
          Tab.make('All'),
          Tab.make('Published').scope((q: any) => q.where('status', 'published')),
        ])
      }

    }
    const config = new PostResource()._resolveTable().getConfig()
    assert.equal(config.tabs.length, 2)
    assert.equal(config.tabs[0]?.getLabel(), 'All')
    assert.ok(config.tabs[1]?.getScope())
  })
})

describe('Resource — form() override', () => {
  it('_resolveForm() uses form() when overridden', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      form(form: Form) {
        return form.fields([
          TextField.make('title').required(),
          TextField.make('body'),
        ])
      }

    }
    const form = new PostResource()._resolveForm()
    assert.equal(form.getFields().length, 2)
  })

  it('form() receives Form with resource slug as ID', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      form(form: Form) {
        assert.equal(form.getId(), 'posts')
        return form
      }

    }
    new PostResource()._resolveForm()
  })
})

describe('Resource — detail() override', () => {
  it('detail() defaults to empty array', () => {
    class R extends Resource {
      static model = MockModel as any

    }
    assert.deepEqual(new R().detail(), [])
  })

  it('detail() can return schema elements', () => {
    class R extends Resource {
      static model = MockModel as any

      detail(record?: Record<string, unknown>) {
        return [Stats.make([Stat.make('Views').value(Number(record?.views ?? 0))])]
      }
    }
    const elements = new R().detail({ views: 42 })
    assert.equal(elements.length, 1)
    assert.equal(elements[0]!.getType(), 'stats')
  })
})

describe('Resource — toMeta integration', () => {
  it('toMeta() derives config from table() and form()', () => {
    class PostResource extends Resource {
      static model = MockModel as any
      table(table: Table) {
        return table
          .softDeletes()
          .titleField('title')
          .emptyState({ icon: 'file', heading: 'No posts' })
      }
      form(form: Form) {
        return form.fields([TextField.make('title')])
      }
    }
    const meta = new PostResource().toMeta()
    assert.equal(meta.softDeletes, true)
    assert.equal(meta.titleField, 'title')
    assert.equal(meta.emptyStateIcon, 'file')
    assert.equal(meta.emptyStateHeading, 'No posts')
    assert.equal(meta.fields.length, 1)
  })
})
