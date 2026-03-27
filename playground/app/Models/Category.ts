import { Model } from '@boostkit/orm'

export class Category extends Model {
  static table = 'category'

  id!:        string
  name!:      string
  slug!:      string
  icon!:      string | null
  position!:  number
  parentId!:  string | null
  createdAt!: Date
  updatedAt!: Date
}
