# Deployment

RudderJS apps use `vike-photon` to wire `bootstrap/app.ts` as the HTTP server, making them deployable to any runtime that supports the Fetch API — Node.js, Cloudflare Workers, Bun, or Deno.

## Entry Point

`bootstrap/app.ts` is the entry point. It exports the `RudderJS` instance, which `vike-photon` uses as the HTTP server:

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
// ...

export default Application.configure({ ... }).create()
```

```ts
// pages/+config.ts
import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'

export default {
  extends: [vikePhoton],
  photon: { server: 'bootstrap/app.ts' },
} as unknown as Config
```

`forge.handleRequest`:
- Lazily bootstraps providers on the first request
- Handles requests via the Hono adapter
- Returns a standard `Response`

## Node.js

RudderJS runs natively on Node.js 18+. The Hono adapter starts a Node.js HTTP server automatically.

### Production build

```bash
pnpm build       # Compile TypeScript → dist/
```

### Start the server

```bash
node dist/server/index.mjs
```

### Environment Variables

Never commit `.env` to production. Use your hosting provider's environment variable management or a secrets manager:

```bash
export DATABASE_URL="postgres://user:pass@host:5432/db"
export AUTH_SECRET="your-32-char-secret"
export NODE_ENV="production"
```

### PM2 (Process Manager)

For persistent Node.js processes:

```bash
pnpm add -g pm2

pm2 start dist/server/index.mjs --name rudderjs-app
pm2 save
pm2 startup   # Configure auto-start on reboot
```

`ecosystem.config.js`:

```js
module.exports = {
  apps: [{
    name:       'rudderjs-app',
    script:     'dist/server/index.mjs',
    env_production: {
      NODE_ENV:     'production',
      PORT:         '3000',
    },
  }],
}
```

## Docker

### `Dockerfile`

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy source and build
COPY . .
RUN pnpm build

# Generate Prisma client
RUN pnpm exec prisma generate

EXPOSE 3000

CMD ["node", "dist/server/index.mjs"]
```

### `docker-compose.yml`

```yaml
version: '3.9'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV:     production
      DATABASE_URL: postgres://rudderjs:secret@db:5432/rudderjs
      AUTH_SECRET:  your-32-char-secret-here
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER:     rudderjs
      POSTGRES_PASSWORD: secret
      POSTGRES_DB:       rudderjs
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Build and run:

```bash
docker compose up -d
docker compose exec app pnpm exec prisma migrate deploy
```

### Multi-stage build (smaller image)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
RUN pnpm exec prisma generate
EXPOSE 3000
CMD ["node", "dist/server/index.mjs"]
```

## Cloudflare Workers

RudderJS's WinterCG-compatible entry point works on Cloudflare Workers.

### Prerequisites

```bash
pnpm add -D wrangler
```

### `wrangler.toml`

```toml
name       = "my-rudderjs-app"
main       = "dist/server/index.mjs"
compatibility_date = "2024-01-01"

[vars]
APP_ENV = "production"

[[d1_databases]]
binding  = "DB"
database_name = "my-app-db"
database_id   = "your-d1-database-id"
```

### Notes for Workers

- Use **D1** (Cloudflare's SQLite) instead of local SQLite
- Use **KV** or **Hyperdrive** for Redis-like caching
- `process.env` is not available — use `env` from the Fetch handler context
- Session storage must be edge-compatible (no `fs`-based adapters)

### Deploy

```bash
pnpm wrangler deploy
```

## Railway / Render / Fly.io

These platforms can deploy directly from a `Dockerfile` or by detecting Node.js.

### Railway

1. Connect your GitHub repo
2. Set environment variables in the Railway dashboard
3. Railway auto-detects `pnpm build` and runs it
4. Set the start command: `node dist/server/index.mjs`

### Render

1. Create a new Web Service
2. Build command: `pnpm install && pnpm build`
3. Start command: `node dist/server/index.mjs`
4. Add environment variables in Render's dashboard

### Fly.io

```bash
fly launch
fly secrets set DATABASE_URL="postgres://..."
fly secrets set AUTH_SECRET="..."
fly deploy
```

## Database Migrations in Production

Never use `prisma db push` in production — it may data-destructively sync the schema. Use migrations:

```bash
# Create a migration (in dev)
pnpm exec prisma migrate dev --name add_user_roles

# Apply all pending migrations (in CI/CD or on deploy)
pnpm exec prisma migrate deploy
```

In Docker/CI, run migrations as a separate step before starting the app:

```bash
pnpm exec prisma migrate deploy && node dist/server/index.mjs
```

## Production Checklist

- `NODE_ENV=production` is set
- `AUTH_SECRET` is at least 32 random characters
- `DATABASE_URL` points to a production database (PostgreSQL recommended)
- `APP_URL` is set to your production domain
- `TRUST_PROXY=true` if behind a reverse proxy (Nginx, Cloudflare, Railway)
- Prisma migrations are applied before starting the app
- `CORS_ORIGIN` is set to your frontend domain (not `*`)
- Log driver is set to `smtp` or a real mailer (not `log`)
- Queue driver is set to `bullmq` or `inngest` (not `sync`)
