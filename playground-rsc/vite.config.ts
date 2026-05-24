import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import vike from 'vike/plugin'
import react from '@vitejs/plugin-react'

// vike-react-rsc-rudder contributes its own Vite plugin via `extends: [vikeReactRsc]`
// in pages/+config.ts — we only wire the base React transform + Vike + the
// RudderJS plugin (view scanner, route scanner, dev IP/HMR) here.
export default defineConfig({
  plugins: [
    react(),
    rudderjs(),
    vike(),
  ],
  server: {
    allowedHosts: true,
  },
})
