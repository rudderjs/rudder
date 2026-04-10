# Plan: @rudderjs/tui + @rudderjs/pilot

## Overview

Two new packages that extend RudderJS into the terminal:

1. **@rudderjs/tui** — Schema-to-terminal renderer using `@clack/prompts` (already a dependency)
2. **@rudderjs/pilot** — Interactive terminal AI agent (Claude Code-style) for RudderJS apps

---

## Phase 1: @rudderjs/tui

**Goal:** Render existing schema fields/forms as interactive terminal prompts.

### Package Setup

- `packages/tui/`
- Dependencies: `@clack/prompts` (already used in cli + create-rudder-app)
- Peer dependencies: `@rudderjs/panels` (for schema types)

### Field Mapping

| Schema Field | Clack Prompt | Notes |
|---|---|---|
| `Field.text()` | `clack.text()` | placeholder → message |
| `Field.number()` | `clack.text()` | with numeric validation |
| `Field.select()` | `clack.select()` | options from field config |
| `Field.multiSelect()` | `clack.multiselect()` | |
| `Field.boolean()` / `Field.toggle()` | `clack.confirm()` | |
| `Field.password()` | `clack.password()` | masked input |
| `Field.textarea()` | `clack.text()` | multiline hint |
| `Field.hidden()` | skip | not rendered |
| `Field.color()` | `clack.text()` | with hex validation |
| `Field.date()` | `clack.text()` | with date validation |
| Unsupported fields | `clack.text()` | fallback to plain text input |

### Schema Element Mapping

| Schema Element | Clack Equivalent | Notes |
|---|---|---|
| `Form([...fields])` | Sequential prompts → returns `Record<string, any>` | |
| `Section(label, [...fields])` | `clack.group()` with `clack.log.step(label)` header | |
| `Tabs([...tabs])` | `clack.select()` to pick tab → render tab fields | |
| `Table` | Formatted ASCII table output | read-only display |
| `Stats` | Formatted key-value output | read-only display |
| `Heading` / `Text` | `clack.log.info()` / `clack.note()` | |
| `Divider` | `clack.log.message('───')` | |
| `Alert` | `clack.log.warn()` / `clack.log.error()` | |

### Core API

```ts
import { renderForm, renderField, renderElement } from '@rudderjs/tui'

// Render a full form — returns collected values
const values = await renderForm(form)

// Render a single field — returns value
const name = await renderField(Field.text('name').label('Your name'))

// Render a read-only element
renderElement(Stats.make([{ label: 'Users', value: 42 }]))
```

### Validation Integration

- Fields with `.rules()` or `.validate()` → passed to clack's `validate` option
- Zod schemas from `@rudderjs/validation` work as-is
- Invalid input shows inline error, re-prompts

### CLI Integration

```ts
// In a rudder command
import { renderForm } from '@rudderjs/tui'

rudder.command('make:model {name}', async (args) => {
  const form = Form.make([
    Field.text('name').label('Model name').default(args.name),
    Field.select('orm').label('ORM').options([
      { label: 'Prisma', value: 'prisma' },
      { label: 'Drizzle', value: 'drizzle' },
    ]),
    Field.boolean('migration').label('Create migration?').default(true),
  ])

  const values = await renderForm(form)
  // scaffold model...
})
```

### Deliverables

- [ ] `packages/tui/` package scaffold
- [ ] `renderField()` — maps each field type to clack prompt
- [ ] `renderForm()` — renders a Form schema, returns values object
- [ ] `renderElement()` — renders read-only schema elements (Table, Stats, Heading, etc.)
- [ ] Validation integration (zod / inline validators)
- [ ] Section + Tabs support (grouping)
- [ ] Tests
- [ ] Migrate `create-rudder-app` prompts to use `@rudderjs/tui` schemas (optional, proves the API)

---

## Phase 2: @rudderjs/pilot

**Goal:** Interactive terminal AI agent with deep RudderJS knowledge.

### Package Setup

- `packages/pilot/`
- Dependencies: `@rudderjs/ai`, `@rudderjs/tui`
- Optional peer: `@rudderjs/boost` (project introspection tools)

### Architecture

