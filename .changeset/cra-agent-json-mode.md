---
"create-rudder-app": minor
---

**AI-agent detection + JSON output mode.** Inspired by Laravel Installer v5.27.

When `create-rudder-app` runs inside an AI coding agent (Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI, Windsurf), it auto-detects via env vars and switches from interactive `@clack/prompts` to a flag-driven non-interactive flow with structured JSON output to stdout. Agents get a parseable success/failure result instead of garbled TTY redraws.

- New flags: `--orm`, `--db`, `--packages`, `--frameworks`, `--primary-framework`, `--tailwind`, `--shadcn`, `--demos`, `--install`, `--json`, `--interactive`. Special values: `--packages=*` (all defaults), `--demos=*` (all gated-available), empty string for none.
- Flags also work in interactive mode — pass `--orm=prisma` to skip just that prompt. Useful for CI templates and scripted setups.
- Detection respects `RUDDER_NONINTERACTIVE=1` for explicit opt-in; `--interactive` forces the prompt UI back on.
- On failure, JSON output includes `error`, `requiredFlags` (when validation fails), and `logFile`/`logTail` (when install crashes).
