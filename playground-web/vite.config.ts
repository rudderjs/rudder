import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import vike from 'vike/plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { diagAssetsManifest } from './vite-diag-assets-manifest.ts'

export default defineConfig({
  plugins: [
    rudderjs(),
    vike(),
    tailwindcss(),
    react(),
    // Opt-in (DIAG_ASSETS_MANIFEST=1) build-topology probe for rolldown#9592.
    // This is the app whose server bundle leaks the placeholder under load.
    // `false` when off; Vite ignores falsy plugin entries.
    diagAssetsManifest(),
  ],
  server: {
    allowedHosts: true,
  },
  ssr: {
    // `@rudderjs/ai` lazy-loads model SDKs server-side; keep them external so
    // Vite doesn't try to bundle them. The framework playground only ships
    // `@anthropic-ai/sdk` (used by `app/Agents/ResearchAgent.ts`).
    external: ['@anthropic-ai/sdk', 'openai', '@google/generative-ai'],
  },
})
