import { Model } from '@rudderjs/orm'
import { Post } from './Post.js'
import { Video } from './Video.js'

export class Tag extends Model.for<'tags'>() {
  static table = 'tags'
  static fillable = ['name']

  static override relations = {
    posts: {
      type:       'morphedByMany' as const,
      model:      () => Post,
      pivotTable: 'taggables',
      morphName:  'taggable',
    },
    videos: {
      type:       'morphedByMany' as const,
      model:      () => Video,
      pivotTable: 'taggables',
      morphName:  'taggable',
    },
  }
}
