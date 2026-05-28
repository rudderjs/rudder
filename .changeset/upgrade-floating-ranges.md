---
'@rudderjs/cli': patch
---

`rudder upgrade` — handle floating dist-tag ranges (`latest`, `*`, `next`) gracefully instead of treating them as parse errors.

Apps that use `"@rudderjs/core": "latest"` (a common pattern for auto-pickup of new releases) previously got a confusing "couldn't parse" message. The command now classifies every range into one of three shapes:

- **`workspace:*`** — silently skipped (monorepo refs, resolved by pnpm at install time).
- **floating** (`latest` / `*` / `next` / empty) — surfaced as info showing what each resolves to today. **Not rewritten** because converting to a caret range would change semantics (the user would stop auto-picking-up future majors).
- **pinned** (`^1.2.3`, `~1.2.3`, `1.2.3`, etc.) — bumped normally.

Discovered while dogfooding the upgrade command against `rudderjs.com`, which uses literal `"latest"` strings throughout `package.json`.
