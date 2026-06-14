---
"@rudderjs/process": minor
---

Add an argv-array command form and fix several execution bugs.

`Process.run()`/`command()`/`start()`/`pool()` now accept a `string[]` argv form that runs WITHOUT a shell, so arguments are passed verbatim and shell metacharacters (`;`, `|`, `>`, backticks) are not interpreted. This is the safe way to pass user-controlled arguments; the existing string form is still shell-interpreted and convenient for trusted commands.

Bug fixes:
- Multi-byte UTF-8 output is no longer corrupted. stdout/stderr were accumulated with a per-chunk `chunk.toString()`, so a character split across two pipe chunks (output over ~64KB) decoded to replacement characters. Output is now decoded with a `StringDecoder` that holds incomplete trailing bytes across chunks.
- `start()` no longer leaks an unhandled rejection. The internal wait promise wired `child.on('error', reject)` eagerly; if `wait()` was never called (a fire-and-forget process) a spawn error (bad cwd, ENOENT) became an unhandled rejection that can crash the process. The rejection is now observed lazily and still surfaced to a real `wait()` consumer.
- `timeout()` now kills the whole process group on POSIX, not just the shell, so a backgrounded grandchild command is no longer orphaned and left running after the timeout fires. Windows behavior is unchanged.
- `pool()` no longer rejects the entire batch when one command fails to spawn; that command is reported as a failed result, like a non-zero exit.
