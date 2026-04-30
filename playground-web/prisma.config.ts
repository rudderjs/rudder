import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./prisma/dev.db',
  },
})
