import { LocalAdapter } from './adapters/local.js'
import { StorageRegistry } from './registry.js'

/**
 * Minimal slice of `@rudderjs/router` we need to register a route.
 * Avoids importing the actual router (which is an optional peer of storage).
 */
interface RouterLike {
  get(
    path: string,
    handler: (req: { url: string; params?: Record<string, string> }) => Promise<unknown> | unknown,
  ): unknown
}

interface RouterModule {
  Url: { isValidSignature: (req: { url: string; headers: Record<string, string> }) => boolean }
}

export interface ServeTemporaryUrlsOptions {
  /** Disk name (must be a `LocalAdapter`). */
  disk: string
  /**
   * Route path to register, ending in `*` (Hono splat) or `:path*`. The leading
   * portion (before the splat) becomes the URL prefix used by `temporaryUrl()`.
   *
   * @example  '/storage/temp/*'
   */
  routePath: string
}

/**
 * Register a signed GET route that serves files from a `LocalAdapter` disk.
 *
 * Pre-signed URLs returned by `Storage.disk(<disk>).temporaryUrl(...)` will
 * point at this route; the handler validates the signature and streams the
 * file from disk.
 *
 * @example
 * import { router } from '@rudderjs/router'
 * import { serveTemporaryUrls } from '@rudderjs/storage'
 *
 * serveTemporaryUrls(router, { disk: 'local', routePath: '/storage/temp/*' })
 */
export async function serveTemporaryUrls(
  router: RouterLike,
  opts: ServeTemporaryUrlsOptions,
): Promise<void> {
  const adapter = StorageRegistry.get(opts.disk)
  if (!(adapter instanceof LocalAdapter)) {
    throw new Error(
      `[RudderJS Storage] serveTemporaryUrls: disk "${opts.disk}" is not a LocalAdapter ` +
      `(got ${adapter.constructor.name}). S3 + other remote drivers sign their own URLs.`,
    )
  }

  // Strip the trailing splat in either documented form: `/foo/*` or `/foo/:path*`.
  // The two-step replace previously here was order-sensitive — the first regex
  // ate the `*` so the second one could no longer match `:path*`.
  const prefix = opts.routePath.replace(/(?::path)?\*+$/, '')
  if (!prefix.endsWith('/')) {
    throw new Error(
      `[RudderJS Storage] serveTemporaryUrls: routePath must end in "/*" or "/:path*" — got "${opts.routePath}".`,
    )
  }
  adapter.serveAt(prefix)

  const { resolveOptionalPeer } = await import('@rudderjs/core')
  const router_ = await resolveOptionalPeer<RouterModule>('@rudderjs/router')

  router.get(opts.routePath, async (req) => {
    const reqWithHeaders = req as { url: string; headers?: Record<string, string> }
    const headers = reqWithHeaders.headers ?? {}
    if (!router_.Url.isValidSignature({ url: req.url, headers })) {
      return new Response('Invalid or expired URL signature.', { status: 403 })
    }

    const url      = new URL(req.url, 'http://placeholder.local')
    const filePath = decodeURI(url.pathname.slice(prefix.length))
    if (!filePath || filePath.includes('..')) {
      return new Response('Not found.', { status: 404 })
    }

    if (!(await adapter.exists(filePath))) {
      return new Response('Not found.', { status: 404 })
    }

    const stream = await adapter.readStream(filePath)
    const { Readable } = await import('node:stream')
    return new Response(Readable.toWeb(stream) as ReadableStream)
  })
}
