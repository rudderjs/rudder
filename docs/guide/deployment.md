# Deployment

Rudder exposes a standard WinterCG Fetch handler — the same `bootstrap/app.ts` runs on Node, Bun, Deno, and Cloudflare Workers without code changes. This page covers the common production targets.

## Build

```bash
pnpm build
```

Output:

```
dist/
├── client/          # static assets — JS, CSS, images
├── server/
│   └── index.mjs    # Node.js server entry
└── assets.json      # asset manifest
```

Run with `node ./dist/server/index.mjs`. The server binds to `PORT` (default `3000`).

## Environment

Configure secrets via `.env` (committed `.env.example`, secrets injected at deploy time):

```dotenv
APP_NAME=MyApp
APP_ENV=production
APP_DEBUG=false
APP_URL=https://myapp.com
APP_KEY=<32-byte base64 secret>
PORT=3000

DATABASE_URL=postgresql://user:pass@host:5432/mydb
AUTH_SECRET=<32-byte secret>
REDIS_URL=redis://localhost:6379
```

Generate `APP_KEY` and `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Validate critical envs at startup with `defineEnv` (see [Configuration](/guide/configuration)) so misconfigured deploys fail fast instead of throwing on first request.

## Database migrations

Run migrations as part of your deploy, before the server starts:

```bash
pnpm rudder migrate     # Prisma → migrate deploy; Drizzle → drizzle-kit migrate
pnpm rudder db:seed     # optional, only on first deploy
```

Never run `db:push` or `migrate:fresh` in production — both can drop columns silently.

## Process supervision

The Node process must stay up. The two production patterns:

### PM2 (single host)

```bash
npm install -g pm2

pm2 start dist/server/index.mjs --name myapp --max-memory-restart 500M
pm2 save && pm2 startup     # auto-start on boot
```

For schedulers, run them as a separate PM2 app: `pm2 start dist/server/index.mjs --name scheduler -- pnpm rudder schedule:work`.

> **Fork mode, not cluster.** The command above runs a single fork-mode process — keep it that way. Do **not** start the server entry in PM2 **cluster** mode (`-i` / `--instances` / `exec_mode: cluster`): PM2's cluster wrapper doesn't execute the ESM `dist/server/index.mjs` entry, so workers report `online` but never bind the port — you get empty logs and refused connections, with no error. For graceful zero-downtime reloads, either front several fork instances with your proxy, or wrap the entry in a tiny CommonJS shim (`server.cjs` → `await import('./dist/server/index.mjs')`) that PM2 *can* cluster.

### systemd

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=MyApp
After=network.target

[Service]
Type=simple
User=myapp
WorkingDirectory=/var/www/myapp
EnvironmentFile=/var/www/myapp/.env
ExecStart=/usr/bin/node /var/www/myapp/dist/server/index.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now myapp
```

## Workers and schedulers

Background work runs as separate processes. Always run them under the same supervisor as your web server:

| Process | Command |
|---|---|
| Web | `node dist/server/index.mjs` |
| Queue worker | `pnpm rudder queue:work` |
| Scheduler | `pnpm rudder schedule:work` |

For BullMQ, run multiple `queue:work` instances per CPU core. For Inngest, the worker is the Inngest service itself — no separate process needed; expose `/api/inngest` as a public route.

## Docker

```dockerfile
# Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server/index.mjs"]
```

Multi-stage keeps the final image small. For Prisma, also copy `prisma/` and run `prisma generate` in the build stage.

## Reverse proxy

