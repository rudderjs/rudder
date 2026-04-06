# Deployment

RudderJS apps compile to a standard Node.js server. Build once, deploy anywhere Node.js runs.

## Build for Production

```bash
pnpm build
```

This creates a `dist/` directory with:

```
dist/
├── client/          # Static assets (JS, CSS, images)
├── server/
│   ├── index.mjs    # Node.js server entry point
│   ├── chunks/      # Code-split server modules
│   └── ...
└── assets.json      # Asset manifest
```

## Run in Production

```bash
node ./dist/server/index.mjs
```

That's it. The server starts on the configured port (default `3000`).

## Environment Variables

Create a `.env` file in your project root (or set variables in your hosting platform):

```env
# App
APP_NAME=MyApp
APP_ENV=production
APP_DEBUG=false
APP_URL=https://myapp.com
APP_KEY=your-32-character-random-secret-key

# Server
PORT=3000

# Database
DATABASE_URL="postgresql://user:pass@host:5432/mydb"

# Auth
AUTH_SECRET=your-32-character-auth-secret-here

# Optional — AI
AI_MODEL=openai/gpt-4o-mini
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...

# Optional — Redis (for cache, queue, rate limiting)
REDIS_URL=redis://localhost:6379

# Optional — Storage (S3)
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# Optional — Mail (SMTP)
MAIL_HOST=smtp.mailgun.org
MAIL_PORT=587
MAIL_USERNAME=...
MAIL_PASSWORD=...
MAIL_FROM_ADDRESS=noreply@myapp.com
```

**Important:** Never commit `.env` to version control. Add it to `.gitignore`.

Generate a secure `APP_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Database

### Prisma

Run migrations before starting the server:

```bash
npx prisma migrate deploy    # Apply pending migrations
npx prisma generate          # Regenerate client (if needed)
```

For initial setup on a new server:
```bash
npx prisma migrate deploy
pnpm rudder db:seed          # Optional — seed initial data
```

### Drizzle

```bash
npx drizzle-kit migrate      # Apply migrations
```

## Process Manager

Use a process manager to keep the app running and restart on crashes.

### PM2

```bash
npm install -g pm2

# Start
pm2 start dist/server/index.mjs --name myapp

# With environment file
pm2 start dist/server/index.mjs --name myapp --env production

# Auto-restart on crash, watch memory
pm2 start dist/server/index.mjs --name myapp --max-memory-restart 500M

# Save and enable startup
pm2 save
pm2 startup
```

### Systemd (Linux)

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=MyApp
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/myapp
ExecStart=/usr/bin/node dist/server/index.mjs
Restart=on-failure
RestartSec=5
EnvironmentFile=/var/www/myapp/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable myapp
sudo systemctl start myapp
```

---

## Deploy to Cloud Providers

### Docker

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN npx prisma generate
RUN pnpm build

# Production image
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.env.production ./.env

EXPOSE 3000
CMD ["node", "dist/server/index.mjs"]
```

```bash
docker build -t myapp .
docker run -p 3000:3000 --env-file .env myapp
```

### Docker Compose

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

### Railway

1. Push your repo to GitHub
2. Create a new project on [railway.app](https://railway.app)
3. Connect your repository
4. Add a PostgreSQL database (if needed)
5. Set environment variables in the Railway dashboard
6. Railway auto-detects the build command. If not, set:
   - **Build command:** `pnpm install && npx prisma generate && pnpm build`
   - **Start command:** `node dist/server/index.mjs`

Railway sets `PORT` automatically — RudderJS reads it from the environment.

### Fly.io

```bash
fly launch
```

Create `fly.toml`:

```toml
app = "myapp"
primary_region = "iad"

[build]

[http_service]
  internal_port = 3000
  force_https = true

[env]
  APP_ENV = "production"
  NODE_ENV = "production"
