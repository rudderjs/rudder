---
"@rudderjs/boost": minor
"@rudderjs/cli": minor
---

**Boost: `commands_list` + `command_run` MCP tools.** Agents can now discover and execute rudder commands directly from MCP — no more shelling out blindly.

- `commands_list` returns built-in + package + user-defined commands with names, descriptions, args, options, and source. Optional `namespace` filter (e.g. `make`, `db`, `queue`).
- `command_run` spawns a command as a subprocess, captures stdout/stderr/exit code/duration, enforces a timeout, and caps stream sizes. Subprocess isolation keeps the long-lived MCP server clean.
- The CLI's `command:list` gains `--all` (include built-in + package commands) and `--json` (machine-readable output) flags. When the user app cannot boot, `command:list --json` still emits built-in + package commands plus a `bootError` field rather than crashing — partial info beats an opaque failure for an agent mid-session.
