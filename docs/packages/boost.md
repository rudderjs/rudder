# @rudderjs/boost

AI developer-experience layer for RudderJS. Exposes your project's internals to AI coding assistants via MCP — Claude Code, Cursor, GitHub Copilot, Codex CLI, Gemini CLI, and Windsurf. Also ships per-package AI coding guidelines and task-specific skill modules that are concatenated into your agent's instructions on install.

## Installation

New projects can opt in via `create-rudder-app` — Boost appears in the optional-package multiselect during scaffolding. To add it to an existing project:

```bash
pnpm add -D @rudderjs/boost
```

Register the provider:

```ts
// bootstrap/providers.ts
import { BoostProvider } from '@rudderjs/boost'

export default [
  // ...other providers
  BoostProvider,
]
```

## Quick start

```bash
pnpm rudder boost:install                        # auto-detect agents, generate configs
pnpm rudder boost:install --agent=claude-code    # specific agent
pnpm rudder boost:install --agent=cursor,copilot # multiple agents
```

`boost:install` detects which agents you use by checking for existing config files. Defaults to Claude Code if nothing is detected.

## Supported agents

| Agent | Guidelines file | MCP config | Skills |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `.mcp.json` | `.ai/skills/` |
| Cursor | `.cursorrules` | `.cursor/mcp.json` | `.ai/skills/` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.vscode/mcp.json` | — |
| Codex CLI | `AGENTS.md` | `.mcp.json` | — |
| Gemini CLI | `GEMINI.md` | `.gemini/settings.json` | — |
| Windsurf | `.windsurfrules` | `.windsurf/mcp.json` | — |

## Commands

```bash
pnpm rudder boost:install     # generate per-agent configs, guidelines, skills, boost.json
pnpm rudder boost:update      # re-scan packages and update all agent configs
                              # --discover flag re-runs for newly installed packages
pnpm rudder boost:mcp         # start the MCP server (stdio transport)
```

## MCP tools

Boost ships an MCP server that runs alongside your app. AI agents connect and call these tools to get live context:

| Tool | Description |
|---|---|
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

## MCP resources

Guidelines are exposed as MCP resources so agents can re-read them on demand:

| Resource URI | Description |
|---|---|
| `guidelines://orm` | Guidelines for `@rudderjs/orm` |
| `guidelines://auth` | Guidelines for `@rudderjs/auth` |
| `guidelines://all` | All package guidelines concatenated |
| ... | One resource per installed package with `boost/guidelines.md` |

## AI guidelines & skills

Each `@rudderjs/*` package can ship `boost/guidelines.md` and `boost/skills/*/SKILL.md` files. Running `boost:install` collects them into your project:

- `.ai/guidelines/{package}.md` — per-package AI coding guidelines
- `.ai/skills/*/SKILL.md` — on-demand task-specific knowledge modules
- Per-agent guideline files (`CLAUDE.md`, `.cursorrules`, etc.) — concatenated guidelines

Your app can ship its own `boost/guidelines.md` at the project root to include app-specific context (naming conventions, architecture decisions, business rules) — it gets merged in alongside the package guidelines.

## Custom agent registration

Third-party packages or users can register custom agent adapters:

```ts
import { Boost } from '@rudderjs/boost'
import type { BoostAgent } from '@rudderjs/boost'

const myAgent: BoostAgent = {
  name:               'my-ide',
  displayName:        'My IDE',
  detect:             (cwd) => existsSync(join(cwd, '.my-ide')),
  supportsGuidelines: true,
  supportsMcp:        true,
  supportsSkills:     false,
  installGuidelines:  async (cwd, content) => { /* ... */ },
  installMcp:         async (cwd, cmd) => { /* ... */ },
}

Boost.registerAgent(myAgent)
```

Custom agents appear in `boost:install` auto-detection and `--agent=` selection.

## Programmatic use

```ts
import { getAppInfo, getDbSchema, getRouteList, getModelList, searchDocs } from '@rudderjs/boost'

const info    = getAppInfo(process.cwd())
const schema  = getDbSchema(process.cwd())
const routes  = getRouteList(process.cwd())
const models  = getModelList(process.cwd())
const results = searchDocs(process.cwd(), 'middleware')
```

Useful for custom dashboards, CI checks, or embedding project context into your own tooling.

---

## Notes

- `boost:mcp` requires a fully bootstrapped application — it reads live routes, models, and config from the running DI container.
- `db_schema` reads the Prisma schema file directly; Drizzle support reads the schema directory.
- `last_error` returns the most recent entries from `storage/logs/` filtered by level.
- Works with any MCP-compatible AI client beyond the listed agents — the standard MCP protocol is the wire format.
