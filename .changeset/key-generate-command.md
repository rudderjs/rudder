---
'@rudderjs/cli': minor
'create-rudder': patch
---

`rudder key:generate` — Laravel-parity command for generating a 32-byte `APP_KEY` and writing it to `.env`.

```bash
pnpm rudder key:generate            # generate + write to .env
pnpm rudder key:generate --show     # print to stdout, leave .env alone
pnpm rudder key:generate --force    # overwrite an existing non-empty APP_KEY
pnpm rudder key:generate --path .env.local   # target a different .env file
```

Idempotent behavior:

- `.env` doesn't exist → created with `APP_KEY=base64:...`
- `.env` exists but has no `APP_KEY` line → appended
- `.env` has an **empty** `APP_KEY=` (the fresh-scaffold shape) → replaced silently
- `.env` has a **non-empty** `APP_KEY=…` → refused with exit 1, unless `--force` is passed (protects production secrets from accidental overwrite)

Commented-out lines (`# APP_KEY=...`) and similar-prefixed names (`APP_KEYS=...`) are not touched. Preserves all other lines, comments, and ordering in `.env`.

Also updates every place in the framework that previously emitted the verbose `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` recipe:

- **doctor → APP_KEY unset** now says `Run \`pnpm rudder key:generate\` to generate a 32-byte APP_KEY and write it to .env`
- **doctor → APP_KEY too short** now says `Run \`pnpm rudder key:generate --force\` to replace it with a 32-byte key`
- **`create-rudder` scaffolder** — `.env.example`'s `# Generate with:` hint now points at `pnpm rudder key:generate` instead of the inline `node -e` recipe.

The scaffolder still generates `APP_KEY` automatically at scaffold time (it always did) — the change only affects the `.env.example` documentation hint, so users cloning a fresh project know which command to run when they need to rotate or regenerate.
