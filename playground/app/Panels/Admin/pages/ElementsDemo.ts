import {
  Page, Heading, Text, Card, Alert, Divider, Each, View, Example, Snippet, Code, Playground,
  Stats, Stat, TextField, ToggleField, SelectField, NumberField, ColorField,
} from '@pilotiq/panels'
import type { PanelContext } from '@pilotiq/panels'
import { Article } from '../../../Models/Article.js'
import { User } from '../../../Models/User.js'

export class ElementsDemo extends Page {
  static slug  = 'elements-demo'
  static label = 'Elements Demo'
  static icon  = 'layout-grid'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Schema Elements'),
      Text.make('Demonstrates Card, Alert, Divider, Each, View, Example, and Snippet elements.'),

      // ── Alert ────────────────────────────────────────────────
      Heading.make('Alert').level(2),
      Text.make('Callout boxes with different severity levels.'),

      Alert.make('This is an informational message about the feature.').info().title('Info'),
      Alert.make('Please review your changes before publishing.').warning().title('Warning'),
      Alert.make('Record saved successfully.').success().title('Success'),
      Alert.make('This action cannot be undone. All data will be permanently deleted.').danger().title('Danger'),

      Example.make('Alert')
        .description('Callout box with type-based styling.')
        .code(`Alert.make('Please review your changes before publishing.')
  .warning()
  .title('Warning')`)
        .schema([
          Alert.make('Please review your changes before publishing.').warning().title('Warning'),
        ]),

      // ── Divider ──────────────────────────────────────────────
      Heading.make('Divider').level(2),
      Text.make('Horizontal separator with optional label.'),

      Divider.make(),
      Text.make('Content between dividers.'),
      Divider.make('Section Break'),
      Text.make('More content after labeled divider.'),

      Example.make('Divider')
        .description('Simple separator and labeled divider.')
        .code(`Divider.make()
Divider.make('Advanced Options')`)
        .schema([
          Divider.make(),
          Text.make('Content between dividers.'),
          Divider.make('Advanced Options'),
        ]),

      // ── Card ─────────────────────────────────────────────────
      Heading.make('Card').level(2),
      Text.make('Lightweight wrapper with title and description. Contains any schema elements.'),

      Card.make('User Profile')
        .description('Basic user information')
        .schema([
          TextField.make('cardName').label('Name').placeholder('Enter name...'),
          TextField.make('cardEmail').label('Email').placeholder('Enter email...'),
        ]),

      Card.make('Statistics')
        .schema([
          Stats.make([
            Stat.make('Articles').value(42),
            Stat.make('Users').value(150),
            Stat.make('Views').value('12.5K'),
          ]),
        ]),

      Example.make('Card')
        .description('Card with title, description, and nested elements.')
        .code(`Card.make('User Profile')
  .description('Basic user information')
  .schema([
    TextField.make('name').label('Name'),
    TextField.make('email').label('Email'),
  ])`)
        .schema([
          Card.make('Quick Info')
            .description('A simple card with fields.')
            .schema([
              TextField.make('exCardName').label('Name').placeholder('Enter name...'),
            ]),
        ]),

      // ── View ─────────────────────────────────────────────────
      Heading.make('View').level(2),
      Text.make('Render schema from a single data object. Supports sync and async data.'),

      View.make()
        .data({ title: 'Dashboard Stats', articles: 42, users: 150, views: '12.5K' })
        .content((data) => [
          Card.make(String(data.title)).schema([
            Stats.make([
              Stat.make('Articles').value(Number(data.articles)),
              Stat.make('Users').value(Number(data.users)),
              Stat.make('Views').value(String(data.views)),
            ]),
          ]),
        ]),

      View.make()
        .data(async () => {
          const count = await Article.query().count()
          return { articleCount: count }
        })
        .content((data) => [
          Alert.make(`There are ${data.articleCount} articles in the database.`).info().title('Live Data'),
        ]),

      Example.make('View')
        .description('Render schema from a data object.')
        .code(`View.make()
  .data({ name: 'RudderJS', version: '0.0.3' })
  .content((data) => [
    Alert.make(\`Running \${data.name} v\${data.version}\`).info(),
  ])`)
        .schema([
          View.make()
            .data({ name: 'RudderJS', version: '0.0.3' })
            .content((data) => [
              Alert.make(`Running ${data.name} v${data.version}`).info(),
            ]),
        ]),

      // ── Each ─────────────────────────────────────────────────
      Heading.make('Each').level(2),
      Text.make('Iterate over a collection and render schema per item. Supports grid layout, model queries, and static arrays.'),

      Heading.make('Each — Static Array').level(3),

      Each.make()
        .fromArray([
          { title: 'Users', count: 150, color: 'blue' },
          { title: 'Articles', count: 42, color: 'green' },
          { title: 'Comments', count: 380, color: 'purple' },
          { title: 'Views', count: 12500, color: 'amber' },
        ])
        .columns(4)
        .content((item) => [
          Card.make(String(item.title)).schema([
            Stats.make([Stat.make(String(item.title)).value(Number(item.count))]),
          ]),
        ]),

