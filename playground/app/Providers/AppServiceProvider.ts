import { ServiceProvider } from '@forge/core'
import { UserService } from '../Services/UserService.js'
import { GreetingService } from '../Services/GreetingService.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
    this.app.singleton(GreetingService, () => new GreetingService())
  }

  boot(): void {
    console.log(`[AppServiceProvider] booted — app: ${this.app.name}`)
  }
}
