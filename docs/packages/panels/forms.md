# Standalone Forms

Standalone forms let you embed interactive server-processed forms anywhere in a panel — the landing page, a custom `Page`, inside a `Section`, a `Tab`, or a `Dialog`. Unlike resource CRUD forms, standalone forms are general-purpose: they are not tied to a model, they define their own submit handler, and they can pre-populate, transform, and post-process data however you need.

The submit handler runs server-side via `POST /{panel}/api/_forms/{id}/submit`. The form id must be unique per panel.

---

## Basic Form

```ts
import { Form, TextField, EmailField, TextareaField } from '@rudderjs/panels'

Form.make('contact')
  .fields([
    TextField.make('name').label('Your Name').required(),
    EmailField.make('email').label('Email Address').required(),
    TextareaField.make('message').label('Message').required(),
  ])
  .submitLabel('Send Message')
  .successMessage('Message sent! We\'ll get back to you shortly.')
  .onSubmit(async (data, ctx) => {
    // data = { name, email, message }
    // ctx = { user, headers, path }
    await Mail.to('admin@example.com').send(new ContactMail(data))
  })
```

The `onSubmit` handler receives the validated form data and the current `PanelContext`. On success the form clears and shows the `successMessage`. On error the form shows field-level error messages inline.

| Method | Description |
|--------|-------------|
| `Form.make(id)` | Create a form with a unique string ID |
| `.fields([...])` | Array of `Field`, `Section`, or `Tabs` |
| `.onSubmit(fn)` | Async handler `(data, ctx) => Promise<void>` |
| `.submitLabel(text)` | Submit button label (default: `'Submit'`) |
| `.successMessage(text)` | Message shown after successful submit |
| `.description(text)` | Description text above the form fields |

---

## Field Types

All field types from `@rudderjs/panels` work in standalone forms.

### `TextField`

Single-line text input.

```ts
import { TextField } from '@rudderjs/panels'

TextField.make('name').label('Name').required()
TextField.make('title').label('Title').default('Untitled')
```

### `EmailField`

Text input with email validation.

```ts
import { EmailField } from '@rudderjs/panels'

EmailField.make('email').label('Email Address').required()
```

### `PasswordField`

Masked text input. Hidden from table views by default.

```ts
import { PasswordField } from '@rudderjs/panels'

PasswordField.make('password').label('Password').required()
PasswordField.make('password').label('Password').required().confirm()  // adds confirm field
```

| Method | Description |
|--------|-------------|
| `.confirm()` | Show a second "Confirm Password" input below the main one |

### `NumberField`

Numeric input with optional min, max, and step.

```ts
import { NumberField } from '@rudderjs/panels'

NumberField.make('age').label('Age').required()
NumberField.make('price').label('Price ($)').min(0).step(0.01)
NumberField.make('quantity').label('Quantity').min(1).max(100).default(1)
```

| Method | Description |
|--------|-------------|
| `.min(n)` | Minimum allowed value |
| `.max(n)` | Maximum allowed value |
| `.step(n)` | Step increment (e.g. `0.01` for cents) |

### `TextareaField`

Multi-line text input.

```ts
import { TextareaField } from '@rudderjs/panels'

TextareaField.make('bio').label('Bio')
TextareaField.make('notes').label('Notes').rows(8)
```

| Method | Description |
|--------|-------------|
| `.rows(n)` | Number of visible rows (default: auto) |

### `SelectField`

Dropdown with label/value pairs. Supports single and multi-select.

```ts
import { SelectField } from '@rudderjs/panels'

SelectField.make('status').label('Status').default('draft').options([
  { label: 'Draft',     value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Archived',  value: 'archived' },
])

// Multi-select
SelectField.make('categories').label('Categories').options([
  { label: 'Technology', value: 'tech' },
  { label: 'Design',     value: 'design' },
  { label: 'Business',   value: 'business' },
]).multiple()

// String array shorthand
SelectField.make('role').options(['admin', 'editor', 'user'])
```

| Method | Description |
|--------|-------------|
| `.options(opts)` | Array of `{ label, value }` pairs, or plain strings |
| `.multiple()` | Allow multiple selections (value becomes an array) |

### `BooleanField`

Checkbox that submits `true` / `false`.

```ts
import { BooleanField } from '@rudderjs/panels'

BooleanField.make('active').label('Active')
BooleanField.make('acceptTerms').label('I accept the terms').required()
```

### `ToggleField`

Switch-style boolean input. Same value semantics as `BooleanField`.

