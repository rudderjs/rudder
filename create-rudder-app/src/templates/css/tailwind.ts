export function semanticRulesApply(): string {
  return `/* ─── Scaffolded view classes ────────────────────────────────
   Semantic classes shared by app/Views/Welcome and vendored
   @rudderjs/auth views. The --no-tailwind variant of this
   scaffolder emits equivalent hand-authored CSS under the
   same selectors. */

.page {
  @apply min-h-svh bg-gradient-to-b from-white to-zinc-50 text-zinc-900 dark:from-zinc-950 dark:to-black dark:text-zinc-100;
}
.page-nav {
  @apply mx-auto flex max-w-6xl items-center justify-between px-6 py-5;
}
.page-footer {
  @apply border-t border-zinc-200 dark:border-zinc-900;
}
.footer-inner {
  @apply mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6 text-xs text-zinc-500 sm:flex-row sm:justify-between;
}
.footer-links {
  @apply flex gap-4;
}
.footer-link {
  @apply transition-colors hover:text-zinc-900 dark:hover:text-zinc-100;
}

.brand {
  @apply flex items-center gap-2 text-sm font-semibold tracking-tight;
}
.brand-dot {
  @apply inline-block h-2 w-2 rounded-full bg-emerald-500;
}
.nav-right {
  @apply flex items-center gap-4 text-sm;
}
.nav-badge {
  @apply text-zinc-500 dark:text-zinc-400;
}
.nav-badge strong {
  @apply font-medium text-zinc-900 dark:text-zinc-100;
}
.nav-button {
  @apply rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900;
}
.nav-link {
  @apply text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100;
}

.hero {
  @apply mx-auto max-w-3xl px-6 pb-12 pt-20 text-center;
}
.hero-title {
  @apply text-5xl font-bold tracking-tight sm:text-6xl;
}
.hero-lead {
  @apply mt-6 text-lg text-zinc-600 dark:text-zinc-400;
}
.hero-meta {
  @apply mt-8 flex items-center justify-center gap-3 text-xs text-zinc-500;
}
.inline-code {
  @apply rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900;
}

.feature-section {
  @apply mx-auto max-w-6xl px-6 pb-20;
}
.feature-grid {
  @apply grid gap-4 md:grid-cols-2 lg:grid-cols-3;
}
.feature-card {
  @apply rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-100;
}
.feature-title {
  @apply font-semibold;
}
.feature-desc {
  @apply mt-2 text-sm text-zinc-600 dark:text-zinc-400;
}
.feature-card:hover .feature-desc {
  @apply text-zinc-900 dark:text-zinc-100;
}

/* Auth forms + error page (reused selectors) */
.auth-wrap {
  @apply flex min-h-svh items-center justify-center p-4;
}
.auth-card {
  @apply w-full max-w-sm space-y-6;
}
.auth-head {
  @apply text-center;
}
.heading-lg {
  @apply text-2xl font-bold;
}
.muted {
  @apply text-sm text-zinc-500 dark:text-zinc-400;
}
.form-card {
  @apply space-y-4 rounded-lg border border-zinc-200 p-6 shadow-sm dark:border-zinc-800;
}
.form-error {
  @apply rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400;
}
.form-success {
  @apply rounded-md bg-green-50 px-3 py-2 text-sm text-green-600 dark:bg-green-950 dark:text-green-400;
}
.form-label {
  @apply block text-sm font-medium mb-1;
}
.form-input {
  @apply w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:ring-zinc-100;
}
.form-submit {
  @apply w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900;
}
.form-link-row {
  @apply flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400;
}
.auth-link {
  @apply underline transition-colors hover:text-zinc-900 dark:hover:text-zinc-100;
}

.error-wrap {
  @apply flex min-h-svh flex-col items-center justify-center gap-4 p-4;
}
.error-link {
  @apply mt-4 text-sm underline transition-colors hover:text-zinc-900 dark:hover:text-zinc-100;
}
.empty-state {
  @apply py-8 text-center text-sm text-zinc-500 dark:text-zinc-400;
}

.form-inline {
  @apply flex w-full max-w-md gap-2;
}

/* AI chat */
.chat-wrap {
  @apply flex min-h-svh flex-col items-center p-4;
}
.chat-column {
  @apply flex w-full max-w-2xl flex-1 flex-col;
}
.chat-header {
  @apply mb-4 flex items-center justify-between;
}
.chat-log {
  @apply flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-200 p-4 dark:border-zinc-800;
  max-height: calc(100svh - 180px);
}
.chat-row {
  @apply flex;
}
.chat-row.is-user {
  @apply justify-end;
}
.chat-row.is-assistant {
  @apply justify-start;
}
.chat-bubble {
  @apply max-w-[80%] rounded-lg px-3 py-2 text-sm;
}
.chat-bubble.is-user {
  @apply bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900;
}
.chat-bubble.is-assistant {
  @apply bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100;
}
.chat-input {
  @apply mt-3;
}
`
}
