# Runtime-Agnostic `@rudderjs/ai` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `@rudderjs/ai` work in Electron renderer, React Native, and browsers — matching Vercel AI SDK's runtime-agnostic design — without breaking the Node/server use case.

**Architecture:** Split the package via subpath exports. The main entry (`@rudderjs/ai`) stays pure-JS with zero Node dependencies. Node-specific helpers move to `@rudderjs/ai/node`. The service provider (which requires `@rudderjs/core`) moves to `@rudderjs/ai/server`. No refactor to agent/tool/provider internals — they already only use `fetch`.

**Tech Stack:** TypeScript subpath exports, `package.json` `exports` field, conditional Node-only modules.

---

## Current State

After inspection, `@rudderjs/ai` is **already 95% isomorphic**:

- `agent.ts`, `facade.ts`, `tool.ts`, `middleware.ts`, `registry.ts`, `observers.ts`, `types.ts`, `vercel-protocol.ts`, `provider-tools.ts`, `zod-to-json-schema.ts` — all pure, fetch-only, zero Node imports
- All 11 provider adapters (`providers/*.ts`) — pure fetch/SDK calls, **no `node:` imports**
- `queue-job.ts`, `cached-embedding.ts`, `rerank.ts`, `image.ts`, `audio.ts`, `files.ts`, `output.ts`, `conversation.ts`, `fake.ts` — pure

**Only 3 files block RN/browser use:**

| File | Node usage | Fix |
|---|---|---|
| `attachment.ts` | `node:fs/promises`, `node:path`, `Buffer` | Drop filesystem helpers from main entry; move to `/node` subpath |
| `transcription.ts` | `node:fs` | Same |
| `provider.ts` | `@rudderjs/core` `ServiceProvider` + `config()` | Move to `/server` subpath |

One additional concern: `conversation.ts` throws "No ConversationStore registered" referencing DI, but doesn't actually `import` from core. The error message is misleading but the code is pure. Leave as-is.

---

## Design Decisions

### 1. Subpath exports, not separate packages

Three entry points:

- `@rudderjs/ai` — runtime-agnostic core. Works in Node, Electron main/renderer, RN, browser.
- `@rudderjs/ai/node` — Node-specific helpers (file-path attachments, transcription from filesystem).
- `@rudderjs/ai/server` — `AiProvider` (ServiceProvider). Depends on `@rudderjs/core`, Node-only.

One npm package, three entry points — matches how Vercel does it (`ai` + `ai/rsc` + `@ai-sdk/react`).

### 2. `DocumentAttachment` and `ImageAttachment` stay in the main entry

Move only the `.fromPath()` static methods to the `/node` subpath. The classes themselves (with `.fromBase64`, `.fromUrl`, `.fromString`) stay in the core — those work in any runtime.

Approach: add a `NodeDocumentAttachment` / `NodeImageAttachment` pair in `/node` with `.fromPath()`. No changes to existing API in the core — browsers/RN just don't get `.fromPath()`.

Rationale: people will want to do `ImageAttachment.fromBase64(cameraBase64)` in RN. Having the class in the core entry is the natural home.

### 3. `Transcription.fromBuffer` stays; `.fromPath` moves

Same pattern: the `Transcription` class stays in the main entry with `.fromBuffer`. A `NodeTranscription` subclass (or helper) in `/node` adds `.fromPath`.

### 4. `Buffer` usage in main entry

`attachment.ts` uses `Buffer.from(...)` for base64 encoding. Replace with browser-safe:

```ts
// Before
Buffer.from(content).toString('base64')

// After
btoa(content)  // or a tiny helper that uses btoa/atob in browsers, Buffer in Node
```

Browsers/RN have `btoa`/`atob` natively. For binary data use `Uint8Array` → `base64` via a tiny helper.

### 5. Keep `@rudderjs/core` as a peer dep of the main package

`@rudderjs/core` is *only* imported by `provider.ts` which moves to `/server`. Make `@rudderjs/core` an **optional peer** so RN/browser apps don't pull it in:

```json
"peerDependencies": {
  "@rudderjs/core": "workspace:*"
},
"peerDependenciesMeta": {
  "@rudderjs/core": { "optional": true }
}
```

Server apps that import from `@rudderjs/ai/server` already have core installed.

