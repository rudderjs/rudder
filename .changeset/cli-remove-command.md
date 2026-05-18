---
'@rudderjs/cli': minor
---

Add `rudder remove <package>` — the natural counterpart to `rudder add`.

Reverses every step the `add` command makes:

1. **Validates** the alias against the same registry (25 packages).
2. **Refuses cleanly** when other installed packages still depend on the target. `rudder remove auth` while `sanctum` or `passport` is installed fails with: `"Cannot remove auth — these installed packages depend on it: passport. Remove them first, or keep auth installed."`
3. **Uninstalls** the npm dependency via the auto-detected package manager.
4. **Deletes** `config/<name>.ts` (unless `--keep-config` is passed).
5. **Surgically unregisters** the entry from `config/index.ts` — removes the import line and drops the key from the `configs = { ... }` map. Idempotent: returns `not-registered` if the key is already gone.
6. **Re-runs** `providers:discover` so the removed provider drops out of the manifest.

Like `rudder add`, this lives in the skip-boot list — the about-to-be-deleted provider may still be in `node_modules` but is being torn out; booting the app would be wasted work at best and surface confusing errors at worst.

## Idempotency

- `rudder remove queue` when `@rudderjs/queue` is already absent: prints `"@rudderjs/queue is not installed — nothing to remove"`, and opportunistically cleans up any orphaned `config/queue.ts` or `config/index.ts` entry left behind by a manual `pnpm remove`.
- Running twice in a row is safe — the second invocation just hits the not-installed branch.

## --keep-config

For users who want to uninstall the dependency but keep their tuned `config/<name>.ts` for later. The config file stays in place; the npm package goes away. Useful when temporarily uninstalling to test compatibility, or when migrating between adapter packages that share a config shape.
