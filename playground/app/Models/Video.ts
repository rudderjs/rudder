import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'
import { Tag } from './Tag.js'

export class Video extends Model.for<'videos'>() {
  static table = 'videos'
  static fillable = ['url']

  static override relations = {
    comments: { type: 'morphMany'   as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag,     pivotTable: 'taggables', morphName: 'taggable' },
  }
}
