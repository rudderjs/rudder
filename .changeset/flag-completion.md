---
"@rudderjs/cli": minor
---

Complete command flags. Typing `rudder make:model --<TAB>` now suggests that command's options (`--with-test`, `--force`, `--migration`, ...), and `rudder -<TAB>` offers the global flags. Candidates are read from the command's live commander definition via a new internal `rudder completion flags` resolver, so the list never drifts. Commands that parse flags by hand expose only `--help`; the make:* family registers real options, which is where flag completion is most useful. Wired into bash (robust to intervening arguments), zsh, and fish.
