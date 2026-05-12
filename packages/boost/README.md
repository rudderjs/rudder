# @rudderjs/boost

AI developer experience layer for RudderJS. Exposes your project internals to AI coding assistants via MCP. Supports Claude Code, Cursor, GitHub Copilot, Codex CLI, Gemini CLI, and Windsurf.

## Installation

New projects can opt in via `create-rudder-app` — Boost appears in the optional-package multiselect during scaffolding. To add it to an existing project:

```bash
pnpm add -D @rudderjs/boost
```

## Setup

`BoostProvider` is picked up by [auto-discovery](https://github.com/rudderjs/rudder/blob/main/docs/guide/service-providers.md#auto-discovery) — `pnpm rudder providers:discover` is all that's needed.

### Quick Start

```bash
rudder boost:install                          # Auto-detect agents, generate configs
rudder boost:install --agent=claude-code      # Specific agent
rudder boost:install --agent=cursor,copilot   # Multiple agents
rudder boost:install --include-all-skills     # Install every shipped skill, even ones whose target package isn't present
```

`boost:install` writes a `boost.json` at the project root recording the agents you selected and the skills it installed; `boost:update` reads it back to drive incremental re-scans without re-prompting. Commit `boost.json` so teammates and CI get the same agent configuration.

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
| `search_docs` | Search local `@rudderjs/*` package documentation by keyword |
| `commands_list` | List all rudder commands (built-in + package + user-defined) with args, options, and source. Optional `namespace` filter |
| `command_run` | Execute a rudder command and return stdout, stderr, exit code, and duration |

## MCP Resources

Guidelines are also exposed as MCP resources so AI agents can re-read them on demand:

| Resource URI | Description |
|---|---|
| `guidelines://orm` | Guidelines for `@rudderjs/orm` |
| `guidelines://auth` | Guidelines for `@rudderjs/auth` |
| `guidelines://all` | All package guidelines concatenated |
| ... | One resource per installed package with `boost/guidelines.md` |

## AI Guidelines & Skills

Each `@rudderjs/*` package can ship `boost/guidelines.md` and `boost/skills/*/SKILL.md` files. Running `boost:install` collects these into your project:

- `.ai/guidelines/{package}.md` — per-package AI coding guidelines
- `.ai/skills/*/SKILL.md` — on-demand task-specific knowledge modules
- Per-agent guideline files (`CLAUDE.md`, `.cursorrules`, etc.) — concatenated guidelines, with foundational context (installed `@rudderjs/*` packages + versions, Boost MCP tool list) and a Skills Activation section listing each skill's ACTIVATE/SKIP heuristics

### Skill targeting (`appliesTo`)

A skill's frontmatter can declare `appliesTo: [<package>, ...]`. `boost:install` only installs the skill when at least one of those packages is present in the project — keeps the skills directory focused on what the project actually uses. Use `--include-all-skills` to bypass and install every shipped skill, even ones whose target package isn't installed.

```yaml
# boost/skills/orm-models/SKILL.md
---
name: orm-models
appliesTo:
  - @rudderjs/orm
  - @rudderjs/orm-prisma
trigger: when defining or editing ORM models
---
```

## Custom Agent Registration

Third-party packages or users can register custom agent adapters:

```ts
import { Boost } from '@rudderjs/boost'
import type { BoostAgent } from '@rudderjs/boost'

const myAgent: BoostAgent = {
  name: 'my-ide',
  displayName: 'My IDE',
  detect: (cwd) => existsSync(join(cwd, '.my-ide')),
  supportsGuidelines: true,
  supportsMcp: true,
  supportsSkills: false,
  installGuidelines: async (cwd, content) => { /* ... */ },
  installMcp: async (cwd, cmd) => { /* ... */ },
}

Boost.registerAgent(myAgent)
```

Custom agents appear in `boost:install` auto-detection and `--agent=` selection.

## Programmatic Use

```ts
import { getAppInfo, getDbSchema, getRouteList, getModelList, searchDocs } from '@rudderjs/boost'

const info    = getAppInfo(process.cwd())
const schema  = getDbSchema(process.cwd())
const routes  = getRouteList(process.cwd())
const models  = getModelList(process.cwd())
const results = searchDocs(process.cwd(), 'middleware')
```
