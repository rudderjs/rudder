import { defineConfig } from 'vite'
import boostkit from '@boostkit/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    boostkit(),
    tailwindcss(),
    react(),
  ],
  server: {
    allowedHosts: true,
  },
})
