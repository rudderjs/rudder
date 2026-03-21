import { Page, Heading, Text, Table, Column, SelectFilter, Action, SelectField, TextareaField, TagsField, ColorField, ToggleField, Form, TextField } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'
import { User }    from '../../../Models/User.js'
import { PaginationDemo }   from './tables/PaginationDemo.js'
import { ExternalDataDemo } from './tables/ExternalDataDemo.js'
import { InlineEditDemo }   from './tables/InlineEditDemo.js'

export class TablesDemo extends Page {
  static slug  = 'tables-demo'
  static label = 'Tables Demo'
  static icon  = 'table'
  static pages = [PaginationDemo, ExternalDataDemo, InlineEditDemo]

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Table Examples'),
      Text.make('Demonstrates all Table features: pagination, search, sort, remember, lazy, scope, fromArray.'),

      // ── Pages pagination + search + remember(url) + live ──────────
      Heading.make('Paginated Table (pages + URL persist)').level(2),
      Text.make('Search, sort, and pagination state persists in the URL. Try searching, sorting, then sharing the URL.'),

      Table.make('Articles (URL)')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable().href('/admin/articles/:id'),
          Column.make('draftStatus').label('Status').badge().sortable(),
          Column.make('createdAt').label('Created').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 3)
        .searchable()
        .emptyMessage('No articles found.')
        .remember('url')
        .live()
        .filters([
          SelectFilter.make('draftStatus').label('Status').options([
            { label: 'Published', value: 'published' },
            { label: 'Draft', value: 'draft' },
          ]),
        ])
        .actions([
          Action.make('edit').label('Edit').icon('pencil').row().url('/admin/articles/:id/edit'),
          Action.make('view').label('View').icon('eye').row().url('/admin/articles/:id'),
          Action.make('publish').label('Publish').bulk()
            .handler(async (records) => {
              for (const record of records as any[]) {
                await Article.query().update(record.id, { draftStatus: 'published', publishedAt: new Date() } as any)
              }
            }),
          Action.make('delete').label('Delete').destructive().confirm('Delete selected articles?').bulk()
            .handler(async (records) => {
              for (const record of records as any[]) {
                await Article.query().delete(record.id)
              }
            }),
        ]),

      // ── Load More pagination + remember(localStorage) ──────
      Heading.make('Load More Table (localStorage)').level(2),
      Text.make('Click "Load more" to append records. State saved in localStorage.'),

      Table.make('Articles (Load More)')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('loadMore', 3)
        .searchable()
        .remember('localStorage'),

      // ── Session persist ────────────────────────────────────
      Heading.make('Session Persist Table').level(2),
      Text.make('Page/sort/search state saved in server session. SSR\'d correctly on refresh.'),

      Table.make('Users (Session)')
        .fromModel(User)
        .columns([
          Column.make('name').label('Name').sortable().searchable(),
          Column.make('email').label('Email').sortable().searchable(),
          Column.make('role').label('Role').badge(),
          Column.make('createdAt').label('Joined').date(),
        ])
        .filters([
          SelectFilter.make('role').label('Role').options([
            { label: 'Admin', value: 'admin' },
            { label: 'User', value: 'user' },
          ]),
        ])
        .paginated('pages', 2)
        .searchable()
        .remember('session'),

      // ── Scoped table ───────────────────────────────────────
      Heading.make('Scoped Table').level(2),
      Text.make('Only shows published articles using .scope().'),

      Table.make('Published Articles')
        .fromModel(Article)
        .scope(q => q.where('draftStatus', 'published'))
        .columns([
          Column.make('title').label('Title').sortable(),
          Column.make('createdAt').label('Published').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .limit(5)
        .emptyMessage('No published articles yet.'),

      // ── Static array ─────────────────────────────────────────
      Heading.make('Static Data Table').level(2),
      Text.make('No model — data provided inline via .fromArray().'),

      Table.make('Browser Market Share')
        .fromArray([
          { browser: 'Chrome', share: 65, trend: '+2.1%' },
          { browser: 'Safari', share: 18, trend: '-0.5%' },
          { browser: 'Firefox', share: 10, trend: '-1.2%' },
          { browser: 'Edge', share: 5, trend: '+0.8%' },
          { browser: 'Other', share: 2, trend: '-1.2%' },
        ])
        .columns([
          Column.make('browser').label('Browser').sortable().searchable(),
          Column.make('share').label('Share (%)').numeric().sortable(),
          Column.make('trend').label('Trend'),
        ])
        .searchable()
        .description('Estimated global browser market share'),

      // ── No persistence (default) ───────────────────────────
      Heading.make('Simple Table (no persist)').level(2),
      Text.make('Basic table with no state persistence. Resets on every page load.'),

      Table.make('Recent 5 Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title'),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .limit(5),

      // ── Live table ───────────────────────────────────────
      Heading.make('Live Table (WebSocket)').level(2),
      Text.make('Real-time updates via WebSocket. Execute an action — the table refreshes automatically across all open tabs.'),

      Table.make('Live Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('draftStatus').label('Status').badge(),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 3)
        .searchable()
        .live()
        .actions([
          Action.make('publish').label('Publish').bulk()
            .handler(async (records) => {
              for (const record of records as any[]) {
                await Article.query().update(record.id, { draftStatus: 'published', publishedAt: new Date() } as any)
              }
            }),
          Action.make('delete').label('Delete').destructive().confirm('Delete?').bulk()
            .handler(async (records) => {
              for (const record of records as any[]) {
                await Article.query().delete(record.id)
              }
            }),
        ]),

      // ── Live + Editable ─────────────────────────────────────
      Heading.make('Live + Editable Table').level(2),
      Text.make('Real-time sync + inline editing. Open in two tabs — edit a cell in one, see it update instantly in the other.'),

      Table.make('Live Editable Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable().editable(),
          Column.make('draftStatus').label('Status').badge().editable(
            SelectField.make('draftStatus').options([
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
            ]),
          ),
          Column.make('featured').label('Featured').editable(ToggleField.make('featured')),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 5)
        .searchable()
        .live(),

      // ── Form + Live Table (.refreshes) ──────────────────────
      Heading.make('Form + Live Table').level(2),
      Text.make('Submit the form to create an article — the live table below refreshes automatically via .refreshes().'),

      Form.make('quick-article')
        .description('Quick-add a new article.')
        .fields([
          TextField.make('title').label('Title').required(),
          SelectField.make('draftStatus').label('Status').default('draft').options([
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ]),
        ])
        .onSubmit(async (data) => {
          const base = String(data.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
          const slug = `${base}-${Date.now().toString(36)}`
          await Article.create({ title: data.title, slug, draftStatus: data.draftStatus ?? 'draft' } as any)
        })
        .refreshes('Live Form Articles')
        .submitLabel('Create Article')
        .successMessage('Article created!'),

      Table.make('Live Form Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('draftStatus').label('Status').badge(),
          Column.make('createdAt').label('Created').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 5)
        .searchable()
        .live(),

      // ── Column compute + display ──────────────────────────
      Heading.make('Computed & Formatted Columns').level(2),
      Text.make('Column.compute() derives values from record. Column.display() formats for output. Both run server-side.'),

      Table.make('Articles with Computed Columns')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable(),
          Column.make('wordCount').label('Title Words')
            .compute((r) => {
              const text = String(r['title'] ?? '')
              return text.trim() ? text.trim().split(/\s+/).length : 0
            })
            .display((v) => `${v} ${Number(v) === 1 ? 'word' : 'words'}`),
          Column.make('status').label('Status')
            .compute((r) => String(r['draftStatus'] ?? 'unknown'))
            .display((v) => String(v).toUpperCase())
            .badge(),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .limit(20),

      // ── Async fromArray (external API) ─────────────────────
      Heading.make('External API Table').level(2),
      Text.make('Data fetched from JSONPlaceholder API at SSR time via .fromArray(async fn). Supports .lazy() and .poll().'),

      Table.make('GitHub-style Users')
        .fromArray(async () => {
          const res = await fetch('https://jsonplaceholder.typicode.com/users')
          const users = await res.json() as Array<{ id: number; name: string; email: string; company: { name: string }; address: { city: string } }>
          return users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            company: u.company.name,
            city: u.address.city,
          }))
        })
        .columns([
          Column.make('name').label('Name').sortable().searchable(),
          Column.make('email').label('Email').sortable().searchable(),
          Column.make('company').label('Company').sortable(),
          Column.make('city').label('City').sortable(),
        ])
        .searchable()
        .description('10 users from jsonplaceholder.typicode.com — SSR\'d'),

      // ── Lazy external API ──────────────────────────────────
      Heading.make('Lazy External API Table').level(2),
      Text.make('Same API but with .lazy() — shows skeleton on SSR, fetches client-side after mount.'),

      Table.make('Posts (Lazy)')
        .fromArray(async () => {
          const res = await fetch('https://jsonplaceholder.typicode.com/posts')
          const posts = await res.json() as Array<{ id: number; title: string; userId: number }>
          return posts.slice(0, 20).map(p => ({
            id: p.id,
            title: p.title,
            author: `User ${p.userId}`,
          }))
        })
        .columns([
          Column.make('title').label('Title').sortable().searchable(),
          Column.make('author').label('Author').sortable(),
        ])
        .paginated('pages', 5)
        .searchable()
        .lazy()
        .description('20 posts from jsonplaceholder.typicode.com — lazy loaded'),

      // ── Inline Editing ──────────────────────────────────────
      Heading.make('Inline Editable Table').level(2),
      Text.make('Click cell values to edit inline. Different edit modes: inline (text/select/toggle), popover (textarea), modal (complex fields).'),

      Table.make('Editable Users')
        .fromModel(User)
        .columns([
          Column.make('name').label('Name').sortable().searchable().editable(),
          Column.make('email').label('Email').sortable().searchable().editable(),
          Column.make('role').label('Role').editable(
            SelectField.make('role').options([
              { label: 'Admin', value: 'admin' },
              { label: 'User', value: 'user' },
            ]),
          ),
          Column.make('createdAt').label('Joined').date(),
        ])
        .paginated('pages', 5)
        .searchable(),

      // ── Editable Articles (model-backed, auto-save) ───────────
      Heading.make('Editable Articles (Model)').level(2),
      Text.make('Edit article fields directly in the table. Saves to database automatically via Model.update(). Try all three edit modes.'),

      Table.make('Editable Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').label('Title').sortable().searchable().editable(),
          Column.make('slug').label('Slug').editable(),
          Column.make('draftStatus').label('Status').badge().editable(
            SelectField.make('draftStatus').options([
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
              { label: 'Archived', value: 'archived' },
            ]),
          ),
          Column.make('featured').label('Featured').editable(ToggleField.make('featured')),
          Column.make('accentColor').label('Color').editable(ColorField.make('accentColor')),
          Column.make('excerpt').label('Excerpt').editable(TextareaField.make('excerpt'), 'popover'),
          Column.make('tags').label('Tags').editable(TagsField.make('tags'), 'popover'),
          Column.make('createdAt').label('Created').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 5)
        .searchable(),

      // ── Static editable (fromArray + onSave) ────────────────
      Heading.make('Static Editable Table').level(2),
      Text.make('Editable fromArray() table with onSave handler. Demonstrates inline, popover, and modal modes.'),

      Table.make('Editable Team')
        .fromArray([
          { id: 1, name: 'Alice', role: 'admin', active: true, bio: 'Full-stack developer with 10 years of experience.' },
          { id: 2, name: 'Bob', role: 'user', active: false, bio: 'UI/UX designer passionate about accessibility.' },
          { id: 3, name: 'Carol', role: 'user', active: true, bio: 'DevOps engineer specializing in cloud infrastructure.' },
        ])
        .columns([
          Column.make('name').label('Name').editable(),
          Column.make('role').label('Role').editable(
            SelectField.make('role').options([
              { label: 'Admin', value: 'admin' },
              { label: 'User', value: 'user' },
            ]),
          ),
          Column.make('active').label('Active').boolean().editable(),
          Column.make('bio').label('Bio').editable(TextareaField.make('bio'), 'popover'),
        ])
        .onSave(async (record, field, value) => {
          console.log('[inline edit]', { recordId: record['id'], field, value })
        }),
    ]
  }
}
