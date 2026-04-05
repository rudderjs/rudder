# @rudderjs/boost — AI Developer Experience Layer

**Date:** 2026-04-05
**Status:** Planning
**Inspiration:** [Laravel Boost](https://laravel.com/docs/13.x/boost)
**Dependencies:** `@rudderjs/core`, `@rudderjs/cli`

---

## What

`@rudderjs/boost` makes AI coding assistants (Claude Code, Cursor, Copilot, Codex) smarter about your RudderJS project. It's a **dev dependency** — it helps the developer, not the app's end users.

Three pillars:
1. **MCP Server** — expose project internals as tools for AI agents
2. **Auto-generated guidelines** — project-specific CLAUDE.md from installed packages
3. **Package-bundled skills** — on-demand knowledge modules shipped with each `@rudderjs/*` package

---

## Why

Our CLAUDE.md is 500+ lines and manually maintained. A new RudderJS user gets zero AI context about their project. Laravel Boost solves this — we should too.

---

## Phase 1: MCP Server (`rudder boost:mcp`)

Expose project internals via Model Context Protocol (stdio transport). AI coding assistants connect to this and can inspect the app in real-time.

### MCP Tools

| Tool | Description |
|------|-------------|
| `app_info` | Node.js version, installed `@rudderjs/*` packages + versions, server adapter, config values |
| `db_schema` | Read Prisma schema files (or Drizzle schemas) — returns table/column/relation definitions |
| `db_query` | Execute a read-only database query and return results |
| `route_list` | List all registered routes (method, path, middleware, handler name) |
| `model_list` | List all registered ORM models with their table names and fields |
| `last_error` | Read the latest error from application logs |
| `read_logs` | Read last N log entries |
| `search_docs` | Semantic search over RudderJS documentation (local or hosted API) |
| `config_get` | Read a config value by dot-notation key (e.g. `app.name`, `database.default`) |

### Implementation

```ts
// Rudder command — runs as stdio MCP server
rudder.command('boost:mcp', async () => {
  const server = new McpServer({ name: 'rudderjs-boost', version: '0.0.1' })

  server.tool('app_info', 'Get application info', {}, async () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const rudderPkgs = Object.entries(pkg.dependencies ?? {})
      .filter(([name]) => name.startsWith('@rudderjs/'))
    return { node: process.version, packages: rudderPkgs, ... }
  })

  server.tool('db_schema', 'Read database schema', {}, async () => {
    // Read prisma/schema/*.prisma files, parse and return
  })

  // ... more tools

  await server.connect(new StdioServerTransport())
})
```

### MCP Config Generation

`rudder boost:install` generates `.mcp.json`:

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

### Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK
- No AI provider SDKs needed — this talks to the IDE, not to LLMs

---

## Phase 2: Auto-Generated Guidelines (`rudder boost:install`)

Scan installed `@rudderjs/*` packages and generate a project-specific CLAUDE.md.

### How it works

1. Read `package.json` for `@rudderjs/*` dependencies
2. For each installed package, load its `boost/guidelines.md` (shipped in the npm package)
3. Concatenate into a single CLAUDE.md with only the relevant sections
4. Detect project config (ORM type, auth setup, server adapter) and include relevant pitfalls

### Per-package guidelines

Each `@rudderjs/*` package ships a `boost/` directory:

```
packages/auth/
├── src/
├── boost/
│   ├── guidelines.md    # Core conventions for this package
│   └── skills/
│       └── auth-development/
│           └── SKILL.md  # Detailed auth implementation patterns
└── package.json         # "files": ["dist", "boost"]
```

### Generated output

```
project-root/
├── CLAUDE.md            # Auto-generated from installed packages
├── .ai/
│   ├── guidelines/      # Per-package guideline files (auto-discovered)
│   └── skills/          # Per-package skill files (auto-discovered)
└── .mcp.json            # MCP server config
```

### Commands

```bash
rudder boost:install     # Generate CLAUDE.md + .mcp.json + .ai/ directory
rudder boost:update      # Regenerate after adding/removing packages
```

### Custom guidelines

Users can add `.ai/guidelines/custom-rules.md` — these get appended to the generated CLAUDE.md and survive `boost:update`.

---

## Phase 3: Package-Bundled Skills

Each `@rudderjs/*` package ships optional skill files for AI coding assistants.

### Skill format

```markdown
---
name: auth-development
description: Implement authentication, authorization, and password resets with @rudderjs/auth
---

# Auth Development

## When to use this skill
Use when implementing login/register flows, protecting routes, adding gates/policies...

## Key APIs
- `Auth.attempt({ email, password })` — login with credentials
- `Auth.login(user)` / `Auth.logout()`
- `Gate.define('ability', callback)` — closure-based authorization
- `Gate.policy(Model, PolicyClass)` — model-bound policies
...
```

### Auto-discovery

`rudder boost:install` scans `node_modules/@rudderjs/*/boost/skills/` and symlinks or copies into `.ai/skills/`.

### Built-in skills to ship

| Package | Skill |
|---------|-------|
| `@rudderjs/auth` | `auth-development` |
| `@rudderjs/panels` | `panels-development` |
| `@rudderjs/ai` | `ai-development` |
| `@rudderjs/orm` | `orm-development` |
| `@rudderjs/router` | `routing-development` |
| `@rudderjs/queue` | `queue-development` |
| `@rudderjs/broadcast` | `realtime-development` |
| `@rudderjs/live` | `collaboration-development` |
| `@rudderjs/sanctum` | `api-tokens-development` |
| `@rudderjs/socialite` | `oauth-development` |

---

## Implementation Order

| Phase | Effort | Priority |
|-------|--------|----------|
| 1. MCP Server | Medium | High — biggest immediate value |
| 2. Auto-generated guidelines | Small | High — low effort, high impact |
| 3. Package-bundled skills | Medium | Medium — requires writing content for each package |

---

## Open Questions

1. **Hosted docs API** — should `search_docs` call a hosted endpoint (like Laravel's) or search local markdown files?
2. **IDE auto-detection** — should `boost:install` detect the IDE and generate the right config format?
3. **Package manager** — `npx tsx` vs `pnpm exec tsx` in `.mcp.json` — use `pmExec()` helper from create-rudderjs-app?
4. **Write tools** — should MCP expose write operations (create model, add route) or stay read-only for safety?
