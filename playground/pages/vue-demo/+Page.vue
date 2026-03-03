<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <div style="font-family: sans-serif; max-width: 480px; margin: 80px auto; text-align: center;">
    <h1 style="font-size: 2rem; font-weight: bold; margin-bottom: 8px;">Vue Demo</h1>
    <p style="color: #666; margin-bottom: 32px;">
      This page is rendered with <strong>Vue 3</strong> via <code>vike-vue</code>.<br />
      The rest of the app uses React — per-page <code>+config.ts</code> controls the framework.
    </p>

    <div style="display: flex; align-items: center; justify-content: center; gap: 16px;">
      <button
        style="padding: 8px 20px; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; font-size: 1rem;"
        @click="count--"
      >−</button>
      <span style="font-size: 1.5rem; font-weight: 600; min-width: 40px;">{{ count }}</span>
      <button
        style="padding: 8px 20px; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; font-size: 1rem;"
        @click="count++"
      >+</button>
    </div>

    <p style="margin-top: 40px;">
      <a href="/" style="color: #888; font-size: 0.9rem;">← Back to home</a>
    </p>
  </div>
</template>
