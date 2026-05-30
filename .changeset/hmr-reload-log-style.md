---
"@rudderjs/vite": patch
---

Style the dev HMR reload line to sit with Vite's. `[RudderJS] change detected —
reloading (file)` is now `<dim time> [Rudder] change detected <dim file>` —
matching the shape of Vite's `<dim time> [vite] hmr update <dim files>`, with a
bold orange `[Rudder]` tag.
