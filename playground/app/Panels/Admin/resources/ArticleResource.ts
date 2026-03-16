import {
  Resource,
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
  ContentField,
  RichContentField,
  Block,
  RelationField,
  ComputedField,
  Action,
  Tab,
} from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'

export class ArticleResource extends Resource {
  static model          = Article
  static label          = 'Articles'
  static labelSingular  = 'Article'
  static icon           = 'file-text'
  static titleField     = 'title'
  static defaultSort    = 'createdAt'
  static defaultSortDir = 'DESC' as const
  static persistTableState = true
  static persistFormState  = false
  // static autosave          = { interval: 10000 }
  static perPage = 5
  static perPageOptions = [5,10, 15, 25, 50, 100]
  static live          = true
  static versioned     = true
  static draftable     = true
  static softDeletes   = true

  static navigationGroup     = 'Content'
  static navigationBadge     = async () => await Article.query().count()
  static navigationBadgeColor = 'primary' as const
  static emptyStateIcon       = 'file-text'
  static emptyStateHeading    = 'No :label yet'
  static emptyStateDescription = 'Write your first article to share with the world.'

  fields() {
    return [
      // ── Content ──────────────────────────────────────────────
      TextField.make('title')
        .label('Title')
        .required()
        .searchable()
        .sortable()
        .persist(['websocket', 'indexeddb']),

      SlugField.make('slug')
        .label('Slug')
        .from('title')
        .required()
        // Per-field validation: unique slug check
        .validate(async (value, data) => {
          const q = Article.query().where('slug', value as string)
          if (data['id']) (q as any).where('id', '!=', data['id'])
          return await (q as any).first() ? 'Slug already in use' : true
        }),

      TextareaField.make('excerpt')
        .label('Excerpt')
        .rows(3)
        .hideFromTable()
        .collaborative(),

      FileField.make('coverImage')
        .label('Cover Image')
        .image()
        .accept('image/*')
        .maxSize(5)
        .disk('public')
        .directory('articles'),

        // ContentField.make('content')
        //   .label('Content')
        //   .placeholder('Start writing...'),
          // .collaborative(),

        RichContentField.make('content')
          .label('Content (Lexical)')
          .placeholder('Start writing your article…')
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
          .collaborative(),

        RichContentField.make('body')
          .label('Body (Lexical)')
          .placeholder('Start writing your article…')
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
          .collaborative(),

        TagsField.make('tags')
          .label('Tags')
          .placeholder('Add a tag…'),

        RelationField.make('categories')
          .label('Categories')
          .resource('categories')
          .displayField('name')
          .multiple()
          .creatable(),
          // .hideFromTable(),


      // ── Publishing ────────────────────────────────────────────
      Section.make('Publishing')
        .columns(2)
        .schema(
          ToggleField.make('featured')
            .label('Featured')
            .onLabel('Featured')
            .offLabel('Not featured')
            .inlineEditable()
            .collaborative(),

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
            // Display transformer: format date for table/show
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
            .label('Meta Title').hideFromTable(),

          TextareaField.make('metaDescription')
            .label('Meta Description')
            .rows(2).hideFromTable(),

          JsonField.make('metadata')
            .label('Extra Metadata')
            .rows(4).hideFromTable(),
        ),

      // Computed virtual field — word count derived from excerpt
      ComputedField.make('wordCount')
        .label('Words')
        .compute((r) => {
          const text = ((r as any).excerpt as string | undefined) ?? ''
          return text.trim() ? text.trim().split(/\s+/).length : 0
        })
        .display((v) => `${v} words`),

    ]
  }

  tabs() {
    return [
      Tab.make('all').label('All'),
      Tab.make('published').label('Published').icon('circle-check').query((q: any) => q.where('draftStatus', 'published')),
      Tab.make('draft').label('Drafts').icon('pencil-line').query((q: any) => q.where('draftStatus', 'draft')),
    ]
  }

  filters() {
    return [
      SelectFilter.make('featured')
        .label('Featured')
        .options([
          { label: 'Featured',     value: true  },
          { label: 'Not featured', value: false },
        ]),
    ]
  }

  actions() {
    return [
      Action.make('publish')
        .label('Publish')
        .bulk()
        .handler(async (records) => {
          for (const record of records as Article[]) {
            await Article.query().update(record.id, {
              draftStatus: 'published',
              publishedAt: new Date(),
            })
          }
        }),

      Action.make('unpublish')
        .label('Revert to Draft')
        .bulk()
        .handler(async (records) => {
          for (const record of records as Article[]) {
            await Article.query().update(record.id, { draftStatus: 'draft' })
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
    ]
  }
}
