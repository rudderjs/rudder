#!/usr/bin/env node
// `npm create rudder-app@latest` — legacy alias that delegates to create-rudder.
// Source of truth lives in /create-rudder; this package exists for backwards
// compatibility with the old install command (blog posts, muscle memory).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// create-rudder's `main` and `bin` both point at ./dist/index.js, so
// resolving the package entry gives us exactly the file we need to invoke.
// `import.meta.resolve` honors ESM `import` conditions; `require.resolve`
// would fail because the package exports map has no `require` condition.
const entry = fileURLToPath(import.meta.resolve('create-rudder'))

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env:   { ...process.env, RUDDER_INVOKED_AS: 'create-rudder-app' },
})
child.on('exit', code => process.exit(code ?? 0))
