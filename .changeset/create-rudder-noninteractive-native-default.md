---
"create-rudder": minor
---

feat(create-rudder): non-interactive recipes default to the native engine (matching the docs and the interactive prompt)

The flag-driven (CI / AI-agent) flow previously derived `orm: 'prisma'` for every recipe, contradicting the documented native default. Now:

- `--recipe=...` without `--orm` scaffolds the **native engine** (sqlite), same as the interactive Database prompt's default. `--db` is no longer required in recipe mode — only `--orm=prisma|drizzle` needs a driver choice.
- An explicit `--db=postgresql|mysql` without `--orm` falls back to **Prisma** — the native engine only scaffolds sqlite today, so the driver you actually asked for wins over the engine default.
- `--orm=native` combined with `--recipe` no longer demands `--db` (the sqlite pin is honored in validation, not just resolution).
- The scaffolded `tsconfig.json` gains `"types": ["node", "vite/client"]` so app code touching `import.meta.env` passes `tsc --noEmit` out of the box.
- `--orm` is now in the documented flag table (native default, prisma/drizzle/none opt-ins).
