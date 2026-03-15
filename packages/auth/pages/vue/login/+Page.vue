<script setup lang="ts">
import '@/index.css'
import { ref } from 'vue'
import { navigate } from 'vike/client/router'

const email    = ref('')
const password = ref('')
const error    = ref('')
const loading  = ref(false)

async function handleSubmit() {
  error.value   = ''
  loading.value = true
  const res = await fetch('/api/auth/sign-in/email', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: email.value, password: password.value }),
  })
  if (res.ok) {
    const params = new URLSearchParams(window.location.search)
    const redirect = params.get('redirect')
    await navigate(redirect && redirect.startsWith('/') ? redirect : '/')
  } else {
    const body = await res.json().catch(() => ({})) as { message?: string }
    error.value = body.message ?? 'Invalid email or password.'
  }
  loading.value = false
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">Welcome back</h1>
        <p class="text-sm text-gray-500 mt-1">Sign in to your account</p>
      </div>
      <form @submit.prevent="handleSubmit" class="space-y-4 rounded-lg border p-6 shadow-sm">
        <p v-if="error" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
        <div>
          <label class="block text-sm font-medium mb-1" for="email">Email</label>
          <input id="email" v-model="email" type="email" placeholder="you@example.com"
            required autocomplete="email"
            class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1" for="password">Password</label>
          <input id="password" v-model="password" type="password" placeholder="••••••••"
            required autocomplete="current-password"
            class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
        </div>
        <button type="submit" :disabled="loading"
          class="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
        <p class="text-center text-sm text-gray-500">
          Don't have an account?
          <a href="/register" class="underline hover:text-black">Register</a>
        </p>
      </form>
    </div>
  </div>
</template>
