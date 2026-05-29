import { ServiceProvider, bootLine } from '@rudderjs/core'
import { Mcp } from '@rudderjs/mcp'
import { Feature, Lottery } from '@rudderjs/pennant'
import { UserService } from 'App/Services/UserService.js'
import { GreetingService } from 'App/Services/GreetingService.js'
import { TodoServiceProvider } from 'App/Modules/Todo/TodoServiceProvider.js'
import { EchoServer } from 'App/Mcp/EchoServer.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
    this.app.singleton(GreetingService, () => new GreetingService())

    Mcp.web('/mcp/echo', EchoServer)
    Mcp.web('/mcp/secure', EchoServer).oauth2({
      scopes: ['mcp.read'],
      scopesSupported: ['mcp.read', 'mcp.write'],
    })
  }

  async boot(): Promise<void> {
    // `panels(...)` and `AiServiceProvider` were hoisted to bootstrap/
    // providers.ts so the framework's natural register-then-boot phasing
    // handles ordering: AiServiceProvider.register() seeds the AI action
    // catalogue before panels.boot() iterates resources and resolves
    // Field.ai([...]). See providers.ts for the full ordering rationale.

    await this.app.register(TodoServiceProvider)

    Feature.define('dark-mode',      () => true)
    Feature.define('max-uploads',    () => 10)
    Feature.define('beta-dashboard', (scope) => typeof scope === 'object' && scope !== null)
    Feature.define('new-checkout',   () => Lottery.odds(1, 4))

    bootLine(`[AppServiceProvider] booted — app: ${this.app.name}`)
  }
}
