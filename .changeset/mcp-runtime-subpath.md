---
'@rudderjs/mcp': major
---

**Breaking:** `createSdkServer`, `startStdio`, `mountHttpTransport`, and `HttpTransportOptions` are no longer re-exported from the main `@rudderjs/mcp` entry point. They now live at the `@rudderjs/mcp/runtime` subpath. Update any direct imports:

```ts
// Before
import { createSdkServer, startStdio, mountHttpTransport } from '@rudderjs/mcp'

// After
import { createSdkServer, startStdio, mountHttpTransport } from '@rudderjs/mcp/runtime'
```

These primitives are described in the boost guidelines as "rarely needed in app code" — `McpProvider`, `Mcp.web()`, and `Mcp.local()` cover normal usage and remain on the main entry. The split keeps `@modelcontextprotocol/sdk` out of the import graph when an app declares `@rudderjs/mcp` but hasn't registered any servers, so cold-boot is unaffected by the SDK in that case. `McpTestClient` and the provider boot path were also updated to import from the cheap sibling modules instead of going through the runtime barrel.
