import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'

export class Post extends Model {
  static table = 'post'
  static fillable = ['title']

  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
  }

  id!:        number
  title!:     string
  createdAt!: Date
}
