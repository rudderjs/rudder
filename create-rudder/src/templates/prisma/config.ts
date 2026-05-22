import type { TemplateContext } from '../../templates.js'

export function prismaConfig(ctx: TemplateContext): string {
  const dbUrl = ctx.db === 'sqlite'
    ? "process.env['DATABASE_URL'] ?? 'file:./dev.db'"
    : "process.env['DATABASE_URL']!"

  return `import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: ${dbUrl},
  },
})
`
}