```ts
import { ToggleField } from '@rudderjs/panels'

ToggleField.make('featured').label('Featured Article')
ToggleField.make('notifications').label('Email Notifications').default(true)
ToggleField.make('published').label('Published').onLabel('Live').offLabel('Draft')
```

| Method | Description |
|--------|-------------|
| `.onLabel(text)` | Label shown when toggle is on (default: `'On'`) |
| `.offLabel(text)` | Label shown when toggle is off (default: `'Off'`) |

### `DateField`

Date picker. Optionally includes a time picker.

```ts
import { DateField } from '@rudderjs/panels'

DateField.make('birthday').label('Birthday')
DateField.make('startDate').label('Start Date').default(new Date().toISOString().split('T')[0])
DateField.make('publishedAt').label('Publish Time').withTime()
```

| Method | Description |
|--------|-------------|
| `.withTime()` | Include a time picker alongside the date picker |

### `ColorField`

Color picker. Stores the selected color as a hex string (e.g. `'#3b82f6'`).

```ts
import { ColorField } from '@rudderjs/panels'

ColorField.make('primaryColor').label('Brand Color').default('#3b82f6')
ColorField.make('accentColor').label('Accent Color')
```

### `TagsField`

Comma-separated tag input. Stores as an array of strings.

```ts
import { TagsField } from '@rudderjs/panels'

TagsField.make('tags').label('Tags')
TagsField.make('keywords').label('Keywords').placeholder('Add a keyword...')
```

| Method | Description |
|--------|-------------|
| `.placeholder(text)` | Placeholder text inside the tags input |

### `SlugField`

URL slug input with auto-generation from another field.

```ts
import { SlugField } from '@rudderjs/panels'

TextField.make('title').label('Title'),
SlugField.make('slug').label('URL Slug').from('title')
```

When combined with the Field base class `.from()` + `.derive()` pattern, the field auto-generates a slug as the user types in the source field.

### `JsonField`

Raw JSON editor with syntax highlighting. Stores the value as a parsed object.

```ts
import { JsonField } from '@rudderjs/panels'

JsonField.make('metadata').label('Metadata')
JsonField.make('config').label('Configuration').default('{\n  "key": "value"\n}').rows(10)
```

| Method | Description |
|--------|-------------|
| `.rows(n)` | Editor height in rows (default: 6) |

### `FileField`

File upload. Stores the uploaded file path on the configured disk.

```ts
import { FileField } from '@rudderjs/panels'

// Image upload with preview thumbnail
FileField.make('avatar').label('Profile Picture').image().accept('image/*').maxSize(5)

// Document upload
FileField.make('document').label('Attachment').accept('.pdf,.doc,.docx').maxSize(20)

// Multiple files
FileField.make('gallery').label('Gallery').image().multiple()

// Image with optimization and size conversions
FileField.make('cover')
  .label('Cover Image')
  .image()
  .disk('public')
  .directory('covers')
  .optimize()
  .conversions([
    { name: 'thumb',   width: 200, height: 200, crop: true, format: 'webp' },
    { name: 'preview', width: 800, format: 'webp' },
  ])
```

| Method | Description |
|--------|-------------|
| `.image()` | Render as image with preview thumbnail |
| `.accept(mime)` | MIME type or extension filter (e.g. `'image/*'`, `'.pdf'`) |
| `.maxSize(mb)` | Max file size in megabytes (default: 10) |
| `.multiple()` | Allow multiple file uploads |
| `.disk(name)` | Storage disk name (default: `'local'`) |
| `.directory(path)` | Upload subdirectory (default: `'uploads'`) |
| `.optimize()` | Auto-optimize images (requires `@rudderjs/image`) |
| `.conversions([...])` | Generate additional image sizes on upload (requires `@rudderjs/image`) |

### `HiddenField`

Not rendered in the form UI but included in submitted data. Useful for passing context values.

```ts
import { HiddenField } from '@rudderjs/panels'

HiddenField.make('formType').default('contact')
HiddenField.make('version').default(2)
```

---

## Field Defaults

Use `.default()` on any field to set a pre-filled value for new forms.

```ts
// Static default
TextField.make('title').default('Untitled Article')
SelectField.make('status').default('draft')
NumberField.make('priority').default(5)
ToggleField.make('notifications').default(true)
DateField.make('startDate').default(new Date().toISOString().split('T')[0])

// Dynamic default — function called with PanelContext
TextField.make('author').default((ctx) => ctx.user?.name ?? '')
DateField.make('createdAt').default(() => new Date().toISOString())
```

