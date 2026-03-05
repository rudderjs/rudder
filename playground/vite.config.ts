import { defineConfig } from 'vite'
import boostkit from '@boostkit/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import solid from 'vike-solid/vite'

export default defineConfig({
  plugins: [
    boostkit(),
    tailwindcss(),
    react({ exclude: ['**/pages/solid*/**'] }),
    solid({ include: ['**/pages/solid*/**'] }),
    vue(),
  ],
})