### 6. Package.json `exports` field

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./node": {
    "import": "./dist/node/index.js",
    "types": "./dist/node/index.d.ts"
  },
  "./server": {
    "import": "./dist/server/index.js",
    "types": "./dist/server/index.d.ts"
  },
  "./observers": {
    "import": "./dist/observers.js",
    "types": "./dist/observers.d.ts"
  },
  "./commands/make-agent": {
    "import": "./dist/commands/make-agent.js",
    "types": "./dist/commands/make-agent.d.ts"
  }
}
```

### 7. What stays unchanged

- Provider adapters — already fetch-only, no changes
- `AiRegistry`, `agent.ts`, `facade.ts` — no changes
- Playground `AiProvider` import path — updates from `@rudderjs/ai` to `@rudderjs/ai/server`

---

## Phase 1 — Prepare the Core for Isomorphism

Strip `Buffer` usage from `attachment.ts` so the main entry has no Node-specific primitives.

### Task 1.1: Add base64 helper

**Files:**
- Create: `packages/ai/src/base64.ts`

**Step 1: Write the helper**

```ts
// packages/ai/src/base64.ts

/**
 * Encode a string or Uint8Array to base64.
 * Works in Node, browsers, React Native, and Electron (both processes).
 */
export function toBase64(input: string | Uint8Array): string {
  // String → base64
  if (typeof input === 'string') {
    // btoa works for ASCII. For UTF-8 strings, encode first.
    if (typeof btoa === 'function') {
      // Browser / RN / Electron renderer
      const bytes = new TextEncoder().encode(input)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
      return btoa(binary)
    }
    // Node (no btoa in older versions, but Buffer always available)
    return globalThis.Buffer!.from(input, 'utf8').toString('base64')
  }

  // Uint8Array → base64
  if (typeof btoa === 'function') {
    let binary = ''
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]!)
    return btoa(binary)
  }
  return globalThis.Buffer!.from(input).toString('base64')
}

/**
 * Decode a base64 string to Uint8Array.
 */
export function fromBase64(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(globalThis.Buffer!.from(base64, 'base64'))
}
```

**Step 2: Build to make sure it compiles**

```bash
cd packages/ai && pnpm build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add packages/ai/src/base64.ts
git commit -m "feat(ai): add runtime-agnostic base64 helpers"
```

### Task 1.2: Replace Buffer usage in `attachment.ts`

**Files:**
- Modify: `packages/ai/src/attachment.ts`

**Step 1: Replace the two `Buffer.from()` calls**

Find (around line 49 in `fromString`):
```ts
const data = Buffer.from(content).toString('base64')
```

Replace with:
```ts
const data = toBase64(content)
```

Find (around line 64 in `fromUrl`, `DocumentAttachment`):
```ts
const buffer = Buffer.from(await res.arrayBuffer())
// ...
new DocumentAttachment(buffer.toString('base64'), mimeType, name)
```

Replace the `fromUrl` body with:
```ts
static async fromUrl(url: string): Promise<DocumentAttachment> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[RudderJS AI] Failed to fetch document: ${res.status} ${url}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
  const name = url.split('/').pop()?.split('?')[0]
  return new DocumentAttachment(toBase64(bytes), mimeType, name)
}
```

Do the same for `ImageAttachment.fromUrl` (around line 101).

**Step 2: Add the import at the top**

```ts
import { toBase64 } from './base64.js'
```

**Step 3: Remove the node imports at the top**

Delete lines 1-2:
```ts
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
```

**Step 4: Remove `fromPath` methods + `mimeFromPath` helper**

Delete `DocumentAttachment.fromPath` (around lines 37-45), `ImageAttachment.fromPath` (around lines 89-93), and the `mimeFromPath` function + `MIME_MAP` constant (lines 7-26). These move to `/node` in Task 2.1.

**Step 5: Build**

```bash
cd packages/ai && pnpm build
```

Expected: clean. If TypeScript complains about unused imports, clean them up.

**Step 6: Commit**

```bash
git add packages/ai/src/attachment.ts
git commit -m "refactor(ai): remove Node-specific helpers from attachment core"
```

### Task 1.3: Remove `Transcription.fromPath` from the main entry

**Files:**
- Modify: `packages/ai/src/transcription.ts`

**Step 1: Remove the `node:fs` import and `fromPath` support**

Delete line 1:
```ts
import { readFileSync } from 'node:fs'
```

Delete the `fromPath` static (around lines 20-22):
```ts
static fromPath(path: string): Transcription {
  return new Transcription(path)
}
```

**Step 2: Narrow the constructor parameter type**

Change the private constructor (around line 17):
```ts
private constructor(private readonly _audio: Buffer | string) {}
```

To:
```ts
private constructor(private readonly _audio: Uint8Array) {}
```

**Step 3: Update `generate()` to not read from paths**

Change (around line 61):
```ts
const audioBuffer = typeof this._audio === 'string'
  ? readFileSync(this._audio)
  : this._audio