Static defaults are serialized and sent to the client. Function defaults are resolved server-side during SSR and merged into the form's initial values.

---

## Initial Data

Use `.data(fn)` to pre-populate a form from a server-side async function. The function receives `PanelContext` and returns an object mapping field names to values. This runs during SSR — the values are hydrated into the form before the page reaches the client.

```ts
Form.make('profile')
  .data(async (ctx) => {
    const user = await User.query().find(ctx.user!.id)
    return {
      name:  user.name,
      email: user.email,
      bio:   user.bio ?? '',
    }
  })
  .fields([
    TextField.make('name').label('Name').required(),
    EmailField.make('email').label('Email').required(),
    TextareaField.make('bio').label('Bio'),
  ])
  .submitLabel('Update Profile')
  .successMessage('Profile updated.')
  .onSubmit(async (data, ctx) => {
    await User.query().update(ctx.user!.id, data)
  })
```

`.data(fn)` takes priority over field-level `.default()` — if the data function returns a value for a field, it overrides the field's static default.

---

## Sections and Tabs

Group fields into `Section` or `Tabs` layouts within a form. Any combination is supported.

### Sections

```ts
import { Form, Section, TextField, EmailField, BooleanField, SelectField } from '@rudderjs/panels'

Form.make('settings')
  .description('Update your account settings.')
  .fields([
    Section.make('Profile').schema(
      TextField.make('displayName').label('Display Name').required(),
      EmailField.make('contactEmail').label('Contact Email'),
    ),
    Section.make('Preferences').columns(2).schema(
      BooleanField.make('notifications').label('Email Notifications'),
      SelectField.make('theme').label('Theme').options([
        { label: 'Light',  value: 'light' },
        { label: 'Dark',   value: 'dark' },
        { label: 'System', value: 'system' },
      ]),
    ),
    Section.make('Address').collapsible().collapsed().schema(
      TextField.make('street').label('Street'),
      TextField.make('city').label('City'),
      TextField.make('zip').label('ZIP Code'),
    ),
  ])
  .submitLabel('Save Settings')
  .successMessage('Settings saved.')
  .onSubmit(async (data, ctx) => {
    await User.query().update(ctx.user!.id, data)
  })
```

| Method | Description |
|--------|-------------|
| `Section.make(title)` | Create a named section card |
| `.schema(...fields)` | Fields inside this section |
| `.description(text)` | Description below the section title |
| `.columns(1\|2\|3)` | Layout columns for the fields (default: 1) |
| `.collapsible()` | Allow the section to be collapsed |
| `.collapsed()` | Start collapsed (requires `.collapsible()`) |

### Tabs inside Forms

Use the `Tabs` schema element to create a tabbed layout within a form. Each tab holds fields:

```ts
import { Form, Tabs, TextField, EmailField, TextareaField, ToggleField } from '@rudderjs/panels'

Form.make('account')
  .fields([
    Tabs.make()
      .tab('Profile',
        TextField.make('name').label('Name').required(),
        EmailField.make('email').label('Email').required(),
        TextareaField.make('bio').label('Bio'),
      )
      .tab('Notifications',
        ToggleField.make('emailNotifications').label('Email Notifications'),
        ToggleField.make('pushNotifications').label('Push Notifications'),
      ),
  ])
  .submitLabel('Save Account')
  .successMessage('Account updated.')
  .onSubmit(async (data, ctx) => {
    await User.query().update(ctx.user!.id, data)
  })
```

All tabs' fields are included in the submit payload — the active tab only controls which fields are visible on screen.

---

## Server Validation

All validation runs server-side. Use `.required()` for presence checks and `.validate(fn)` for custom logic. Errors are displayed inline below each field.

### Required Fields

```ts
TextField.make('username').label('Username').required()
EmailField.make('email').label('Email').required()
```

### Custom Validation

`.validate(fn)` receives the field's value and the full form payload. Return `true` to pass, or an error string to fail.

