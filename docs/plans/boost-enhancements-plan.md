# Boost Enhancements Plan

Bring `@rudderjs/boost` to parity with Laravel Boost: multi-agent install, skills content, docs search, guidelines as MCP resources, runtime route list, and CLAUDE.md auto-update.

**Status:** Done (2026-04-13)

**Packages affected:** `@rudderjs/boost`, plus 4-6 packages that will ship new `boost/skills/` content

**Breaking change risk:** None. All changes are additive. Existing MCP tools, commands, and guideline collection are untouched. The MCP server stays on `@modelcontextprotocol/sdk` directly (same as Laravel Boost — it does NOT use `laravel/mcp` and we don't use `@rudderjs/mcp`).

**Consumer impact:** None — boost is a dev dependency only.

**Depends on:** Nothing — independent of MCP and AI plans.

---

## Goal

After this plan:

1. `boost:install` is **interactive** — asks which AI agents you use and generates per-agent config files (Claude Code, Cursor, Copilot, Codex, Gemini CLI, Windsurf).
2. `boost:update` also **regenerates CLAUDE.md** (and per-agent guideline files) — no need to re-run `boost:install`.
3. Key packages ship **skills** (on-demand SKILL.md files) — not just guidelines.
4. Guidelines are exposed as **MCP resources** — the AI agent can re-read them on demand, not just at install time.
5. `search_docs` MCP tool provides **local documentation search** over framework docs.
6. `route_list` tool uses **runtime route data** (`rudder route:list`) instead of regex parsing source files.
7. Third-party packages can register **custom agent adapters** via `Boost.registerAgent()`.

---

## Non-Goals

- **Remote docs API.** Laravel has a 17k-entry hosted API. Ours is local-first — indexes README.md + docs/ from installed packages. No external dependency.
- **Version-specific guidelines.** We're at v0. The infrastructure can be added later when we have multiple majors.
- **Migrating to `@rudderjs/mcp`.** Boost uses the raw MCP SDK directly for simplicity, same as Laravel Boost. No class hierarchy needed for a fixed tool set.

---

## Phase 1 — Multi-Agent Interactive Install

**What:** `boost:install` detects available agents, presents a selection, and generates per-agent config files.

### Current behavior
- Generates `.mcp.json` (Claude Code only) + `CLAUDE.md` + `.ai/guidelines/` + `.ai/skills/` + `boost.json`
- No agent detection, no selection, no support for other IDEs

### New behavior
- Detects which agents are likely in use (checks for config files, IDE directories)
- Presents interactive checklist (or accepts `--agent=claude-code,cursor` flag)
- Generates agent-specific files for each selected agent
- Tracks selections in `boost.json` so `boost:update` knows which agents to refresh

**Files to create/modify:**

1. **`packages/boost/src/agents/`** (new directory):
   ```
   agents/
   ├── types.ts           # BoostAgent interface
   ├── claude-code.ts     # .mcp.json + CLAUDE.md
   ├── cursor.ts          # .cursor/mcp.json + .cursorrules
   ├── copilot.ts         # .github/copilot-instructions.md + .vscode/mcp.json
   ├── codex.ts           # AGENTS.md + codex CLI MCP config
   ├── gemini.ts          # GEMINI.md + .gemini/settings.json
   └── windsurf.ts        # .windsurfrules + .windsurf/mcp.json
   ```

2. **`packages/boost/src/agents/types.ts`** (new):
   ```ts
   export interface BoostAgent {
     name: string
     displayName: string
     detect(cwd: string): boolean
     supportsGuidelines: boolean
     supportsMcp: boolean
     supportsSkills: boolean
     installGuidelines(cwd: string, content: string): Promise<void>
     installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void>
     installSkills?(cwd: string, skills: SkillEntry[]): Promise<void>
   }
   ```

3. **`packages/boost/src/commands/install.ts`** (rewrite):
   - Import all built-in agents + any registered custom agents
   - Detect which are available, present selection (using `@clack/prompts` or simple stdin)
   - Run each selected agent's install methods
   - Store selections in `boost.json`:
     ```json
     {
       "version": "0.0.1",
       "agents": ["claude-code", "cursor"],
       "packages": ["@rudderjs/core", "@rudderjs/orm", ...],
       "generatedAt": "..."
     }
     ```

**Per-agent output:**

| Agent | Guidelines File | MCP Config | Skills |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `.mcp.json` | `.ai/skills/` |
| Cursor | `.cursorrules` | `.cursor/mcp.json` | `.ai/skills/` |
| GitHub Copilot | `.github/copilot-instructions.md` | `.vscode/mcp.json` | — |
| Codex | `AGENTS.md` | codex CLI config | — |
| Gemini CLI | `GEMINI.md` | `.gemini/settings.json` | — |
| Windsurf | `.windsurfrules` | `.windsurf/mcp.json` | — |

All guideline files get the same concatenated content — just written to different paths. MCP config is the same `boost:mcp` command, just in different JSON formats per agent.

**Test:** Run `boost:install --agent=cursor`, verify `.cursor/mcp.json` and `.cursorrules` created correctly.

---

## Phase 2 — `boost:update` Regenerates Everything

**What:** `boost:update` refreshes guidelines, skills, AND per-agent files — no need to re-run `boost:install`.

### Current behavior
- Updates `.ai/guidelines/` and `.ai/skills/`
- Prints "CLAUDE.md was not modified. Run `boost:install` to regenerate it." — friction

### New behavior
- Updates `.ai/guidelines/` and `.ai/skills/`
- Reads `boost.json` to know which agents are configured
- Regenerates each agent's guideline file (CLAUDE.md, .cursorrules, etc.)
- With `--discover`: also finds newly installed packages

**Files to modify:**

1. **`packages/boost/src/commands/update.ts`** (rewrite):
   - Read `boost.json` for agent list + package list
   - Collect guidelines + skills (existing logic)
   - For each agent in `boost.json.agents`, call `agent.installGuidelines()` with fresh content
   - Update `boost.json` timestamp

**Test:** Install with Claude Code + Cursor, add a new package with guidelines, run `boost:update --discover`, verify both `CLAUDE.md` and `.cursorrules` updated.

---

## Phase 3 — Ship Skills in Packages

**What:** Write SKILL.md files for key packages so AI agents have on-demand deep knowledge.

### What guidelines vs skills are

| | Guidelines | Skills |
|---|---|---|
| **Loaded** | Always — injected into agent context upfront | On-demand — loaded when relevant to the task |
| **Scope** | Broad conventions, key imports, pitfalls | Deep implementation patterns, step-by-step |
| **Size** | Short (under 200 lines) | Longer, detailed |
| **Example** | "Here's how agents work, here are the key imports" | "How to build a multi-step agent with tool approval, conversation persistence, and streaming" |

### Skills to create

| Package | Skill Name | Content |
|---|---|---|
| `@rudderjs/orm` | `orm-models` | Creating models, relationships, queries, migrations, seeding |
| `@rudderjs/auth` | `auth-setup` | Setting up auth, guards, sessions, registration flow, vendor views |
| `@rudderjs/ai` | `ai-agents` | Building agents with tools, streaming, approval flows, conversations, middleware |
| `@rudderjs/ai` | `ai-tools` | Defining server/client tools, approval gates, generator yields, modelOutput |
| `@rudderjs/mcp` | `mcp-servers` | Building MCP servers with tools, resources, prompts, testing |
| `@rudderjs/view` | `controller-views` | Creating views, route overrides, multi-framework setup |

**Files to create:**
- `packages/orm/boost/skills/orm-models/SKILL.md`
- `packages/auth/boost/skills/auth-setup/SKILL.md`
- `packages/ai/boost/skills/ai-agents/SKILL.md`
- `packages/ai/boost/skills/ai-tools/SKILL.md`
- `packages/mcp/boost/skills/mcp-servers/SKILL.md`
- `packages/view/boost/skills/controller-views/SKILL.md`

Each follows the Agent Skills spec:
```markdown
---
name: ai-agents
description: Build AI agents with tools, streaming, approval flows, and conversations
---

# Building AI Agents

## When to use this skill
When creating a new agent class, adding tools, setting up conversations, or configuring streaming.

## Step-by-step
...

## Examples
...
```

**Test:** Run `boost:install`, verify skills appear in `.ai/skills/`.

---

## Phase 4 — Guidelines as MCP Resources

**What:** Expose collected guidelines as MCP resources so the AI agent can re-read them on demand — not just at install time.

### Why
Guidelines are baked into CLAUDE.md at install time. But if the agent needs to re-check a specific package's guidelines mid-conversation, it can't. Making them available as MCP resources means the agent can call `readResource('guidelines://orm')` at any time.

**Files to modify:**

1. **`packages/boost/src/server.ts`** (modify) — After registering tools, register resources:
   ```ts
   // For each installed package that has guidelines
   server.registerResource(`guidelines://${shortName}`, {
     description: `AI coding guidelines for @rudderjs/${shortName}`,
     mimeType: 'text/markdown',
   }, async () => {
     const content = readFileSync(guidelinePath, 'utf-8')
     return { contents: [{ uri: `guidelines://${shortName}`, text: content }] }
   })
   ```

2. Also register a `guidelines://all` resource that returns the concatenated guidelines (same content as CLAUDE.md).

