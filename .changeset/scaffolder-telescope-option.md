---
"create-rudder-app": patch
---

Add `@rudderjs/telescope` to the package multiselect. Selecting it scaffolds `config/telescope.ts` (defaults to in-memory storage — no extra deps), wires it into `config/index.ts`, and surfaces a post-install hint pointing to the `/telescope` dashboard. Provider auto-discovery handles the rest.
