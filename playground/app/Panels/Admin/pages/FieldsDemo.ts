import {
  Page, Heading, Text, Code, Form, Section,
  TextField, EmailField, PasswordField, NumberField,
  TextareaField, SelectField, BooleanField, ToggleField,
  DateField, ColorField, TagsField, SlugField,
  JsonField, HiddenField, FileField,
  RepeaterField, BuilderField, RichContentField, Block,
} from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'

export class FieldsDemo extends Page {
  static slug  = 'fields-demo'
  static label = 'Fields Demo'
  static icon  = 'text-cursor-input'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Field Types'),
      Text.make('All available field types with configuration examples.'),

      // ── Text Fields ────────────────────────────────────────
      Heading.make('Text Fields').level(2),
      Text.make('TextField, EmailField, PasswordField, TextareaField.'),
      TextField.make('test').label('Test field'),

      Form.make('text-fields')
        .fields([
          TextField.make('name').label('Name').required(),
          TextField.make('title').label('Title with Default').default('Untitled'),
          EmailField.make('email').label('Email').required(),
          PasswordField.make('password').label('Password').required(),
          TextareaField.make('bio').label('Bio'),
        ])
        .submitLabel('Submit Text Fields')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[text fields]', data) }),

      // ── Number & Date ──────────────────────────────────────
      Heading.make('Number & Date Fields').level(2),
      Text.make('NumberField, DateField.'),

