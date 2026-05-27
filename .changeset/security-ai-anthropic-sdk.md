---
"@rudderjs/ai": minor
---

Require `@anthropic-ai/sdk` `>=0.91.1` (was `>=0.30.0`) to clear two moderate advisories (Memory Tool path validation + insecure default file permissions). The Anthropic provider loads the SDK via a loose lazy `await import(...)`, so no source changes are needed — apps using the Anthropic provider should upgrade their installed `@anthropic-ai/sdk` to 0.91.1+.
