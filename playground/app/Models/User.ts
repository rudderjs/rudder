import { Model } from '@boostkit/core'

export class User extends Model {
  // Prisma accessor is the model name lowercased
  static table = 'user'

  id!:        string
  name!:      string
  email!:     string
  role!:      string
  createdAt!: Date
  updatedAt!: Date
}
