import { Page, Heading, Text, Table, Column, SelectFilter, Action, SelectField, TextareaField, ToggleField, Form, TextField } from '@pilotiq/panels'
import { Table as TableIcon } from 'lucide-static'
import type { PanelContext } from '@pilotiq/panels'
import { Article } from '../../../Models/Article.js'
import { PaginationDemo }   from './tables/PaginationDemo.js'
import { ExternalDataDemo } from './tables/ExternalDataDemo.js'
import { InlineEditDemo }   from './tables/InlineEditDemo.js'

export class TablesDemo extends Page {
  static slug  = 'tables-demo'
  static label = 'Tables Demo'
  static icon  = TableIcon
  static pages = [PaginationDemo, ExternalDataDemo, InlineEditDemo]

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Table Examples'),
      Text.make('Table extends List — adds .columns() for tabular layout. See sub-pages for pagination modes, external data, and inline editing.'),

      // ── 1. Full-featured table ─────────────────────────────
      Heading.make('Full-Featured Table').level(2),
      Text.make('Pagination, search, sort, filters, scopes, live updates, actions, session persist — all in one.'),

      Table.make('Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').sortable().searchable(),
          Column.make('draftStatus').label('Status').badge().sortable(),
          Column.make('featured').boolean().editable(ToggleField.make('featured')),
          Column.make('createdAt').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 5)
        .searchable()
        .remember('session')
        .live()
        .scopes([
          { label: 'All' },
          { label: 'Published', icon: 'circle-check', scope: (q: any) => q.where('draftStatus', 'published') },
          { label: 'Drafts', icon: 'pencil-line', scope: (q: any) => q.where('draftStatus', 'draft') },
        ])
        .filters([
          SelectFilter.make('draftStatus').label('Status').options([
            { label: 'Published', value: 'published' },
            { label: 'Draft', value: 'draft' },
          ]),
        ])
        .actions([
          Action.make('publish').label('Publish').bulk()
            .handler(async (records) => {
              for (const record of records as any[]) {
                await Article.query().update(record.id, { draftStatus: 'published', publishedAt: new Date() } as any)
              }
            }),
          Action.make('delete').label('Delete').destructive().confirm('Delete selected?').bulk()
            .handler(async (records) => {
              for (const record of records as any[]) {
                await Article.query().delete(record.id)
              }
            }),
        ]),

      // ── 2. Computed + display columns ──────────────────────
      Heading.make('Computed Columns').level(2),
      Text.make('Column.compute() derives values server-side. Column.display() formats output.'),

      Table.make('Articles with Computed Columns')
        .fromModel(Article)
        .columns([
          Column.make('title').sortable(),
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
        ])
        .sortBy('createdAt', 'DESC')
        .limit(5),

      // ── 3. Scoped query ────────────────────────────────────
      Heading.make('Scoped Table').level(2),
      Text.make('Permanently filtered via .scope() — only published articles.'),

      Table.make('Published Articles')
        .fromModel(Article)
        .scope(q => q.where('draftStatus', 'published'))
        .columns([
          Column.make('title').sortable(),
          Column.make('createdAt').date(),
        ])
        .sortBy('createdAt', 'DESC')
        .limit(5)
        .emptyMessage('No published articles yet.'),

      // ── 4. Static data ─────────────────────────────────────
      Heading.make('Static Data').level(2),
      Text.make('No model — data provided inline via .fromArray(). Supports search and sort.'),

      Table.make('Browser Market Share')
        .fromArray([
          { browser: 'Chrome', share: 65, trend: '+2.1%' },
          { browser: 'Safari', share: 18, trend: '-0.5%' },
          { browser: 'Firefox', share: 10, trend: '-1.2%' },
          { browser: 'Edge', share: 5, trend: '+0.8%' },
          { browser: 'Other', share: 2, trend: '-1.2%' },
        ])
        .columns([
          Column.make('browser').sortable().searchable(),
          Column.make('share').label('Share (%)').numeric().sortable(),
          Column.make('trend'),
        ])
        .searchable(),

      // ── 5. Form + Live Table ───────────────────────────────
      Heading.make('Form + Live Table').level(2),
      Text.make('Submit the form — the table refreshes automatically via .refreshes().'),

      Form.make('quick-article')
        .fields([
          TextField.make('title').label('Title').required(),
          SelectField.make('draftStatus').label('Status').default('draft').options([
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ]),
        ])
        .onSubmit(async (data) => {
          const base = String(data.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
          await Article.create({ title: data.title, slug: `${base}-${Date.now().toString(36)}`, draftStatus: data.draftStatus ?? 'draft' } as any)
        })
        .refreshes('Form Articles')
        .submitLabel('Create Article')
        .successMessage('Article created!'),

      Table.make('Form Articles')
        .fromModel(Article)
        .columns([
          Column.make('title').sortable(),
          Column.make('draftStatus').label('Status').badge(),
          Column.make('createdAt').date().sortable(),
        ])
        .sortBy('createdAt', 'DESC')
        .paginated('pages', 5)
        .live(),
    ]
  }
}
