#!/usr/bin/env node
// `npm create rudder@latest` — thin stub that delegates to create-rudder-app.
// Source of truth lives in /create-rudder-app; this package exists so the
// install command matches the brand (`Rudder`, not `RudderJS-app`).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// create-rudder-app's `main` and `bin` both point at ./dist/index.js, so
// resolving the package entry gives us exactly the file we need to invoke.
// `import.meta.resolve` honors ESM `import` conditions; `require.resolve`
// would fail because the package exports map has no `require` condition.
const entry = fileURLToPath(import.meta.resolve('create-rudder-app'))

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env:   { ...process.env, RUDDER_INVOKED_AS: 'create-rudder' },
})
child.on('exit', code => process.exit(code ?? 0))
