import {
  Resource,
  PanelAgent,
  Section,
  TextField,
  TextareaField,
  SlugField,
  SelectField,
  SelectFilter,
  ToggleField,
  TagsField,
  DateField,
  ColorField,
  FileField,
  JsonField,
  Block,
  RelationField,
  Action,
  Tab,
  Table,
  Form,
  Column,
  DataField,
  ViewMode,
  Stats,
  Stat,
} from '@rudderjs/panels'
import { RichContentField } from '@rudderjs/panels-lexical'
import { MediaPickerField } from '@rudderjs/media'
import { Article } from '../../../Models/Article.js'

export class ArticleResource extends Resource {
  static model          = Article
  static label          = 'Articles'
  static labelSingular  = 'Article'
  static icon           = 'file-text'
  static perPageOptions = [5, 10, 15, 25, 50, 100]

  static navigationGroup      = 'Content'
  static navigationBadge      = async () => await Article.query().count()
  static navigationBadgeColor = 'primary' as const

  table(table: Table) {
    return table
      .views([
        ViewMode.table([
          Column.make('title').sortable().searchable(),
          Column.make('slug'),
          Column.make('featured').boolean().editable(ToggleField.make('featured')),
          Column.make('publishedAt').date(),
          Column.make('createdAt').date().sortable(),
        ]),
        ViewMode.list([
          DataField.make('title'),
          DataField.make('publishedAt').date(),
          DataField.make('featured').badge(),
        ]),
        ViewMode.grid([
          DataField.make('title'),
          DataField.make('publishedAt').date(),
          DataField.make('featured').badge(),
        ]),
      ])
      .live()
      .sortBy('createdAt', 'DESC')
      .titleField('title')
      .softDeletes()
      .searchable(['title'])
      .paginated('pages', 5)
      .remember('session')
      .autoAnimate()
      .animateScopes({ highlight: true, content: false })
      .emptyState({
        icon: 'file-text',
        heading: 'No :label yet',
        description: 'Write your first article to share with the world.',
      })
      .scopes([
        { label: 'All' },
        { label: 'Published', icon: 'circle-check', scope: (q: any) => q.where('draftStatus', 'published') },
        { label: 'Drafts', icon: 'pencil-line', scope: (q: any) => q.where('draftStatus', 'draft') },
      ])
      .filters([
        SelectFilter.make('featured')
          .label('Featured')
          .options([
            { label: 'Featured',     value: true  },
            { label: 'Not featured', value: false },
          ]),
      ])
      .actions([
        Action.make('publish')
          .label('Publish')
          .bulk()
          .handler(async (records) => {
            for (const record of records as Article[]) {
              await Article.query().update(record.id, {
                draftStatus: 'published',
                publishedAt: new Date(),
              } as any)
            }
          }),

        Action.make('unpublish')
          .label('Revert to Draft')
          .bulk()
          .handler(async (records) => {
            for (const record of records as Article[]) {
              await Article.query().update(record.id, { draftStatus: 'draft' } as any)
            }
          }),

        Action.make('resync')
          .label('Re-sync Live Data')
          .confirm('Clear stale collaborative data and re-seed from database for selected articles?')
          .bulk()
          .handler(async (records) => {
            const { Live } = await import('@rudderjs/live')
            for (const record of records as Article[]) {
              const id = (record as any).id as string
              const docName = `panel:articles:${id}`
              // Clear all Y.Doc rooms (main + per-field)
              await Live.clearDocument(docName)
              const fieldPrefixes = ['text:title', 'text:slug', 'richcontent:content']
              for (const prefix of fieldPrefixes) {
                await Live.clearDocument(`${docName}:${prefix}`)
              }
              // Re-seed from saved DB data
              const saved = await Article.query().find(id)
              if (saved) {
                const row = saved as Record<string, unknown>
                await Live.seed(docName, row)
              }
            }
          }),

        Action.make('delete')
          .label('Delete')
          .destructive()
          .confirm('Permanently delete selected articles? This cannot be undone.')
          .bulk()
          .handler(async (records) => {
            for (const record of records as Article[]) {
              await Article.query().delete(record.id)
            }
          }),
      ])
      .live()
  }