      Heading.make('Each — Model-backed (3 columns)').level(3),

      Each.make()
        .fromModel(User)
        .columns(3)
        .content((user) => [
          Card.make(String(user.name))
            .description(String(user.email))
            .schema([
              Alert.make(`Role: ${user.role}`).info(),
            ]),
        ]),

      Example.make('Each')
        .description('Grid of cards generated from an array.')
        .code(`Each.make()
  .fromArray([
    { title: 'Users', count: 150 },
    { title: 'Articles', count: 42 },
    { title: 'Views', count: 12500 },
  ])
  .columns(3)
  .content((item) => [
    Card.make(item.title).schema([
      Stats.make([Stat.make(item.title).value(item.count)]),
    ])
  ])`)
        .schema([
          Each.make()
            .fromArray([
              { title: 'Users', count: 150 },
              { title: 'Articles', count: 42 },
              { title: 'Views', count: 12500 },
            ])
            .columns(3)
            .content((item) => [
              Card.make(String(item.title)).schema([
                Stats.make([Stat.make(String(item.title)).value(Number(item.count))]),
              ]),
            ]),
        ]),

      // ── Snippet ──────────────────────────────────────────────
      Heading.make('Snippet').level(2),
      Text.make('Tabbed code display with copy button.'),

      Snippet.make('Install RudderJS')
        .tab('npm', 'npx create-rudderjs-app my-app', 'bash')
        .tab('pnpm', 'pnpm create rudderjs-app my-app', 'bash')
        .tab('yarn', 'yarn create rudderjs-app my-app', 'bash')
        .tab('bun', 'bunx create-rudderjs-app my-app', 'bash'),

      Snippet.make('Resource API')
        .tab('table()', `table(table: Table) {
  return table
    .columns([
      Column.make('title').sortable().searchable(),
      Column.make('status').badge(),
      Column.make('createdAt').date().sortable(),
    ])
    .paginated('pages', 10)
    .remember('session')
    .live()
}`, 'ts')
        .tab('form()', `form(form: Form) {
  return form
    .versioned()
    .draftable()
    .fields([
      TextField.make('title').required(),
      TextareaField.make('body'),
      SelectField.make('status').options(['draft', 'published']),
    ])
}`, 'ts')
        .tab('detail()', `detail(record) {
  return [
    Stats.make([
      Stat.make('Status').value(record.status),
      Stat.make('Views').value(record.views),
    ]),
  ]
}`, 'ts'),

      // ── Example ──────────────────────────────────────────────
      Heading.make('Example').level(2),
      Text.make('Live preview with expandable code. The preview area renders actual interactive elements.'),

      Example.make('Interactive Toggle')
        .description('A live toggle field you can interact with.')
        .code(`ToggleField.make('subscribe')
  .label('Subscribe to newsletter')
  .onLabel('Subscribed')
  .offLabel('Not subscribed')`)
        .schema([
          ToggleField.make('exToggle').label('Subscribe to newsletter').onLabel('Subscribed').offLabel('Not subscribed'),
        ]),

      Example.make('Select with Options')
        .description('Dropdown select rendered from schema.')
        .code(`SelectField.make('theme')
  .label('Theme')
  .options([
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ])`)
        .schema([
          SelectField.make('exTheme').label('Theme').options([
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]),
        ]),

      // ── Playground ───────────────────────────────────────────
      Heading.make('Playground').level(2),
      Text.make('Interactive demo with controls that update a live preview. Change the controls below and see the preview update in real-time.'),

      Playground.make('Alert Builder')
        .description('Build an alert by changing its properties.')
        .controls([
          TextField.make('message').label('Message').default('This is an alert message.'),
          SelectField.make('alertType').label('Type').options([
            { value: 'info', label: 'Info' },
            { value: 'warning', label: 'Warning' },
            { value: 'success', label: 'Success' },
            { value: 'danger', label: 'Danger' },
          ]).default('info'),
          TextField.make('title').label('Title').default('Notice'),
        ])
        .preview((props) => [
          Alert.make(String(props.message || 'Alert message'))
            .alertType((props.alertType as 'info' | 'warning' | 'success' | 'danger') || 'info')
            .title(String(props.title || '')),
        ])
        .code(`Alert.make(:message)
  .alertType(:alertType)
  .title(:title)`),

      Playground.make('Stats Builder')
        .description('Configure a stats display.')
        .controls([
          TextField.make('label1').label('Stat 1 Label').default('Users'),
          NumberField.make('value1').label('Stat 1 Value').default(150),
          TextField.make('label2').label('Stat 2 Label').default('Articles'),
          NumberField.make('value2').label('Stat 2 Value').default(42),
        ])
        .preview((props) => [
          Stats.make([
            Stat.make(String(props.label1 || 'Stat 1')).value(Number(props.value1 || 0)),
            Stat.make(String(props.label2 || 'Stat 2')).value(Number(props.value2 || 0)),
          ]),
        ])
        .code(`Stats.make([
  Stat.make(:label1).value(:value1),
  Stat.make(:label2).value(:value2),
])`),
    ]
  }
}
