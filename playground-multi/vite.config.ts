import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import solid from 'vike-solid/vite'

export default defineConfig({
  plugins: [
    rudderjs(),
    tailwindcss(),
    react({ exclude: ['**/pages/solid-demo/**'] }),
    vue(),
    solid({ include: ['**/pages/solid-demo/**'] }),
  ],
})
