import { SocialiteProvider } from '../provider.js'
import { SocialUser } from '../social-user.js'

export class FacebookProvider extends SocialiteProvider {
  protected defaultScopes(): string[] { return ['email', 'public_profile'] }
  protected authUrl():  string { return 'https://www.facebook.com/v19.0/dialog/oauth' }
  protected tokenUrl(): string { return 'https://graph.facebook.com/v19.0/oauth/access_token' }
  protected userUrl():  string { return 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.type(large)' }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    const picture = data['picture'] as { data?: { url?: string } } | undefined
    return new SocialUser({
      id:       String(data['id'] ?? ''),
      name:     (data['name'] as string | null) ?? null,
      email:    (data['email'] as string | null) ?? null,
      avatar:   picture?.data?.url ?? null,
      nickname: null,
      token,
      refreshToken,
      raw: data,
    })
  }
}
