---
"@rudderjs/cli": patch
---

`rudder doctor`'s `env:dotenv-loadable` check now passes when config is supplied via `process.env` directly (Docker, CI, Forge / Fly / Render / Vercel / Railway, Kubernetes ConfigMap / Secret) — previously hard-errored on absent `.env`, breaking unscoped `rudder doctor` as a `predev` pre-flight in every non-`.env` deployment shape.

Detection signal: any of `APP_KEY`, `APP_ENV`, or `DATABASE_URL` set in `process.env` means the operator has deliberately chosen the process.env shape. The per-key validation stays with the targeted sibling checks (`env:app-key`, `env:app-env`, `orm-prisma:database-url`) — this check only owns the file-shape concern.

The fresh-clone case (bare repo, no `.env`, no env signals) still gets the actionable `Run cp .env.example .env` error. Composes with the previous workspace-friendliness pass (#619): an API-only app deployed via CI without `APP_KEY` (now a warn per the post-#619 lenient `env:app-key`) no longer trips this check either, because `DATABASE_URL` / `APP_ENV` is the signal.
