---
"create-rudder": patch
---

Scaffolded `start`/`preview` scripts now set `NODE_ENV=production`. Running the built server without it mixes React build flavors (the vike SSR bundle bakes production internals while the external `react` package resolves its development build) and every render 500s with `TypeError: dispatcher.getOwner is not a function`.
