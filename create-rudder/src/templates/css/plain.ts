export function indexCssPlain(): string {
  return `:root {
  --bg-start: #ffffff;
  --bg-end: #fafafa;
  --fg: #18181b;
  --fg-muted: #52525b;
  --fg-strong: #09090b;
  --border: #e4e4e7;
  --surface: #ffffff;
  --surface-muted: #f4f4f5;
  --accent: #10b981;
  --danger-bg: #fef2f2;
  --danger-fg: #dc2626;
  --success-bg: #f0fdf4;
  --success-fg: #16a34a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-start: #09090b;
    --bg-end: #000000;
    --fg: #fafafa;
    --fg-muted: #a1a1aa;
    --fg-strong: #ffffff;
    --border: #27272a;
    --surface: #09090b;
    --surface-muted: #18181b;
    --danger-bg: #450a0a;
    --danger-fg: #f87171;
    --success-bg: #052e16;
    --success-fg: #4ade80;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: linear-gradient(to bottom, var(--bg-start), var(--bg-end));
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }

/* Layout */
.page { min-height: 100svh; }
.page-nav {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-footer {
  border-top: 1px solid var(--border);
}
.footer-inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--fg-muted);
}
@media (min-width: 640px) {
  .footer-inner { flex-direction: row; justify-content: space-between; }
}
.footer-links { display: flex; gap: 1rem; }
.footer-link {
  text-decoration: none;
  transition: color 150ms;
}
.footer-link:hover { color: var(--fg-strong); }

/* Welcome */
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.brand-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: var(--accent);
}
.nav-right {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 0.875rem;
}
.nav-badge { color: var(--fg-muted); }
.nav-badge strong { color: var(--fg-strong); font-weight: 500; }
.nav-button {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--fg);
  background: transparent;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 150ms;
}
.nav-button:hover { background: var(--surface-muted); }
.nav-link {
  color: var(--fg-muted);
  text-decoration: none;
  transition: color 150ms;
}
.nav-link:hover { color: var(--fg-strong); }

.hero {
  max-width: 48rem;
  margin: 0 auto;
  padding: 5rem 1.5rem 3rem;
  text-align: center;
}
.hero-title {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}
@media (min-width: 640px) {
  .hero-title { font-size: 3.75rem; }
}
.hero-lead {
  margin: 1.5rem 0 0;
  font-size: 1.125rem;
  color: var(--fg-muted);
  line-height: 1.6;
}
.hero-meta {
  margin-top: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--fg-muted);
}
.inline-code {
  background: var(--surface-muted);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.feature-section {
  max-width: 72rem;
  margin: 0 auto;
  padding: 0 1.5rem 5rem;
}
.feature-grid {
  display: grid;
  gap: 1rem;
}
@media (min-width: 768px) { .feature-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .feature-grid { grid-template-columns: repeat(3, 1fr); } }
.feature-card {
  display: block;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 0.75rem;
  padding: 1.5rem;
  text-decoration: none;
  color: inherit;
  transition: border-color 150ms, color 150ms;
}
.feature-card:hover { border-color: var(--fg-strong); }
.feature-title { font-weight: 600; margin: 0; }
.feature-desc {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: var(--fg-muted);
}
.feature-card:hover .feature-desc { color: var(--fg-strong); }

/* Auth forms + error page */
.auth-wrap {
  display: flex;
  min-height: 100svh;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.auth-card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.auth-head { text-align: center; }
.heading-lg { font-size: 1.5rem; font-weight: 700; margin: 0; }
.muted { font-size: 0.875rem; color: var(--fg-muted); margin: 0; }
.auth-head .muted { margin-top: 0.25rem; }

.form-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1.5rem;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.form-error {
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  margin: 0;
}
.form-success {
  background: var(--success-bg);
  color: var(--success-fg);
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  margin: 0;
}
.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}
.form-input {
  display: block;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  background: var(--surface);
  color: var(--fg);
  outline: none;
  transition: box-shadow 150ms, border-color 150ms;
}
.form-input:focus {
  border-color: var(--fg-strong);
  box-shadow: 0 0 0 2px var(--fg-strong);
}
.form-submit {
  width: 100%;
  background: var(--fg-strong);
  color: var(--bg-start);
  border: 0;
  border-radius: 0.375rem;
  padding: 0.625rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms;
}
.form-submit:hover { opacity: 0.9; }
.form-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.form-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.875rem;
  color: var(--fg-muted);
}
.auth-link {
  text-decoration: underline;
  transition: color 150ms;
}
.auth-link:hover { color: var(--fg-strong); }

.error-wrap {
  display: flex;
  min-height: 100svh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
  text-align: center;
}
.error-link {
  margin-top: 1rem;
  font-size: 0.875rem;
  text-decoration: underline;
  transition: color 150ms;
}
.error-link:hover { color: var(--fg-strong); }
.empty-state {
  padding: 2rem 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--fg-muted);
}

.form-inline {
  display: flex;
  width: 100%;
  max-width: 28rem;
  gap: 0.5rem;
}

/* AI chat */
.chat-wrap {
  display: flex;
  min-height: 100svh;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
}
.chat-column {
  display: flex;
  width: 100%;
  max-width: 42rem;
  flex: 1;
  flex-direction: column;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.chat-log {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1rem;
  background: var(--surface);
  max-height: calc(100svh - 180px);
}
.chat-row { display: flex; }
.chat-row.is-user { justify-content: flex-end; }
.chat-row.is-assistant { justify-content: flex-start; }
.chat-bubble {
  max-width: 80%;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
}
.chat-bubble.is-user {
  background: var(--fg-strong);
  color: var(--bg-start);
}
.chat-bubble.is-assistant {
  background: var(--surface-muted);
  color: var(--fg);
}
.chat-input {
  margin-top: 0.75rem;
}
`
}
