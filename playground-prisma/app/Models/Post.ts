import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'
import { Tag } from './Tag.js'

export class Post extends Model {
  static table = 'post'
  static fillable = ['title']

  static override relations = {
    comments: { type: 'morphMany'   as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag,     pivotTable: 'taggable', morphName: 'taggable' },
  }

  id!:        number
  title!:     string
  createdAt!: Date
}
