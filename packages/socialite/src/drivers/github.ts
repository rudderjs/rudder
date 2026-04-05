import { SocialiteProvider } from '../provider.js'
import { SocialUser } from '../social-user.js'

export class GitHubProvider extends SocialiteProvider {
  protected defaultScopes(): string[] { return ['read:user', 'user:email'] }
  protected authUrl():  string { return 'https://github.com/login/oauth/authorize' }
  protected tokenUrl(): string { return 'https://github.com/login/oauth/access_token' }
  protected userUrl():  string { return 'https://api.github.com/user' }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    return new SocialUser({
      id:       String(data['id'] ?? ''),
      name:     (data['name'] as string | null) ?? null,
      email:    (data['email'] as string | null) ?? null,
      avatar:   (data['avatar_url'] as string | null) ?? null,
      nickname: (data['login'] as string | null) ?? null,
      token,
      refreshToken,
      raw: data,
    })
  }

  /** GitHub may not return email in the user endpoint if it's private. Fetch from /user/emails. */
  async user(codeOrRequest: string | { query: Record<string, string> }): Promise<SocialUser> {
    const socialUser = await super.user(codeOrRequest)
    if (!socialUser.getEmail()) {
      const email = await this.fetchPrimaryEmail(socialUser.token)
      if (email) {
        return new SocialUser({
          id:       socialUser.getId(),
          name:     socialUser.getName(),
          email,
          avatar:   socialUser.getAvatar(),
          nickname: socialUser.getNickname(),
          token:    socialUser.token,
          refreshToken: socialUser.refreshToken,
          raw: { ...socialUser.getRaw(), email },
        })
      }
    }
    return socialUser
  }

  private async fetchPrimaryEmail(token: string): Promise<string | null> {
    try {
      const res = await fetch('https://api.github.com/user/emails', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      })
      if (!res.ok) return null
      const emails = await res.json() as { email: string; primary: boolean; verified: boolean }[]
      const primary = emails.find(e => e.primary && e.verified)
      return primary?.email ?? emails[0]?.email ?? null
    } catch {
      return null
    }
  }
}
