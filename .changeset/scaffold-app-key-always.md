---
"create-rudder": patch
---

Scaffolded apps always get a generated `APP_KEY` in `.env` (and an `APP_KEY=` placeholder with the `key:generate` hint in `.env.example`). It was gated on selecting the crypt package, but sessions sign with `APP_KEY` regardless — so every fresh non-crypt scaffold (including the default web-app recipe) started with a red `rudder doctor` (`✗ APP_KEY unset`) and unsigned session cookies. Laravel parity: `laravel new` generates the key for every app.
