<script setup lang="ts">
import '@/index.css'
import { ref } from 'vue'

const email   = ref('')
const error   = ref('')
const success = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value   = ''
  success.value = ''
  loading.value = true
  try {
    const res = await fetch('/api/auth/request-password-reset', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email.value, redirectTo: '/reset-password' }),
    })
    if (res.ok) {
      success.value = 'If an account exists with that email, a password reset link has been sent.'
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string }
      error.value = body.message ?? 'Something went wrong. Please try again.'
    }
  } catch {
    error.value = 'Something went wrong. Please try again.'
  }
  loading.value = false
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">Forgot password</h1>
        <p class="text-sm text-gray-500 mt-1">Enter your email to receive a reset link</p>
      </div>
      <form @submit.prevent="handleSubmit" class="space-y-4 rounded-lg border p-6 shadow-sm">
        <p v-if="error" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>
        <p v-if="success" class="rounded-md bg-green-50 px-3 py-2 text-sm text-green-600">{{ success }}</p>
        <div>
          <label class="block text-sm font-medium mb-1" for="email">Email</label>
          <input id="email" v-model="email" type="email" placeholder="you@example.com"
            required autocomplete="email"
            class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
        </div>
        <button type="submit" :disabled="loading"
          class="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
          {{ loading ? 'Sending...' : 'Send reset link' }}
        </button>
        <p class="text-center text-sm text-gray-500">
          Remember your password?
          <a href="/login" class="underline hover:text-black">Sign in</a>
        </p>
      </form>
    </div>
  </div>
</template>
