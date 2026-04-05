// ─── Social User ──────────────────────────────────────────
// Normalized user returned by all OAuth providers.

export class SocialUser {
  constructor(
    private readonly data: {
      id:       string
      name:     string | null
      email:    string | null
      avatar:   string | null
      nickname: string | null
      token:    string
      refreshToken?: string | null
      expiresIn?: number | null
      raw:      Record<string, unknown>
    },
  ) {}

  getId():       string       { return this.data.id }
  getName():     string | null { return this.data.name }
  getEmail():    string | null { return this.data.email }
  getAvatar():   string | null { return this.data.avatar }
  getNickname(): string | null { return this.data.nickname }

  /** The access token from the OAuth provider. */
  get token():        string             { return this.data.token }
  get refreshToken(): string | null      { return this.data.refreshToken ?? null }
  get expiresIn():    number | null      { return this.data.expiresIn ?? null }

  /** Raw user data from the provider's API. */
  getRaw(): Record<string, unknown> { return this.data.raw }
}
