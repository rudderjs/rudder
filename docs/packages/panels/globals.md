# Globals

Single-record settings pages -- same field system as Resources but no list/create/delete.

---

## Defining Globals

```ts
import { Global, TextField, ToggleField, Section } from '@boostkit/panels'

export class SiteSettingsGlobal extends Global {
  static slug  = 'site-settings'
  static label = 'Site Settings'
  static icon  = 'settings'

  fields() {
    return [
      Section.make('General').schema(
        TextField.make('siteName').required(),
        TextField.make('tagline'),
      ),
      Section.make('Maintenance').schema(
        ToggleField.make('maintenanceMode'),
      ),
    ]
  }
}
```

Register: `.globals([SiteSettingsGlobal])`. API: `GET/PUT /{panel}/api/_globals/{slug}`.

### Required Prisma Model

```prisma
model PanelGlobal {
  slug      String   @id
  data      String   @default("{}")
  updatedAt DateTime @updatedAt
}
```
