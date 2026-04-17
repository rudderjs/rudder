---
'@rudderjs/orm': minor
'@rudderjs/telescope': patch
---

Add `ModelRegistry.all()`, `.register()`, and `.onRegister()` so framework components can discover registered Model classes.

Models are auto-registered on first `query()` or `find()`/`all()`/`first()`/`where()`/`count()`/`paginate()` call. Use `ModelRegistry.register(MyModel)` in a service provider to register eagerly before the first request hits.

Telescope's model collector now subscribes via `onRegister()` so it also picks up models that appear after its own boot.
