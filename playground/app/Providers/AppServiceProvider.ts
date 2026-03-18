import { ServiceProvider } from '@boostkit/core'
import { UserService } from '../Services/UserService.js'
import { GreetingService } from '../Services/GreetingService.js'
import { TodoServiceProvider } from '../Modules/Todo/TodoServiceProvider.js'
import { panels } from '@boostkit/panels'
import { panelsLexical } from '@boostkit/panels-lexical/server'
import { adminPanel } from 'App/Panels/Admin/AdminPanel.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
    this.app.singleton(GreetingService, () => new GreetingService())
  }

  async boot(): Promise<void> {
    // Dynamically register module providers — each module is self-contained
    // and brings its own routes, services, and bindings.
    await this.app.register(panels([adminPanel], [panelsLexical()]))
    await this.app.register(TodoServiceProvider)

    console.log(`[AppServiceProvider] booted — app: ${this.app.name}`)
  }
}
