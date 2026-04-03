import { ServiceProvider } from '@rudderjs/core'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Register your application-level services here:
    // this.app.singleton(MyService, () => new MyService())
  }

  boot(): void {
    console.log(`[AppServiceProvider] booted — ${this.app.name}`)
  }
}
