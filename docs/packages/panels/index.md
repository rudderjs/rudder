# @rudderjs/panels

Admin panel builder for RudderJS. Define resources in TypeScript — panels auto-generates CRUD API routes and a polished React UI. Think Laravel Nova or Filament, but for Node.js: schema-driven, type-safe, and framework-agnostic.

---

## Overview

`@rudderjs/panels` turns your ORM models into fully functional admin interfaces with zero boilerplate. You define what data looks like; panels handles the rest.

**Key features:**

- **Resource CRUD** — auto-generated list, create, edit, and show pages with a matching REST API
- **25+ field types** — text, email, number, date, select, toggle, tags, color, JSON, file upload, rich-text, relations, and more
- **Schema elements** — compose dashboards from Stats, Chart, Table, List, Form, Dialog, Tabs, Section, Code, Heading, and Text
- **Table inline editing** — edit cells directly with inline, popover, or modal modes
- **Real-time updates** — push live data changes via WebSocket with `.live()`
- **Lazy loading & polling** — defer heavy queries with `.lazy()`, keep data fresh with `.poll(ms)`
- **Field persistence** — save field state to localStorage, URL, session, or Yjs WebSocket
- **Reactive derived fields** — compute field values from other fields client-side with `.from().derive()`
- **Server-side validation** — `.required()`, `.validate()`, and full `FormRequest` integration
- **Column transforms** — `.compute()` to derive values server-side, `.display()` to format for output
- **Dashboard builder** — drag-and-drop widget grids with per-user layout persistence
- **Collaborative editing** — real-time co-editing via Yjs CRDT (requires `@rudderjs/live`)
- **Draft recovery & versioning** — localStorage backup, restore banner, and full version history
- **Custom pages & sub-pages** — add arbitrary schema-driven or React pages to the nav
- **AI chat with block introspection** — record-edit chat agent receives a structured catalog of every block type declared on `RichContentField` / `BuilderField` fields, so it can answer block questions and call `update_block` against real schemas instead of guessing
- **i18n + RTL** — built-in English and Arabic translations, automatic RTL layout
- **Dark mode** — light, dark, and system themes with no flash on load
- **Two layouts** — sidebar (default) or topbar navigation

---

## Installation

```bash
pnpm add @rudderjs/panels
```

Optional peer dependencies (install when you need them):

```bash
pnpm add recharts          # Chart element
pnpm add @rudderjs/live    # Collaborative editing / .persist('websocket')
pnpm add @rudderjs/broadcast  # .live() real-time push updates
```

---

## Quick Start

### 1. Define a Resource

```ts
// app/Panels/Admin/resources/UserResource.ts
import { Resource, TextField, EmailField, SelectField, DateField } from '@rudderjs/panels'
import { User } from '../../../Models/User.js'

export class UserResource extends Resource {
  static model         = User
  static label         = 'Users'
  static labelSingular = 'User'
  static titleField    = 'name'

  fields() {
    return [
      TextField.make('name').required().searchable().sortable(),
      EmailField.make('email').required().searchable().sortable(),
      SelectField.make('role').options(['user', 'admin']).required(),
      DateField.make('createdAt').readonly().hideFromCreate().hideFromEdit(),
    ]
  }
}
```

### 2. Define a Panel

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@rudderjs/panels'
import { UserResource } from './resources/UserResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .layout('sidebar')
  .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([UserResource])
```

### 3. Register the provider

```ts
// bootstrap/providers.ts
import { panels } from '@rudderjs/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
  // ... other providers
]
```

### 4. Publish the UI pages

```bash
# First install
pnpm rudder vendor:publish --tag=panels-pages

# After upgrading @rudderjs/panels — update to latest UI
pnpm rudder vendor:publish --tag=panels-pages --force
```

This copies the React pages into `pages/(panels)/` in your project.

### 5. Install shadcn/ui components

```bash
npx shadcn@latest add sidebar dropdown-menu alert-dialog table breadcrumb tooltip tabs badge separator avatar sheet switch dialog
```

**Done.** Visit `/admin` — you have a working CRUD interface for your `User` model.

---

## Core Concepts

### Resources

A Resource maps an ORM model to a full CRUD interface. It defines fields, filters, actions, and optional feature flags. The resource class is the single source of truth — panels derives both the API and the UI from it.

```ts
export class ArticleResource extends Resource {
  static model         = Article
  static label         = 'Articles'
  static titleField    = 'title'
  static defaultSort   = 'createdAt'
  static defaultSortDir = 'DESC' as const

