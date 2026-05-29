---
"@rudderjs/passport": patch
"@rudderjs/cli": patch
"@rudderjs/console": patch
"@rudderjs/vite": patch
---

fix: close file check-then-write races (TOCTOU) in CLI scaffolders, the view/route scanners, and OAuth key generation

Replaced `existsSync(path)` → later `write` patterns with a single atomic
operation, so a concurrent process can't slip a file (or symlink) in between
the check and the write:

- **Scaffolders** (`make:*`, `make:module`, `rudder add`) now write with the
  exclusive `wx` flag and surface the same "already exists — use `--force`"
  message via an `EEXIST` catch. `--force` opts into truncation as before.
- **`passport:keys`** writes the freshly generated keypair with `wx` (private
  key still `0o600`), so the write fails rather than following a pre-planted
  file/symlink at the key path. The non-`--force` guard now rejects when
  *either* key already exists (previously only the private key), treating the
  pair atomically.
- **`@rudderjs/vite` scanners** read-with-`ENOENT`-catch instead of
  `existsSync`-then-read for their idempotent codegen writes.

No behavioral change for normal use; `--force` semantics are unchanged.
