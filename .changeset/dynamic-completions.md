---
"@rudderjs/cli": minor
---

Add dynamic argument completion to the shell scripts. When completing the argument of a model-oriented make command (`make:factory`, `make:seeder`, `make:policy`, `make:observer`), the script now suggests the project's actual model names, read from `app/Models` via a new internal `rudder completion args` resolver (filesystem only, no app boot). Command-name completion stays static and instant. Non-model command arguments now correctly suggest nothing instead of falling back to the full command list. Works in bash (with the colon-word handling), zsh, and fish.
