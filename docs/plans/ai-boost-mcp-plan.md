# Plan 8: AI, Boost & MCP — Laravel Parity

## Context

Plans 1–6 are complete. Plan 7 (monitoring) is deferred. This plan covers the AI ecosystem:
- **`@rudderjs/ai`** — gaps vs Laravel AI SDK (14 providers, image gen, TTS/STT, attachments, queue, etc.)
- **`@rudderjs/boost`** — Phase 1 done (6 MCP tools), Phases 2-3 not built (guidelines, skills)
- **`@rudderjs/mcp`** — new package for building custom MCP servers (plan exists at `docs/plans/rudderjs-mcp.md` but not implemented)

This replaces `docs/plans/2026-04-03-ai-future-phases.md` and incorporates the existing boost/mcp plans.

---

## Phase 1: AI Package Core Gaps (High Priority) ✅

### 1.1 — Wire Middleware into Agent Loop

The middleware system (`runOnConfig`, `runOnChunk`, `runOnBeforeToolCall`, etc.) exists in `packages/ai/src/middleware.ts` but is **never called** in `agent.ts`. Wire it up.

**Files:** `packages/ai/src/agent.ts`

- Call `runOnConfig()` before first provider call
- Call `runOnChunk()` in streaming loop
- Call `runOnBeforeToolCall()` / `runOnAfterToolCall()` around tool execution
- Call `runSequential()` for lifecycle hooks (`onStart`, `onIteration`, `onFinish`)
- Call `runOnUsage()` after each provider response
- Call `runOnError()` in catch blocks
- Call `runOnAbort()` when stop conditions trigger

**Effort:** Small

### 1.2 — File & Image Attachments

Agents need to see documents and images. Add an attachment system.

**New files:** `packages/ai/src/attachment.ts`

```ts
// API
import { Document, Image } from '@rudderjs/ai'

const response = await agent.prompt('Summarize this', {
  attachments: [
    Document.fromPath('/path/to/report.pdf'),
    Document.fromStorage('reports/q4.pdf'),
    Document.fromUrl('https://example.com/doc.pdf'),
    Document.fromString('raw text content', 'report.txt'),
    Image.fromPath('/path/to/chart.png'),
    Image.fromUrl('https://example.com/photo.jpg'),
  ],
})
```

- Each provider adapter converts attachments to its format (Anthropic: base64 content blocks, OpenAI: file references, Google: inlineData)
- `AiMessage.content` changes from `string` to `string | ContentPart[]` where `ContentPart = { type: 'text', text } | { type: 'image', data, mimeType } | { type: 'document', data, mimeType }`
- Optional dep on `@rudderjs/storage` for `fromStorage()` method

**Effort:** Medium

### 1.3 — Queue Integration

Background AI tasks with callbacks.

**Files:** `packages/ai/src/agent.ts`, `packages/ai/src/queue-job.ts`

```ts
// API
await agent.queue('Analyze this report').then(response => {
  await sendNotification(response.text)
})

await agent.queue('Generate summary')
  .onQueue('ai')
  .then(r => console.log(r))
  .catch(e => console.error(e))
```

- Creates an `AiPromptJob` that wraps the agent call
- Dispatches via `@rudderjs/queue` (optional peer dep)
- `then`/`catch` closures serialized with the job
- Agent class must be serializable (class name → registry lookup)

**Effort:** Medium

### 1.4 — Conversation Store Integration

`MemoryConversationStore` exists but agents don't use it. Add `forUser()` / `continue()` to Agent.

**Files:** `packages/ai/src/agent.ts`, `packages/ai/src/conversation.ts`

```ts
// API
const response = await agent
  .forUser(userId)
  .continue(conversationId)
  .prompt('Follow up question')

// Auto-creates conversation on first prompt, auto-appends messages
```

- Agent resolves `ConversationStore` from DI container
- `forUser()` sets the user scope
- `continue()` loads history from store
- After prompt, auto-appends user + assistant messages to store
- Add `PrismaConversationStore` (already exists in panels — extract to ai package)

**Effort:** Medium

### 1.5 — More Providers

Add high-value providers. Each is a new file in `packages/ai/src/providers/`.

