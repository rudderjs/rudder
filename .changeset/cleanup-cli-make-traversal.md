---
"@rudderjs/cli": patch
---

Guard the `make:*` scaffolders against path traversal. A name like `rudder make:model ../../../foo` resolved outside the spec's target directory and would write the file there (creating the intervening directories) — an arbitrary-file-write vector when the name is untrusted (e.g. driven from a codegen pipeline). Names whose resolved path escapes the target directory are now rejected; nested names like `Admin/User` still work. This matches the guard already in `@rudderjs/console`'s `executeMakeSpec`.