  form(form: Form) {
    form.versioned().draftable()
    return form.fields([
      // ── Content ──────────────────────────────────────────────
      TextField.make('title')
        .label('Title')
        .required()
        .searchable()
        .sortable()
        .persist(['websocket', 'indexeddb'])
        .ai(['rewrite', 'shorten', 'expand', 'fix-grammar']),

      SlugField.make('slug')
        .label('Slug')
        .from('title')
        .required()
        .validate(async (value, data) => {
          const q = Article.query().where('slug', value as string)
          if (data['id']) (q as any).where('id', '!=', data['id'])
          return await (q as any).first() ? 'Slug already in use' : true
        })
        .persist(['websocket', 'indexeddb']),

      FileField.make('coverImage')
        .label('Cover Image')
        .image()
        .optimize()
        .conversions([
          { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
          { name: 'preview', width: 800, format: 'webp' },
        ])
        .accept('image/*')
        .maxSize(5)
        .disk('public')
        .directory('articles'),

      MediaPickerField.make('mediaId')
        .label('Featured Media')
        .library('photos'),

      RichContentField.make('content')
        .label('Content (Lexical)')
        .placeholder('Start writing your article…')
        .ai(['rewrite', 'expand', 'shorten', 'fix-grammar', 'translate', 'simplify'])
        .blocks([
          Block.make('callToAction')
            .label('Call to Action')
            .icon('📣')
            .schema([
              TextField.make('title').label('Title').required(),
              TextField.make('buttonText').label('Button Text'),
              TextField.make('url').label('URL'),
              SelectField.make('style').label('Style').options([
                { value: 'primary', label: 'Primary' },
                { value: 'outline', label: 'Outline' },
              ]),
            ]),
          Block.make('video')
            .label('Video Embed')
            .icon('🎬')
            .schema([
              TextField.make('url').label('URL').required(),
              TextField.make('caption').label('Caption'),
            ]),
        ])
        .persist(['websocket', 'indexeddb']),

      TagsField.make('tags')
        .label('Tags')
        .placeholder('Add a tag…'),

      RelationField.make('categories')
        .label('Categories')
        .resource('categories')
        .displayField('name')
        .multiple()
        .creatable(),

      // ── Publishing ────────────────────────────────────────────
      Section.make('Publishing')
        .columns(2)
        .schema(
          ToggleField.make('featured')
            .label('Featured')
            .onLabel('Featured')
            .offLabel('Not featured'),

          DateField.make('publishedAt')
            .label('Publish Date'),

          ColorField.make('accentColor')
            .label('Accent Color')
            .hideFromTable(),

          DateField.make('createdAt')
            .label('Created At')
            .sortable()
            .readonly()
            .hideFromCreate()
            .hideFromEdit()
            .display((v) =>
              v ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(v as string)) : '—'
            ),
        ),

      // ── SEO & Metadata ────────────────────────────────────────
      Section.make('SEO & Metadata')
        .description('Optional fields to improve search engine visibility.')
        .collapsible()
        .collapsed()
        .schema(
          TextField.make('metaTitle')
            .label('Meta Title').hideFromTable()
            .ai(['rewrite', 'shorten']),

          TextareaField.make('metaDescription')
            .label('Meta Description')
            .rows(2).hideFromTable()
            .ai(['rewrite', 'shorten', 'expand']),

          JsonField.make('metadata')
            .label('Extra Metadata')
            .rows(4).hideFromTable(),
        ),

    ])
  }

  agents() {
    return [
      PanelAgent.make('seo')
        .label('Improve SEO')
        .icon('Search')
        .instructions('You are an SEO expert. Analyse the current article and improve the meta title and meta description for better search engine visibility. Keep the meta title under 60 characters and meta description under 160 characters. Use the title and excerpt for context.')
        .fields(['metaTitle', 'metaDescription']),

      PanelAgent.make('editor')
        .label('Edit Content')
        .icon('Pencil')
        .instructions('You are a content editor. You can edit the article title and content fields. Always call read_record first to see the current content.')
        .fields(['title', 'content']),
    ]
  }

  detail(record?: Record<string, unknown>) {
    return [
      Stats.make([
        Stat.make('Slug').value(String(record?.slug ?? '—')),
        Stat.make('Status').value(String(record?.draftStatus ?? 'draft')),
      ]),
    ]
  }
}
