import { ServiceProvider } from '@rudderjs/core'
import { UserService } from '../Services/UserService.js'
import { GreetingService } from '../Services/GreetingService.js'
import { TodoServiceProvider } from '../Modules/Todo/TodoServiceProvider.js'
import { panels } from '@pilotiq/panels'
import { adminPanel } from 'App/Panels/Admin/AdminPanel.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
    this.app.singleton(GreetingService, () => new GreetingService())
  }

  async boot(): Promise<void> {
    await this.app.register(panels([adminPanel]))

    await this.app.register(TodoServiceProvider)

    console.log(`[AppServiceProvider] booted — app: ${this.app.name}`)
  }
}