**Test:** Start MCP server, list resources, verify `guidelines://orm`, `guidelines://auth`, etc. appear. Read one, verify content matches the package's `boost/guidelines.md`.

---

## Phase 5 — Documentation Search Tool

**What:** `search_docs` MCP tool for searching RudderJS documentation locally.

**Approach:** Build a lightweight in-memory index from markdown files. No external API, no embeddings — simple keyword/TF-IDF search that can be upgraded later.

**Files to create/modify:**

1. **`packages/boost/src/docs-index.ts`** (new) — Index builder:
   - Scans: `node_modules/@rudderjs/*/README.md` + `node_modules/@rudderjs/*/docs/**/*.md`
   - Splits by headings (`##` / `###`) into sections
   - Each section: `{ package, file, heading, headingHierarchy, content, keywords }`
   - Ranking: exact phrase match > all words present > partial word overlap
   - Index is built on first call, cached for MCP server lifetime

2. **`packages/boost/src/tools/search-docs.ts`** (new) — MCP tool:
   ```ts
   Input: { query: string, package?: string, limit?: number }
   Output: ranked list of { package, file, heading, excerpt, score }
   ```

3. **`packages/boost/src/server.ts`** (modify) — Register `search_docs` as the 11th tool.

**Why local, not remote:**
- Works offline, no API key
- Docs ship with packages (README.md + docs/)
- Zero latency — in-process
- Upgrade path: swap in embeddings later without changing the tool interface

