import { Migration, Schema } from '@rudderjs/orm/native'

// Backing table for the self-contained Todo module (app/Modules/Todo).
export default class extends Migration {
  async up() {
    await Schema.create('todos', (t) => {
      t.id()
      t.string('title')
      t.boolean('completed').default(false)
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('todos')
  }
}
