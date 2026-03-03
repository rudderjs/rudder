import { ServiceProvider } from '@boostkit/core'
import { ModelRegistry } from '@boostkit/orm'
import { prisma } from '@boostkit/orm-prisma'

export class DatabaseServiceProvider extends ServiceProvider {
  register(): void {
    // Bindings that depend on the DB connection are registered in boot()
  }

  async boot(): Promise<void> {
    const adapter = await prisma().create()
    await adapter.connect()

    // Make the adapter available globally for Model.query() calls
    ModelRegistry.set(adapter)

    // Also bind into the container for explicit injection
    this.app.instance('db', adapter)

    console.log('[DatabaseServiceProvider] booted — connected to database')
  }
}