```
User input (terminal)
       │
   ┌───▼───┐
   │ Pilot  │ ← render loop (raw ANSI + @rudderjs/tui for prompts)
   │  CLI   │
   └───┬───┘
       │
   ┌───▼───┐
   │ Agent  │ ← @rudderjs/ai Agent class
   │  Loop  │
   └───┬───┘
       │
   ┌───▼───────┐
   │ Tools      │
   │ ├─ boost   │ ← db_schema, route_list, model_list, config_get, last_error
   │ ├─ file    │ ← read, write, edit, glob, grep
   │ ├─ shell   │ ← run commands (with confirmation)
   │ ├─ rudder  │ ← make:model, make:controller, etc.
   │ └─ schema  │ ← render forms/fields in terminal via @rudderjs/tui
   └───────────┘
```

### Terminal UI Components (raw ANSI)

| Component | Purpose |
|---|---|
| Message stream | Streaming markdown text from agent |
| Tool call card | Shows tool name, args, result (expandable) |
| Input bar | User text input at bottom |
| Status line | Current model, token usage, connection status |
| Spinner | During agent thinking / tool execution |

No Ink dependency — use raw ANSI escape codes:
- `\x1b[1m` bold, `\x1b[2m` dim, `\x1b[36m` cyan, etc.
- `\x1b[?25l` hide cursor during streaming
- `readline` for input capture
- Simple markdown → ANSI converter (headers, code blocks, bold, italic, lists)

### Built-in Tools

#### From @rudderjs/boost (project context)
- `app_info` — app name, version, environment
- `db_schema` — database tables and columns
- `route_list` — all registered routes
- `model_list` — all ORM models
- `config_get` — read config values
- `last_error` — recent error logs

#### File tools
- `read_file` — read file contents
- `write_file` — write/create file (with confirmation)
- `edit_file` — edit existing file
- `glob` — find files by pattern
- `grep` — search file contents

#### Rudder tools
- `run_command` — execute rudder commands (make:model, etc.)
- `run_shell` — execute shell commands (with user confirmation)

#### Schema tools
- `ask_form` — render a form in terminal, collect values from user
- `show_table` — display data as terminal table

### Agent System Prompt

The agent gets a system prompt with:
- RudderJS conventions (from CLAUDE.md / project context)
- Current project structure (from boost tools)
- Available commands and generators
- Coding style guidelines

### CLI Interface

```bash
# As a rudder command
pnpm rudder ai                         # interactive mode
pnpm rudder ai "add auth to this app"  # one-shot with prompt
pnpm rudder ai --model openai:gpt-4    # model override

# Or standalone
npx rudderjs-pilot                     # if installed globally
```

### Conversation Features

- Streaming responses (token by token)
- Tool calls displayed inline with expand/collapse
- Conversation history (in-memory for session)
- File edits shown as diffs before applying
- Shell commands require user confirmation
- `Ctrl+C` to cancel current generation
- `/clear` to reset conversation
- `/model` to switch model mid-conversation

### Deliverables

- [ ] `packages/pilot/` package scaffold
- [ ] Terminal render loop (input, streaming output, ANSI formatting)
- [ ] Markdown → ANSI converter (basic: headers, code, bold, lists)
- [ ] Agent integration with `@rudderjs/ai`
- [ ] Boost tools integration
- [ ] File tools (read, write, edit, glob, grep)
- [ ] Rudder command tools
- [ ] Shell execution with confirmation
- [ ] Streaming display
- [ ] Tool call cards (inline display)
- [ ] System prompt with project context
- [ ] `rudder ai` command registration
- [ ] Conversation history (session-level)
- [ ] Tests

---

## Phase 3: Enhancements (future)

- [ ] Conversation persistence (save/resume sessions)
- [ ] `@rudderjs/tui` — migrate `create-rudder-app` to schema-defined wizard
- [ ] `@rudderjs/tui` — migrate `cli` make commands to schema-defined forms
- [ ] `@rudderjs/pilot` — multi-agent mode (like workspaces but in terminal)
- [ ] `@rudderjs/pilot` — MCP client support (connect to external MCP servers)
- [ ] `@rudderjs/pilot` — image/screenshot support (for multimodal models)
- [ ] `@rudderjs/pilot` — custom tools from user's app (register via provider)
- [ ] `@rudderjs/pilot` — `.pilotrc` config file for project-specific agent behavior

---

## Dependency Flow

```
@clack/prompts              (existing, no new deps)
       │
@rudderjs/tui               (schema → terminal prompts)
       │
@rudderjs/pilot             (terminal AI agent)
       ├── @rudderjs/ai     (agent, tools, streaming)
       ├── @rudderjs/tui    (interactive prompts when needed)
       └── @rudderjs/boost  (optional, project introspection)
```

## Package Count

Current: 36 packages → After: 38 packages (`tui` + `pilot`)
