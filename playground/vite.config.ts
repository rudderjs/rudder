import path from 'path'
import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vike(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  ssr: {
    // Keep CLI-only and optional adapter packages external in the SSR bundle —
    // they are loaded from node_modules at runtime when the driver config requests them.
    external: [
      '@clack/core', '@clack/prompts',    // CLI interactive prompts — Node.js only
      '@forge/queue-inngest',             // optional — only needed when driver=inngest
      '@forge/queue-bullmq',              // optional — only needed when driver=bullmq
      '@forge/mail-nodemailer',           // optional — only needed when mail driver=smtp
      '@forge/server-express',            // optional server adapters
      '@forge/server-fastify',
      '@forge/server-h3',
      '@forge/orm-drizzle',              // optional ORM adapters
    ],
  },
  build: {
    rollupOptions: {
      // Exclude the same set from the browser bundle — they are optional peers and
      // CLI/server-only; they must never be bundled for the browser.
      external: (id) =>
        id.startsWith('@clack/') ||
        ['@forge/queue-inngest', '@forge/queue-bullmq', '@forge/mail-nodemailer', '@forge/orm-drizzle',
         '@forge/server-express', '@forge/server-fastify', '@forge/server-h3'].includes(id),
    },
  },
})
