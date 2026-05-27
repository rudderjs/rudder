---
"@rudderjs/cli": patch
---

fix(doctor): load `.env` before env-var checks so `rudder doctor` doesn't report set secrets as unset

The fast-path `rudder doctor` runs skip-boot, so `bootstrap/app.ts`'s `import 'dotenv/config'` never ran — its env-var checks read `process.env` directly and falsely reported vars defined in `.env` (AUTH_SECRET, DATABASE_URL, APP_KEY, …) as "unset", producing red errors and a non-zero exit on a correctly-configured app. The doctor now loads `.env` (non-override, so real exported env vars from Docker/CI/Forge still win) before running checks, so they reflect what the app actually sees at runtime.