```

Create a Postgres database:
```bash
fly postgres create
fly postgres attach --app myapp
```

Deploy:
```bash
fly deploy
```

### Render

1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect your GitHub repo
3. Set:
   - **Build command:** `pnpm install && npx prisma generate && pnpm build`
   - **Start command:** `node dist/server/index.mjs`
4. Add environment variables in the dashboard
5. Add a PostgreSQL database from Render's dashboard

### DigitalOcean App Platform

1. Create a new app from your GitHub repo
2. Set the run command: `node dist/server/index.mjs`
3. Add a managed PostgreSQL database
4. Set environment variables
5. Deploy

### VPS (Ubuntu/Debian)

```bash
# On your server
sudo apt update && sudo apt install -y nodejs npm nginx

# Install pnpm
npm install -g pnpm

# Clone and build
git clone https://github.com/you/myapp.git /var/www/myapp
cd /var/www/myapp
pnpm install
npx prisma generate
npx prisma migrate deploy
pnpm build

# Start with PM2
pm2 start dist/server/index.mjs --name myapp
pm2 save && pm2 startup
```

#### Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/myapp
server {
    listen 80;
    server_name myapp.com;

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Yjs WebSocket (collaborative editing)
    location /ws-live {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Everything else
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

#### SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d myapp.com
```

---

## WebSocket Considerations

RudderJS uses WebSocket for:
- **Broadcasting** (`/ws`) — real-time events, notifications
- **Live/Yjs** (`/ws-live`) — collaborative editing

### Requirements

- Your reverse proxy must support WebSocket upgrade (see Nginx config above)
- Railway, Fly.io, and Render support WebSocket out of the box
- If using a load balancer, enable sticky sessions for WebSocket connections

### Health Check

WebSocket endpoints don't respond to HTTP GET — configure health checks on `/` or a custom endpoint, not `/ws`.

---

## Queue Workers

If you use `@rudderjs/queue`, start a worker process alongside the web server:

```bash
# Web server
node dist/server/index.mjs

# Queue worker (separate process)
pnpm rudder queue:work
```

With PM2:
```bash
pm2 start dist/server/index.mjs --name web
pm2 start "pnpm rudder queue:work" --name worker
```

With Docker Compose, add a worker service:
```yaml
  worker:
    build: .
    command: pnpm rudder queue:work
    env_file: .env
    depends_on:
      - redis
```

---

## Scheduler

If you use `@rudderjs/schedule`, start the scheduler process:

```bash
pnpm rudder schedule:work
```

With PM2:
```bash
pm2 start "pnpm rudder schedule:work" --name scheduler
```

---

## Static Assets

The `dist/client/` directory contains hashed static assets. In production:

- Serve them with long cache headers (`Cache-Control: public, max-age=31536000, immutable`)
- Optionally serve from a CDN (set `APP_URL` to your CDN origin)
- Nginx can serve static files directly:

```nginx
location /assets {
    alias /var/www/myapp/dist/client/assets;
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

---

## Storage (File Uploads)

If using `@rudderjs/storage` with the local adapter:

- The `storage/` directory must be writable by the Node.js process
- Create a symlink from `public/storage` to `storage/app/public` for public file access:

```bash
ln -s ../storage/app/public public/storage
```

For production, prefer S3 storage — it works across multiple instances and doesn't rely on local disk.

---

## Checklist

Before deploying:

- [ ] `APP_ENV=production` and `APP_DEBUG=false`
- [ ] `APP_KEY` set to a random 32+ character string
- [ ] `AUTH_SECRET` set to a random 32+ character string
- [ ] Database migrations applied (`npx prisma migrate deploy`)
- [ ] `.env` is NOT in version control
- [ ] API keys and secrets are set in your hosting platform's environment
- [ ] WebSocket paths (`/ws`, `/ws-live`) are proxied with upgrade support
- [ ] Queue worker running (if using queues)
- [ ] Scheduler running (if using scheduled tasks)
- [ ] SSL configured (HTTPS)
- [ ] Storage directory writable or S3 configured
