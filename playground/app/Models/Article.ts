import { Model } from '@boostkit/orm'

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
  metadata!:        string | null
  createdAt!:       Date
  updatedAt!:       Date
}
