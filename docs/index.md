---
layout: home

hero:
  name: "Rudder"
  text: "The fullstack Node.js framework with structure, speed, and AI built in."
  tagline: "Ship a signup flow, a background queue, a real-time collaborative document, and an AI agent — from one monorepo."
  image:
    src: /logo.svg
    alt: Rudder
  actions:
    - theme: brand
      text: Get Started
      link: /guide/installation
    - theme: alt
      text: Why Rudder?
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/rudderjs/rudder

features:
  - icon: 🎨
    title: Controller-returned SSR views
    details: "`return view('id', props)` renders typed React / Vue / Solid components through Vike. SPA nav after first paint, ~400 bytes per nav, no Inertia tax."
  - icon: 🧠
    title: AI-native
    details: 15 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure, Cohere, Jina, OpenRouter, Bedrock, ElevenLabs, Voyage). Agents with tools, streaming, MCP, queue-backed runs, approval gates.
  - icon: 🔌
    title: Real-time on one port
    details: WebSocket channels, presence, and Yjs CRDT collab share the same Hono server. No second daemon, no proxy, no Pusher dependency.
  - icon: 🧱
    title: Service-oriented
    details: DI container with ALS request scope, service providers, gates & policies, active-record ORM (Prisma or Drizzle) — one bootstrap file wires everything.
  - icon: 🪶
    title: Pay-as-you-go modularity
    details: 47 first-party packages. Start with three, bolt on what you need. Swap Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3 without changing app code.
  - icon: 🔒
    title: TypeScript-first, strict by default
    details: "`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM + NodeNext everywhere. Incremental builds. WinterCG-compatible runtime."
---
