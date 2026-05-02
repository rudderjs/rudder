# @rudderjs/process

Shell execution facade for RudderJS — run commands, pool parallel execution, pipe output, and fake everything for testing.

## Installation

```bash
pnpm add @rudderjs/process
```

## Usage

### Running Commands

```ts
import { Process } from '@rudderjs/process'

const result = await Process.run('git status')

result.successful()    // true if exit code is 0
result.failed()        // true if exit code is not 0
result.stdout           // stdout output
result.stderr           // stderr output
result.exitCode         // numeric exit code
result.output()         // alias for stdout
result.errorOutput()    // alias for stderr
result.throw()          // throws ProcessFailedException if failed
```

### Builder Pattern

```ts
const result = await Process.command('npm test')
  .path('/path/to/project')
  .timeout(30)                           // seconds
  .env({ NODE_ENV: 'test' })
  .input('stdin data')
  .quietly()                             // suppress onOutput callbacks
  .onOutput((type, data) => {
    console.log(`[${type}] ${data}`)     // real-time output
  })
  .run()
```

### Background Processes

```ts
const running = await Process.start('node server.js')

running.pid          // OS process ID
running.running()    // true while process is alive
running.output()     // stdout collected so far
running.errorOutput()

const result = await running.wait()  // wait for completion
running.kill('SIGTERM')              // or kill it
```

### Pools (Parallel Execution)

```ts
const pool = await Process.pool([
  'npm run build:client',
  'npm run build:server',
  'npm run build:worker',
])

pool.successful()    // true if all commands succeeded
pool.results         // array of ProcessResult
pool.results[0]!.stdout
```

### Pipes

Pipe stdout from one command into stdin of the next:

```ts
const result = await Process.pipe([
  'cat access.log',
  'grep "ERROR"',
  'wc -l',
])

result.stdout.trim()  // "42"
```

Stops on first failure — subsequent commands are skipped.

## Testing

```ts
import { Process } from '@rudderjs/process'

const fake = Process.fake({
  'git status': { stdout: 'On branch main', exitCode: 0 },
  'npm test':   { stdout: '', exitCode: 1, stderr: 'Tests failed' },
})

// Regex patterns
fake.register(/docker.*/, { stdout: 'container started', exitCode: 0 })

// Run commands — intercepted by fake
const result = await Process.run('git status')
result.stdout  // 'On branch main'

// Assertions
fake.assertRan('git status')
fake.assertNotRan('rm -rf /')
fake.assertRanTimes('git status', 1)
fake.assertNothingRan()  // throws if anything ran

fake.restore()
```

## API Reference

### Process (facade)

| Method | Description |
|---|---|
| `Process.run(cmd)` | Run a command and return the result |
| `Process.command(cmd)` | Create a PendingProcess builder |
| `Process.start(cmd)` | Start a background process |
| `Process.pool(cmds)` | Run multiple commands in parallel |
| `Process.pipe(cmds)` | Pipe stdout through a chain of commands |
| `Process.fake(fakes?)` | Install fake for testing |

### PendingProcess (builder)

| Method | Description |
|---|---|
| `.path(dir)` | Set working directory |
| `.timeout(seconds)` | Set timeout (exit code 124 on timeout) |
| `.env(vars)` | Set environment variables |
| `.input(stdin)` | Provide stdin input |
| `.quietly()` | Suppress onOutput callbacks |
| `.tty()` | Inherit stdio (interactive) |
| `.onOutput(fn)` | Real-time output callback |
| `.run()` | Execute and return ProcessResult |
| `.start()` | Execute in background and return RunningProcess |

### ProcessResult

| Property/Method | Description |
|---|---|
| `exitCode` | Numeric exit code |
| `stdout` | Standard output |
| `stderr` | Standard error |
| `successful()` | True if exit code is 0 |
| `failed()` | True if exit code is not 0 |
| `output()` | Alias for stdout |
| `errorOutput()` | Alias for stderr |
| `throw()` | Throws `ProcessFailedException` if failed |

## Common Pitfalls

- **Shell injection from interpolated strings.** `Process.run(\`git checkout ${userInput}\`)` is dangerous. All commands are shell-parsed (`spawn(cmd, [], { shell: true })`) — there is no array-form API that bypasses the shell. Validate/escape user input yourself, or avoid interpolation entirely. Treat command strings like SQL.
- **`.timeout(60)` is seconds, not milliseconds.** `timeout(60_000)` is 1000 minutes, not 1 minute. Timed-out commands exit with code 124 (matches GNU `timeout`).
- **Non-zero exit codes don't throw.** `Process.run()` always resolves; check `result.successful()` / `result.failed()`, or call `result.throw()` to raise `ProcessFailedException`.
- **`Process.start()` keeps the event loop alive.** Background processes need either `await running.wait()` or `running.kill()` — otherwise Node won't exit.
- **`Process.pipe()` stops on first failure.** Downstream commands are skipped — check `result.exitCode`. Use `Process.pool()` if you want all commands to run regardless.
- **Capturing huge stdout.** `result.stdout` holds the entire output in memory. For multi-GB outputs, use `.onOutput((type, data) => ...)` to stream, or redirect inside the shell (`> /tmp/out.log`) and read the file separately.
- **`Process.fake()` is global.** Calling `fake()` while already faked replaces the previous fake (no stack). Always call `fake.restore()` in `afterEach` so state doesn't leak between tests.

## Key Imports

```ts
import { Process } from '@rudderjs/process'

import type {
  ProcessResult,           // { exitCode, stdout, stderr, successful(), failed(), output(), errorOutput(), throw() }
  RunningProcess,          // { pid, running(), output(), errorOutput(), wait(), kill() }
  PendingProcess,          // builder returned by Process.command()
  ProcessPoolResult,       // { results, successful() }
  ProcessFailedException,  // thrown by ProcessResult.throw()
} from '@rudderjs/process'
```
