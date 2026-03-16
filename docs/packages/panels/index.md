# @boostkit/panels

Admin panel builder for BoostKit. Define resources in TypeScript — the package auto-generates CRUD API routes and a polished React UI with two layout options (sidebar or topbar).

## Sub-Pages

| Page | Description |
|---|---|
| [Resources](./resources) | Defining resources, feature flags, duplicate record |
| [Fields](./fields) | Field types, layout groupings, relations, validation, access control |
| [Listing Records](./listing) | Table columns, search, sort, filters, tab filters, pagination, actions |
| [Navigation](./navigation) | Navigation groups, badges, guard |
| [Globals](./globals) | Single-record settings pages |
| [Custom Pages](./pages) | Custom pages, custom resource views, panel schema (dashboard) |
| [Editor](./editor) | Rich-text editor registry, `@boostkit/panels-lexical` |
| [API Routes](./api) | Auto-generated CRUD endpoints |

---

## Installation

```bash
pnpm add @boostkit/panels
```

---

## Setup

### 1. Define a Panel

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@boostkit/panels'
import { UserResource } from './resources/UserResource.js'
import { TodoResource } from './resources/TodoResource.js'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My Admin' })
  .layout('sidebar')
  .guard(async (ctx) => ctx.user?.role === 'admin')
  .resources([UserResource, TodoResource])
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { panels } from '@boostkit/panels'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'

export default [
  panels([adminPanel]),
  // ...
]
```

### 3. Publish the UI pages

```bash
# First install
pnpm artisan vendor:publish --tag=panels-pages

# After upgrading @boostkit/panels — update to latest UI
pnpm artisan vendor:publish --tag=panels-pages --force
```

This copies the React pages into `pages/(panels)/` in your app.

---

## Layout Options

```ts
Panel.make('admin').layout('sidebar')   // vertical sidebar nav (default)
Panel.make('admin').layout('topbar')    // horizontal top nav bar
```

Both layouts are built with Tailwind CSS design tokens (`bg-primary`, `text-muted-foreground`, etc.) and adapt to your shadcn theme automatically.

---

## Branding

```ts
Panel.make('admin').branding({
  title:   'My App Admin',
  logo:    '/images/logo.svg',   // shown in sidebar/topbar instead of title
  favicon: '/favicon.ico',
})
```

---

## Internationalization (i18n) and RTL

The panel UI is fully internationalized. By default the locale is inherited from `@boostkit/localization` (read from `globalThis`). Override it per panel with `.locale()`:

```ts
Panel.make('admin')
  .path('/admin')
  .locale('ar')   // Arabic + RTL layout
```

Built-in translations: **`en`** (English) and **`ar`** (Arabic).

When a locale is set, the panel automatically:
- Applies the correct UI strings (buttons, labels, toasts, empty states)
- Sets `dir="rtl"` on the layout root for RTL languages
- Uses CSS logical properties so padding, borders, and alignment flip correctly

**RTL languages detected automatically**: `ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`

If `.locale()` is not called, the panel reads the active locale from `@boostkit/localization`. This means all panels in a multilingual app will use the right locale without any extra config.

---

## Dark Mode

The panel UI supports light, dark, and system-based themes. A toggle button appears in the header.

Theme is persisted to `localStorage` under the key `panels-theme`.

The theme system uses class-based toggling (`.dark` on `<html>`) which works with Tailwind CSS v4's built-in dark mode support. All panel components respect the current theme automatically. An inline `<script>` in `<head>` applies the saved theme before React hydrates, preventing flash.

### Customizing Colors

Override CSS variables in your `src/index.css` to customize both light and dark themes:

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

## shadcn/ui Components

The panel UI uses [shadcn/ui](https://ui.shadcn.com) components (v4, base-nova style). After publishing panel pages, install the required shadcn components in your app:

```bash
npx shadcn@latest add sidebar dropdown-menu alert-dialog table breadcrumb tooltip tabs badge separator avatar sheet switch dialog
```

> **Note:** shadcn v4 uses `@base-ui/react` (not Radix). Components use the `render` prop pattern instead of `asChild`.
