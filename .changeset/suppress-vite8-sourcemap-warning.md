---
"@rudderjs/vite": patch
---

Suppress the noisy Vite 8 dev-startup sourcemap warnings for `@rudderjs/*` packages. Each framework package ships a `dist/*.js.map` whose `sources` point at `../src/*.ts`; the pnpm workspace symlink makes Vite resolve that to the real `packages/<name>/src` path, which Vite 8 flags with `Sourcemap for "…" points to a source file outside its package` — one line per linked package on every `vike dev` boot. The maps are correct (they power accurate dev-error stack remapping); the warnings are benign. The `rudderjs:config` logger filter already suppressed the older `missing source files` wording — this extends it to the Vite 8 wording. Other packages' sourcemap warnings are still shown.