```

To:
```ts
const audioBuffer = this._audio
```

**Step 4: Update `fromBuffer` to accept Uint8Array**

Change:
```ts
static fromBuffer(buffer: Buffer): Transcription {
  return new Transcription(buffer)
}
```

To:
```ts
static fromBytes(bytes: Uint8Array): Transcription {
  return new Transcription(bytes)
}

/** @deprecated Use fromBytes(). Kept for backwards compat. */
static fromBuffer(buffer: Uint8Array): Transcription {
  return new Transcription(buffer)
}
```

**Step 5: Check the STT adapter type**

Look at `packages/ai/src/types.ts` for the `audio` field type in the STT provider interface. If it's `Buffer`, widen it to `Uint8Array | Buffer`. (Node `Buffer extends Uint8Array` so this should be trivial.)

**Step 6: Build**

```bash
cd packages/ai && pnpm build
```

Expected: clean build. If provider adapters complain, they shouldn't — all adapters already accept `Buffer` which is also a `Uint8Array`.

**Step 7: Commit**

```bash
git add packages/ai/src/transcription.ts packages/ai/src/types.ts
git commit -m "refactor(ai): make Transcription accept Uint8Array, drop fromPath"
```

---

## Phase 2 — Create the `/node` Subpath

Houses filesystem-dependent helpers for Node consumers who want `.fromPath()` ergonomics.

### Task 2.1: Create `node/attachment.ts` with path-based helpers

**Files:**
- Create: `packages/ai/src/node/attachment.ts`

**Step 1: Write the Node-specific attachment helpers**

```ts
// packages/ai/src/node/attachment.ts
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { DocumentAttachment, ImageAttachment } from '../attachment.js'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
}

