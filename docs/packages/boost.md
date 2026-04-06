# @rudderjs/boost

AI developer tools that expose your project's internals to AI coding assistants via MCP (Model Context Protocol).

## Installation

```bash
pnpm add @rudderjs/boost
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { boost } from '@rudderjs/boost'

export default [
  // ...other providers
  boost(),
]
```

## Usage

Start the MCP server via the rudder CLI:

```bash
pnpm rudder boost:mcp
```

This launches a stdio-based MCP server that AI coding assistants can connect to for live project context.

### Connecting to Claude Code

```bash
claude mcp add -s local -t stdio rudderjs-boost -- npx tsx node_modules/@rudderjs/cli/src/index.ts boost:mcp
```

Once connected, Claude Code can query your application's routes, models, database schema, config, and recent errors directly.

## Available Tools

| Tool | Description |
|---|---|
| `app_info` | Application name, environment, and debug mode |
| `db_schema` | Full Prisma or Drizzle database schema |
| `route_list` | All registered routes with methods and middleware |
| `model_list` | Registered ORM models and their fields |
| `config_get` | Read configuration values by key |
| `last_error` | Most recent exception with stack trace |

### Example Tool Responses

```ts
// app_info
{ name: 'my-app', env: 'development', debug: true }

// route_list
[
  { method: 'GET',  path: '/api/users',     middleware: ['auth'] },
  { method: 'POST', path: '/api/users',     middleware: ['auth', 'validate'] },
  { method: 'GET',  path: '/api/posts/:id', middleware: [] },
]

// model_list
[
  { name: 'User', table: 'users', fields: ['id', 'name', 'email'] },
  { name: 'Post', table: 'posts', fields: ['id', 'title', 'body', 'authorId'] },
]
```

## Notes

- The MCP server uses stdio transport -- no HTTP server or port required.
- `boost:mcp` requires a fully bootstrapped application (`bootstrap/app.ts`) to read live state.
- `db_schema` reads the schema file directly (Prisma `schema.prisma` or Drizzle schema directory).
- `last_error` returns the most recent exception caught by the framework's exception reporter.
- Works with any MCP-compatible AI assistant, not just Claude Code.
