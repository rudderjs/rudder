---
"@rudderjs/core": patch
---

Harden the DI container and provider discovery:

- `Container.make()` now detects circular dependencies (factory bindings and constructor auto-resolution) and throws a clear error naming the cycle path, instead of recursing into a stack overflow. The deferred-provider cycle detector in `Application` is left intact (it has a more actionable message and owns that path).
- Provider auto-discovery now skips a package whose `rudderjs` field has no `provider` key, emitting a one-line warning, instead of writing a provider-less manifest entry that hard-throws at load time.