  // Feature flags
  static softDeletes   = true   // trash & restore
  static versioned     = true   // version history with JSON snapshots
  static draftable     = true   // draft/publish workflow
  static autosave      = true   // periodic server save
  static draftRecovery = true   // localStorage backup + restore banner
  static live          = true   // table auto-refreshes on record change

  fields() { return [...] }
  filters() { return [...] }
  actions() { return [...] }
}
```

See [Resources](./resources) for the full reference.

### Schema Elements

Schema elements are composable building blocks for panel landing pages (`Panel.schema()`), custom pages, and resource show page widgets (`Resource.widgets()`).

| Element | Description |
|---------|-------------|
| `Stats` / `Stat` | Row of stat cards with values, trends, and descriptions |
| `Chart` | Line, bar, area, pie, or doughnut chart (requires `recharts`) |
| `Table` | Data table from a Resource, Model, or array — sort, search, paginate |
| `Column` | Typed display column for `Table` — sortable, badge, date, image, editable |
| `List` | Card with a list of items and optional links |
| `Form` | Standalone form — not tied to a resource |
| `Dialog` | Modal wrapper — trigger button opens a dialog with any schema content |
| `Tabs` | Tab-navigated group of schema elements or fields |
| `Section` | Collapsible card grouping for form fields |
| `Code` | Syntax-highlighted code block with copy button |
| `Heading` | Section heading with configurable level |
| `Text` | Paragraph of text |

All async elements support `.lazy()`, `.poll(ms)`, and `.live()`.

See [Widgets & Schema](./schema) for the full reference.

### Fields

Fields define how model columns render in forms, tables, and the show view. Every field supports a shared set of fluent methods for labels, visibility, validation, sorting, searching, and derivation.

See [Fields](./fields) for the complete field type list and all fluent methods.

### Custom Pages

Add schema-driven or React pages alongside resources. Pages appear in the sidebar or topbar nav at `/{panel}/{slug}`.

See [Custom Pages](./pages) for details.

### Dashboard Builder

`Dashboard.make()` inside `Panel.schema()` renders a user-customizable widget grid. Users can drag, resize, and rearrange widgets. Layouts are persisted per-user.

See [Widgets & Schema](./schema) for the dashboard API.

---

## Panel Configuration

### `Panel.make(id)`

```ts
Panel.make('admin')
  .path('/admin')                         // URL prefix (required)
  .branding({
    title:   'My App Admin',
    logo:    '/images/logo.svg',          // shown instead of title
    favicon: '/favicon.ico',
  })
  .layout('sidebar')                      // 'sidebar' (default) | 'topbar'
  .guard(async (ctx) => {
    return ctx.user?.role === 'admin'     // return false to redirect to login
  })
  .locale('ar')                           // override locale (default: auto-detect)
  .middleware([AuthMiddleware()])          // panel-level middleware
  .resources([UserResource, ArticleResource])
  .pages([DashboardPage, ReportsPage])
  .schema(async (ctx) => [               // custom landing page
    Heading.make('Welcome back'),
    Stats.make([...]),
  ])
```

### `.guard(fn)`

The guard function receives `PanelContext` (`{ user, headers, path }`) and must return a boolean or throw. Return `false` (or a falsy value) to redirect unauthenticated requests. Combine with `AuthMiddleware()` in `.middleware()` for typical setups:

```ts
Panel.make('admin')
  .middleware([AuthMiddleware()])
  .guard(async (ctx) => ctx.user?.role === 'admin')
