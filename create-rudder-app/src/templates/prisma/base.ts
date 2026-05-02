import type { TemplateContext } from '../../templates.js'

export function prismaBase(ctx: TemplateContext): string {
  const provider = ctx.db === 'sqlite' ? 'sqlite'
    : ctx.db === 'postgresql' ? 'postgresql'
    : 'mysql'

  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
}
`
}
