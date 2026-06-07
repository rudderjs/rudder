---
"@rudderjs/cli": minor
---

Add `-t, --with-test` to every CLI-owned `make:*` generator — also writes `tests/<Name>.test.ts` shaped for what was scaffolded: a feature test (AppTestCase + HTTP) for `make:controller`, a unit test (plain node:test, no app boot) for everything else. An existing test file is never overwritten without `--force`, and the generated test carries a `// Covers <path>` pointer back at the scaffolded file.