```

### `.schema(fn)`

By default the panel root (`/admin`) redirects to the first resource. Define a custom landing page with `.schema()`. The function receives `PanelContext` and can be async — safe to run ORM queries:

```ts
.schema(async (ctx) => [
  Heading.make('Welcome back'),
  Text.make(`Logged in as ${ctx.user?.email}`),
  Stats.make([
    Stat.make('Users').value(await User.query().count()),
    Stat.make('Articles').value(await Article.query().count()),
  ]),
  Table.make('Recent Articles')
    .fromResource(ArticleResource)
    .columns(['title', 'status', 'createdAt'])
    .sortBy('createdAt', 'DESC')
    .limit(5),
])
```

---

## Icons

Resources, Pages, and Globals support four icon formats via `static icon`:

```ts
// 1. Lucide icon name — lazy-loaded on client (brief invisible placeholder)
static icon = 'settings'
static icon = 'file-text'

// 2. Lucide SVG import — SSR instant, no loading flash (recommended)
import { Settings } from 'lucide-static'
static icon = Settings

// 3. Inline SVG string — SSR instant
static icon = '<svg viewBox="0 0 24 24" ...><path d="..."/></svg>'

// 4. Emoji — SSR instant
static icon = '📦'
```

For instant SSR rendering (no loading flash), use `lucide-static` imports:

```bash
pnpm add lucide-static
```

```ts
import { Table as TableIcon, FileInput, BarChart3 } from 'lucide-static'

export class TablesDemo extends Page {
  static icon = TableIcon
}
```

> **Tip:** Alias the import if it conflicts with a schema element name (e.g. `Table` from `@rudderjs/panels`).

---

## Layout Options

```ts
Panel.make('admin').layout('sidebar')   // vertical sidebar nav (default)
Panel.make('admin').layout('topbar')    // horizontal top nav bar
```

Both layouts are built with Tailwind CSS design tokens (`bg-primary`, `text-muted-foreground`, etc.) and adapt to your shadcn theme automatically.

**Sidebar** — collapsible vertical navigation on the left. Supports navigation groups, badges, icons, and a branding area at the top.

**Topbar** — horizontal navigation bar at the top. Useful for panels where vertical space matters.

---

## Dark Mode

The panel UI supports light, dark, and system-based themes. A toggle button appears in the header. The theme is persisted to `localStorage` under the key `panels-theme`.

The theme system uses class-based toggling (`.dark` on `<html>`) which is compatible with Tailwind CSS v4's built-in dark mode support. All panel components respect the current theme automatically. An inline `<script>` in `<head>` applies the saved theme before React hydrates, preventing flash.

### Customizing Colors

Override CSS variables in `src/index.css` to customize both light and dark themes:

```css
:root {
  --primary: oklch(0.5 0.2 250);
  --sidebar: oklch(0.97 0 0);
}

.dark {
  --primary: oklch(0.7 0.15 250);
  --sidebar: oklch(0.15 0 0);
}
```

---

## i18n & RTL

The panel UI is fully internationalized. Built-in translations: **`en`** (English) and **`ar`** (Arabic).

Override the locale per panel with `.locale()`:

```ts
Panel.make('admin')
  .path('/admin')
  .locale('ar')   // Arabic + automatic RTL layout
