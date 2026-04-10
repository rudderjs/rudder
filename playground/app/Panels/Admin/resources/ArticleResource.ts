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
} from '@pilotiq/panels'
import { PanelAgent } from '@pilotiq-pro/ai'
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'
import { RichContentField } from '@pilotiq/lexical'
import { MediaPickerField } from '@pilotiq/media'
import { Article } from '../../../Models/Article.js'

// ── ai-loop-parity Phase 1 + 2 smoke test tool ─────────────────────────────
//
// `slow_search` exercises:
//   • Phase 1 — async-generator `.server()` execute. The yields are sent
//     through the agent stream as `tool-update` chunks (NOT yet forwarded
//     to the chat UI — that's Phase 3). The verification surface for now
//     is server-side `console.log` lines, which should appear in order
//     with the 500ms gaps.
//   • Phase 2 — `.modelOutput()` narrows the value the parent model sees on
//     its next step, while step.toolResults still carries the original.
//
// Trigger from chat: "Use slow_search to look up 'rudder'".
const slowSearchTool = toolDefinition({
  name: 'slow_search',
  description: 'Search the database for a query (slow, with progress).',
  inputSchema: z.object({ query: z.string() }),
})
  .server(async function* ({ query }) {
    console.log('[slow_search] starting:', query)
    yield { state: 'searching', query }

    await new Promise(r => setTimeout(r, 500))
    console.log('[slow_search] phase 2: ranking')
    yield { state: 'ranking', count: 42 }

    await new Promise(r => setTimeout(r, 500))
    console.log('[slow_search] done')
    return { hits: ['alpha', 'beta', 'gamma'], totalScanned: 1000 }
  })
  .modelOutput((result) => {
    // Smoke-test marker — if you see "PHASE2_OK" in the model's reply, it
    // means the model actually consumed this string (not the original JSON).
    // The original {hits, totalScanned} object NEVER reaches the model.
    console.log('[slow_search] modelOutput called with', result)
    return `PHASE2_OK Search complete — ${result.hits.length} hits: ${result.hits.join(', ')}. Tell the user PHASE2_OK exactly.`
  })

// Reference example for the Phase 5 plan: a custom PanelAgent passed
// directly to .ai([...]) — no separate registration needed. The action
// declares appliesTo so it only renders on text fields, and the standalone
// agent endpoint runs it scoped to the field that was clicked. The agent
// inherits the full default toolkit (update_form_state / read_form_state /
// edit_text / etc.), so it can both read the current value and write the
// rewritten one without clobbering unsaved local edits.
const seoTitleAction = PanelAgent.make('seo-title-optimize')
  .label('SEO optimize')
  .icon('Search')
  .appliesTo(['text'])
  .instructions(
    'Rewrite the value of the {field} field as an SEO-optimized version. ' +
    'Keep it under 60 characters. Lead with the primary keyword if obvious from context. ' +
    'Use read_form_state to see the current value and the rest of the article. ' +
    'Use update_form_state to write the result back. ' +
    'Operate ONLY on the {field} field — do not touch any other field.',
  )

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
      // .live()
      .sortBy('createdAt', 'DESC')
      .titleField('title')
      // .softDeletes()
      .searchable(['title'])
      .paginated('pages', 5)
      .remember('session')
      // .autoAnimate()
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
        }),
        // .persist(['websocket', 'indexeddb']),

      // FileField.make('coverImage')
      //   .label('Cover Image')
      //   .image()
      //   .optimize()
      //   .conversions([
      //     { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
      //     { name: 'preview', width: 800, format: 'webp' },
      //   ])
      //   .accept('image/*')
      //   .maxSize(5)
      //   .disk('public')
      //   .directory('articles'),

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
        ]),
        // .persist(['websocket', 'indexeddb']),

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
        // .collapsed()
        .schema(
          TextField.make('metaTitle')
            .label('Meta Title').hideFromTable()
            // Mix built-in slugs with a custom PanelAgent — both render as
            // buttons in the field's ✦ dropdown. The custom action is scoped
            // to this single field via .appliesTo + the standalone endpoint's
            // `field` parameter.
            .ai(['rewrite', 'shorten', seoTitleAction]),

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

      PanelAgent.make('improve-content')
        .label('Improve Content')
        .icon('Search')
        .instructions('You are a content editor. you can edit the content of the article to improve clarity, grammar, and engagement. Use the current content and title for context.')
        .fields(['title', 'content']),

      // ai-loop-parity Phase 1 + 2 smoke test agent. Standalone (button-click)
      // so it must NOT wait for user input — it calls slow_search immediately
      // with a hardcoded query, then summarizes. After this runs you should
      // see, in the playground server console:
      //   [slow_search] starting: rudder
      //   [slow_search] phase 2: ranking
      //   [slow_search] done
      // and the chat reply should mention "3 hits" + "rudder" but should NOT
      // quote totalScanned (that field is hidden by .modelOutput).
      PanelAgent.make('slow-search-test')
        .label('Slow search (smoke test)')
        .icon('Search')
        .instructions(
          'You exist ONLY to smoke-test the slow_search tool. ' +
          'Immediately call slow_search with the query "rudder" — do not ' +
          'ask for any input. After it returns, reply in one sentence summarizing ' +
          'what slow_search said. Do NOT call any other tool, do NOT modify any ' +
          'field, do NOT call update_form_state. Just call slow_search once and ' +
          'then write the one-sentence summary.',
        )
        .tools([slowSearchTool]),
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
