---
"@rudderjs/cli": patch
---

Exit non-zero on an unknown command. `rudder <unknown-command>` previously printed the full help text and exited 0 — a typo'd command looked like success. It now prints a clear `Unknown command: <name>` error with a `rudder --help` hint and exits with code 1, matching Laravel Artisan / npm / cargo. Bare `rudder` (no args) still shows help and exits 0.
