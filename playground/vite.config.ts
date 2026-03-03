import path from 'path'
import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import vikeSolid from 'vike-solid/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    vike(),
    // React: handles all .tsx/.jsx except the solid-demo page directory
    react({ exclude: ['**/pages/solid-demo/**'] }),
    // Vue: handles .vue files — no JSX conflict
    vue(),
    // Solid: scoped to the solid-demo page directory only to avoid JSX conflict with React
    vikeSolid({ include: ['**/pages/solid-demo/**'] }),
    tailwindcss(),
  ],
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
      '@boostkit/queue-inngest',             // optional — only needed when driver=inngest
      '@boostkit/queue-bullmq',              // optional — only needed when driver=bullmq
      '@boostkit/mail-nodemailer',           // optional — only needed when mail driver=smtp
      '@boostkit/cache-redis',               // optional — only needed when cache driver=redis
      '@boostkit/storage-s3',               // optional — only needed when storage driver=s3
      '@boostkit/orm-drizzle',              // optional ORM adapters
    ],
  },
  build: {
    rollupOptions: {
      // Exclude the same set from the browser bundle — they are optional peers and
      // CLI/server-only; they must never be bundled for the browser.
      external: (id) =>
        id.startsWith('@clack/') ||
        ['@boostkit/queue-inngest', '@boostkit/queue-bullmq', '@boostkit/mail-nodemailer',
         '@boostkit/cache-redis', '@boostkit/storage-s3', '@boostkit/orm-drizzle'].includes(id),
    },
  },
})