```ts
Form.make('registration')
  .fields([
    TextField.make('username').label('Username').required()
      .validate(async (value) => {
        const v = String(value ?? '')
        if (v.length < 3) return 'Username must be at least 3 characters.'
        if (!/^[a-z0-9_]+$/.test(v)) return 'Only lowercase letters, numbers, and underscores.'
        const taken = await User.query().where('username', v).first()
        return taken ? 'That username is already taken.' : true
      }),

    EmailField.make('email').label('Email').required()
      .validate(async (value) => {
        const v = String(value ?? '')
        const taken = await User.query().where('email', v).first()
        return taken ? 'An account with this email already exists.' : true
      }),

    NumberField.make('age').label('Age').required()
      .validate((value) => {
        const n = Number(value)
        if (isNaN(n) || n < 18) return 'You must be at least 18 years old.'
        return true
      }),

    // Cross-field validation — use the `data` parameter
    TextField.make('endDate').label('End Date')
      .validate((value, data) => {
        if (value && data.startDate && value < data.startDate) {
          return 'End date must be after start date.'
        }
        return true
      }),
  ])
  .submitLabel('Register')
  .successMessage('Registration successful!')
  .onSubmit(async (data) => {
    await User.create(data)
  })
```

Validation runs in this order:

1. `.required()` — presence check (empty string, null, and undefined all fail)
2. `.validate(fn)` — your custom async function

If any field fails, the form does not call `.onSubmit()` and instead returns all errors to the client.

---

## Reactive Derived Fields

Use `.from()` and `.derive()` to compute a field's value automatically as other fields change. The derived value is recomputed on the client in real time — no server round-trip.

```ts
import { Form, TextField, TextareaField, NumberField } from '@rudderjs/panels'

Form.make('article-composer')
  .fields([
    TextField.make('firstName').label('First Name').default('John'),
    TextField.make('lastName').label('Last Name').default('Doe'),

    // Derived, read-only
    TextField.make('fullName').label('Full Name')
      .from('firstName', 'lastName')
      .derive(({ firstName, lastName }) => `${firstName ?? ''} ${lastName ?? ''}`.trim())
      .readonly(),

    TextField.make('title').label('Article Title'),

    // Derived but user-editable — manual edits are preserved
    TextField.make('slug').label('URL Slug')
      .from('title')
      .derive(({ title }) =>
        String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      ),

    TextareaField.make('body').label('Body'),

    // Derived with debounce — avoids recomputing on every keystroke
    TextField.make('wordCount').label('Word Count')
      .from('body')
      .derive(({ body }) => {
        const words = String(body ?? '').trim().split(/\s+/).filter(Boolean).length
        return `${words} ${words === 1 ? 'word' : 'words'}`
      })
      .debounce(500)
      .readonly(),
  ])
  .submitLabel('Publish')
  .onSubmit(async (data) => { /* ... */ })
```

| Method | Description |
|--------|-------------|
| `.from(...fields)` | Declare which fields this field depends on |
| `.derive(fn)` | Compute a value from the dependency values |
| `.debounce(ms)` | Wait N ms after last change before recomputing (default: 200ms) |
| `.readonly()` | Prevent manual edits — value is always derived |

Without `.readonly()`, the derived value fills in automatically but the user can still edit it manually. `.readonly()` locks the field so it can only be set by the derivation function.

---

## Field Persistence

Use `.persist()` on any field to save and restore its value across page reloads without submitting the form. This is useful for drafts, filters, or search state.

```ts
// URL query params — shareable, SSR'd on refresh
TextField.make('search').label('Search').persist('url')
SelectField.make('category').label('Category').persist('url')

// Server session — SSR'd, clean URL
TextareaField.make('notes').label('Notes').persist('session')

// Browser localStorage — survives refresh, not shared
TextField.make('draft').label('Draft').persist('localStorage')
TextField.make('draft').label('Draft').persist()  // same as 'localStorage'
```

| Mode | URL changes | SSR state | Survives refresh | Shareable |
|------|------------|-----------|------------------|-----------|
| `'url'` | Yes | Yes | Yes | Yes |
| `'session'` | No | Yes | Yes | No |
| `'localStorage'` | No | No | Yes | No |

Persist can be combined with `.derive()` — the persisted value seeds the form on load, and derived fields recompute from it:

```ts
TextField.make('title').label('Title').persist('url'),
TextField.make('slug').label('Slug')
  .from('title')
  .derive(({ title }) => String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  .debounce(300),
```

Share the URL and both values restore correctly on the next visit.

---

## Lifecycle Hooks

### `beforeSubmit`

Transform form data before it reaches `.onSubmit()`. Return the modified data object.

```ts
Form.make('order')
  .fields([
    TextField.make('title').label('Title').required(),
    NumberField.make('quantity').label('Quantity'),
  ])
  .beforeSubmit(async (data, ctx) => {
    return {
      ...data,
      title:       String(data.title).trim(),
      userId:      ctx.user!.id,
      processedAt: new Date().toISOString(),
    }
  })
  .onSubmit(async (data) => {
    // data now includes userId and processedAt
    await Order.create(data)
  })
```

