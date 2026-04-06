# @rudderjs/workspaces

AI workspace canvas -- an Isoflow-style 3D node editor with departments, connections, chat sidebar, and an orchestrator agent. Installed as a `@rudderjs/panels` plugin.

## Installation

```bash
pnpm add @rudderjs/workspaces
```

## Setup

Register the plugin on your panel:

```ts
// app/Panels/AdminPanel.ts
import { Panel } from '@rudderjs/panels'
import { workspaces } from '@rudderjs/workspaces'

export default Panel.make('admin')
  .use(workspaces())
  .resources([/* ... */])
```

### Prerequisites

`@rudderjs/workspaces` requires both `@rudderjs/panels` and `@rudderjs/ai` to be installed and registered:

```ts
// bootstrap/providers.ts
import { panels } from '@rudderjs/panels'
import { ai }     from '@rudderjs/ai'

export default [
  // ...other providers
  ai(configs.ai),
  panels(),
]
```

Prisma models for workspace persistence are included -- run `prisma generate` and `prisma db push` after installing.

## Usage

### Canvas Nodes

Workspaces present an interactive 3D canvas where each node represents an AI agent, data source, or processing step. Nodes are connected with directional edges to define execution flow.

### Departments

Group related nodes into departments -- logical containers that organize agents by domain (e.g. "Research", "Writing", "Review"):

```ts
workspaces({
  departments: [
    { name: 'Research',  color: '#3b82f6' },
    { name: 'Writing',   color: '#10b981' },
    { name: 'Review',    color: '#f59e0b' },
  ],
})
```

### Chat Sidebar

Each workspace includes a chat sidebar for interacting with the orchestrator agent. The orchestrator coordinates execution across all connected nodes, routing tasks through the defined workflow.

### Orchestrator Agent

The orchestrator uses `@rudderjs/ai` to:

1. Parse the user's request from the chat sidebar
2. Plan execution across the workspace graph
3. Dispatch work to individual node agents
4. Aggregate and return results

## Notes

- All workspace data (nodes, connections, departments, chat history) is persisted via Prisma.
- The canvas uses an Isoflow-inspired 3D rendering style with isometric perspective.
- Nodes support drag-and-drop repositioning with auto-save.
- The plugin registers its own panel pages and API routes via `Panel.use()`.
- Requires `@rudderjs/ai` with at least one provider configured (Anthropic, OpenAI, Google, or Ollama).
