/**
 * Server-safe entry point — only exports the ServiceProvider.
 * Import this from bootstrap/providers.ts (Node.js / artisan context).
 * No React imports here.
 */
export { MediaServiceProvider, media } from './MediaServiceProvider.js'
export type { MediaConfig, MediaConversion } from './types.js'
