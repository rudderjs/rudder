/**
 * Base class for database seeders. Subclass and implement `run()`.
 *
 * @example
 * ```ts
 * import { Seeder } from '@rudderjs/orm'
 * import { UserSeeder } from './UserSeeder.js'
 * import { PostSeeder } from './PostSeeder.js'
 *
 * export default class DatabaseSeeder extends Seeder {
 *   async run(): Promise<void> {
 *     await this.call(UserSeeder)
 *     await this.call(PostSeeder)
 *   }
 * }
 * ```
 */
export abstract class Seeder {
  abstract run(): void | Promise<void>

  /** Invoke another seeder from this one. Accepts a single class or an array. */
  protected async call(SeederClass: SeederConstructor | SeederConstructor[]): Promise<void> {
    const classes = Array.isArray(SeederClass) ? SeederClass : [SeederClass]
    for (const Cls of classes) {
      const seeder = new Cls()
      await seeder.run()
    }
  }
}

export type SeederConstructor = new () => Seeder
