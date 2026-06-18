---
"@rudderjs/sanctum": patch
---

fix(sanctum): resolve sanctum binding once per middleware factory instead of on every request; add development-mode debug logging to validateToken for each distinct failure reason