### `afterSubmit`

Run side effects after a successful submit. Receives the result returned from `.onSubmit()` (if any) and the `PanelContext`.

```ts
Form.make('post')
  .fields([...])
  .onSubmit(async (data) => {
    const post = await Post.create(data)
    return { id: post.id }          // returned value passed to afterSubmit
  })
  .afterSubmit(async (result, ctx) => {
    await ActivityLog.create({
      action:  'post.created',
      userId:  ctx.user!.id,
      postId:  (result as { id: string }).id,
    })
  })
```

Execution order: `beforeSubmit` → `.onSubmit()` → `afterSubmit`.

---

## Live Table Refresh

After a successful form submit, you can broadcast a live data refresh to one or more panel tables. The table re-fetches its data from the server without a full page reload. Requires `@rudderjs/broadcast` to be registered.

```ts
Form.make('quick-add-article')
  .fields([
    TextField.make('title').label('Title').required(),
    SelectField.make('status').label('Status').default('draft').options([
      { label: 'Draft',     value: 'draft' },
      { label: 'Published', value: 'published' },
    ]),
  ])
  .submitLabel('Add Article')
  .successMessage('Article added.')
  .refreshes('recent-articles', 'article-stats')   // table IDs to refresh
  .onSubmit(async (data) => {
    await Article.create(data)
  })
```

The table IDs passed to `.refreshes()` correspond to the IDs set via `Table.make(title).id('recent-articles')`. Multiple tables can be refreshed with a single form submit.

---

## Collaborative Fields

Use `.persist('websocket')` on any field to enable real-time collaborative editing via Yjs. Changes sync across all users viewing the same form instantly — no page refresh required.

```ts
Form.make('shared-notes')
  .description('Edit together — changes sync in real time across all open tabs and users.')
  .fields([
    TextField.make('title').label('Title').persist('websocket'),
    TextareaField.make('notes').label('Notes').persist('websocket'),
    ToggleField.make('published').label('Published').persist('websocket'),
  ])
  .submitLabel('Save')
  .successMessage('Saved.')
  .onSubmit(async (data) => {
    await Settings.upsert(data)
  })
```

Sync behavior by field type:

- **Text fields** (`TextField`, `TextareaField`): character-level CRDT sync via a per-field Y.Doc. Concurrent edits are merged without conflicts.
- **Non-text fields** (`ToggleField`, `SelectField`, `DateField`, etc.): last-write-wins sync via a shared Y.Map.

When collaborative fields are present, the form displays a connection status indicator and a count of other users currently viewing the form.

Combine multiple Yjs providers for offline resilience:

```ts
TextField.make('notes').persist(['websocket', 'indexeddb'])
// syncs live over WebSocket; local changes survive offline via IndexedDB
```

Requires `@rudderjs/live` to be registered.

---

## Standalone Fields

Fields can be placed directly in a panel schema without a `Form` wrapper. A standalone field renders as an editable input that auto-saves on blur. It posts to the same `_forms` endpoint using the field name as its implicit form ID.

```ts
// In Panel.schema() or Page.schema()
TextField.make('siteTitle').label('Site Title').default('My App')
ToggleField.make('maintenanceMode').label('Maintenance Mode')
```

Standalone fields are useful for single-value settings that do not need a grouped form layout.

---

## Conditional Fields

Show or hide fields based on the current values of other fields in the same form. Conditions are evaluated client-side — no server round-trip.

### `.showWhen()`

```ts
SelectField.make('contactMethod').label('Contact Method').options([
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: 'None',  value: 'none' },
]).default('email'),

// Show only when contactMethod = 'email'
EmailField.make('email').label('Email Address').showWhen('contactMethod', 'email'),

// Show only when contactMethod = 'phone'
TextField.make('phone').label('Phone Number').showWhen('contactMethod', 'phone'),
```

### `.hideWhen()`

```ts
// Hide when contactMethod = 'none'
ToggleField.make('newsletter').label('Subscribe to Newsletter')
  .hideWhen('contactMethod', 'none'),
```

### `.disabledWhen()`

Show the field but render it as read-only when the condition is met:

```ts
TextField.make('publishedAt').label('Published At')
  .disabledWhen('status', 'draft'),
```

### Condition operators

All three methods accept an optional operator argument:

```ts
.showWhen('views', '>', 100)                        // comparison
.showWhen('status', ['draft', 'review'])            // one of (array → 'in')
.showWhen('status', 'not_in', ['archived', 'spam']) // not one of
.showWhen('title', 'truthy')                        // non-empty / non-null
.showWhen('title', 'falsy')                         // empty or null
```

