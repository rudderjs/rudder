import { SocialiteProvider } from '../provider.js'
import { SocialUser } from '../social-user.js'

export class GoogleProvider extends SocialiteProvider {
  protected defaultScopes(): string[] { return ['openid', 'profile', 'email'] }
  protected authUrl():  string { return 'https://accounts.google.com/o/oauth2/v2/auth' }
  protected tokenUrl(): string { return 'https://oauth2.googleapis.com/token' }
  protected userUrl():  string { return 'https://www.googleapis.com/oauth2/v3/userinfo' }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    return new SocialUser({
      id:       String(data['sub'] ?? ''),
      name:     (data['name'] as string | null) ?? null,
      email:    (data['email'] as string | null) ?? null,
      avatar:   (data['picture'] as string | null) ?? null,
      nickname: null,
      token,
      refreshToken,
      raw: data,
    })
  }
}
