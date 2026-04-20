# @rudderjs/process

## Overview

Shell execution facade — Laravel's Process facade for Node. Wraps `child_process` with a fluent builder (`Process.command(...)`), parallel pools (`Process.pool`), pipe chains (`Process.pipe`), background processes (`Process.start`), and full-stack `Process.fake()` for testing. Use this instead of reaching for `child_process.exec` directly — you get timeouts, retries, typed results, and test fakes for free.

## Key Patterns

### Running commands

```ts
import { Process } from '@rudderjs/process'

const result = await Process.run('git status')

result.successful()      // exit code 0
result.failed()
result.exitCode
result.stdout
result.stderr
```

### Builder (`Process.command(...)`)

```ts
const result = await Process
  .command('npm install')
  .path('./my-package')              // cwd
  .timeout(60)                        // seconds — exit code 124 on timeout
  .env({ NODE_ENV: 'production' })
  .input(stdinString)                 // provide stdin
  .quietly()                           // suppress onOutput callbacks
  .onOutput(chunk => process.stdout.write(chunk))   // stream live
  .run()
```

Use `.tty()` to inherit stdio for interactive commands (prompts, SSH, etc.).

### Background processes (`Process.start`)

```ts
const running = await Process.start('npm run dev')

running.pid            // OS pid
running.running()      // true while alive
running.output()       // stdout captured so far
running.errorOutput()

const result = await running.wait()   // await completion
running.kill('SIGTERM')                // or terminate
```

### Pools (parallel)

```ts
const pool = await Process.pool([
  'npm run build:client',
  'npm run build:server',
  'npm run build:worker',
])

pool.successful()           // all commands succeeded
pool.results                // ProcessResult[]
pool.results[0]!.stdout
```

All commands start at once. Useful for parallel build steps, test shards, bulk CLI operations.

### Pipes (chained commands)

```ts
const result = await Process.pipe([
  'cat access.log',
  'grep "ERROR"',
  'wc -l',
])

result.stdout.trim()       // '42'
```

stdout of command N flows into stdin of command N+1. **Stops on first failure** — downstream commands are skipped.

### Testing

```ts
import { Process } from '@rudderjs/process'

const fake = Process.fake({
  'git status': { stdout: 'On branch main', exitCode: 0 },
  'npm test':   { stdout: '', exitCode: 1, stderr: 'Tests failed' },
})

// Regex patterns for dynamic matches
fake.register(/docker\s.*/, { stdout: 'container started', exitCode: 0 })

await Process.run('git status')   // → fake result, no real exec

// Assertions
fake.assertRan('git status')
fake.assertNotRan('rm -rf /')
fake.assertRanTimes('git status', 1)
fake.assertNothingRan()            // fails if anything ran

fake.restore()
```

Nothing touches the shell under `Process.fake()`. Critical for CI — tests can't accidentally shell out.

## Common Pitfalls

- **Shell injection from interpolated strings.** `Process.run(\`git checkout ${userInput}\`)` is dangerous. Prefer array form via `Process.command([...])` or explicitly validate/escape user input. Treat command strings like SQL.
- **`Process.start()` without `await wait()` or `kill()`.** Background processes keep the event loop alive. If you forget both, the Node process won't exit.
- **`.timeout(60)` is seconds, not milliseconds.** Common bug. `timeout(60_000)` = ~1000 minutes, not 1 minute.
- **Pipe with a failing middle command.** Subsequent commands are skipped. Check `result.exitCode` + `result.failed()` to detect partial failure; `pool` completes all and reports individual failures.
- **Capturing huge stdout.** `result.stdout` holds the entire output in memory. For multi-GB outputs, use `.onOutput(chunk => ...)` to stream, or redirect inside the shell (`> /tmp/out.log`) and read the file.
- **Forgetting `fake.restore()` in tests.** Fake state persists globally across tests. Always restore in `afterEach`.
- **Nested faking.** Calling `Process.fake()` while already faked replaces the previous fake. No stack. Design your test setup around a single `fake()` per test.

## Key Imports

```ts
import { Process } from '@rudderjs/process'

import type { ProcessResult, RunningProcess, PendingProcess } from '@rudderjs/process'
```
