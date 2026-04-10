import { ServiceProvider } from '@rudderjs/core'
import { UserService } from '../Services/UserService.js'
import { GreetingService } from '../Services/GreetingService.js'
import { TodoServiceProvider } from '../Modules/Todo/TodoServiceProvider.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
    this.app.singleton(GreetingService, () => new GreetingService())
  }

  async boot(): Promise<void> {
    // `panels(...)` and `AiServiceProvider` were hoisted to bootstrap/
    // providers.ts so the framework's natural register-then-boot phasing
    // handles ordering: AiServiceProvider.register() seeds the AI action
    // catalogue before panels.boot() iterates resources and resolves
    // Field.ai([...]). See providers.ts for the full ordering rationale.

    await this.app.register(TodoServiceProvider)

    console.log(`[AppServiceProvider] booted — app: ${this.app.name}`)
  }
}
