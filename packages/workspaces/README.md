# @boostkit/workspaces

AI workspace builder for BoostKit — departments, agents, knowledge base, and orchestrator.

## Installation

```bash
pnpm add @boostkit/workspaces
```

## Setup

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel } from '@boostkit/panels'
import { workspaces } from '@boostkit/workspaces'

export const adminPanel = Panel.make('admin')
  .use(workspaces())
  .resources([...])
```

## What It Adds

The `workspaces()` plugin registers five resources into your panel:

| Resource | Description |
|---|---|
| **Workspaces** | Top-level container — canvas layout, settings |
| **Departments** | Groups of agents with domain instructions |
| **Agents** | AI agents with model config, system prompt, tools |
| **Knowledge Bases** | Document collections scoped to a workspace |
| **Documents** | Individual documents (text, file, URL) in a knowledge base |

## Prisma Schema

The plugin ships a Prisma schema at `schema/workspaces.prisma`. Publish it:

```bash
pnpm artisan vendor:publish --tag=workspaces-schema
pnpm exec prisma generate
pnpm exec prisma db push
```

## Phases

- **Phase 2** (current): CRUD resources — create/edit workspaces, departments, agents, KB
- **Phase 3**: Orchestrator + Chat UI — multi-agent routing, real-time streaming
- **Phase 4**: Three.js canvas — 3D collaborative workspace visualization
