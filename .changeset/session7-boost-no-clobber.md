---
"@rudderjs/boost": patch
---

Stop `boost:install` / `boost:update` from destroying user files, and harden the `db_query` MCP tool.

- Guideline files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`) are now spliced in place using the `<rudderjs-boost-guidelines>` markers the generator already emits. A hand-written file is preserved — only the marked block is inserted or replaced — instead of being overwritten wholesale.
- MCP config files (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`, `.windsurf/mcp.json`) are now merged. Sibling MCP servers and unrelated settings (e.g. Gemini's theme/auth in `settings.json`) are preserved instead of being clobbered by a single-server write.
- `boost:update` now uses the same generator as `boost:install`, so the regenerated content keeps its markers and a consistent format, and it preserves the recorded `skills` list in `boost.json` instead of dropping it.
- The `db_query` tool now rejects stacked statements. A query such as `SELECT 1; DROP TABLE users` passed the SELECT-prefix check and would execute the write through the Prisma `db execute --stdin` fallback; only a single SELECT statement is now accepted.
