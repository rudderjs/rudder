# @rudderjs/boost

AI developer experience layer for RudderJS. Exposes your project internals to AI coding assistants via MCP. Supports Claude Code, Cursor, GitHub Copilot, Codex CLI, Gemini CLI, and Windsurf.

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

### Quick Start

```bash
rudder boost:install                        # Auto-detect agents, generate configs
rudder boost:install --agent=claude-code    # Specific agent
rudder boost:install --agent=cursor,copilot # Multiple agents
```

### Supported Agents

| Agent | Guidelines | MCP Config | Skills |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `.mcp.json` | `.ai/skills/` |
| Cursor | `.cursorrules` | `.cursor/mcp.json` | `.ai/skills/` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.vscode/mcp.json` | — |
| Codex CLI | `AGENTS.md` | `.mcp.json` | — |
| Gemini CLI | `GEMINI.md` | `.gemini/settings.json` | — |
| Windsurf | `.windsurfrules` | `.windsurf/mcp.json` | — |

`boost:install` auto-detects which agents you use by checking for existing config files. Defaults to Claude Code if nothing is detected.

## Commands

```bash
rudder boost:install    # Generate per-agent configs, guidelines, skills, boost.json
rudder boost:update     # Re-scan packages and update all agent configs (--discover for new packages)
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
- Per-agent guideline files (`CLAUDE.md`, `.cursorrules`, etc.) — concatenated guidelines

## Programmatic Use

```ts
import { getAppInfo, getDbSchema, getRouteList, getModelList } from '@rudderjs/boost'
import { executeDbQuery, readLogs, readBrowserLogs, getAbsoluteUrl } from '@rudderjs/boost'

const info   = getAppInfo(process.cwd())
const schema = getDbSchema(process.cwd())
const routes = getRouteList(process.cwd())
const models = getModelList(process.cwd())
```
