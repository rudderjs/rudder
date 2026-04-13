// Helper functions that operate on raw OAuth records (ORM returns plain objects, not instances).

export interface OAuthClientRecord {
  id:           string
  name:         string
  secret:       string | null
  redirectUris: string
  grantTypes:   string
  scopes:       string
  confidential: boolean
  revoked:      boolean
}

export interface AccessTokenRecord {
  id:        string
  userId:    string | null
  clientId:  string
  name:      string | null
  scopes:    string
  revoked:   boolean
  expiresAt: Date
  createdAt: Date
}

export interface RefreshTokenRecord {
  id:            string
  accessTokenId: string
  revoked:       boolean
  expiresAt:     Date
}

export interface AuthCodeRecord {
  id:                  string
  userId:              string
  clientId:            string
  scopes:              string
  revoked:             boolean
  expiresAt:           Date
  codeChallenge:       string | null
  codeChallengeMethod: string | null
}

export interface DeviceCodeRecord {
  id:           string
  clientId:     string
  userCode:     string
  deviceCode:   string
  scopes:       string
  userId:       string | null
  approved:     boolean | null
  expiresAt:    Date
  lastPolledAt: Date | null
}

// ─── Parsing helpers ──────────────────────────────────────

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[]
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as string[] } catch { return [] }
  }
  return []
}

// ─── OAuthClient helpers ──────────────────────────────────

export const clientHelpers = {
  getRedirectUris: (c: OAuthClientRecord): string[] => parseJsonArray(c.redirectUris),
  getGrantTypes:   (c: OAuthClientRecord): string[] => parseJsonArray(c.grantTypes),
  getScopes:       (c: OAuthClientRecord): string[] => parseJsonArray(c.scopes),

  hasGrantType:  (c: OAuthClientRecord, type: string): boolean => clientHelpers.getGrantTypes(c).includes(type),
  hasRedirectUri: (c: OAuthClientRecord, uri: string): boolean => clientHelpers.getRedirectUris(c).includes(uri),

  isPublic: (c: OAuthClientRecord): boolean => !c.confidential,
}

// ─── AccessToken helpers ──────────────────────────────────

export const accessTokenHelpers = {
  getScopes: (t: AccessTokenRecord): string[] => parseJsonArray(t.scopes),

  can: (t: AccessTokenRecord, scope: string): boolean => {
    const scopes = accessTokenHelpers.getScopes(t)
    return scopes.includes('*') || scopes.includes(scope)
  },

  isExpired: (t: AccessTokenRecord): boolean => new Date(t.expiresAt).getTime() <= Date.now(),
  isValid:   (t: AccessTokenRecord): boolean => !t.revoked && !accessTokenHelpers.isExpired(t),
}

// ─── RefreshToken helpers ─────────────────────────────────

export const refreshTokenHelpers = {
  isExpired: (t: RefreshTokenRecord): boolean => new Date(t.expiresAt).getTime() <= Date.now(),
}

// ─── AuthCode helpers ─────────────────────────────────────

export const authCodeHelpers = {
  getScopes: (c: AuthCodeRecord): string[] => parseJsonArray(c.scopes),
  isExpired: (c: AuthCodeRecord): boolean => new Date(c.expiresAt).getTime() <= Date.now(),
  isPkce:    (c: AuthCodeRecord): boolean => c.codeChallenge !== null,
}

// ─── DeviceCode helpers ───────────────────────────────────

export const deviceCodeHelpers = {
  getScopes:  (d: DeviceCodeRecord): string[] => parseJsonArray(d.scopes),
  isExpired:  (d: DeviceCodeRecord): boolean => new Date(d.expiresAt).getTime() <= Date.now(),
  isApproved: (d: DeviceCodeRecord): boolean => d.approved === true,
  isDenied:   (d: DeviceCodeRecord): boolean => d.approved === false,
  isPending:  (d: DeviceCodeRecord): boolean => d.approved === null,
}
