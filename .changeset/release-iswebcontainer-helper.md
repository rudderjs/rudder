---
'@rudderjs/support': minor
---

Add `isWebContainer()` runtime helper

Returns `true` when the app is running inside a StackBlitz WebContainer
(Node.js virtualized in the browser via WebAssembly). Useful for config
defaults that need to flip drivers requiring raw TCP — Redis, SMTP,
native Postgres — to in-memory, log, or cookie equivalents because
WebContainers can't open raw TCP sockets.

```ts
import { isWebContainer } from '@rudderjs/support'

// config/cache.ts
export default {
  default: isWebContainer() ? 'memory' : 'redis',
}
```
