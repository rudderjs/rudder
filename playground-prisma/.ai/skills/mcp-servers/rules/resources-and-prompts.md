# Resources and Prompts

## Static resource

```ts
// app/Mcp/Resources/SchemaResource.ts
import { McpResource, Description } from '@rudderjs/mcp'

@Description('Returns the database schema')
export class SchemaResource extends McpResource {
  uri()      { return 'db://schema' }
  mimeType() { return 'text/plain' }

  async handle() {
    return await readFile('prisma/schema.prisma', 'utf-8')
  }
}
```

## Resource with URI template

`{param}` in the URI makes it a template. Extracted params arrive in `handle(params)`:

```ts
@Description('Read rows from a database table')
export class TableResource extends McpResource {
  uri()      { return 'db://tables/{tableName}' }
  mimeType() { return 'application/json' }

  async handle(params?: Record<string, string>) {
    const tableName = params?.tableName ?? 'unknown'
    const rows = await db.query(`SELECT * FROM ${tableName} LIMIT 100`)
    return JSON.stringify(rows, null, 2)
  }
}
```

## Prompt

Prompts are templates the client can request to seed a conversation. Use `arguments()` to declare a Zod schema:

```ts
// app/Mcp/Prompts/ReviewPrompt.ts
import { McpPrompt, Description } from '@rudderjs/mcp'
import type { McpPromptMessage } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Generate a code review prompt for a file')
export class ReviewPrompt extends McpPrompt {
  // Name auto-derived: "ReviewPrompt" → "review"

  arguments() {
    return z.object({
      file:  z.string().describe('Path to the file to review'),
      focus: z.string().optional().describe('Area to focus on'),
    })
  }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    const { file, focus } = args as { file: string; focus?: string }
    const content = await readFile(file, 'utf-8')

    return [{
      role: 'user',
      content: `Please review this code${focus ? ` with focus on ${focus}` : ''}:\n\n${content}`,
    }]
  }
}
```

## Pitfalls

❌ **Don't** parse `{param}` segments yourself — the runtime handles it:

```ts
async handle(params) {
  const m = params?.uri?.match(/db:\/\/tables\/(.+)/)   // ❌ uri isn't passed
}
```

✅ **Do** use the named params the runtime extracts:

```ts
async handle(params?: Record<string, string>) {
  const tableName = params?.tableName ?? ''
}
```

❌ **Don't** SQL-interpolate a template param without validation:

```ts
const rows = await db.query(`SELECT * FROM ${tableName}`)   // SQL injection
```

✅ **Do** validate against an allowlist or quote-escape:

```ts
const allowed = ['users', 'posts', 'comments']
if (!allowed.includes(tableName)) return McpResponse.error('Unknown table')
const rows = await db.query(`SELECT * FROM ${tableName}`)
```

❌ **Don't** return a non-`z.object` schema from `arguments()`:

```ts
arguments() { return z.string() }   // MCP rejects
```

✅ **Do** wrap in `z.object()`:

```ts
arguments() { return z.object({ file: z.string() }) }
```
