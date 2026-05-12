---
"create-rudder-app": patch
---

**Scaffold `pages/+config.ts` with the `vike#3251` workaround out of the box.**

Fresh `create-rudder-app` projects previously generated `} satisfies Config` in their `pages/+config.ts`, `pages/index/+config.ts`, `pages/_error/+config.ts`, and any opt-in demo / AI-chat config. Under `exactOptionalPropertyTypes: true` (which the scaffolder also enables in `tsconfig.json`), `pnpm typecheck` failed on day 1 with a misleading "not assignable to `import:${string}:${string}`" error — see [vikejs/vike#3251](https://github.com/vikejs/vike/issues/3251).

Templates now emit `} as unknown as Config` in all 4 generators (`pages/index.ts`, `pages/demo.ts`, `pages/error.ts`, `pages/ai-chat.ts`). Drop the `as unknown` cast once Vike fixes #3251 upstream.

No other behavior change.
