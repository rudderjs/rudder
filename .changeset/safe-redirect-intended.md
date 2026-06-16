---
"@rudderjs/server-hono": minor
"@rudderjs/contracts": minor
---

feat(server-hono): open-redirect-safe redirect helper

Add `res.intended(target, fallback?, code?)` plus the standalone `isSafeRedirect(target)` predicate and `safeRedirectTarget(target, fallback?)` resolver. These guard the common "redirect back to the intended URL after login" flow against open-redirect attacks: only same-origin absolute paths are honored, while absolute URLs (`https://evil.com`), protocol-relative targets (`//evil.com`), backslash-smuggled variants (`/\evil.com`), and whitespace/control-char smuggling fall back to a safe default. `intended` is also added to the `AppResponse` contract.