| Operator | Description |
|----------|-------------|
| `'='` | Equality (default when value given without operator) |
| `'!='` | Not equal |
| `'>'` / `'>='` / `'<'` / `'<='` | Numeric comparison |
| `'in'` | Value is in array |
| `'not_in'` | Value is not in array |
| `'truthy'` | Value is non-empty / non-null / non-zero |
| `'falsy'` | Value is empty / null / zero |

---

## Custom Action URL

By default forms POST to `/{panel}/api/_forms/{id}/submit`. Override the URL and method to send to any endpoint.

```ts
Form.make('search')
  .fields([
    TextField.make('query').label('Search').required(),
    SelectField.make('type').label('Filter').options(['articles', 'users', 'tags']),
  ])
  .action('/api/search')
  .method('POST')
  .submitLabel('Search')
  .onSubmit(async (data) => {
    // still called — runs server-side, result sent back to client
    return await SearchService.query(data)
  })
```

When `.action(url)` is set, the panel form renderer uses that URL instead of the default endpoint. The `.onSubmit()` handler still runs server-side via the panel API — the action URL and the server handler are independent.

To send the form to a completely external endpoint that does not go through the panel API, omit `.onSubmit()` and set `.action()` to the target URL. The form will POST directly to that URL.

---

## Complete Example

A fully-featured profile settings form with sections, initial data, validation, lifecycle hooks, reactive derivation, and selective field persistence:

```ts
import {
  Form, Section, Tabs,
  TextField, EmailField, TextareaField, SelectField,
  BooleanField, ToggleField, SlugField, FileField,
} from '@rudderjs/panels'
import { User } from 'App/Models/User.js'

Form.make('user-profile')
  .description('Manage your account details and preferences.')
  .method('PUT')

  // Pre-populate from database
  .data(async (ctx) => {
    const user = await User.query().find(ctx.user!.id)
    return {
      name:          user.name,
      email:         user.email,
      username:      user.username,
      bio:           user.bio ?? '',
      theme:         user.theme ?? 'system',
      notifications: user.notifications ?? true,
    }
  })

  .fields([
    Section.make('Identity').schema(
      FileField.make('avatar')
        .label('Profile Photo')
        .image()
        .disk('public')
        .directory('avatars')
        .accept('image/*')
        .maxSize(5),

      TextField.make('name').label('Display Name').required(),

      TextField.make('username').label('Username').required()
        .validate(async (value, data) => {
          const v = String(value ?? '')
          if (!/^[a-z0-9_]{3,20}$/.test(v)) {
            return 'Username must be 3-20 characters: lowercase letters, numbers, underscores only.'
          }
          const taken = await User.query()
            .where('username', v)
            .where('id', '!=', String(data.id ?? ''))
            .first()
          return taken ? 'That username is already taken.' : true
        }),
    ),

    Section.make('Contact').schema(
      EmailField.make('email').label('Email Address').required()
        .validate(async (value, data) => {
          const taken = await User.query()
            .where('email', String(value))
            .where('id', '!=', String(data.id ?? ''))
            .first()
          return taken ? 'That email is already registered.' : true
        }),
    ),

    Section.make('About').schema(
      TextareaField.make('bio').label('Bio').rows(5),
      // Derived word count — updates as user types
      TextField.make('bioWordCount').label('Word Count')
        .from('bio')
        .derive(({ bio }) => {
          const n = String(bio ?? '').trim().split(/\s+/).filter(Boolean).length
          return `${n} words`
        })
        .debounce(300)
        .readonly(),
    ),

    Section.make('Preferences').collapsible().columns(2).schema(
      SelectField.make('theme').label('Theme').options([
        { label: 'Light',  value: 'light' },
        { label: 'Dark',   value: 'dark' },
        { label: 'System', value: 'system' },
      ]).persist('localStorage'),
      ToggleField.make('notifications').label('Email Notifications'),
    ),
  ])

  .beforeSubmit(async (data, ctx) => ({
    ...data,
    updatedAt: new Date().toISOString(),
  }))

  .onSubmit(async (data, ctx) => {
    await User.query().update(ctx.user!.id, data)
  })

  .afterSubmit(async (_result, ctx) => {
    await ActivityLog.create({ action: 'profile.updated', userId: ctx.user!.id })
  })

  .submitLabel('Save Profile')
  .successMessage('Profile updated successfully.')
```
