import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    rudderjs(),
    tailwindcss(),
    react(),
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
