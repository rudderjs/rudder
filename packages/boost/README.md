# @rudderjs/boost

AI developer experience layer for RudderJS. Exposes your project internals to AI coding assistants (Claude Code, Cursor, Copilot) via MCP.

## Installation

```bash
pnpm add -D @rudderjs/boost
```

## Setup

Add to your providers:

```ts
// bootstrap/providers.ts
import { boost } from '@rudderjs/boost'

export default [..., boost()]
```

### Connect to Claude Code

```bash
claude mcp add -s local -t stdio rudderjs-boost -- npx tsx node_modules/@rudderjs/cli/src/index.ts boost:mcp
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "rudderjs-boost": {
      "command": "npx",
      "args": ["tsx", "node_modules/@rudderjs/cli/src/index.ts", "boost:mcp"]
    }
  }
}
```

## Commands

```bash
rudder boost:install    # Generate .mcp.json, CLAUDE.md, .ai/guidelines/, .ai/skills/, boost.json
rudder boost:update     # Re-scan packages and update guidelines/skills (--discover for new packages)
rudder boost:mcp        # Start the MCP server (stdio transport)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `app_info` | Installed `@rudderjs/*` packages, versions, Node.js version, package manager |
| `db_schema` | Prisma schema — parsed models with fields/types, or raw `.prisma` source |
| `route_list` | All HTTP routes with methods, paths, middleware, source files |
| `model_list` | ORM models in `app/Models/` with table names and field types |
| `config_get` | Read config files — list all or read a specific one by key |
| `last_error` | Latest log entries from `storage/logs/` |
| `db_query` | Execute read-only SQL SELECT queries via Prisma |
| `read_logs` | Read log entries with filtering by level and search term |
| `browser_logs` | Read browser console logs from Vite dev server |
| `get_absolute_url` | Convert relative URI paths to absolute URLs using APP_URL |

## AI Guidelines & Skills

Each `@rudderjs/*` package can ship `boost/guidelines.md` and `boost/skills/*/SKILL.md` files. Running `boost:install` collects these into your project:

- `.ai/guidelines/{package}.md` — per-package AI coding guidelines
- `.ai/skills/*/SKILL.md` — on-demand task-specific knowledge modules
- `CLAUDE.md` — concatenated guidelines for Claude Code

## Programmatic Use

```ts
import { getAppInfo, getDbSchema, getRouteList, getModelList } from '@rudderjs/boost'
import { executeDbQuery, readLogs, readBrowserLogs, getAbsoluteUrl } from '@rudderjs/boost'

const info   = getAppInfo(process.cwd())
const schema = getDbSchema(process.cwd())
const routes = getRouteList(process.cwd())
const models = getModelList(process.cwd())
```
