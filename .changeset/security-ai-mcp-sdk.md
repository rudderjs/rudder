---
"@rudderjs/ai": minor
---

Require `@modelcontextprotocol/sdk` `^1.29.0` (was `^1.13.0`) and re-resolve its transitive dependencies to clear high-severity advisories in `express-rate-limit`, `path-to-regexp`, and `fast-uri`. The MCP bridge loads the SDK via loose dynamic imports, so no source changes are needed. Also re-resolves `protobufjs` to 7.6.1, clearing the critical `@google/genai` protobufjs advisory.
