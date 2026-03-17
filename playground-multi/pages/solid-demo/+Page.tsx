// @ts-nocheck — Solid JSX uses `class` not `className`; TypeScript checks this as React JSX
import '@/index.css'

export default function Page() {
  return (
    <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 class="text-2xl font-bold">Hello from Solid</h1>
      <p class="text-muted-foreground">Solid demo page — running alongside react.</p>
      <a href="/" class="text-sm underline">← Back to home</a>
    </div>
  )
}
