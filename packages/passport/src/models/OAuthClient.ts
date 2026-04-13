import { Model, Hidden } from '@rudderjs/orm'

export class OAuthClient extends Model {
  static override table = 'oAuthClient'

  static override fillable = ['name', 'secret', 'redirectUris', 'grantTypes', 'scopes', 'confidential']

  @Hidden
  declare secret: string | null

  declare name: string
  declare confidential: boolean
  declare revoked: boolean

  /** Parsed redirect URIs. */
  getRedirectUris(): string[] {
    const raw = (this as unknown as Record<string, unknown>)['redirectUris']
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return (raw as string[]) ?? []
  }

  /** Parsed grant types. */
  getGrantTypes(): string[] {
    const raw = (this as unknown as Record<string, unknown>)['grantTypes']
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return (raw as string[]) ?? []
  }

  /** Parsed scopes. */
  getScopes(): string[] {
    const raw = (this as unknown as Record<string, unknown>)['scopes']
    if (typeof raw === 'string') return JSON.parse(raw) as string[]
    return (raw as string[]) ?? []
  }

  /** Check if client supports a specific grant type. */
  hasGrantType(type: string): boolean {
    return this.getGrantTypes().includes(type)
  }

  /** Check if a redirect URI is registered for this client. */
  hasRedirectUri(uri: string): boolean {
    return this.getRedirectUris().includes(uri)
  }

  /** Whether this is a first-party (non-confidential / PKCE) client. */
  isPublic(): boolean {
    return !this.confidential
  }
}
