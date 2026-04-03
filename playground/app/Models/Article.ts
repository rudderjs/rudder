import { Model } from '@rudderjs/orm'

export class Article extends Model {
  static table = 'article'

  id!:              string
  title!:           string
  slug!:            string
  excerpt!:         string | null
  coverImage!:      string | null
  tags!:            string          // JSON-encoded string[]
  status!:          string
  featured!:        boolean
  publishedAt!:     Date | null
  accentColor!:     string | null
  metaTitle!:       string | null
  metaDescription!: string | null
  content!:         unknown | null
  body!:            unknown | null
  metadata!:        string | null
  categories?:      Array<{ id: string; name: string; slug: string }>
  createdAt!:       Date
  updatedAt!:       Date
}
