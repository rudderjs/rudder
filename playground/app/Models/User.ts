import { Model } from '@rudderjs/orm'
import { HasApiTokens } from '@rudderjs/passport'

export class User extends HasApiTokens(Model) {
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