Most production setups put nginx (or your platform's equivalent) in front of the Node process — for TLS termination, static-asset caching, rate limiting, and graceful restarts.

```nginx
upstream myapp { server 127.0.0.1:3000; }

server {
  listen 443 ssl http2;
  server_name myapp.com;

  ssl_certificate     /etc/letsencrypt/live/myapp.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/myapp.com/privkey.pem;

  location / {
    proxy_pass http://myapp;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `TRUST_PROXY=true` in `.env` so `req.ip` reads `x-forwarded-for` correctly. The WebSocket-upgrade headers are required for `@rudderjs/broadcast` and `@rudderjs/sync`.

## Laravel Forge

Forge is a popular choice in the Laravel ecosystem and works well for Rudder — it provisions the VPS, manages PM2 + nginx, handles SSL via Let's Encrypt, and exposes a one-click deploy from GitHub. Because Rudder is a Node SSR app, the setup leans on Forge's PM2-based site types rather than the PHP defaults.

**Site type:** pick **Next.js** when creating the site. It's the closest preset — both run a long-running Node process behind nginx — but you'll override the deploy script and start command. None of Next's actual runtime is involved.

**PM2 config — commit it as a file, don't generate it inline.** Forge's web deploy-script editor is brittle: heredocs whose terminator gets indented break silently (the rest of the script gets swallowed into the file), and long single lines get wrapped onto two lines, producing `syntax error` or `missing operand` failures at the activate step. The robust pattern is to commit a `pm2.config.json` at the repo root and have the deploy script just reference it.

```json
{
  "name":      "myapp",
  "cwd":       "/home/forge/myapp.com/current",
  "script":    "./dist/server/index.mjs",
  "instances": 1,
  "exec_mode": "fork",
  "max_memory_restart": "500M"
}
```

**Deploy script.** Replace Forge's auto-generated `$ACTIVATE_RELEASE()` block with three short lines that read the config from the repo via the `current` symlink:

```bash
$CREATE_RELEASE()

cd $FORGE_RELEASE_DIRECTORY

pnpm install --frozen-lockfile || pnpm install
pnpm build

$ACTIVATE_RELEASE()

CONFIG=/home/forge/myapp.com/current/pm2.config.json
pm2 start "$CONFIG" || pm2 reload myapp --update-env
pm2 save
```

Each line stays under ~60 characters — short enough that Forge's editor can't wrap it into a syntax error. PM2 picks up new code on every deploy because `reload` re-points at `current/dist/server/index.mjs` through the symlink.

**pnpm build approval (pnpm 10+).** pnpm refuses to run a dependency's build scripts unless they're allow-listed — and on **pnpm 11 this is a fatal `ERR_PNPM_IGNORED_BUILDS`**, not a warning. Native deps a Rudder app commonly pulls in (`esbuild`, `better-sqlite3`) need approval in `pnpm-workspace.yaml`:

```yaml
# pnpm 11
allowBuilds:
  esbuild: true
  better-sqlite3: true
# pnpm 10 (back-compat)
onlyBuiltDependencies:
  - esbuild
  - better-sqlite3
```

pnpm 11 ignores `pnpm.onlyBuiltDependencies` in `package.json` — it must live in `pnpm-workspace.yaml`. pnpm 11 also enforces **`minimumReleaseAge`**: it rejects dependencies published in the last ~24h (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). If you regenerate the lockfile the same day a dependency publishes, set `minimumReleaseAge: 2880` (48h) and re-resolve so the lock pins slightly-older versions. Check the **server's** pnpm version (`pnpm --version`) before debugging install failures — pnpm 10 and 11 differ enough that a fix verified against the wrong major won't hold on deploy.

**Env vars** (Forge → Site → Environment):

```
APP_URL=https://myapp.com
APP_ENV=production
PORT=3000
TRUST_PROXY=true
```

`TRUST_PROXY=true` is required whenever Forge sits behind another proxy (Cloudflare, AWS ALB, anything that rewrites `X-Forwarded-For`) — without it `req.ip` reads the upstream proxy IP instead of the real client.

**Health check.** Forge → Site → Health Checks → point at `https://myapp.com/healthz` (or the on-forge.com staging URL). Forge pings post-deploy and marks the deploy failed if it doesn't return 2xx — catches the "build succeeded but the process crashed on startup" class of bugs.

**Cloudflare in front of Forge** is a common combo. Use a Cloudflare **Origin Certificate** installed on Forge (15-year, set-and-forget) with Cloudflare SSL mode **Full (strict)**. Drops the Let's Encrypt renewal cycle and gets you CDN + DDoS protection at the edge for free.

## Edge runtimes

The same `app.fetch` handler runs on Cloudflare Workers, Deno Deploy, and Bun. Some considerations:

- **Cloudflare Workers** — no long-running processes. Queue with Inngest, schedule with platform crons. Native modules (argon2, better-sqlite3) don't load — use bcrypt and a remote database.
- **Bun** — full Node compatibility for most packages. Run with `bun run dist/server/index.mjs`.
- **Deno Deploy** — needs `--allow-net --allow-read --allow-env`. Native modules require `--allow-ffi`.

For each, the deploy command is the platform's standard tooling; the application code is unchanged.

## Health and readiness

Add a route that confirms upstream services are reachable:

```ts
Route.get('/healthz', async (_req, res) => {
  await app().make<PrismaClient>('prisma').$queryRaw`SELECT 1`
  return res.json({ ok: true })
})
```

Most platforms (Kubernetes, Cloud Run, Fly.io) hit this endpoint before routing traffic. A 200 means the new instance is ready; anything else triggers a rollback.

## Pitfalls

- **`pnpm build` skipped.** Running `tsx` in production works but starts cold every request. Always build first.
- **Forgetting `pnpm rudder providers:discover`.** The provider manifest must exist at boot. The build doesn't generate it — add it to your deploy script before `pnpm build`.
- **`APP_DEBUG=true` shipping to production.** Stack traces leak path and dependency info. Hard-set `APP_DEBUG=false` in production environments.
- **Single instance for everything.** Run web, queue worker, and scheduler as separate supervised processes. Bundling them in one process means a queue spike degrades request handling.
- **No reverse proxy.** Node serves TLS poorly compared to nginx, and you lose static-asset caching. Even on edge platforms, the platform itself is the proxy.
- **PM2 cluster mode with the ESM entry.** Workers go `online` but never listen (empty logs, refused connections). Use fork mode — see [Process supervision](#pm2-single-host).
- **pnpm build scripts blocked.** pnpm won't run native postinstalls (`esbuild`, `better-sqlite3`) without an allow-list; pnpm 11 makes it fatal. Add `allowBuilds` (pnpm 11) / `onlyBuiltDependencies` (pnpm 10) to `pnpm-workspace.yaml` — see [Laravel Forge](#laravel-forge).
