---
"create-rudder": minor
---

Scaffold new apps on Vite 8. Bumps the generated `vite` to `^8.0.0`, `@vitejs/plugin-react` to `^6.0.0` (Vite-8-only), `@vitejs/plugin-vue` to `^6.0.0`, and `@tailwindcss/vite` to `^4.3.0` (which declares Vite 8 support). The Solid path's `vite-plugin-solid` (pulled via `vike-solid`) resolves to 2.11.12+, which adds Vite 8 to its peer range. Validated end-to-end via the scaffolder smoke (React/Vue/Solid: install → build → boot → headless render) and the RSC production e2e under Vite 8 + rolldown.
