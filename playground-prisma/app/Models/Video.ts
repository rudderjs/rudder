import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'
import { Tag } from './Tag.js'

export class Video extends Model {
  static table = 'video'
  static fillable = ['url']

  static override relations = {
    comments: { type: 'morphMany'   as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag,     pivotTable: 'taggable', morphName: 'taggable' },
  }

  id!:        number
  url!:       string
  createdAt!: Date
}
