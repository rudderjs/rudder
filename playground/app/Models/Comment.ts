import { Model } from '@rudderjs/orm'
import { Post } from './Post.js'
import { Video } from './Video.js'

export class Comment extends Model {
  static table = 'comment'
  static fillable = ['body', 'commentableId', 'commentableType']

  static override relations = {
    commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post, Video] },
  }

  id!:              number
  body!:            string
  commentableId!:   number
  commentableType!: string
  createdAt!:       Date
}
