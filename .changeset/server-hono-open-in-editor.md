---
"@rudderjs/server-hono": minor
---

Add a prominent "Open in editor" action to the dev error page. A primary button in the title-row (alongside Copy-as-Markdown) opens the top application frame directly in the resolved editor, so a developer can jump from an exception to the offending line without hunting through the per-frame list. Reuses the existing `editor-launch.ts` infra (`resolveEditor()` / `buildEditorUrl()`, `APP_EDITOR` env) — no new URL-scheme logic. The button is rendered only when an editor URL is available, so it is hidden when `APP_EDITOR=none` or the error has no stack. Dev-only, same gating as the rest of the error page.
