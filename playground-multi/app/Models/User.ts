import { Model } from '@boostkit/orm'

export class User extends Model {
  // Prisma accessor is the model name lowercased
  static table = 'user'

  id!:            string
  name!:          string
  email!:         string
  emailVerified!: boolean
  role!:          string
  createdAt!:     Date
  updatedAt!:     Date
}
