import type { TemplateContext } from '../templates.js'
import { builtDependencies } from './package-json.js'

export function dotenv(ctx: TemplateContext): string {
  const lines = [
    `APP_NAME=${ctx.name}`,
    'APP_ENV=development',
    'APP_DEBUG=true',
    'APP_URL=http://localhost:3000',
    '',
    'PORT=3000',
  ]

  if (ctx.orm) {
    lines.push('')
    if (ctx.db === 'sqlite') lines.push('DATABASE_URL="file:./dev.db"')
    else if (ctx.db === 'postgresql') lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"')
    else lines.push('DATABASE_URL="mysql://user:password@localhost:3306/mydb"')
  }

  if (ctx.packages.auth) {
    lines.push('')
    lines.push(`AUTH_SECRET=${ctx.authSecret}`)
  }

  if (ctx.packages.crypt) {
    lines.push('')
    lines.push(`APP_KEY=base64:${ctx.appKey}`)
  }

  if (ctx.packages.ai) {
    lines.push('')
    lines.push('AI_MODEL=anthropic/claude-sonnet-4-5')
    lines.push('ANTHROPIC_API_KEY=')
    lines.push('# OPENAI_API_KEY=')
    lines.push('# GOOGLE_AI_API_KEY=')
    lines.push('# OLLAMA_BASE_URL=http://localhost:11434')
  }

  if (ctx.packages.socialite) {
    lines.push('')
    lines.push('GITHUB_CLIENT_ID=')
    lines.push('GITHUB_CLIENT_SECRET=')
    lines.push('GITHUB_REDIRECT_URL=http://localhost:3000/auth/github/callback')
    lines.push('GOOGLE_CLIENT_ID=')
    lines.push('GOOGLE_CLIENT_SECRET=')
    lines.push('GOOGLE_REDIRECT_URL=http://localhost:3000/auth/google/callback')
  }

  return lines.join('\n') + '\n'
}

export function dotenvExample(ctx: TemplateContext): string {
  const lines = [
    `APP_NAME=${ctx.name}`,
    'APP_ENV=development',
    'APP_DEBUG=false',
    'APP_URL=http://localhost:3000',
    '',
    'PORT=3000',
  ]

  if (ctx.orm) {
    lines.push('')
    if (ctx.db === 'sqlite') lines.push('DATABASE_URL="file:./dev.db"')
    else if (ctx.db === 'postgresql') lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"')
    else lines.push('DATABASE_URL="mysql://user:password@localhost:3306/mydb"')
  }

  if (ctx.packages.auth) {
    lines.push('')
    lines.push('AUTH_SECRET=please-set-a-real-32-char-secret-here')
  }

  if (ctx.packages.crypt) {
    lines.push('')
    lines.push('# Generate with: pnpm rudder key:generate')
    lines.push('APP_KEY=')
  }

  if (ctx.packages.ai) {
    lines.push('')
    lines.push('AI_MODEL=anthropic/claude-sonnet-4-5')
    lines.push('ANTHROPIC_API_KEY=')
    lines.push('# OPENAI_API_KEY=')
    lines.push('# GOOGLE_AI_API_KEY=')
    lines.push('# OLLAMA_BASE_URL=http://localhost:11434')
  }

  if (ctx.packages.socialite) {
    lines.push('')
    lines.push('GITHUB_CLIENT_ID=')
    lines.push('GITHUB_CLIENT_SECRET=')
    lines.push('GITHUB_REDIRECT_URL=http://localhost:3000/auth/github/callback')
    lines.push('GOOGLE_CLIENT_ID=')
    lines.push('GOOGLE_CLIENT_SECRET=')
    lines.push('GOOGLE_REDIRECT_URL=http://localhost:3000/auth/google/callback')
  }

  return lines.join('\n') + '\n'
}

export function envDts(): string {
  return `import type { Configs } from './config/index.js'

declare module '@rudderjs/core' {
  interface AppConfig extends Configs {}
}
`
}

export function gitignore(): string {
  return `node_modules/
dist/
.env
*.db
*.db-journal
prisma/generated/
bootstrap/cache/
`
}

export function pnpmWorkspace(ctx: TemplateContext): string {
  // pnpm 10+ blocks dependency build scripts by default. pnpm 11 reads the
  // `onlyBuiltDependencies` allowlist from THIS file (pnpm-workspace.yaml), NOT
  // from package.json#pnpm — and because this file exists (we generate it to
  // stop pnpm merging the app into a parent workspace), the package.json
  // allowlist is ignored on pnpm 11. So the allowlist must live here too, or the
  // SQLite native binding / Prisma engine never builds and `db:generate` fails.
  const allow = builtDependencies(ctx)
    .map(d => `  - ${d.startsWith('@') ? `'${d}'` : d}`)
    .join('\n')
  return [
    '# Standalone project — prevents pnpm from merging with a parent workspace',
    'packages: []',
    '',
    '# Allow these dependencies to run install/build scripts (pnpm blocks them by',
    '# default). Mirrors package.json#pnpm.onlyBuiltDependencies; pnpm 11 reads',
    '# the allowlist from here, not package.json.',
    'onlyBuiltDependencies:',
    allow,
    '',
  ].join('\n')
}
