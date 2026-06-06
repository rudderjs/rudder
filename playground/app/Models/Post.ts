import { Model } from '@rudderjs/orm'
import { Comment } from './Comment.js'
import { Tag } from './Tag.js'

// Model.for<'posts'>() binds the generated registry types — id/title/createdAt
// come from app/Models/__schema/registry.d.ts (regenerated on every migrate),
// so the fields can't drift from the schema. No hand-declared columns.
export class Post extends Model.for<'posts'>() {
  static table = 'posts'
  static fillable = ['title']

  static override relations = {
    comments: { type: 'morphMany'   as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag,     pivotTable: 'taggables', morphName: 'taggable' },
  }
}
