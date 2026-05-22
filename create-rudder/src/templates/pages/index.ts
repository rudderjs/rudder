import type { TemplateContext } from '../../templates.js'

export function pagesRootConfig(ctx: TemplateContext): string {
  // No-frontend recipe (api-service / minimal). No vike-* renderer installed,
  // so Vike auto-discovers an adjacent `+onRenderHtml.ts` (scaffolded next to
  // this file — see `pagesRootRenderHtml`). Vike rejects `onRenderHtml`
  // declared inline in +config.ts ("runtime in config" error), so the hook
  // must live in its own file.
  if (ctx.frameworks.length === 0) {
    return `import type { Config } from 'vike/types'

export default {
  passToClient: ['user', 'locale', 'flash'],
} satisfies Config
`
  }
  // Forward @rudderjs/vite pageContext enhancers (user/locale/flash) to the
  // client during hydration. Without this, components reading
  // pageContext.user via usePageContext() render signed-in on the server but
  // signed-out on the client, causing a hydration flicker.
  if (ctx.frameworks.length === 1) {
    const rendererImport = ctx.primary === 'vue'
      ? `import vikeVue from 'vike-vue/config'`
      : ctx.primary === 'solid'
        ? `import vikeSolid from 'vike-solid/config'`
        : `import vikeReact from 'vike-react/config'`
    const rendererVar = ctx.primary === 'vue' ? 'vikeVue' : ctx.primary === 'solid' ? 'vikeSolid' : 'vikeReact'
    return `import type { Config } from 'vike/types'
${rendererImport}

export default {
  extends:      [${rendererVar}],
  passToClient: ['user', 'locale', 'flash'],
} satisfies Config
`
  }

  // Multi-framework: no renderer in root config — each page picks its own.
  // No `extends` here, so the workaround isn't needed.
  return `import type { Config } from 'vike/types'

export default {
  passToClient: ['user', 'locale', 'flash'],
} satisfies Config
`
}

export function pagesIndexConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default: // react
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

export function pagesIndexData(ctx: TemplateContext): string {
  if (!ctx.packages.auth) {
    return `export type Data = {
  message: string
}

export async function data(): Promise<Data> {
  return { message: 'Welcome to RudderJS' }
}
`
  }

  return `import { app } from '@rudderjs/core'
import { AuthManager, Auth, runWithAuth } from '@rudderjs/auth'

export type Data = {
  user: { id: string; name: string; email: string } | null
}

export async function data(): Promise<Data> {
  const manager = app().make<AuthManager>('auth.manager')
  let user: Data['user'] = null
  await runWithAuth(manager, async () => {
    const authUser = await Auth.user()
    if (authUser) {
      const record = authUser as unknown as Record<string, unknown>
      user = {
        id:    String(authUser.getAuthIdentifier()),
        name:  String(record['name'] ?? ''),
        email: String(record['email'] ?? ''),
      }
    }
  })
  return { user }
}
`
}

export function pagesIndexPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return pagesIndexPageVue(ctx)
    case 'solid': return pagesIndexPageSolid(ctx)
    default:      return pagesIndexPageReact(ctx)
  }
}

export function pagesIndexPageReact(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  const extraLinks: string[] = []
  if (ctx.packages.ai) extraLinks.push('        <a href="/ai-chat" className="auth-link">AI Chat</a>')
  const extraLinksStr = extraLinks.length > 0 ? '\n' + extraLinks.join('\n') : ''

  if (!ctx.packages.auth) {
    return `${cssImport}import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()

  return (
    <div className="error-wrap">
      <h1 className="heading-lg">${ctx.name}</h1>
      <p className="muted">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      <div className="footer-links muted">
        <a href="/api/health" className="auth-link">API Health</a>${extraLinksStr}
      </div>
    </div>
  )
}
`
  }

  return `${cssImport}import { useState } from 'react'
import { useData } from 'vike-react/useData'
import { getCsrfToken } from '@rudderjs/middleware/client'
import type { Data } from './+data.js'

export default function Page() {
  const data         = useData<Data>()
  const [user, setUser] = useState(data.user)

  async function signOut() {
    await fetch('/auth/sign-out', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: '{}',
    })
    window.location.href = '/'
  }

  return (
    <div className="error-wrap">
      <h1 className="heading-lg">${ctx.name}</h1>
      <p className="muted">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      {user ? (
        <>
          <p className="nav-badge">
            Signed in as <strong>{user.name}</strong>
          </p>
          <div className="footer-links">
            <button onClick={signOut} className="nav-button">Sign out</button>
          </div>
        </>
      ) : (
        <div className="footer-links">
          <a href="/register" className="nav-button">Register</a>
          <a href="/login" className="nav-button">Login</a>
        </div>
      )}

      <div className="footer-links muted">
        <a href="/api/health" className="auth-link">API Health</a>
        <a href="/api/me" className="auth-link">Session Info</a>${extraLinksStr}
      </div>
    </div>
  )
}
`
}

