---
"@rudderjs/sanctum": patch
---

Return a generic 403 message from RequireToken in production to avoid leaking ability names to callers. In development mode, the specific ability name is still shown for easier debugging.
