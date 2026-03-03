import { ServiceProvider } from '@boostkit/core'

export class AuthServiceProvider extends ServiceProvider {
  register(): void {
    // Future: bind AuthManager, SessionGuard, JwtGuard, etc.
    // this.app.singleton(AuthManager, () => new AuthManager(config))
  }

  boot(): void {
    // Future: define gates, policies, and guards
    // Gate.define('update-post', (user, post) => user.id === post.userId)
    console.log('[AuthServiceProvider] booted — guards and policies registered')
  }
}
