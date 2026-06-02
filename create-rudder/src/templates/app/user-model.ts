export function userModel(orm: 'prisma' | 'drizzle' | 'native' | false): string {
  // The native engine queries the real SQL table name and uses an integer
  // auto-increment primary key (`t.id()` in the migration). Prisma/Drizzle map a
  // string id through their own schema, and `static table` is the delegate /
  // registry key — not the SQL table name.
  if (orm === 'native') {
    return `import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'users'

  id!:              number
  name!:            string
  email!:           string
  password?:        string | null
  emailVerifiedAt!: Date | null
  role!:            string
  createdAt!:       Date
  updatedAt!:       Date
}
`
  }

  return `import { Model } from '@rudderjs/orm'

export class User extends Model {
  // Prisma accessor is the model name lowercased
  static table = 'user'

  id!:            string
  name!:          string
  email!:         string
  password?:        string | null
  emailVerifiedAt!: Date | null
  role!:            string
  createdAt!:     Date
  updatedAt!:     Date
}
`
}
