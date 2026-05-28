---
'@rudderjs/cli': minor
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

Also updates the doctor's `APP_KEY` fix hint from a one-liner `node -e crypto.randomBytes...` recipe to the new command.
