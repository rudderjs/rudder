---
"@rudderjs/server-hono": patch
---

fix: write the perf-boundaries dump to a private temp dir

The dev-only request-latency profiler (`RUDDER_PERF_BOUNDARIES=1`) dumped its
percentile table to a predictable `/tmp/rudder-perf.txt` when `RUDDER_PERF_OUT`
wasn't set, so a local attacker could pre-plant a file/symlink at that path
(TOCTOU — same class as #774/#779). The default now writes inside a private,
randomly-named `fs.mkdtemp()` directory (mode 0700); the resolved path is logged
on write, so the dev still finds the dump. An explicit `RUDDER_PERF_OUT` is still
honoured as-is. Resolves CodeQL `js/insecure-temporary-file`.
