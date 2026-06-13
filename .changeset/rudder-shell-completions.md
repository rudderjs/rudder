---
"@rudderjs/cli": minor
---

Add `rudder completion` for shell tab-completion. `rudder completion <bash|zsh|fish>` prints a self-contained completion script to stdout; `rudder completion install` detects your shell, writes the script under `~/.rudder/`, and wires it into your rc file (fish autoloads, so no rc edit); `rudder completion uninstall` removes both cleanly and idempotently. Completion covers the built-in and framework command names, including namespaced ones (`make:model`, `migrate:fresh`), with the bash colon-word handling needed for `make:<TAB>` to work under the default `COMP_WORDBREAKS`. A tip pointing at `rudder completion install` now appears at the bottom of `rudder --help`. Static v1 (no per-keystroke CLI round-trip, no third-party dependency); dynamic completions (model/route names) are a future follow-up.
