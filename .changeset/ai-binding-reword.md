---
"@rudderjs/ai": patch
---

Reword the package metadata and docs: `@rudderjs/ai` is Rudder's AI integration (it re-exports the agnostic engine from `@gemstack/ai-sdk` and adds the Rudder-specific bindings: `AiProvider`, ORM-backed stores, the doctor check, and the `make:agent`/`ai:eval` CLI), not a deprecated back-compat shim. Corrects the npm description and the in-package guidance so users do not migrate off the supported binding. No code or behavior change.
