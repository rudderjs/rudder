import { Migration, Schema } from '@rudderjs/orm/native'

// ORM demo tables — polymorphic relations (posts/videos ← comments) and a
// polymorphic many-to-many (tags ↔ posts/videos through taggables).
export default class extends Migration {
  async up() {
    await Schema.create('posts', (t) => {
      t.id()
      t.string('title')
      t.dateTime('createdAt').useCurrent()
    })

    await Schema.create('videos', (t) => {
      t.id()
      t.string('url')
      t.dateTime('createdAt').useCurrent()
    })

    await Schema.create('comments', (t) => {
      t.id()
      t.text('body')
      t.integer('commentableId')
      t.string('commentableType')
      t.dateTime('createdAt').useCurrent()
      t.index(['commentableType', 'commentableId'])
    })

    await Schema.create('tags', (t) => {
      t.id()
      t.string('name').unique()
    })

    await Schema.create('taggables', (t) => {
      t.integer('tagId')
      t.integer('taggableId')
      t.string('taggableType')
      t.index(['taggableType', 'taggableId'])
    })
  }

  async down() {
    await Schema.dropIfExists('taggables')
    await Schema.dropIfExists('tags')
    await Schema.dropIfExists('comments')
    await Schema.dropIfExists('videos')
    await Schema.dropIfExists('posts')
  }
}
