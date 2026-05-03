import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'

export class Video extends Model {
  static table = 'video'
  static fillable = ['url']

  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
  }

  id!:        number
  url!:       string
  createdAt!: Date
}