      Form.make('number-date')
        .fields([
          NumberField.make('age').label('Age').default(25),
          NumberField.make('price').label('Price ($)'),
          DateField.make('birthday').label('Birthday'),
          DateField.make('startDate').label('Start Date').default(new Date().toISOString().split('T')[0]),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[number-date]', data) }),

      // ── Select & Boolean ───────────────────────────────────
      Heading.make('Select, Boolean & Toggle').level(2),
      Text.make('SelectField with options, BooleanField checkbox, ToggleField switch.'),

      Form.make('select-boolean')
        .fields([
          SelectField.make('role').label('Role').default('user').options([
            { label: 'Admin', value: 'admin' },
            { label: 'Editor', value: 'editor' },
            { label: 'User', value: 'user' },
          ]),
          SelectField.make('categories').label('Categories (Multi)').options([
            { label: 'Technology', value: 'tech' },
            { label: 'Design', value: 'design' },
            { label: 'Business', value: 'business' },
            { label: 'Science', value: 'science' },
          ]).multiple(),
          BooleanField.make('active').label('Active'),
          ToggleField.make('featured').label('Featured Article'),
          ToggleField.make('notifications').label('Email Notifications').default(true),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[select-boolean]', data) }),

      // ── Slug & Tags ────────────────────────────────────────
      Heading.make('Slug & Tags').level(2),
      Text.make('SlugField auto-generates from another field. TagsField for comma-separated values.'),

      Form.make('slug-tags')
        .fields([
          TextField.make('articleTitle').label('Article Title'),
          SlugField.make('slug').label('URL Slug').from('articleTitle'),
          TagsField.make('tags').label('Tags'),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[slug-tags]', data) }),

      // ── Color & JSON ───────────────────────────────────────
      Heading.make('Color & JSON').level(2),
      Text.make('ColorField color picker. JsonField for raw JSON editing.'),

      Form.make('color-json')
        .fields([
          ColorField.make('primaryColor').label('Primary Color').default('#3b82f6'),
          ColorField.make('accentColor').label('Accent Color'),
          JsonField.make('metadata').label('Metadata (JSON)').default('{\n  "key": "value"\n}'),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[color-json]', data) }),

      // ── File Upload ────────────────────────────────────────
      Heading.make('File Upload').level(2),
      Text.make('FileField for file and image uploads.'),

      Form.make('file-upload')
        .fields([
          FileField.make('avatar').label('Profile Picture').image().accept('image/*').maxSize(5),
          FileField.make('document').label('Document').accept('.pdf,.doc,.docx'),
        ])
        .submitLabel('Upload')
        .successMessage('Uploaded!')
        .onSubmit(async (data) => { console.log('[file-upload]', data) }),

      // ── Conditional Fields ─────────────────────────────────
      Heading.make('Conditional Fields').level(2),
      Text.make('Fields that show/hide based on other field values using .showWhen() and .hideWhen().'),

      Form.make('conditional')
        .fields([
          SelectField.make('contactMethod').label('Contact Method').options([
            { label: 'Email', value: 'email' },
            { label: 'Phone', value: 'phone' },
            { label: 'None', value: 'none' },
          ]).default('email'),
          EmailField.make('contactEmail').label('Email Address').showWhen('contactMethod', 'email'),
          TextField.make('contactPhone').label('Phone Number').showWhen('contactMethod', 'phone'),
          ToggleField.make('newsletter').label('Subscribe to Newsletter').hideWhen('contactMethod', 'none'),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[conditional]', data) }),

      // ── Hidden Field ───────────────────────────────────────
      Heading.make('Hidden Field').level(2),
      Text.make('HiddenField is not visible but included in form data.'),

      Form.make('hidden-field')
        .fields([
          HiddenField.make('formType').default('demo'),
          TextField.make('comment').label('Comment'),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted! (check console for hidden value)')
        .onSubmit(async (data) => { console.log('[hidden-field]', data) }),

      // ── With Sections ──────────────────────────────────────
      Heading.make('Fields in Sections').level(2),
      Text.make('Fields grouped into collapsible sections.'),

      Form.make('sectioned')
        .fields([
          Section.make('Personal Info').schema(
            TextField.make('firstName').label('First Name').required(),
            TextField.make('lastName').label('Last Name').required(),
            EmailField.make('personalEmail').label('Email'),
          ),
          Section.make('Address').collapsible().collapsed().schema(
            TextField.make('street').label('Street'),
            TextField.make('city').label('City'),
            TextField.make('zip').label('ZIP Code'),
          ),
          Section.make('Preferences').collapsible().schema(
            ToggleField.make('darkMode').label('Dark Mode').default(true),
            SelectField.make('language').label('Language').default('en').options([
              { label: 'English', value: 'en' },
              { label: 'Arabic', value: 'ar' },
              { label: 'Spanish', value: 'es' },
            ]),
          ),
        ])
        .submitLabel('Save Profile')
        .successMessage('Profile saved!')
        .onSubmit(async (data) => { console.log('[sectioned]', data) }),

      // ── Persist Fields ─────────────────────────────────────
      Heading.make('Field Persist Modes').level(2),
      Text.make('Fields with .persist() — values survive refresh. Try typing, then refresh.'),

      Heading.make('persist(\'url\') — URL Query Params').level(3),
      Text.make('Field values saved in URL. Shareable and SSR\'d.'),

      Form.make('persist-url')
        .fields([
          TextField.make('search').label('Search Query').persist('url'),
          SelectField.make('category').label('Category').persist('url').default('all').options([
            { label: 'All', value: 'all' },
            { label: 'Technology', value: 'tech' },
            { label: 'Design', value: 'design' },
          ]),
        ])
        .submitLabel('Apply')
        .successMessage('Applied!')
        .onSubmit(async (data) => { console.log('[persist-url]', data) }),

      Heading.make('persist(\'session\') — Server Session').level(3),
      Text.make('Field values saved in server session. SSR\'d on refresh, clean URL.'),

      Form.make('persist-session')
        .fields([
          TextField.make('notes').label('Notes').persist('session'),
          SelectField.make('theme').label('Theme').persist('session').default('system').options([
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'System', value: 'system' },
          ]),
        ])
        .submitLabel('Save')
        .successMessage('Saved!')
        .onSubmit(async (data) => { console.log('[persist-session]', data) }),

      Heading.make('persist(\'localStorage\') — Browser Storage').level(3),
      Text.make('Field values saved in browser localStorage. Survives refresh.'),

      Form.make('persist-local')
        .fields([
          TextField.make('draft').label('Draft Text').persist('localStorage'),
          NumberField.make('fontSize').label('Font Size').persist('localStorage').default(16),
        ])
        .submitLabel('Save')
        .successMessage('Saved!')
        .onSubmit(async (data) => { console.log('[persist-local]', data) }),

      // ── Collaborative Fields ───────────────────────────────
      Heading.make('Collaborative Fields').level(2),
      Text.make('Fields with .persist(\'websocket\') — real-time sync across browser tabs. Open this page in two tabs to see live collaboration.'),

      Form.make('collab-demo')
        .description('Try editing in two browser tabs — changes sync in real-time.')
        .fields([
          TextField.make('title').label('Collaborative Title').persist('websocket'),
          TextareaField.make('notes').label('Collaborative Notes').persist('websocket'),
          ToggleField.make('published').label('Published').persist('websocket'),
        ])
        .submitLabel('Save')
        .successMessage('Saved!')
        .onSubmit(async (data) => { console.log('[collab form]', data) }),

      // ── Reactive Derived Fields ────────────────────────────
      Heading.make('Reactive Derived Fields').level(2),
      Text.make('Fields with .from() + .derive() — auto-compute from other fields as you type.'),

      Form.make('derived-demo')
        .fields([
          TextField.make('firstName').label('First Name').default('John'),
          TextField.make('lastName').label('Last Name').default('Doe'),
          TextField.make('fullName').label('Full Name (derived)')
            .from('firstName', 'lastName')
            .derive(({ firstName, lastName }) => `${firstName ?? ''} ${lastName ?? ''}`.trim())
            .debounce(0)
            .readonly(),
          TextField.make('articleTitle').label('Article Title'),
          TextField.make('slug').label('URL Slug (derived, editable)')
            .from('articleTitle')
            .derive(({ articleTitle }) => String(articleTitle ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')),
          TextareaField.make('body').label('Body'),
          TextField.make('wordCount').label('Word Count (derived)')
            .from('body')
            .derive(({ body }) => {
              const words = String(body ?? '').trim().split(/\s+/).filter(Boolean).length
              return `${words} ${words === 1 ? 'word' : 'words'}`
            })
            .readonly(),
        ])
        .submitLabel('Submit')
        .successMessage('Submitted!')
        .onSubmit(async (data) => { console.log('[derived form]', data) }),

      // ── Persist + Derive combined ──────────────────────────
      Heading.make('Persist + Derive Combined').level(2),
      Text.make('Title persists in URL. Slug auto-derives from title. Share the URL — both values SSR correctly.'),

      Form.make('persist-derive')
        .fields([
          TextField.make('title').label('Article Title').persist('url'),
          TextField.make('slug').label('URL Slug (derived from title)')
            .from('title')
            .derive(({ title }) => String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
            .debounce(300),
          TextareaField.make('content').label('Content').persist('url'),
          TextField.make('readTime').label('Read Time (derived)')
            .from('content')
            .derive(({ content }) => {
              const words = String(content ?? '').trim().split(/\s+/).filter(Boolean).length
              const minutes = Math.max(1, Math.ceil(words / 200))
              return `${minutes} min read`
            })
            .debounce(500)
            .readonly(),
        ])
        .submitLabel('Publish')
        .successMessage('Published!')
        .onSubmit(async (data) => { console.log('[persist-derive]', data) }),

      // ── Code Blocks ──────────────────────────────────────────
      Heading.make('Code Blocks').level(2),
      Text.make('Code.make() renders syntax-highlighted code blocks with copy button.'),

      Code.make(`import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'

export default Application.configure({
  server: hono(configs.server),
  providers,
}).create()`).language('typescript').title('bootstrap/app.ts'),

      Code.make(`pnpm add @boostkit/core @boostkit/server-hono
pnpm build
cd playground && pnpm dev`).language('bash').title('Quick Start'),

      Code.make(`{
  "name": "@boostkit/panels",
  "version": "0.0.3",
  "type": "module"
}`).language('json').title('package.json'),

      Code.make(`SELECT a.title, a.status, COUNT(c.id) as comments
FROM articles a
LEFT JOIN comments c ON c.article_id = a.id
GROUP BY a.id
ORDER BY comments DESC
LIMIT 10;`).language('sql').title('Top Articles by Comments').lineNumbers(),

      // ── Repeater Field ────────────────────────────────────────
      Heading.make('Repeater Field').level(2),
      Text.make('RepeaterField renders a list of repeatable field groups. Add, remove, and reorder items with drag-and-drop.'),

      Form.make('repeater-demo')
        .fields([
          RepeaterField.make('features').label('Features').addLabel('Add Feature').maxItems(5).schema([
            TextField.make('title').label('Title').required(),
            TextareaField.make('description').label('Description'),
            SelectField.make('status').label('Status').default('planned').options([
              { label: 'Planned', value: 'planned' },
              { label: 'In Progress', value: 'in-progress' },
              { label: 'Done', value: 'done' },
            ]),
          ]),
        ])
        .submitLabel('Save Features')
        .successMessage('Features saved!')
        .onSubmit(async (data) => { console.log('[repeater]', data) }),

      Code.make(`RepeaterField.make('features')
  .label('Features')
  .addLabel('Add Feature')
  .maxItems(5)
  .schema([
    TextField.make('title').label('Title').required(),
    TextareaField.make('description').label('Description'),
    SelectField.make('status').label('Status').options([...]),
  ])`).language('typescript').title('Repeater API'),

      // ── Builder Field ─────────────────────────────────────────
      Heading.make('Builder Field').level(2),
      Text.make('BuilderField is a page/content builder. Users pick from block types, each with its own fields. Drag to reorder.'),

      Form.make('builder-demo')
        .fields([
          BuilderField.make('pageContent').label('Page Content').addLabel('Add Block').blocks([
            Block.make('hero')
              .label('Hero Section')
              .icon('🦸')
              .schema([
                TextField.make('title').label('Headline').required(),
                TextareaField.make('subtitle').label('Subtitle'),
                SelectField.make('alignment').label('Alignment').default('center').options([
                  { label: 'Left', value: 'left' },
                  { label: 'Center', value: 'center' },
                  { label: 'Right', value: 'right' },
                ]),
              ]),
            Block.make('textBlock')
              .label('Text Block')
              .icon('📝')
              .schema([
                TextareaField.make('content').label('Content').required(),
              ]),
            Block.make('callToAction')
              .label('Call to Action')
              .icon('📣')
              .schema([
                TextField.make('title').label('Title').required(),
                TextField.make('buttonText').label('Button Text').default('Learn More'),
                TextField.make('url').label('URL'),
                SelectField.make('style').label('Style').default('primary').options([
                  { label: 'Primary', value: 'primary' },
                  { label: 'Outline', value: 'outline' },
                  { label: 'Ghost', value: 'ghost' },
                ]),
              ]),
            Block.make('features')
              .label('Features Grid')
              .icon('✨')
              .schema([
                TextField.make('title').label('Section Title'),
                NumberField.make('columns').label('Columns').default(3),
              ]),
            Block.make('testimonial')
              .label('Testimonial')
              .icon('💬')
              .schema([
                TextareaField.make('quote').label('Quote').required(),
                TextField.make('author').label('Author Name').required(),
                TextField.make('role').label('Role / Company'),
              ]),
          ]),
        ])
        .submitLabel('Save Page')
        .successMessage('Page content saved!')
        .onSubmit(async (data) => { console.log('[builder]', data) }),

      Code.make(`BuilderField.make('pageContent')
  .label('Page Content')
  .addLabel('Add Block')
  .blocks([
    Block.make('hero')
      .label('Hero Section')
      .icon('🦸')
      .schema([
        TextField.make('title').label('Headline').required(),
        TextareaField.make('subtitle').label('Subtitle'),
      ]),
    Block.make('callToAction')
      .label('Call to Action')
      .icon('📣')
      .schema([
        TextField.make('title').required(),
        TextField.make('buttonText').default('Learn More'),
        TextField.make('url'),
      ]),
  ])`).language('typescript').title('Builder API'),

      // ── Rich Content Field ────────────────────────────────────
      Heading.make('Rich Content Field (Lexical)').level(2),
      Text.make('RichContentField renders a Lexical rich-text editor. Requires @boostkit/panels-lexical. Supports custom blocks and real-time collaboration.'),

      Form.make('richcontent-demo')
        .fields([
          RichContentField.make('article').label('Article Content')
            .placeholder('Start writing...')
            .blocks([
              Block.make('callout')
                .label('Callout')
                .icon('💡')
                .schema([
                  TextField.make('title').label('Title'),
                  TextareaField.make('content').label('Content').required(),
                  SelectField.make('type').label('Type').default('info').options([
                    { label: 'Info', value: 'info' },
                    { label: 'Warning', value: 'warning' },
                    { label: 'Success', value: 'success' },
                    { label: 'Error', value: 'error' },
                  ]),
                ]),
              Block.make('embed')
                .label('Embed')
                .icon('🔗')
                .schema([
                  TextField.make('url').label('URL').required(),
                  TextField.make('caption').label('Caption'),
                ]),
            ]),
        ])
        .submitLabel('Save Article')
        .successMessage('Article saved!')
        .onSubmit(async (data) => { console.log('[richcontent]', data) }),

      Code.make(`RichContentField.make('article')
  .label('Article Content')
  .placeholder('Start writing...')
  .blocks([
    Block.make('callout')
      .label('Callout')
      .icon('💡')
      .schema([
        TextField.make('title'),
        TextareaField.make('content').required(),
        SelectField.make('type').options([...]),
      ]),
  ])`).language('typescript').title('Rich Content API'),
    ]
  }
}
