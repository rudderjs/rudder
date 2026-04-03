---
'@rudderjs/panels': minor
---

Add autosave, form persistence, and per-field persist with Yjs provider support.

- `static autosave = true | { interval?: number }` — periodic server-side save on the edit page with toolbar status indicator (Unsaved / Saving / Saved)
- `static persistFormState = true` — full-form localStorage backup with restore banner, beforeunload warning; drafts cleared on save
- `.persist()` — per-field localStorage persistence; silently saves and restores individual field values across page reloads (no banner)
- `.persist('indexeddb')` — per-field y-indexeddb offline persistence via Yjs
- `.persist('websocket')` — per-field y-websocket real-time sync via Yjs
- `.persist(['websocket', 'indexeddb'])` — both Yjs providers combined
- `.collaborative()` is now a shorthand for `.persist('websocket')`
- Renamed internal `_collaborative` → `_yjs`; `FieldMeta.collaborative` → `FieldMeta.yjs`; `ResourceMeta.collaborative` → `ResourceMeta.yjs`
- New i18n keys: `autosaved`, `autosaving`, `unsavedChanges`, `restoreDraft`, `restoreDraftButton`, `discardDraft`, `unsavedWarning` (en + ar)
- 29 new tests covering persist modes, autosave config, yjs flag derivation, and i18n keys
