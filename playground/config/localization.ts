import { resolve } from 'node:path'
import { Env } from '@rudderjs/core'

// Resolve lang/ relative to the working directory (project root) so the path
// is stable across `pnpm dev` (Vite SSR) and `pnpm preview` (bundled dist).
// `import.meta.dirname` would point to dist/server/ in production builds,
// breaking the relative `../lang` lookup.
export default {
  locale: Env.get('APP_LOCALE', 'ar'),
  fallback: 'en',
  path: resolve(process.cwd(), 'lang'),
}
