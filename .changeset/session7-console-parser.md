---
"@rudderjs/console": patch
---

Fix command-signature parsing and a couple of related bugs.

- `parseSignature` split the inline description on a bare `:`, corrupting any argument/option default value that contained a colon — `{--url=http://localhost:3000}` lost everything after `http`, and `{host=db:5432}` truncated to `db`. The description delimiter is now the spaced ` : ` (the Laravel convention the docstrings already used), so colons inside default values survive.
- A variadic or optional argument carrying a default (`{files*=a,b}`) lost its variadic flag and kept the `*` in its name. The `=default` segment is now stripped before the trailing `?`/`*` marker is read, so the flag and a clean name are both preserved.
- `newLine(0)` threw a `RangeError` (`'\n'.repeat(-1)`); the repeat count is now clamped to zero.
- `executeMakeSpec` now rejects a name whose resolved path escapes the spec's target directory (e.g. `../../../foo`), closing an arbitrary-file-write vector when a `make:*` command is driven with an untrusted name. Nested names like `Admin/Widget` remain allowed.
