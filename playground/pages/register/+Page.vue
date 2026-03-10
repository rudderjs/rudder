<script setup lang="ts">
import '@/index.css'
import { ref } from 'vue'

const name     = ref('')
const email    = ref('')
const password = ref('')
const error    = ref('')
const loading  = ref(false)

async function handleSubmit() {
  error.value   = ''
  loading.value = true
  const res = await fetch('/api/auth/sign-up/email', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: name.value, email: email.value, password: password.value }),
  })
  if (res.ok) {
    window.location.href = '/'
  } else {
    const body = await res.json().catch(() => ({})) as { message?: string }
    error.value = body.message ?? 'Could not create account. Please try again.'
  }
  loading.value = false
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">Create an account</h1>
        <p class="text-sm text-gray-500 mt-1">Get started in seconds</p>
      </div>
      <form @submit.prevent="handleSubmit" class="space-y-4 rounded-lg border p-6 shadow-sm">
        <p v-if="error" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
        <div>
          <label class="block text-sm font-medium mb-1" for="name">Name</label>
          <input id="name" v-model="name" type="text" placeholder="Alice Smith"
            required autocomplete="name"
            class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1" for="email">Email</label>
          <input id="email" v-model="email" type="email" placeholder="you@example.com"
            required autocomplete="email"
            class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1" for="password">Password</label>
          <input id="password" v-model="password" type="password" placeholder="••••••••"
            required autocomplete="new-password" minlength="8"
            class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
        </div>
        <button type="submit" :disabled="loading"
          class="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
          {{ loading ? 'Creating account…' : 'Create account' }}
        </button>
        <p class="text-center text-sm text-gray-500">
          Already have an account?
          <a href="/login" class="underline hover:text-black">Sign in</a>
        </p>
      </form>
    </div>
  </div>
</template>
