---
"@rudderjs/boost": patch
---

Fix the `db_schema` MCP tool summary in generated CLAUDE.md guidelines: it described only "Prisma schema models" but the tool is native-first (parses `.rudder/types/models.d.ts`, falling back to the Prisma schema).
