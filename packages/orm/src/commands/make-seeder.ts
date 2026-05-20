import type { MakeSpec } from '@rudderjs/console'

/**
 * `pnpm rudder make:seeder Users` → `database/seeders/UsersSeeder.ts`
 *
 * Stub matches the real `Seeder` abstract-class shape (see
 * `packages/orm/src/seeder.ts`): subclass + `async run()` body. The
 * `Seeder.call(OtherSeeder)` helper is shown commented so a top-level
 * `DatabaseSeeder` can compose child seeders without hunting the docs.
 *
 * Directory: `database/seeders/` (project root, not `app/`) — matches
 * Laravel's convention. The orm's `db:seed` runner already discovers
 * `database/seeders/DatabaseSeeder.{ts,js,mts,mjs}` (see
 * `findSeederFile()` in `packages/orm/src/commands/migrate.ts`).
 */
export const makeSeederSpec: MakeSpec = {
  command:     'make:seeder',
  description: 'Create a new database seeder class',
  label:       'Seeder created',
  suffix:      'Seeder',
  directory:   'database/seeders',
  stub: (className) => {
    // `UsersSeeder` → `Users`. Useful as a hint for the example body's
    // factory import — the user picks the actual model + factory names.
    const subject = className.replace(/Seeder$/, '')
    return `import { Seeder } from '@rudderjs/orm'
// import { ${subject}Factory } from 'App/Factories/${subject}Factory.js'

export class ${className} extends Seeder {
  async run(): Promise<void> {
    // Replace with your seed logic — e.g.
    // await ${subject}Factory.new().create(10)

    // Or compose other seeders from a top-level DatabaseSeeder:
    // await this.call(${subject}Seeder)
  }
}
`
  },
}
