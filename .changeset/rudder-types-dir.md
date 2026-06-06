---
'@rudderjs/vite': minor
'@rudderjs/database': minor
'@rudderjs/orm': patch
'create-rudder': minor
---

Generated type registries consolidate under the committed `.rudder/types/` directory: `views.d.ts` (was `pages/__view/registry.d.ts`), `routes.d.ts` (was `routes/__registry.d.ts`), `models.d.ts` (was `app/Models/__schema/registry.d.ts`). The Vike page stubs stay in `pages/__view/` (pinned by Vike's filesystem routing).

Migration is automatic — the first dev/build/`routes:sync`/`view:sync`/`migrate` after upgrading writes the new path and deletes the legacy file. One manual step for existing apps: add `".rudder/**/*"` to the `tsconfig.json` `include` array (dot-directories are invisible to `**/*` globs and to bare-directory include entries; new scaffolds ship it). A `.rudder/README.md` is generated alongside, describing each file and its regen command.
