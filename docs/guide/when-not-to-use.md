# When Not to Use Rudder

Most framework docs only tell you when to say yes. This page tells you when to say no — because picking the wrong tool wastes more of your time than any feature saves it. Rudder is a batteries-included, full-stack, service-oriented framework. That shape is a great fit for some projects and the wrong fit for others.

## Reach for something else when…

### You're building a static or content site with no server logic

A marketing site, blog, or documentation site that's mostly content doesn't need a DI container, an ORM, or service providers. [Astro](https://astro.build) or plain [Vite](https://vitejs.dev) will be lighter, faster to deploy, and simpler to reason about. Rudder earns its weight when you have *application* logic — auth, a database, background work, real-time — not just pages.

### You need a single endpoint or a tiny script

If the whole job is one webhook handler or a five-route internal tool, a full framework is overhead. Reach directly for [Hono](https://hono.dev) (which Rudder itself runs on) or Express. You can always graduate to Rudder later; the routing concepts carry over.

### You can't adopt ESM, TypeScript, or decorators

Rudder is strict ESM and TypeScript-first, and its DI and routing rely on decorator metadata (`experimentalDecorators` + `emitDecoratorMetadata`). If your project is locked to CommonJS, plain JavaScript, or a build setup that can't emit decorator metadata, you'll fight the framework constantly. This is a hard requirement, not a preference.

### You need a non-Node runtime as your primary target

Rudder runs on Node, Bun, Deno, and Cloudflare Workers via a WinterCG Fetch handler — but it's a Node-ecosystem framework at heart, and Node is the gated, first-class runtime. If your team's primary platform is Go, Rust, Python, or the JVM, use a native framework there.

### You're committed to React Server Components + Vercel as the center of your stack

Rudder supports RSC as an opt-in renderer, but its center of gravity is server-rendered views returned from controllers, not the App Router model. If your team is deeply invested in Next.js's RSC-everywhere approach and Vercel's deployment story, the switching cost likely outweighs the benefit. Next.js is the better fit for that worldview.

### You need GraphQL-first or gRPC-first APIs

Rudder is REST- and SSR-first. There's no first-party GraphQL or gRPC layer — you can wire one in, but you'd be building on top of the framework rather than with it. If a typed GraphQL schema is the core of your architecture, a GraphQL-native stack will serve you better.

### Maturity and ecosystem size are non-negotiable for this project

Be honest with yourself about risk tolerance. Rudder reached 1.0 in May 2026. It's tested ([see how](/guide/quality)) and dogfooded, but it is new: a smaller community, fewer Stack Overflow answers, a smaller hiring pool, and fewer third-party packages than NestJS, Next.js, or AdonisJS. For a high-stakes project where "many people have hit this exact problem before" is a hard requirement, an older framework is the safer call — and that's a legitimate reason to wait.

## Still a good fit when…

If most of these describe your project, Rudder is built for exactly this:

- A full-stack app with real server logic — auth, a database, background jobs, scheduled work.
- A TypeScript team that wants structure and convention without hand-wiring every layer.
- You want SSR views *and* a JSON API from one codebase, one router, one mental model.
- AI agents, MCP servers, or real-time collaboration are first-class needs, not bolt-ons.
- You want to deploy the same code to Node today and Bun, Deno, or Workers later without a rewrite.

If you're on the fence, the fastest way to decide is to scaffold one and build a real slice of your app — [Installation](/guide/installation) gets you there in a couple of minutes.