| Provider | SDK | Priority | Why |
|----------|-----|----------|-----|
| Groq | `groq-sdk` | High | Fastest inference, popular for dev |
| DeepSeek | OpenAI-compatible | High | Cost-effective, popular |
| xAI (Grok) | OpenAI-compatible | Medium | Growing ecosystem |
| Mistral | `@mistralai/mistralai` | Medium | European market |
| Azure OpenAI | `openai` (baseUrl) | Medium | Enterprise |
| Cohere | `cohere-ai` | Low | Niche, reranking |

OpenAI-compatible providers (DeepSeek, xAI, Azure) reuse `OpenAIAdapter` with custom `baseUrl` — minimal code.

**Effort:** Small per provider

---

## Phase 2: AI Capabilities (Medium Priority) ✅

### 2.1 — Image Generation

```ts
import { Image } from '@rudderjs/ai'

const result = await Image.of('A mountain at sunset')
  .model('openai/dall-e-3')
  .size('landscape')    // or 'portrait', 'square', '1024x1024'
  .quality('hd')
  .generate()

// result.url, result.base64, result.store('images/sunset.png')
await Image.of('prompt').queue().then(r => r.store('path'))
```

**New files:** `packages/ai/src/image.ts`
- `ProviderFactory.createImage?()` — optional method
- OpenAI DALL-E, Google Imagen supported initially
- `Image.fake()` for testing

**Effort:** Medium

### 2.2 — Provider Tools (WebSearch, WebFetch)

Built-in tools that leverage provider-native capabilities.

```ts
import { WebSearch, WebFetch } from '@rudderjs/ai'

const agent = AI.agent({
  instructions: 'Research assistant',
  tools: [
    WebSearch.make(),                    // provider-native web search
    WebSearch.make().domains(['docs.rudderjs.dev']),
    WebFetch.make(),                     // fetch web page content
  ],
})
```

- Anthropic: maps to `computer_use` web search tool
- OpenAI: maps to `web_search` tool
- Google: maps to `google_search_retrieval`
- Fallback: server-side fetch for providers without native support

**Effort:** Medium

### 2.3 — Vercel AI Protocol

Streaming compatibility with frontend frameworks (Next.js, Nuxt, SvelteKit).

```ts
// In route handler
const { stream } = await agent.stream(input)
return new Response(toVercelDataProtocol(stream), {
  headers: { 'Content-Type': 'text/event-stream' }
})
```

**New file:** `packages/ai/src/vercel-protocol.ts`
- Converts `StreamChunk` to Vercel AI SDK data stream format
- Text deltas, tool calls, tool results, finish events

**Effort:** Small

### 2.4 — TTS & STT

```ts
import { Audio, Transcription } from '@rudderjs/ai'

// Text-to-Speech
const audio = await Audio.of('Hello world')
  .voice('alloy')
  .model('openai/tts-1')
  .generate()
await audio.store('audio/greeting.mp3')

// Speech-to-Text
const text = await Transcription.fromPath('/audio/meeting.mp3')
  .model('openai/whisper-1')
  .generate()
```

**New files:** `packages/ai/src/audio.ts`, `packages/ai/src/transcription.ts`
- OpenAI and ElevenLabs initially
- `Audio.fake()`, `Transcription.fake()` for testing

**Effort:** Medium

### 2.5 — Embeddings Enhancement

`AI.embed()` works but needs:
- **Caching** — `AI.embed('text').cache()` or config-level cache
- **Batch optimization** — auto-chunk large arrays
- **More providers** — Google, Cohere, Jina, VoyageAI
- **No vector DB integration yet** — defer to ORM package (Prisma pgvector extension)

**Effort:** Small

---

## Phase 3: Boost Phases 2-3 (High Priority) ✅

### 3.1 — `boost:install` Command

Generates IDE configs for AI coding assistants.

```bash
rudder boost:install
```

**Generates:**
- `.mcp.json` — MCP server config (auto-detects PM via `pmExec()`)
- `CLAUDE.md` — auto-generated from installed packages (see 3.2)
- `.ai/guidelines/` — per-package guideline files
- `.ai/skills/` — per-package skill files

