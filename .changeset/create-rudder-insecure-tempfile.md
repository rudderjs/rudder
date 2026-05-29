---
"create-rudder": patch
---

fix: write the JSON/agent-mode scaffold log to a private temp dir

In `--json`/agent mode the scaffolder wrote its log to a predictably-named
`create-rudder-<timestamp>.log` directly in the shared OS temp dir. Because the
name was guessable, a local attacker could pre-plant a file or symlink at that
path before the write landed (a TOCTOU / symlink attack — the same class the
framework hardened in #774). The log now goes inside a private, randomly-named
directory created with `fs.mkdtemp()` (mode 0700, unguessable suffix), so the
target can't be anticipated. Resolves CodeQL `js/insecure-temporary-file`.
