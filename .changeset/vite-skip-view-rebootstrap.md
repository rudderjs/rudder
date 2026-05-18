---
'@rudderjs/vite': patch
---

Skip framework re-bootstrap in dev when `app/Views/**` files change. View files are loaded lazily by Vike per-request and aren't captured in provider boot closures, so the singleton-clear + SSR invalidate + full-reload that other `app/` edits need is wasted work for view edits.

The `rudderjs:routes` watcher previously fired the same heavy path for every file under `routes/`, `bootstrap/`, and `app/` — including views — which forced cold SSR on the next request (~600–750 ms measured on the playground) and prevented Vike's component HMR from firing. Now view edits fall through to Vike's native HMR path (≈50 ms component refresh in the browser; ~240–280 ms if the user issues a fresh request, vs ~700 ms before).

Non-view `app/` edits (models, controllers, providers, services, jobs, …) still trigger the full re-bootstrap — those *are* captured in closures and need it.
