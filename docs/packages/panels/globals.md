# Globals

Single-record settings pages — same field system as Resources but no list/create/delete. Just an edit form that saves to a keyed JSON row.

---

## Defining Globals

```ts
// app/Panels/Admin/globals/SiteSettingsGlobal.ts
import { Global, TextField, TextareaField, ToggleField, FileField, ColorField, Section } from '@rudderjs/panels'

export class SiteSettingsGlobal extends Global {
  static slug  = 'site-settings'
  static label = 'Site Settings'
  static icon  = 'settings'

  fields() {
    return [
      Section.make('General').schema(
        TextField.make('siteName').required().label('Site Name'),
        TextField.make('tagline'),
        FileField.make('logo').image().accept('image/*'),
        FileField.make('favicon').image().accept('image/*'),
      ),

      Section.make('Appearance').columns(2).schema(
        ColorField.make('primaryColor').label('Primary Color'),
        ColorField.make('accentColor').label('Accent Color'),
      ),

      Section.make('SEO Defaults').collapsible().schema(
        TextField.make('metaTitle').label('Default Meta Title'),
        TextareaField.make('metaDescription').label('Default Meta Description'),
      ),

      Section.make('Maintenance').schema(
        ToggleField.make('maintenanceMode').label('Maintenance Mode'),
        TextareaField.make('maintenanceMessage').label('Maintenance Message')
          .showWhen('maintenanceMode', 'truthy'),
      ),
    ]
  }
}
```

Register on the panel: `.globals([SiteSettingsGlobal])`.

The global is accessible at `/{panel}/globals/{slug}` — e.g., `/admin/globals/site-settings`.

---

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/{panel}/api/_globals/{slug}` | Fetch current values |
| `PUT` | `/{panel}/api/_globals/{slug}` | Save values |

---

## Layout

Globals support the same layout tools as Resources:

```ts
Section.make('Title')            // card grouping with a heading
  .description('Help text')      // optional subtext below heading
  .collapsible()                  // user can collapse
  .collapsed()                    // start collapsed
  .columns(2)                     // 2-column field grid inside the section
  .schema(...fields)

Tabs.make()                      // tab-navigated groups
  .tab('General', ...fields)
  .tab('Advanced', ...fields)
```

---

## Required Prisma Model

All globals share a single table — no migration needed when adding a new global:

```prisma
model PanelGlobal {
  slug      String   @id
  data      String   @default("{}")
  updatedAt DateTime @updatedAt
}
```