function mimeFromPath(path: string): string {
  const ext = extname(path).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

/** Load a DocumentAttachment from a local file path (Node-only). */
export async function documentFromPath(path: string): Promise<DocumentAttachment> {
  const buffer = await readFile(path)
  const base64 = buffer.toString('base64')
  return DocumentAttachment.fromBase64(base64, mimeFromPath(path), basename(path))
}

/** Load an ImageAttachment from a local file path (Node-only). */
export async function imageFromPath(path: string): Promise<ImageAttachment> {
  const buffer = await readFile(path)
  const base64 = buffer.toString('base64')
  return ImageAttachment.fromBase64(base64, mimeFromPath(path))
}
```

**Step 2: Build**

```bash
cd packages/ai && pnpm build
```

Expected: compiles to `dist/node/attachment.js`.

**Step 3: Commit**

```bash
git add packages/ai/src/node/attachment.ts
git commit -m "feat(ai): add Node-only attachment helpers"
```

### Task 2.2: Create `node/transcription.ts` with path-based helper

**Files:**
- Create: `packages/ai/src/node/transcription.ts`

**Step 1: Write the Node-specific transcription helper**

```ts
// packages/ai/src/node/transcription.ts
import { readFile } from 'node:fs/promises'
import { Transcription } from '../transcription.js'

/** Create a Transcription from a local file path (Node-only). */
export async function transcribeFromPath(path: string): Promise<Transcription> {
  const buffer = await readFile(path)
  return Transcription.fromBytes(new Uint8Array(buffer))
}
```

**Step 2: Build + commit**

```bash
cd packages/ai && pnpm build
git add packages/ai/src/node/transcription.ts
git commit -m "feat(ai): add Node-only transcription helper"
```

### Task 2.3: Create `node/index.ts` barrel

**Files:**
- Create: `packages/ai/src/node/index.ts`

**Step 1: Re-export everything**

```ts
// packages/ai/src/node/index.ts
export { documentFromPath, imageFromPath } from './attachment.js'
export { transcribeFromPath } from './transcription.js'
```

**Step 2: Build + commit**

```bash
cd packages/ai && pnpm build
git add packages/ai/src/node/index.ts
git commit -m "feat(ai): add /node subpath barrel"
```

---

## Phase 3 — Move `AiProvider` to `/server` Subpath

### Task 3.1: Create `server/` directory with provider

**Files:**
- Create: `packages/ai/src/server/index.ts`
- Create: `packages/ai/src/server/provider.ts`

**Step 1: Copy provider code into new location**

```bash
mkdir -p packages/ai/src/server
```

Copy the entire contents of `packages/ai/src/provider.ts` to `packages/ai/src/server/provider.ts`. Update all relative imports (`'./providers/...'` → `'../providers/...'`, `'./registry.js'` → `'../registry.js'`, etc.)

```ts
// packages/ai/src/server/provider.ts
import { ServiceProvider, config } from '@rudderjs/core'
import { AiRegistry } from '../registry.js'
import { setConversationStore } from '../agent.js'
import type { AiConfig, ConversationStore } from '../types.js'

export class AiProvider extends ServiceProvider {
  // ... exact same body as before, just update provider imports
  // from './providers/anthropic.js' to '../providers/anthropic.js', etc.
}
```

**Step 2: Create the barrel**

```ts
// packages/ai/src/server/index.ts
export { AiProvider } from './provider.js'
```

**Step 3: Build**

```bash
cd packages/ai && pnpm build
```

Expected: clean, compiles to `dist/server/provider.js` and `dist/server/index.js`.

**Step 4: Commit**

```bash
git add packages/ai/src/server/
git commit -m "feat(ai): add /server subpath with AiProvider"
```

### Task 3.2: Delete the old `provider.ts`

**Files:**
- Delete: `packages/ai/src/provider.ts`
- Modify: `packages/ai/src/index.ts` (remove `AiProvider` export)

**Step 1: Remove the AiProvider export from the main index**

In `packages/ai/src/index.ts`, find the line that exports `AiProvider` (look for `export { AiProvider }` or `export * from './provider.js'`) and delete it.

**Step 2: Delete the old file**

```bash
rm packages/ai/src/provider.ts
```

**Step 3: Build the whole monorepo to find broken imports**

```bash
cd /Users/sleman/Projects/rudderjs && pnpm build
```

Expected: **this will fail** in `playground/` (and anywhere else importing `AiProvider`). That's what we're fixing next.

**Step 4: Find all consumers**

```bash
cd /Users/sleman/Projects/rudderjs
grep -rn "from '@rudderjs/ai'" --include="*.ts" | grep -i "AiProvider"
```

Note every file that imports `AiProvider`.

**Step 5: Update each consumer**

For every file (typically only `playground/bootstrap/providers.ts` if explicit; otherwise it's auto-discovered), change:

```ts
import { AiProvider } from '@rudderjs/ai'
```

to:

```ts
import { AiProvider } from '@rudderjs/ai/server'
```

**Step 6: Update provider auto-discovery entry**

The `rudderjs` field in `packages/ai/package.json` declares `"provider": "AiProvider"`. The discovery scanner reads `package.json` and imports the provider class from the package's main entry. We need to update it so the scanner loads from `/server`.

Check how auto-discovery resolves the provider — grep `packages/core/src` for how it imports providers from the manifest:

```bash
grep -rn "import(" packages/core/src | grep -i "package\|provider"
```

If it imports from the package main (`@rudderjs/ai`), we need to either:
- (a) Re-export `AiProvider` from the main entry as a thin re-export from `/server` (undoes the split for runtime; but keeps TS type-only imports pure — not great)
- (b) Add a `providerSubpath` field to the `rudderjs` metadata and update the scanner

**Go with (b)** — cleaner long-term:

- Add to `packages/ai/package.json` `rudderjs` field:
  ```json
  "rudderjs": {
    "provider": "AiProvider",
    "providerSubpath": "./server",
    "stage": "feature"
  }
  ```
- Update the discovery scanner in `packages/core/src/commands/providers-discover.ts` and `packages/core/src/default-providers.ts` (wherever the dynamic import happens) to prefer `providerSubpath` when set:
  ```ts
  const importPath = entry.providerSubpath
    ? `${entry.package}/${entry.providerSubpath.replace(/^\.\//, '')}`
    : entry.package
  const mod = await import(importPath)
  ```

This is a cross-package change; test carefully.

**Step 7: Regenerate the provider manifest in playground**

```bash
cd playground && pnpm rudder providers:discover
```

Check the output — `ai` should still appear. Inspect `bootstrap/cache/providers.json` to confirm the entry has `providerSubpath` recorded.

**Step 8: Full build**

```bash
cd /Users/sleman/Projects/rudderjs && pnpm build
```

Expected: clean.

**Step 9: Boot the playground to smoke-test**

```bash
cd playground && pnpm rudder command:list 2>&1 | head -5
```

Expected: boots cleanly, no "AiProvider not found" errors. If it fails, check step 6 scanner changes.

**Step 10: Commit**

```bash
git add -A
git commit -m "refactor(ai): move AiProvider to /server subpath, add providerSubpath auto-discovery"
```

---

## Phase 4 — Wire `package.json` Exports

### Task 4.1: Update `exports` field

**Files:**
- Modify: `packages/ai/package.json`

**Step 1: Add new subpaths**

Replace the current `exports` block with:

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./node": {
    "import": "./dist/node/index.js",
    "types": "./dist/node/index.d.ts"
  },
  "./server": {
    "import": "./dist/server/index.js",
    "types": "./dist/server/index.d.ts"
  },
  "./observers": {
    "import": "./dist/observers.js",
    "types": "./dist/observers.d.ts"
  },
  "./commands/make-agent": {
    "import": "./dist/commands/make-agent.js",
    "types": "./dist/commands/make-agent.d.ts"
  }
}
```

**Step 2: Move `@rudderjs/core` to optional peer**

Change:
```json
"dependencies": {
  "@rudderjs/core": "workspace:*",
  "zod": "^4.0.0"
},
```

To:
```json
"dependencies": {
  "zod": "^4.0.0"
},
"peerDependencies": {
  "@rudderjs/core": "workspace:*"
},
"peerDependenciesMeta": {
  "@rudderjs/core": { "optional": true }
},
"devDependencies": {
  "@rudderjs/core": "workspace:*",
  // ... existing devDeps
}
```

Keep `@rudderjs/core` as a devDep so typecheck + `/server` build work.

**Step 3: Re-install and rebuild**

```bash
cd /Users/sleman/Projects/rudderjs && pnpm install && pnpm build
```

Expected: clean.

**Step 4: Commit**

```bash
git add packages/ai/package.json pnpm-lock.yaml
git commit -m "chore(ai): add /node and /server subpath exports, make core an optional peer"
```

---

## Phase 5 — Validate + Document

### Task 5.1: Write a runtime-agnostic smoke test

Prove the main entry has no Node-only imports.

**Files:**
- Create: `packages/ai/src/isomorphic-check.test.ts` (new test)

**Step 1: Write the test**

```ts
// packages/ai/src/isomorphic-check.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')

/** The files that make up the main entry — must have ZERO node: imports. */
const MAIN_ENTRY_FILES = [
  'index.js', 'agent.js', 'facade.js', 'tool.js', 'middleware.js',
  'registry.js', 'observers.js', 'types.js', 'attachment.js',
  'transcription.js', 'vercel-protocol.js', 'provider-tools.js',
  'zod-to-json-schema.js', 'base64.js', 'image.js', 'audio.js',
  'files.js', 'output.js', 'conversation.js', 'fake.js',
  'queue-job.js', 'cached-embedding.js', 'rerank.js',
]

test('main entry has no node: imports', () => {
  for (const file of MAIN_ENTRY_FILES) {
    const filePath = join(distDir, file)
    let content: string
    try {
      content = readFileSync(filePath, 'utf8')
    } catch { continue /* file may not exist */ }

    const matches = content.match(/from ['"](node:|fs|path|os|crypto|child_process)['"]/g)
    assert.equal(
      matches,
      null,
      `${file} imports Node-only modules: ${matches?.join(', ')}`,
    )
  }
})

test('providers have no node: imports', () => {
  const providers = ['anthropic', 'openai', 'google', 'ollama', 'deepseek', 'xai', 'groq', 'mistral', 'azure', 'cohere', 'jina']
  for (const p of providers) {
    const filePath = join(distDir, 'providers', `${p}.js`)
    let content: string
    try {
      content = readFileSync(filePath, 'utf8')
    } catch { continue }

    const matches = content.match(/from ['"](node:|fs|path|os|crypto|child_process)['"]/g)
    assert.equal(matches, null, `providers/${p}.js has Node imports: ${matches?.join(', ')}`)
  }
})
```

**Step 2: Build + run**

```bash
cd packages/ai && pnpm build && pnpm test
```

Expected: both tests pass.

**Step 3: If tests fail**

If any file still has a `node:` import, either:
- Lazy-load it inside a function (dynamic `await import()`)
- Move the code to `/node` subpath

**Step 4: Commit**

```bash
git add packages/ai/src/isomorphic-check.test.ts
git commit -m "test(ai): add isomorphism guard — main entry has no node: imports"
```

### Task 5.2: Update CLAUDE.md

**Files:**
- Modify: `packages/ai/CLAUDE.md`

**Step 1: Add a "Runtime Compatibility" section after "Key Files"**

```markdown
## Runtime Compatibility

`@rudderjs/ai` is runtime-agnostic via subpath exports:

| Entry | Runtimes | Use for |
|---|---|---|
| `@rudderjs/ai` | Node, browser, Electron main+renderer, React Native | Agents, tools, streaming, providers — any `fetch`-capable JS runtime |
| `@rudderjs/ai/node` | Node only | `documentFromPath()`, `imageFromPath()`, `transcribeFromPath()` |
| `@rudderjs/ai/server` | Node only | `AiProvider` (requires `@rudderjs/core`) |

The main entry has **zero `node:` imports** — enforced by `isomorphic-check.test.ts`.

**Security caveat:** Calling LLM providers directly from a client (browser/RN) leaks your API key. Use server-side proxies for production; BYOK desktop apps (Electron) are the main client-side use case.
```

**Step 2: Commit**

```bash
git add packages/ai/CLAUDE.md
git commit -m "docs(ai): document runtime compatibility and subpath exports"
```

### Task 5.3: Update root `CLAUDE.md` pitfalls

**Files:**
- Modify: `/CLAUDE.md` (root)

**Step 1: Add a pitfall about the subpath split**

Add to the `## Common Pitfalls` section:

```markdown
- **`AiProvider` not found when importing from `@rudderjs/ai`**: As of the isomorphism refactor, `AiProvider` lives at `@rudderjs/ai/server`, not the main entry. The main entry is runtime-agnostic (works in RN/browser/Electron). Also, provider auto-discovery reads `rudderjs.providerSubpath` from `package.json` to load the provider class from the right subpath.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note AiProvider subpath location in pitfalls"
```

### Task 5.4: Manual RN/browser verification (optional but recommended)

Not testable in this monorepo, but the engineer should:

1. Create a minimal React Native test project (or browser HTML page)
2. `npm install @rudderjs/ai` (after publishing) OR use `pnpm link`
3. Try:
   ```ts
   import { AI, ImageAttachment } from '@rudderjs/ai'
   const img = ImageAttachment.fromBase64(someBase64, 'image/png')
   const res = await AI.prompt('Describe this image', { attachments: [img.toAttachment()] })
   ```
4. Confirm no Metro/bundler errors about `node:fs`.

Document findings in the AI CLAUDE.md if you hit surprises.

---

## Summary

After this plan:

- `@rudderjs/ai` — runtime-agnostic core (agents, tools, streaming, 11 providers, attachment classes)
- `@rudderjs/ai/node` — `documentFromPath`, `imageFromPath`, `transcribeFromPath` (Node filesystem helpers)
- `@rudderjs/ai/server` — `AiProvider` (DI-integrated ServiceProvider)

**Consumers by runtime:**

| Runtime | Imports |
|---|---|
| RudderJS server | `@rudderjs/ai/server` for provider, `@rudderjs/ai` for agents, `@rudderjs/ai/node` for file helpers |
| Electron main process | `@rudderjs/ai/node` (full Node access) |
| Electron renderer | `@rudderjs/ai` only |
| React Native | `@rudderjs/ai` only |
| Browser | `@rudderjs/ai` only |

**What doesn't change:**
- Agent/tool/streaming APIs — identical
- Provider adapters — identical
- Playground behavior — identical (just updated one import path)

**Enforced by tests:**
- Main entry has no `node:` imports (isomorphism guard)

**Estimated scope:**
- ~8 new files (base64 helper, node/attachment, node/transcription, node/index, server/provider, server/index, isomorphic-check test)
- ~6 modified files (attachment, transcription, types, index, ai package.json, core's providers-discover + default-providers for subpath support)
- ~1 deleted file (provider.ts)

**Risk:** The provider auto-discovery scanner change (Task 3.2 step 6) touches `@rudderjs/core`. Verify `pnpm rudder providers:discover` still works after, and that the playground boots. If it breaks, the fallback is option (a) — re-export `AiProvider` from the main entry, accepting that TypeScript import paths show both locations.
