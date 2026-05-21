---
"create-rudder": minor
"create-rudder-app": minor
---

feat(scaffolder): colored ANSI wordmark in the installer banner

Prints a `RUDDER` wordmark in ANSI Shadow block characters as the first thing the scaffolder shows, with a 6-stop gradient centered on `#f3b02f` (the brand orange) — light amber at the top, deep amber at the bottom. Lands the brand on the most-clicked surface in the framework and matches the install-experience identity Laravel/Astro/etc. set for modern scaffolders.

Skipped automatically when stdout isn't a TTY (CI piping, JSON agent mode), and degrades to plain-text monochrome when `NO_COLOR` is set in the environment.
