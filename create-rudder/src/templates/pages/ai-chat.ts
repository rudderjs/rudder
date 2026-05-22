import type { TemplateContext } from '../../templates.js'

export function aiChatPageConfig(ctx: TemplateContext): string {
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
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

export function aiChatPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return aiChatPageVue(ctx)
    case 'solid': return aiChatPageSolid(ctx)
    default:      return aiChatPageReact(ctx)
  }
}

export function aiChatPageReact(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `${cssImport}import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const json = await res.json() as { message: string }
      setMessages(prev => [...prev, { role: 'assistant', content: json.message }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Check your AI_PROVIDER and API key in .env.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-wrap">
      <div className="chat-column">
        <div className="chat-header">
          <h1 className="heading-lg">AI Chat</h1>
          <a href="/" className="auth-link muted">← Home</a>
        </div>

        <div ref={scrollRef} className="chat-log">
          {messages.length === 0 && (
            <p className="empty-state">Send a message to start chatting.</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={\`chat-row \${msg.role === 'user' ? 'is-user' : 'is-assistant'}\`}>
              <div className={\`chat-bubble \${msg.role === 'user' ? 'is-user' : 'is-assistant'}\`}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="chat-row is-assistant">
              <div className="chat-bubble is-assistant muted">Thinking...</div>
            </div>
          )}
        </div>

        <form onSubmit={send} className="form-inline chat-input">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            className="form-input"
          />
          <button type="submit" disabled={loading} className="form-submit">
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
`
}

export function aiChatPageVue(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `<script setup lang="ts">
${cssImport}import { ref, nextTick } from 'vue'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const messages  = ref<Message[]>([])
const input     = ref('')
const loading   = ref(false)
const scrollEl  = ref<HTMLDivElement>()

async function send(e: Event) {
  e.preventDefault()
  if (!input.value.trim() || loading.value) return

  const userMsg: Message = { role: 'user', content: input.value }
  messages.value.push(userMsg)
  input.value = ''
  loading.value = true

  try {
    const res = await fetch('/api/ai/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: messages.value }),
    })
    const json = await res.json() as { message: string }
    messages.value.push({ role: 'assistant', content: json.message })
  } catch {
    messages.value.push({ role: 'assistant', content: 'Something went wrong. Check your AI_PROVIDER and API key in .env.' })
  } finally {
    loading.value = false
    await nextTick()
    scrollEl.value?.scrollTo(0, scrollEl.value.scrollHeight)
  }
}
</script>

<template>
  <div class="chat-wrap">
    <div class="chat-column">
      <div class="chat-header">
        <h1 class="heading-lg">AI Chat</h1>
        <a href="/" class="auth-link muted">← Home</a>
      </div>

      <div ref="scrollEl" class="chat-log">
        <p v-if="messages.length === 0" class="empty-state">Send a message to start chatting.</p>
        <div v-for="(msg, i) in messages" :key="i" :class="['chat-row', msg.role === 'user' ? 'is-user' : 'is-assistant']">
          <div :class="['chat-bubble', msg.role === 'user' ? 'is-user' : 'is-assistant']">
            {{ msg.content }}
          </div>
        </div>
        <div v-if="loading" class="chat-row is-assistant">
          <div class="chat-bubble is-assistant muted">Thinking...</div>
        </div>
      </div>

      <form @submit="send" class="form-inline chat-input">
        <input v-model="input" placeholder="Type a message..." :disabled="loading" class="form-input" />
        <button type="submit" :disabled="loading" class="form-submit">Send</button>
      </form>
    </div>
  </div>
</template>
`
}

export function aiChatPageSolid(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `${cssImport}import { createSignal, For, Show, onCleanup } from 'solid-js'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function Page() {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [input, setInput]       = createSignal('')
  const [loading, setLoading]   = createSignal(false)
  let scrollEl: HTMLDivElement | undefined

  function scrollToBottom() {
    setTimeout(() => scrollEl?.scrollTo(0, scrollEl.scrollHeight), 0)
  }

  async function send(e: Event) {
    e.preventDefault()
    if (!input().trim() || loading()) return

    const userMsg: Message = { role: 'user', content: input() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    scrollToBottom()

    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: [...messages()] }),
      })
      const json = await res.json() as { message: string }
      setMessages(prev => [...prev, { role: 'assistant', content: json.message }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Check your AI_PROVIDER and API key in .env.' }])
    } finally {
      setLoading(false)
      scrollToBottom()
    }
  }

  return (
    <div class="chat-wrap">
      <div class="chat-column">
        <div class="chat-header">
          <h1 class="heading-lg">AI Chat</h1>
          <a href="/" class="auth-link muted">← Home</a>
        </div>

        <div ref={scrollEl} class="chat-log">
          <Show when={messages().length === 0}>
            <p class="empty-state">Send a message to start chatting.</p>
          </Show>
          <For each={messages()}>
            {(msg) => (
              <div class={\`chat-row \${msg.role === 'user' ? 'is-user' : 'is-assistant'}\`}>
                <div class={\`chat-bubble \${msg.role === 'user' ? 'is-user' : 'is-assistant'}\`}>
                  {msg.content}
                </div>
              </div>
            )}
          </For>
          <Show when={loading()}>
            <div class="chat-row is-assistant">
              <div class="chat-bubble is-assistant muted">Thinking...</div>
            </div>
          </Show>
        </div>

        <form onSubmit={send} class="form-inline chat-input">
          <input
            value={input()}
            onInput={e => setInput(e.currentTarget.value)}
            placeholder="Type a message..."
            disabled={loading()}
            class="form-input"
          />
          <button type="submit" disabled={loading()} class="form-submit">
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
`
}
