---
"@rudderjs/orm": patch
"@rudderjs/ai": patch
"@rudderjs/mail": patch
"@rudderjs/support": patch
---

Second round of CodeQL source hardening.

- `@rudderjs/orm` (**security**) — `make:migration <name>` ran through `spawn(..., { shell: true })` (load-bearing on Windows, where the `pnpm` shim is `pnpm.cmd`), so a crafted name (`pnpm rudder make:migration "x; rm -rf ."`) was a shell-injection vector. The migration name — the only caller-influenced token in the command — is now validated against a strict identifier allowlist (`assertSafeName`) at both the Prisma and Drizzle sink sites; everything else in the command is a hardcoded literal.
- `@rudderjs/ai` — the `web_fetch` tool's HTML→text extraction now removes `<script>`/`<style>` blocks with a tag-filter-safe regex (tolerates `</script >`) and strips remaining tags iteratively to a fixed point. Output is fed to the model as text, never rendered as HTML — this improves extraction robustness, not a security boundary. New `htmlToText` export.
- `@rudderjs/mail` — extracted a shared `stripHtmlTags` helper (loop-to-stable tag removal) used by the Markdown text-alternative and the LogAdapter preview, replacing two single-pass strips.
- `@rudderjs/support` — `ConfigRepository.set()` now guards prototype-polluting keys (`__proto__`/`constructor`/`prototype`) with a literal comparison directly at each assignment site instead of an upfront set-membership check; behavior is unchanged.