**Files:** `packages/boost/src/commands/install.ts`

**Effort:** Small

### 3.2 — Auto-Generated Guidelines

Each `@rudderjs/*` package ships a `boost/guidelines.md` in its npm tarball.

`boost:install` reads `package.json`, finds installed `@rudderjs/*` packages, loads their guidelines, and concatenates into a project-specific CLAUDE.md.

**Per-package work:** Add `boost/guidelines.md` to each package's `files` array in package.json + write the guidelines content.

**Files:**
- `packages/boost/src/guidelines.ts` — scanner + generator
- `packages/*/boost/guidelines.md` — one per package (start with core, auth, orm, panels, ai, queue, router)

**Effort:** Medium (mostly content writing)

### 3.3 — Package-Bundled Skills

Each package ships optional `boost/skills/{name}/SKILL.md` — on-demand knowledge modules.

`boost:install` discovers and copies them to `.ai/skills/`.

**Files:**
- `packages/boost/src/skills.ts` — scanner + copier
- `packages/*/boost/skills/*/SKILL.md` — one per package

**Effort:** Medium (mostly content writing)

### 3.4 — New MCP Tools for Boost

Add to the existing boost MCP server:

| Tool | Description |
|------|-------------|
| `db_query` | Execute read-only SQL queries |
| `read_logs` | Read last N log entries (separate from `last_error`) |
| `browser_logs` | Read browser logs and errors |
| `get_absolute_url` | Convert relative URIs to absolute URLs |

**Files:** `packages/boost/src/tools/db-query.ts`, `packages/boost/src/tools/read-logs.ts`, `packages/boost/src/tools/browser-logs.ts`, `packages/boost/src/tools/get-absolute-url.ts`, update `server.ts`

**Effort:** Small

### 3.5 — `boost:update` Command

Auto-update guidelines and skills when packages change (e.g., after `pnpm install`).

```bash
rudder boost:update              # Re-scan and update guidelines + skills
rudder boost:update --discover   # Auto-discover newly installed @rudderjs/* packages
```

Can be automated via `postinstall` script in `package.json`.

**Files:** `packages/boost/src/commands/update.ts`

**Effort:** Small

### 3.6 — Search Docs Tool

MCP tool that queries a hosted RudderJS documentation API with semantic search (embeddings).

```ts
// Usage by AI agent via MCP
search_docs({ query: 'how to define middleware', packages: ['core', 'router'] })
```

- Hosted API serves indexed docs for all `@rudderjs/*` packages
- Semantic search via embeddings for accurate results
- Filterable by package and version
- Referenced automatically by guidelines/skills so agents know to use it

**Files:** `packages/boost/src/tools/search-docs.ts`

**Effort:** Medium (tool is small, but requires hosted docs API infrastructure)

---

## Phase 4: `@rudderjs/mcp` Package (High Priority) ✅

Build the MCP framework package per the existing plan at `docs/plans/rudderjs-mcp.md`.

### 4.1 — Core: McpServer + McpTool + Web Transport

```ts
class WeatherServer extends McpServer {
  tools = [GetForecast]
  resources = [WeatherData]
  prompts = [WeatherAnalysis]
}

// routes/ai.ts
Mcp.web('/mcp/weather', WeatherServer)
Mcp.web('/mcp/weather', WeatherServer, [RequireToken('mcp:read')])
```

**New package:** `packages/mcp/`
**Files:**
- `src/index.ts` — exports
- `src/McpServer.ts` — base server class
- `src/McpTool.ts` — base tool class (Zod schema, handle method)
- `src/McpResource.ts` — base resource class (URI patterns)
- `src/McpPrompt.ts` — base prompt class
- `src/McpResponse.ts` — response helpers (text, json, error)
- `src/Mcp.ts` — registration facade (`Mcp.web()`, `Mcp.local()`)
- `src/provider.ts` — service provider factory

**Dependencies:** `@modelcontextprotocol/sdk`, `@rudderjs/core`, `zod`

**Effort:** Medium

### 4.2 — Stdio Transport + CLI

```bash
rudder mcp:serve weather    # run stdio server
rudder mcp:list             # list registered servers + tools
```

