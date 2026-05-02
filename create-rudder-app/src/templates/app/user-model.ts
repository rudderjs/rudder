export function userModel(): string {
  return `import { Model } from '@rudderjs/orm'

export class User extends Model {
  // Prisma accessor is the model name lowercased
  static table = 'user'

  id!:            string
  name!:          string
  email!:         string
  password?:      string | null
  emailVerified!: boolean
  role!:          string
  createdAt!:     Date
  updatedAt!:     Date
}
`
}
