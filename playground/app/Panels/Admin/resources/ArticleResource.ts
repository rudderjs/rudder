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
  RelationField,
  SelectFilter,
  Action,
} from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'

export class ArticleResource extends Resource {
  static model          = Article
  static label          = 'Articles'
  static labelSingular  = 'Article'
  static titleField     = 'title'
  static defaultSort    = 'createdAt'
  static defaultSortDir = 'DESC' as const

  fields() {
    return [
      // ── Content ──────────────────────────────────────────────
      Section.make('Content').schema(
        TextField.make('title')
          .label('Title')
          .required()
          .searchable()
          .sortable(),

        SlugField.make('slug')
          .label('Slug')
          .from('title')
          .required(),

        TextareaField.make('excerpt')
          .label('Excerpt')
          .rows(3)
          .hideFromTable(),

        FileField.make('coverImage')
          .label('Cover Image')
          .image()
          .accept('image/*')
          .maxSize(5)
          .disk('public')
          .directory('articles'),

        TagsField.make('tags')
          .label('Tags')
          .placeholder('Add a tag…'),

        RelationField.make('categories')
          .label('Categories')
          .resource('categories')
          .display('name')
          .multiple()
          .creatable()
          .hideFromTable(),
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
            .hideFromCreate(),

          ColorField.make('accentColor')
            .label('Accent Color')
            .hideFromTable(),

          DateField.make('createdAt')
            .label('Created At')
            .sortable()
            .readonly()
            .hideFromCreate()
            .hideFromEdit(),
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
