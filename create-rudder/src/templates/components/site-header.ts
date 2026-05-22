import type { TemplateContext } from '../../templates.js'

export function siteHeaderComponent(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return siteHeaderVue(ctx)
    case 'solid': return siteHeaderSolid(ctx)
    default:      return siteHeaderReact(ctx)
  }
}

function siteHeaderReact(ctx: TemplateContext): string {
  if (!ctx.packages.auth) {
    return `import { usePageContext } from 'vike-react/usePageContext'

// Minimal header — no auth installed, so no login/register/sign-out links.
export function SiteHeader() {
  // usePageContext() is invoked so future auth integration is a one-line edit:
  // const ctx = usePageContext() as { user?: { name?: string } | null }
  usePageContext()
  return (
    <header className="page-header">
      <nav className="page-nav">
        <a href="/" className="brand">
          <span className="brand-dot" />
          ${ctx.name}
        </a>
        <div className="nav-right">
        </div>
      </nav>
    </header>
  )
}
`
  }

  return `import { usePageContext } from 'vike-react/usePageContext'
import { getCsrfToken } from '@rudderjs/middleware/client'

interface PageContextUser {
  user?: { name?: string; email?: string } | null
}

export function SiteHeader() {
  const ctx  = usePageContext() as unknown as PageContextUser
  const user = ctx.user ?? null

  async function handleSignOut() {
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
    <header className="page-header">
      <nav className="page-nav">
        <a href="/" className="brand">
          <span className="brand-dot" />
          ${ctx.name}
        </a>
        <div className="nav-right">
          {user ? (
            <>
              <span className="nav-badge">
                <strong>{user.name ?? user.email ?? 'Account'}</strong>
              </span>
              <button type="button" onClick={handleSignOut} className="nav-button">
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href="/login" className="nav-link">Login</a>
              <a href="/register" className="nav-button">Register</a>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
`
}

function siteHeaderVue(ctx: TemplateContext): string {
  if (!ctx.packages.auth) {
    return `<script setup lang="ts">
import { usePageContext } from 'vike-vue/usePageContext'

// Invoked so future auth integration is a one-line edit.
usePageContext()
</script>

<template>
  <header class="page-header">
    <nav class="page-nav">
      <a href="/" class="brand">
        <span class="brand-dot"></span>
        ${ctx.name}
      </a>
      <div class="nav-right">
      </div>
    </nav>
  </header>
</template>
`
  }

  return `<script setup lang="ts">
import { computed } from 'vue'
import { usePageContext } from 'vike-vue/usePageContext'
import { getCsrfToken } from '@rudderjs/middleware/client'

const pageContext = usePageContext() as unknown as {
  user?: { name?: string; email?: string } | null
}
const user = computed(() => pageContext.user ?? null)

async function handleSignOut() {
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
  <header class="page-header">
    <nav class="page-nav">
      <a href="/" class="brand">
        <span class="brand-dot"></span>
        ${ctx.name}
      </a>
      <div class="nav-right">
        <template v-if="user">
          <span class="nav-badge">
            <strong>{{ user.name ?? user.email ?? 'Account' }}</strong>
          </span>
          <button type="button" @click="handleSignOut" class="nav-button">Sign out</button>
        </template>
        <template v-else>
          <a href="/login" class="nav-link">Login</a>
          <a href="/register" class="nav-button">Register</a>
        </template>
      </div>
    </nav>
  </header>
</template>
`
}

function siteHeaderSolid(ctx: TemplateContext): string {
  if (!ctx.packages.auth) {
    return `import { usePageContext } from 'vike-solid/usePageContext'

export function SiteHeader() {
  usePageContext()
  return (
    <header class="page-header">
      <nav class="page-nav">
        <a href="/" class="brand">
          <span class="brand-dot" />
          ${ctx.name}
        </a>
        <div class="nav-right">
          </div>
      </nav>
    </header>
  )
}
`
  }

  return `import { Show } from 'solid-js'
import { usePageContext } from 'vike-solid/usePageContext'
import { getCsrfToken } from '@rudderjs/middleware/client'

export function SiteHeader() {
  const ctx = usePageContext() as unknown as {
    user?: { name?: string; email?: string } | null
  }

  async function handleSignOut() {
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
    <header class="page-header">
      <nav class="page-nav">
        <a href="/" class="brand">
          <span class="brand-dot" />
          ${ctx.name}
        </a>
        <div class="nav-right">
            <Show
            when={ctx.user}
            fallback={
              <>
                <a href="/login" class="nav-link">Login</a>
                <a href="/register" class="nav-button">Register</a>
              </>
            }
          >
            {(user) => (
              <>
                <span class="nav-badge">
                  <strong>{user().name ?? user().email ?? 'Account'}</strong>
                </span>
                <button type="button" onClick={handleSignOut} class="nav-button">Sign out</button>
              </>
            )}
          </Show>
        </div>
      </nav>
    </header>
  )
}
`
}

export function siteHeaderExt(fw: 'react' | 'vue' | 'solid'): string {
  return fw === 'vue' ? 'vue' : 'tsx'
}
