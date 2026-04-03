import { Model } from '@rudderjs/orm'

export class Workspace extends Model {
  static table = 'workspace'

  id!:          string
  name!:        string
  description!: string | null
  nodes!:       string
  createdAt!:   Date
  updatedAt!:   Date
}
