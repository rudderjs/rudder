import type { TemplateContext } from '../templates.js'

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

export function gitattributes(): string {
  // Generated registries + Vike page stubs are committed (see the
  // "Generated files" docs) — mark them linguist-generated so GitHub
  // collapses them in PR diffs and skips them in language stats.
  return `pages/__view/** linguist-generated=true
routes/__registry.d.ts linguist-generated=true
app/Models/__schema/registry.d.ts linguist-generated=true
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

export function pnpmWorkspace(): string {
  // pnpm 10+ blocks dependency build/postinstall scripts by default. Without
  // this, the SQLite native binding (better-sqlite3), the Prisma engine and
  // esbuild never build, so `db:generate`/`db:push`/`dev` fail with
  // ERR_PNPM_IGNORED_BUILDS. A scaffolded app's dependencies are all
  // framework-curated, and npm/yarn run every postinstall by default anyway, so
  // we opt in to running them here. (pnpm 11 no longer honors an
  // `onlyBuiltDependencies` allowlist for a standalone, non-workspace app, and
  // ignores `package.json#pnpm` entirely — `dangerouslyAllowAllBuilds` is the
  // setting that works on both pnpm 10 and 11. Tighten it if you prefer to vet
  // each dependency with `pnpm approve-builds`.)
  return [
    '# Standalone project — prevents pnpm from merging with a parent workspace',
    'packages: []',
    '',
    '# Run dependency build scripts (pnpm blocks them by default; see note above)',
    'dangerouslyAllowAllBuilds: true',
    '',
  ].join('\n')
}
