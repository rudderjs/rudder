<template>
  <a
    class="package-badge"
    :href="`https://www.npmjs.com/package/${name}`"
    target="_blank"
    rel="noopener noreferrer"
  >
    <span>{{ name }}</span>
  </a>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
</script>
