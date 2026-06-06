---
"@rudderjs/cli": minor
"@rudderjs/core": minor
---

`vendor:publish` now detects the native database engine: an app with `@rudderjs/orm` / `@rudderjs/database` but no orm-prisma/orm-drizzle adapter resolves as `orm: 'native'`, and `PublishGroup.orm` accepts `'native'` so packages can ship native-engine assets (e.g. `@rudderjs/sync`'s `syncDocument` migration under `--tag=sync-schema`).