**Files:** `src/commands/serve.ts`, `src/commands/list.ts`

**Effort:** Small

### 4.3 — Testing Utilities

```ts
const client = new McpTestClient(WeatherServer)
const result = await client.callTool('get-weather', { location: 'London' })
client.assertToolExists('get-weather')
```

**Files:** `src/testing.ts`

**Effort:** Small

### 4.4 — CLI Scaffolders

```bash
rudder make:mcp-server Weather
rudder make:mcp-tool GetForecast
rudder make:mcp-resource AppDocs
rudder make:mcp-prompt SummarizeTable
```

**Files:** Update `packages/cli/` with new templates

**Effort:** Small

---

## Phase 5: AI Panels Integration (Lower Priority)

Items from the old `ai-future-phases.md` that are still relevant. Defer until phases 1-4 are done.

### 5.1 — Field-Level AI Assist (was Phase B)
Quick actions on text fields: rewrite, expand, shorten, fix-grammar, translate. Already partially implemented via `Field.ai()`.

### 5.2 — Suggestion/Review System (was Phase C)
Tracked changes in Lexical editor. AI writes create suggestions instead of direct edits.

### 5.3 — Block-Level AI Tools (was Phase D)
Client-side Lexical block operations triggered by SSE tool_call events.

---

## Execution Order

```
Phase 1 (AI Core)     — 1.1 middleware, 1.2 attachments, 1.3 queue, 1.4 conversations, 1.5 providers  ✅
Phase 3 (Boost 2-3)   — 3.1 install, 3.2 guidelines, 3.3 skills, 3.4 tools, 3.5 update, 3.6 search docs  ✅ (3.3 skills + 3.6 search docs deferred)
Phase 4 (MCP Package)  — 4.1 core, 4.2 stdio, 4.3 testing, 4.4 scaffolders  ✅
Phase 2 (AI Caps)      — 2.1 image, 2.2 provider tools, 2.3 vercel, 2.4 audio, 2.5 embeddings  ✅
Phase 5 (Panels AI)    — 5.1 field assist, 5.2 suggestions, 5.3 blocks
```

---

## Summary Table

| # | Feature | Package | Effort | Priority |
|---|---------|---------|--------|----------|
| 1.1 | Wire middleware into agent loop | ai | S | High |
| 1.2 | File/image attachments | ai | M | High |
| 1.3 | Queue integration | ai | M | High |
| 1.4 | Conversation store integration | ai | M | High |
| 1.5 | More providers (Groq, DeepSeek, xAI, Mistral, Azure) | ai | S | High |
| 2.1 | Image generation | ai | M | Medium |
| 2.2 | Provider tools (WebSearch, WebFetch) | ai | M | Medium |
| 2.3 | Vercel AI protocol | ai | S | Medium |
| 2.4 | TTS & STT | ai | M | Low |
| 2.5 | Embeddings enhancement | ai | S | Medium |
| 3.1 | `boost:install` command | boost | S | High |
| 3.2 | Auto-generated guidelines | boost + all | M | High |
| 3.3 | Package-bundled skills | boost + all | M | Medium |
| 3.4 | New MCP tools (db_query, read_logs, browser_logs, get_absolute_url) | boost | S | Medium |
| 3.5 | `boost:update` command | boost | S | Medium |
| 3.6 | Search Docs tool (hosted docs API) | boost | M | Medium |
| 4.1 | McpServer + McpTool + web transport | mcp (new) | M | High |
| 4.2 | Stdio transport + CLI | mcp | S | Medium |
| 4.3 | Testing utilities | mcp | S | Medium |
| 4.4 | CLI scaffolders | cli | S | Low |
| 5.1 | Field-level AI assist | panels | M | Low |
| 5.2 | Suggestion system | panels-lexical | L | Low |
| 5.3 | Block-level AI tools | panels-lexical | L | Low |

---

## Files to Delete After This Plan Is Approved

- `docs/plans/2026-04-03-ai-future-phases.md` — superseded by this plan
- `docs/plans/rudderjs-boost.md` — phases 2-3 incorporated here
- `docs/plans/rudderjs-mcp.md` — incorporated here
