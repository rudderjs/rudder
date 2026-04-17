import type { MiddlewareHandler } from '@rudderjs/core'

export interface OAuth2McpOptions {
  /** Scopes required on the bearer token. Missing scopes → 403 `insufficient_scope`. */
  scopes?: string[]
  /** Canonical URL of this protected MCP resource. Defaults to the current request URL. */
  resource?: string
  /**
   * Authorization server URL(s) advertised via RFC 9728. Defaults to the app
   * origin when `@rudderjs/passport` is installed as the in-app AS.
   */
  authorizationServers?: string[]
  /** Scopes advertised in the protected-resource metadata document. */
  scopesSupported?: string[]
}

interface PassportModule {
  verifyToken: (jwt: string) => Promise<{
    jti: string
    sub?: string
    scopes?: string[]
  }>
  AccessToken: {
    query(): {
      where(field: string, value: unknown): {
        first(): Promise<{ id: string; revoked: boolean } | null>
      }
    }
  }
}

let passportPromise: Promise<PassportModule> | null = null

function loadPassport(): Promise<PassportModule> {
  if (!passportPromise) {
    passportPromise = (async () => {
      const { resolveOptionalPeer } = await import('@rudderjs/core')
      return resolveOptionalPeer<PassportModule>('@rudderjs/passport')
    })().catch((err) => {
      passportPromise = null
      throw err
    })
  }
  return passportPromise
}

/**
 * Protect an MCP web endpoint with OAuth 2.1 Bearer tokens issued by
 * `@rudderjs/passport`. On failure, adds an RFC 9728 `WWW-Authenticate`
 * header pointing clients at the protected-resource metadata document.
 */
export function oauth2McpMiddleware(mcpPath: string, options: OAuth2McpOptions = {}): MiddlewareHandler {
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath}`
  const requiredScopes = options.scopes ?? []

  return async function OAuth2McpMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'] as string | undefined
    const metadataUrl = absoluteUrl(req as unknown as RequestShape, metadataPath)

    if (!authHeader?.startsWith('Bearer ')) {
      challenge(res, metadataUrl, 'invalid_token', 'Bearer token required.')
      return
    }

    let passport: PassportModule
    try {
      passport = await loadPassport()
    } catch {
      challenge(res, metadataUrl, 'invalid_token', 'OAuth provider not configured.')
      return
    }

    const jwt = authHeader.slice(7).trim()
    let payload: Awaited<ReturnType<PassportModule['verifyToken']>>
    try {
      payload = await passport.verifyToken(jwt)
    } catch {
      challenge(res, metadataUrl, 'invalid_token', 'Invalid or expired token.')
      return
    }

    let token: { id: string; revoked: boolean } | null
    try {
      token = await passport.AccessToken.query().where('id', payload.jti).first()
    } catch {
      challenge(res, metadataUrl, 'invalid_token', 'Token could not be verified.')
      return
    }
    if (!token || token.revoked) {
      challenge(res, metadataUrl, 'invalid_token', 'Token has been revoked.')
      return
    }

    if (requiredScopes.length > 0) {
      const tokenScopes = Array.isArray(payload.scopes) ? payload.scopes : []
      const granted = tokenScopes.includes('*')
      if (!granted) {
        const missing = requiredScopes.filter((s) => !tokenScopes.includes(s))
        if (missing.length > 0) {
          challenge(res, metadataUrl, 'insufficient_scope',
            `Missing scope(s): ${missing.join(', ')}`,
            requiredScopes.join(' '))
          return
        }
      }
    }

    const raw = req.raw as Record<string, unknown>
    raw['__passport_token'] = token
    raw['__passport_scopes'] = payload.scopes
    raw['__passport_user_id'] = payload.sub

    await next()
  }
}

/** Register the RFC 9728 Protected Resource Metadata endpoint for an MCP path. */
export function registerOAuth2Metadata(
  router: {
    get(path: string, handler: (req: unknown, res: unknown) => unknown, middleware?: unknown[]): unknown
  },
  mcpPath: string,
  options: OAuth2McpOptions,
): void {
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath}`

  router.get(metadataPath, (req: unknown, res: unknown) => {
    const origin = absoluteUrl(req as RequestShape, '')
    const resource = options.resource ?? `${origin}${mcpPath}`
    const authServers = options.authorizationServers && options.authorizationServers.length > 0
      ? options.authorizationServers
      : [origin]

    const body: Record<string, unknown> = {
      resource,
      authorization_servers: authServers,
      bearer_methods_supported: ['header'],
    }
    if (options.scopesSupported && options.scopesSupported.length > 0) {
      body['scopes_supported'] = options.scopesSupported
    }

    ;(res as { json: (data: unknown) => void }).json(body)
  })
}

// ─── helpers ──────────────────────────────────────────────

type RequestShape = {
  headers: Record<string, string | string[] | undefined>
  protocol?: string
  host?: string
  hostname?: string
}

function absoluteUrl(req: RequestShape, path: string): string {
  const host = getHeader(req, 'x-forwarded-host')
    ?? req.host
    ?? getHeader(req, 'host')
    ?? req.hostname
    ?? 'localhost'
  const proto = getHeader(req, 'x-forwarded-proto')
    ?? req.protocol
    ?? 'http'
  return `${proto}://${host}${path}`
}

function getHeader(req: RequestShape, name: string): string | undefined {
  const v = req.headers[name]
  if (Array.isArray(v)) return v[0]
  return v
}

function challenge(
  res: unknown,
  metadataUrl: string,
  error: 'invalid_token' | 'insufficient_scope',
  description: string,
  scope?: string,
): void {
  const r = res as {
    status: (code: number) => { json: (data: unknown) => void }
    header?: (key: string, value: string) => unknown
  }
  const parts: string[] = [`resource_metadata="${metadataUrl}"`, `error="${error}"`]
  if (description) parts.push(`error_description="${description.replace(/"/g, '\\"')}"`)
  if (scope) parts.push(`scope="${scope}"`)
  r.header?.('WWW-Authenticate', `Bearer ${parts.join(', ')}`)

  const statusCode = error === 'insufficient_scope' ? 403 : 401
  const body: Record<string, unknown> = { error, error_description: description }
  if (scope) body['scope'] = scope
  r.status(statusCode).json(body)
}