```

When a locale is set, the panel:
- Applies the correct UI strings (buttons, labels, toasts, empty states)
- Sets `dir="rtl"` on the layout root for RTL languages
- Uses CSS logical properties so padding, borders, and alignment flip correctly

**RTL languages detected automatically**: `ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`

If `.locale()` is not called, the panel reads the active locale from `@rudderjs/localization` — meaning all panels in a multilingual app use the right locale without extra config.

### Overriding bundled strings

The bundled `en` and `ar` translations cover every UI string out of the box. To change individual strings — or to add a new locale entirely — drop a JSON file at `lang/<locale>/pilotiq.json`:

```json
// lang/en/pilotiq.json
{
  "signOut":     "Logout",
  "newButton":   "Create :label",
  "noResultsHint": "Try a different query."
}
```

Only the keys you specify are overridden; everything else falls back to the bundled defaults. Add `lang/es/pilotiq.json`, `lang/fr/pilotiq.json`, etc. to introduce new locales without forking the package — keys missing from your file fall back to bundled `en`.

Scaffold an empty starter file via the CLI:

```bash
pnpm rudder vendor:publish --tag=pilotiq-translations
```

> Requires `@rudderjs/localization` to be installed and registered. Panels eagerly preloads the `pilotiq` namespace during boot, so `getPanelI18n()` resolves overrides synchronously at render time. Without `@rudderjs/localization`, panels still works using the bundled defaults only.

The full list of override keys is the `PanelI18n` type in `@rudderjs/panels` — open `node_modules/@rudderjs/panels/dist/i18n/en.d.ts` for an authoritative reference, or browse the [bundled `en.ts` source on GitHub](https://github.com/rudderjs/rudder/blob/main/packages/panels/src/i18n/en.ts).

### Adding a new locale

Only `en` and `ar` ship bundled. To add Spanish, French, German, or any other language without forking the package, drop a JSON file at `lang/<locale>/pilotiq.json`:

```json
// lang/es/pilotiq.json
{
  "signOut":         "Cerrar sesión",
  "search":          "Buscar :label…",
  "searchButton":    "Buscar",
  "newRecord":       "+ Nuevo",
  "newButton":       "+ Nuevo :label",
  "actions":         "Acciones",
  "edit":            "Editar",
  "view":            "Ver",
  "noResultsTitle":  "Sin resultados",
  "noResultsHint":   "Prueba ajustando tu búsqueda o filtros.",
  "noRecordsTitle":  "Aún no hay :label",
  "createFirstLink": "Crea tu primer :singular"
}
```

Translate as much as you want — anything you skip falls back to bundled `en`. The full key list lives in [`packages/panels/src/i18n/en.ts`](https://github.com/rudderjs/rudder/blob/main/packages/panels/src/i18n/en.ts).

Then point your panel at it. **Per-panel:**

```ts
Panel.make('admin')
  .path('/admin')
  .locale('es')
```

**App-wide** — set the active locale via `@rudderjs/localization` and the panel picks it up automatically:

```ts
// config/app.ts
export default {
  locale:   Env.get('APP_LOCALE', 'es'),
  fallback: 'en',
}
```

For RTL languages (`ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`), the panel auto-sets `dir="rtl"` and uses CSS logical properties — no extra config.

> Translation overrides are loaded at panel boot. After editing `lang/<locale>/pilotiq.json`, restart `pnpm dev` to pick up the changes.

---

## shadcn/ui Components

The panel UI uses [shadcn/ui](https://ui.shadcn.com) (v4, base-nova style). After publishing panel pages, install the required components:

```bash
npx shadcn@latest add sidebar dropdown-menu alert-dialog table breadcrumb tooltip tabs badge separator avatar sheet switch dialog
```

> **Note:** shadcn v4 uses `@base-ui/react` (not Radix). Components use the `render` prop pattern instead of `asChild`.

---

## Required Prisma Models

Add these to your Prisma schema when using the corresponding features:

```prisma
// Required for versioned resources (static versioned = true)
model PanelVersion {
  id        String   @id @default(cuid())
  docName   String
  snapshot  Bytes
  label     String?
  userId    String?
  createdAt DateTime @default(now())
  @@index([docName, createdAt])
}

// Required for globals (Panel.globals())
model PanelGlobal {
  slug      String   @id
  data      String   @default("{}")
  updatedAt DateTime @updatedAt
}
```

---

## Sub-Pages

| Page | Description |
|---|---|
| [Resources](./resources) | Defining resources, feature flags (live, versioned, draftable, softDeletes, autosave, draftRecovery, collaborative), duplicate record, resource widgets |
| [Fields](./fields) | 25+ field types, shared fluent methods, layout groupings (Section, Tabs), relations, validation, access control, reactive derived fields, inline editing, field persistence |
| [Listing Records](./listing) | Table columns, search, sort, filters, tab filters, pagination, actions, badge mapping, progress bars, inline editing |
| [Widgets & Schema](./schema) | Stats, Chart, Table, List, Form, Dialog, Tabs, Column — inline editing, `.live()`, `.lazy()`, `.poll()`, dashboard builder |
| [Navigation](./navigation) | Navigation groups, badges, guard |
| [Globals](./globals) | Single-record settings pages |
| [Custom Pages](./pages) | Custom pages, sub-pages, navigation nesting, custom resource views |
| [Editor](./editor) | Rich-text editor registry, `@rudderjs/panels-lexical` |
| [API Routes](./api) | Auto-generated CRUD endpoints |
