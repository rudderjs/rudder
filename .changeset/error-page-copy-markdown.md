---
'@rudderjs/server-hono': minor
---

feat(server-hono): add Copy-as-Markdown button to the dev error page

Adds a one-click button on the Ignition-style dev error page that copies the
full error context as Markdown — heading, location, request, source context
(with `>` marker on the error line), stack frames, and headers — formatted
for pasting directly into an AI chat to debug. Vendor frames are wrapped in
a collapsed `<details>` block so the primary signal stays visible.

The Markdown is pre-rendered server-side and embedded as a JSON-stringified
JS literal in an inline `<script>` block. `<`, `>`, `&`, U+2028, and U+2029
are unicode-escaped (`<`, etc.) so an attacker-controlled error message
or URL can't break out of the script tag — the existing XSS regression
tests for the visible HTML now also cover this path. Clipboard API is used
directly (secure-context only — dev page already requires localhost/https).

Exports `buildErrorMarkdown(error, req, parts)` for callers that want the
same shape outside the rendered page (e.g. logging the markdown directly).