**Test:** Call `search_docs` with "middleware", verify it returns relevant sections from core/contracts docs.

---

## Phase 6 — Runtime Route List

**What:** Replace regex-based route parsing with actual runtime data.

### Current behavior
`route_list` tool regex-parses `routes/web.ts` and `routes/api.ts` for `Route.method('path')` patterns. Misses dynamic routes, programmatic registration, grouped routes.

### New behavior
Execute `rudder route:list --json` (already exists in CLI) and return the output. Falls back to regex parsing if the command isn't available.

**Files to modify:**

1. **`packages/boost/src/tools/route-list.ts`** (rewrite):
   ```ts
   export function getRouteList(cwd: string): RouteInfo[] {
     try {
       // Try runtime first
       const result = execSync('pnpm rudder route:list --json', { cwd, timeout: 10000 })
       return JSON.parse(result.toString())
     } catch {
       // Fall back to regex parsing
       return regexParseRoutes(cwd)
     }
   }
   ```

**Test:** Start playground, call `route_list` tool, verify it returns all registered routes including auth routes from `registerAuthRoutes()`.

---

## Phase 7 — Custom Agent Registration

**What:** Users and third-party packages can register custom agent adapters.

**Files to create/modify:**

1. **`packages/boost/src/Boost.ts`** (new) — Static registry:
   ```ts
   export class Boost {
     private static customAgents = new Map<string, BoostAgent>()

     static registerAgent(name: string, agent: BoostAgent): void {
       this.customAgents.set(name, agent)
     }

     static getCustomAgents(): Map<string, BoostAgent> {
       return this.customAgents
     }
   }
   ```

2. **`packages/boost/src/index.ts`** (modify) — Export `Boost` class and `BoostAgent` interface.

3. **`packages/boost/src/commands/install.ts`** (modify) — Merge built-in agents with custom agents in the selection list.

**Usage:**
```ts
import { Boost } from '@rudderjs/boost'
Boost.registerAgent('my-agent', new MyCustomAgent())
```

**Test:** Register a custom agent, run `boost:install`, verify it appears in selections.

---

## Phase Order

| Phase | Description | Depends on |
|---|---|---|
| 1 | Multi-agent interactive install | — | Done |
| 2 | boost:update regenerates everything | Phase 1 | Done (was already in af696617) |
| 3 | Ship skills in packages | — | Done (6 skills: orm, auth, ai×2, mcp, view) |
| 4 | Guidelines as MCP resources | — | Done |
| 5 | Documentation search tool | — | Done |
| 6 | Runtime route list | — | Done |
| 7 | Custom agent registration | Phase 1 | Done |

Phases 3-6 are all independent and can be done in any order. Phase 1 is the foundation since 2 and 7 depend on the agent type system.

---

## Verification Checklist

- [ ] Existing boost test suite passes (no regression)
- [ ] `boost:install` interactive selection works
- [ ] `boost:install --agent=claude-code,cursor` flag works
- [ ] Each agent generates correct config files
- [ ] `boost:update` refreshes all agent guideline files
- [ ] `boost:update --discover` finds new packages
- [ ] Skills appear in `.ai/skills/` after install
- [ ] MCP resources list shows `guidelines://` entries
- [ ] `search_docs` returns relevant results
- [ ] `route_list` uses runtime data when available
- [ ] Custom agent registration works
- [ ] `pnpm typecheck` clean
- [ ] Playground `boost:install` + `boost:update` work end-to-end
