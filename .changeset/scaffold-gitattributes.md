---
'create-rudder': minor
---

Scaffolded apps now include a `.gitattributes` marking the committed generated files (`pages/__view/**`, `routes/__registry.d.ts`, `app/Models/__schema/registry.d.ts`) as `linguist-generated` — GitHub collapses them in PR diffs and excludes them from language stats.