export function pagesIndexPageVue(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  const extraLinks: string[] = []
  if (ctx.packages.ai) extraLinks.push('      <a href="/ai-chat" class="auth-link">AI Chat</a>')
  const extraStr = extraLinks.length > 0 ? '\n' + extraLinks.join('\n') : ''

  if (!ctx.packages.auth) {
    return `<script setup lang="ts">
${cssImport}import { useData } from 'vike-vue/useData'
import type { Data } from './+data.js'

const data = useData<Data>()
</script>

<template>
  <div class="error-wrap">
    <h1 class="heading-lg">${ctx.name}</h1>
    <p class="muted">Built with RudderJS — Laravel-inspired Node.js framework.</p>

    <div class="footer-links muted">
      <a href="/api/health" class="auth-link">API Health</a>${extraStr}
    </div>
  </div>
</template>
`
  }

  return `<script setup lang="ts">
${cssImport}import { ref } from 'vue'
import { useData } from 'vike-vue/useData'
import { getCsrfToken } from '@rudderjs/middleware/client'
import type { Data } from './+data.js'

const data = useData<Data>()
const user = ref(data.user)

async function signOut() {
  await fetch('/auth/sign-out', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: '{}',
  })
  window.location.href = '/'
}
</script>

<template>
  <div class="error-wrap">
    <h1 class="heading-lg">${ctx.name}</h1>
    <p class="muted">Built with RudderJS — Laravel-inspired Node.js framework.</p>

    <template v-if="user">
      <p class="nav-badge">
        Signed in as <strong>{{ user.name }}</strong>
      </p>
      <div class="footer-links">
        <button @click="signOut" class="nav-button">Sign out</button>
      </div>
    </template>
    <div v-else class="footer-links">
      <a href="/register" class="nav-button">Register</a>
      <a href="/login" class="nav-button">Login</a>
    </div>

    <div class="footer-links muted">
      <a href="/api/health" class="auth-link">API Health</a>
      <a href="/api/me" class="auth-link">Session Info</a>${extraStr}
    </div>
  </div>
</template>
`
}

export function pagesIndexPageSolid(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  const extraLinks: string[] = []
  if (ctx.packages.ai) extraLinks.push('        <a href="/ai-chat" class="auth-link">AI Chat</a>')
  const extraStr = extraLinks.length > 0 ? '\n' + extraLinks.join('\n') : ''

  if (!ctx.packages.auth) {
    return `${cssImport}import { useData } from 'vike-solid/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()

  return (
    <div class="error-wrap">
      <h1 class="heading-lg">${ctx.name}</h1>
      <p class="muted">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      <div class="footer-links muted">
        <a href="/api/health" class="auth-link">API Health</a>${extraStr}
      </div>
    </div>
  )
}
`
  }

  return `${cssImport}import { createSignal, Show } from 'solid-js'
import { useData } from 'vike-solid/useData'
import { getCsrfToken } from '@rudderjs/middleware/client'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()
  const [user, setUser] = createSignal(data.user)

  async function signOut() {
    await fetch('/auth/sign-out', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: '{}',
    })
    window.location.href = '/'
  }

  return (
    <div class="error-wrap">
      <h1 class="heading-lg">${ctx.name}</h1>
      <p class="muted">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      <Show
        when={user()}
        fallback={
          <div class="footer-links">
            <a href="/register" class="nav-button">Register</a>
            <a href="/login" class="nav-button">Login</a>
          </div>
        }
      >
        <p class="nav-badge">
          Signed in as <strong>{user()!.name}</strong>
        </p>
        <div class="footer-links">
          <button onClick={signOut} class="nav-button">Sign out</button>
        </div>
      </Show>

      <div class="footer-links muted">
        <a href="/api/health" class="auth-link">API Health</a>
        <a href="/api/me" class="auth-link">Session Info</a>${extraStr}
      </div>
    </div>
  )
}
`
}

/**
 * Vanilla `+onRenderHtml.ts` for no-frontend recipes (api-service, minimal).
 *
 * Vike auto-discovers this file adjacent to `+config.ts` and uses it as the
 * render hook when no vike-* renderer is installed. The page's `Page` export
 * (generated by @rudderjs/vite's scanner from app/Views/Welcome.ts) returns
 * a string body fragment, and this hook wraps it in the document shell.
 *
 * Vike rejects `onRenderHtml` defined inline in `+config.ts` — runtime code
 * (like a render hook) must live in its own file. See
 * https://vike.dev/error/runtime-in-config.
 */
export function pagesRootRenderHtml(): string {
  return `import { escapeInject, dangerouslySkipEscape } from 'vike/server'

export default async function onRenderHtml(pageContext: unknown): Promise<unknown> {
  const ctx = pageContext as { Page: (pc: unknown) => string }
  const body = ctx.Page(pageContext)
  return escapeInject\`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RudderJS</title>
  </head>
  <body>\${dangerouslySkipEscape(body)}</body>
</html>\`
}
`
}
