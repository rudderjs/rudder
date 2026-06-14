---
"@rudderjs/terminal": patch
---

Fix `terminal()` misreporting a component's own ENOENT as "component not found". `resolveComponent`'s catch wrapped both the `fs.access` existence check and the dynamic `import()`, so an ENOENT thrown by the component module's own top-level code (e.g. a file it reads at import time being absent) was swallowed and replaced with a misleading "not found" error that hid the real bug. The existence check and the import are now separated so any error from the imported module propagates unchanged.
