---
"@rudderjs/vite": major
---

**Breaking — `rudderjs()` no longer registers Vike.** You must add `vike()` to your `vite.config.ts` plugins array yourself.

Previously, `rudderjs()` dynamically imported `vike/plugin` inside its own async IIFE and prepended Vike's plugins to its return value. That wrapped Vike's plugin IIFE inside ours and tripped a microtask race against Vike's `isOnlyResolvingUserConfig` flag in `loadViteConfigFile` — failing deterministically on Ubuntu Node 20 and ~50% on Ubuntu Node 22 CI runners with the misleading `[vike@…][Bug] You stumbled upon a Vike bug` error wrapper. Upstream discussion: vikejs/vike#3258.

**Migration — two-line diff:**

```diff
  import { defineConfig } from 'vite'
+ import vike from 'vike/plugin'
  import rudderjs from '@rudderjs/vite'
  // …

  export default defineConfig({
    plugins: [
      rudderjs(),
+     vike(),
      // …
    ],
  })
```

Note the order: **`rudderjs()` before `vike()`**. The views-scanner writes auto-generated stubs to `pages/__view/` during plugin construction, and Vike scans `pages/` during its own construction, so the stubs must exist before `vike()` is called.

Other API changes:

- `rudderjs()` now returns `Plugin[]` synchronously instead of `Promise<Plugin[]>`. Existing `await rudderjs()` calls continue to work (await on a non-Promise is a no-op), but TypeScript signatures change.
- The `_vikeVitePluginOptions` self-detection marker is no longer attached to the return value — we don't register Vike, so there's nothing to flag.
- `vike` is still listed in `peerDependencies` and remains required.
