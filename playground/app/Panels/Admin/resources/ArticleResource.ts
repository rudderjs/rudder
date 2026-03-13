import {
  Resource,
  Section,
  TextField,
  TextareaField,
  SlugField,
  SelectField,
  ToggleField,
  TagsField,
  DateField,
  ColorField,
  FileField,
  JsonField,
  ContentField,
  RichContentField,
  RelationField,
  ComputedField,
  SelectFilter,
  Action,
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
  static perPage = 5
  static perPageOptions = [5,10, 15, 25, 50, 100]
  static live      = true
  static versioned = true

  fields() {
    return [
      // ── Content ──────────────────────────────────────────────
      Section.make('Content').schema(
        TextField.make('title')
          .label('Title')
          .required()
          .searchable()
          .sortable()
          .collaborative(),

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

        ContentField.make('content')
          .label('Content')
          .placeholder('Start writing...')
          .collaborative(),

        RichContentField.make('body')
          .label('Body (Lexical)')
          .placeholder('Start writing your article…')
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
      ),

      // ── Publishing ────────────────────────────────────────────
      Section.make('Publishing')
        .columns(2)
        .schema(
          SelectField.make('status')
            .label('Status')
            .options([
              { label: 'Draft',     value: 'draft'     },
              { label: 'Published', value: 'published' },
              { label: 'Archived',  value: 'archived'  },
            ])
            .default('draft')
            .required(),

          ToggleField.make('featured')
            .label('Featured')
            .onLabel('Featured')
            .offLabel('Not featured'),

          DateField.make('publishedAt')
            .label('Publish Date')
            // Conditional: only show when status = published
            .showWhen('status', 'published'),

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

  filters() {
    return [
      // SelectFilter.make('status')
      //   .label('Status')
      //   .options([
      //     { label: 'Draft',     value: 'draft'     },
      //     { label: 'Published', value: 'published' },
      //     { label: 'Archived',  value: 'archived'  },
      //   ]),

    SelectFilter.make('status')
      .label('Status')
        .options([
          { label: 'Draft',     value: 'draft'     },
          { label: 'Published', value: 'published' },
          { label: 'Archived',  value: 'archived'  },
        ])
      .query((q, value) => q.where('status', value)),

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
              status:      'published',
              publishedAt: new Date(),
            })
          }
        }),

      Action.make('unpublish')
        .label('Revert to Draft')
        .bulk()
        .handler(async (records) => {
          for (const record of records as Article[]) {
            await Article.query().update(record.id, { status: 'draft' })
          }
        }),

      Action.make('archive')
        .label('Archive')
        .destructive()
        .confirm('Archive selected articles?')
        .bulk()
        .handler(async (records) => {
          for (const record of records as Article[]) {
            await Article.query().update(record.id, { status: 'archived' })
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
