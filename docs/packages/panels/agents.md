# AI Agents

Resource agents bring AI capabilities directly into your admin panel. Define agents on resources that can read record data, update fields in real-time, and stream progress to an integrated chat sidebar.

Requires `@rudderjs/ai` as a peer dependency.

---

## Defining Agents

Override the `agents()` method on a resource to define available agents:

```ts
import { Resource, ResourceAgent, TextField, TextareaField, Form } from '@rudderjs/panels'

export class ArticleResource extends Resource {
  static model = Article

  form(form: Form) {
    return form.fields([
      TextField.make('title').required(),
      TextareaField.make('excerpt'),
      TextField.make('metaTitle'),
      TextareaField.make('metaDescription'),
    ])
  }

  agents() {
    return [
      ResourceAgent.make('seo')
        .label('Improve SEO')
        .icon('Search')
        .instructions('Analyse and improve the meta title and description for better SEO.')
        .fields(['metaTitle', 'metaDescription']),

      ResourceAgent.make('summarize')
        .label('Write Excerpt')
        .icon('Sparkles')
        .instructions('Write a concise excerpt based on the article title and content.')
        .fields(['excerpt']),
    ]
  }
}
```

### Fluent API

| Method | Description |
|---|---|
| `ResourceAgent.make(slug)` | Create a new agent with a unique slug |
| `.label(string)` | Display name in the UI |
| `.icon(string)` | Lucide icon name |
| `.instructions(string \| fn)` | System prompt — static string or function receiving the record |
| `.fields(string[])` | Which form fields this agent can update |
| `.model(string)` | Override the AI model (e.g. `'anthropic/claude-sonnet-4-5'`) |
| `.tools(Tool[])` | Additional custom tools beyond the auto-generated ones |

### Auto-Generated Tools

Every agent automatically gets:

- **`update_field`** — Updates a field on the current record via Yjs. The field value propagates to all connected clients in real-time.
- **`read_record`** — Returns the current record data as JSON.

---

## Class-Based Agents

For complex agents with custom tools or dynamic instructions:

```ts
import { ResourceAgent } from '@rudderjs/panels'
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'

class TranslateAgent extends ResourceAgent {
  constructor() {
    super('translate')
    this.label('Translate').icon('Languages')
    this.fields(['title', 'content', 'metaDescription'])
  }

  resolveInstructions() {
    const lang = this.context.record.language ?? 'English'
    return `Translate all fields to ${lang}. Preserve formatting.`
  }

  extraTools() {
    return [
      toolDefinition({
        name: 'lookup_term',
        description: 'Look up domain-specific term translation',
        inputSchema: z.object({ term: z.string(), lang: z.string() }),
      }).server(async ({ term, lang }) => `"${term}" in ${lang}: ...`),
    ]
  }
}
```

### Override Points

| Method | Description |
|---|---|
| `resolveInstructions()` | Dynamic system prompt — has access to `this.context.record` |
| `extraTools()` | Additional tools beyond auto-generated ones |
| `beforeRun(ctx)` | Called before the agent runs. Throw to abort. |
| `afterRun(ctx, result)` | Called after the agent completes. |

---

## AI Chat Sidebar

The panel layout includes a collapsible AI chat sidebar on the right side. Toggle it from the header icon.

### Unified Conversation

Agent runs and free-form chat share one conversation timeline:

- **Dropdown trigger** — click "AI Agents" in the form toolbar → agent output streams as a message in the chat
- **Chat trigger** — type "write me an excerpt" in the chat input → the AI recognizes the request and invokes the appropriate agent
- **Free-form chat** — ask questions about your data without triggering agents

### Resource Context

When you're on a resource edit page, the chat is automatically resource-aware:

- The AI knows the current record data and available agents
- It can decide when to invoke an agent based on your request
- On non-resource pages, the chat works as a generic AI assistant

### Field Animation

When an agent calls `update_field`, the new value animates into the form field character-by-character. For collaborative fields (Yjs), the update propagates to all connected users.

---

## Chat Endpoint

`POST /{panel}/api/_chat`

### Request Body

```json
{
  "message": "write me an excerpt",
  "history": [
    { "role": "user", "content": "previous message" },
    { "role": "assistant", "content": "previous response" }
  ],
  "resourceContext": {
    "resourceSlug": "articles",
    "recordId": "abc123"
  },
  "forceAgent": "summarize"
}
```

| Field | Required | Description |
|---|---|---|
| `message` | Yes | The user's message |
| `history` | No | Conversation history (last 20 messages recommended) |
| `resourceContext` | No | Current resource + record for context-aware responses |
| `forceAgent` | No | Skip AI intent detection — run this agent slug directly |

### SSE Events

The response is `text/event-stream`:

```
event: agent_start
data: {"agentSlug":"summarize","agentLabel":"Write Excerpt"}

event: tool_call
data: {"tool":"update_field","input":{"field":"excerpt","value":"..."}}

event: text
data: {"text":"The excerpt has been updated."}

event: agent_complete
data: {"steps":2,"tokens":450}

event: complete
data: {"done":true}
```

---

## Direct Agent Endpoint

The per-agent endpoint is still available for programmatic access:

`POST /{panel}/api/{resource}/:id/_agents/:agentSlug`

```json
{ "input": "optional user instruction" }
```

Returns SSE with events: `text`, `tool_call`, `complete`, `error`.
