import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'user'
  static hidden = ['password', 'rememberToken']

  id!:            string
  name!:          string
  email!:         string
  password!:      string | null
  role!:          string
  rememberToken!: string | null
  createdAt!:     Date
  updatedAt!:     Date
}
