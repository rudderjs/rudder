import type { TemplateContext } from '../../templates.js'

export function configIndex(ctx: TemplateContext): string {
  const imports: string[] = [
    "import app      from './app.js'",
    "import server   from './server.js'",
    "import log      from './log.js'",
  ]
  const keys: string[] = ['app', 'server', 'log']

  if (ctx.orm) {
    imports.push("import database from './database.js'")
    keys.push('database')
  }
  if (ctx.packages.auth) {
    imports.push("import auth     from './auth.js'")
    imports.push("import session  from './session.js'")
    imports.push("import hash     from './hash.js'")
    keys.push('auth', 'session', 'hash')
  }
  if (ctx.packages.queue) {
    imports.push("import queue    from './queue.js'")
    keys.push('queue')
  }
  if (ctx.packages.mail) {
    imports.push("import mail     from './mail.js'")
    keys.push('mail')
  }
  if (ctx.packages.cache) {
    imports.push("import cache    from './cache.js'")
    keys.push('cache')
  }
  if (ctx.packages.storage) {
    imports.push("import storage  from './storage.js'")
    keys.push('storage')
  }
  if (ctx.packages.ai) {
    imports.push("import ai       from './ai.js'")
    keys.push('ai')
  }
  if (ctx.packages.sync) {
    imports.push("import sync     from './sync.js'")
    keys.push('sync')
  }
  if (ctx.packages.passport) {
    imports.push("import passport from './passport.js'")
    keys.push('passport')
  }
  if (ctx.packages.localization) {
    imports.push("import localization from './localization.js'")
    keys.push('localization')
  }
  if (ctx.packages.telescope) {
    imports.push("import telescope from './telescope.js'")
    keys.push('telescope')
  }
  return `${imports.join('\n')}

const configs = { ${keys.join(', ')} }

export type Configs = typeof configs

export default configs
`
}

function envDts(): string {
  return `import type { Configs } from './config/index.js'

declare module '@rudderjs/core' {
  interface AppConfig extends Configs {}
}
`
}

