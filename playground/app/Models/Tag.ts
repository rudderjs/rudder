import { Model } from '@rudderjs/orm'
import { Post } from './Post.js'
import { Video } from './Video.js'

export class Tag extends Model {
  static table = 'tag'
  static fillable = ['name']

  static override relations = {
    posts: {
      type:       'morphedByMany' as const,
      model:      () => Post,
      pivotTable: 'taggable',
      morphName:  'taggable',
    },
    videos: {
      type:       'morphedByMany' as const,
      model:      () => Video,
      pivotTable: 'taggable',
      morphName:  'taggable',
    },
  }

  id!:   number
  name!: string
}
