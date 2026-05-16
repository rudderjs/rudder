#!/usr/bin/env bash
#
# Steady-state RPS benchmark — RudderJS vs Next / Nuxt / SvelteKit.
# Follow-up to perf-bench.sh (#479) which measured cold-boot + first-render.
#
# Usage: scripts/perf-bench-rps.sh [<bench-root>]
#   <bench-root> defaults to ~/perf-bench
#
# Required tools: curl, jq, node, pnpm, nc, npx (autocannon resolved via `npx autocannon@latest`)
# Each app must already be built under <bench-root>/<name>/ per #479.

set -euo pipefail

BENCH_ROOT="${1:-$HOME/perf-bench}"
PORT=7878
ITERATIONS=5
WARMUP_REQS=100
DURATION_SEC=30

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_FILE="$SCRIPT_DIR/perf-bench-rps-results.json"
HELPERS_FILE="$SCRIPT_DIR/perf-bench-helpers.sh"

for tool in curl jq node pnpm nc npx; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool not on PATH" >&2
    exit 1
  fi
done

# Pin autocannon version so reruns are reproducible.
AUTOCANNON="npx --yes autocannon@8.0.0"

# shellcheck disable=SC1090
source "$HELPERS_FILE"

export PORT
export HELPERS_FILE

FRAMEWORKS="rudderjs next nuxt svelte"
SCENARIOS="ssr-c10 ssr-c100 json-c10 json-c100"

# Reuse #479's fw_dir / fw_start_cmd via copy-paste — keep this script
# self-contained so it doesn't break if perf-bench.sh changes.
fw_dir() {
  case "$1" in
    rudderjs) echo "$BENCH_ROOT/rudderjs" ;;
    next)     echo "$BENCH_ROOT/next" ;;
    nuxt)     echo "$BENCH_ROOT/nuxt" ;;
    svelte)   echo "$BENCH_ROOT/svelte" ;;
  esac
}

fw_start_cmd() {
  case "$1" in
    rudderjs) echo "node ./dist/server/index.mjs" ;;
    next)     echo "node node_modules/next/dist/bin/next start" ;;
    nuxt)     echo "node .output/server/index.mjs" ;;
    svelte)   echo "node build" ;;
  esac
}

scenario_route() {
  # $1 = framework, $2 = scenario
  local fw="$1" sc="$2"
  case "$sc" in
    ssr-c10|ssr-c100)   echo "/" ;;
    json-c10|json-c100)
      case "$fw" in
        nuxt) echo "/api/health" ;;
        *)    echo "/health" ;;
      esac
      ;;
  esac
}

scenario_conns() {
  case "$1" in
    *-c10)  echo 10 ;;
    *-c100) echo 100 ;;
  esac
}

# Runs ONE scenario for ONE framework, ONE iteration.
# Echoes a single JSON object on stdout with the autocannon results.
run_scenario() {
  local fw="$1"
  local scenario="$2"
  local iter="$3"
  local dir cmd route conns
  dir=$(fw_dir "$fw")
  cmd=$(fw_start_cmd "$fw")
  route=$(scenario_route "$fw" "$scenario")
  conns=$(scenario_conns "$scenario")
  local out="/tmp/autocannon-$fw-$scenario-$iter.json"

  cd "$dir"

  # Spawn server in background
  local pidfile
  pidfile=$(mktemp)
  # shellcheck disable=SC2086
  ( $cmd >/dev/null 2>&1 & echo $! > "$pidfile"; wait ) >/dev/null 2>&1 &
  local sh_pid=$!

  # Wait for port open (up to 30s)
  local i
  for i in $(seq 1 1500); do
    if nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done

  # Warmup — untimed
  for i in $(seq 1 "$WARMUP_REQS"); do
    curl -s -o /dev/null --max-time 5 "http://localhost:$PORT$route" || true
  done

  # Measured run
  $AUTOCANNON \
    -c "$conns" \
    -d "$DURATION_SEC" \
    --json \
    "http://localhost:$PORT$route" \
    > "$out" 2>/dev/null || true

  # Kill server + wait for port clear
  if [ -f "$pidfile" ]; then
    local app_pid
    app_pid=$(cat "$pidfile")
    kill -9 "$app_pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
  kill -9 "$sh_pid" 2>/dev/null || true
  for i in $(seq 1 500); do
    if ! nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done

  # Extract the fields we care about
  jq '{
    req_sec_mean:    .requests.average,
    req_sec_stddev:  .requests.stddev,
    latency_p50_ms:  .latency.p50,
    latency_p99_ms:  .latency.p99,
    latency_max_ms:  .latency.max,
    bytes_per_sec:   .throughput.average,
    non2xx:          .non2xx,
    errors:          .errors,
    timeouts:        .timeouts,
    duration_sec:    .duration
  }' "$out"
}

provenance() {
  local node_ver
  node_ver=$(node -v)
  local ac_ver
  ac_ver=$($AUTOCANNON --version 2>&1 | head -1)
  jq -n \
    --arg node "$node_ver" \
    --arg ac "$ac_ver" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{node: $node, autocannon: $ac, date: $date}'
}

# Aggregates an array of per-iteration JSON results → medians.
aggregate() {
  jq -s '{
    iterations:      length,
    req_sec_median:  ([.[].req_sec_mean] | sort | .[length / 2 | floor]),
    req_sec_min:     ([.[].req_sec_mean] | min),
    req_sec_max:     ([.[].req_sec_mean] | max),
    latency_p50_median_ms: ([.[].latency_p50_ms] | sort | .[length / 2 | floor]),
    latency_p99_median_ms: ([.[].latency_p99_ms] | sort | .[length / 2 | floor]),
    bytes_per_sec_median:  ([.[].bytes_per_sec]  | sort | .[length / 2 | floor]),
    errors_total:    ([.[].errors] | add),
    non2xx_total:    ([.[].non2xx] | add),
    timeouts_total:  ([.[].timeouts] | add),
    raw:             .
  }'
}

main() {
  echo "==> Provenance"
  local prov
  prov=$(provenance)
  echo "$prov" | jq

  local all="{}"
  for fw in $FRAMEWORKS; do
    echo
    echo "==> $fw"
    local fw_results="{}"
    for scenario in $SCENARIOS; do
      echo "  $scenario..."
      local iter_results=""
      for iter in $(seq 1 $ITERATIONS); do
        printf "    iter %d/%d ... " "$iter" "$ITERATIONS"
        local result
        result=$(run_scenario "$fw" "$scenario" "$iter")
        iter_results="$iter_results $result"
        local rps
        rps=$(echo "$result" | jq -r '.req_sec_mean')
        echo "$rps req/sec"
      done
      local agg
      agg=$(echo "$iter_results" | aggregate)
      fw_results=$(echo "$fw_results" | jq --arg s "$scenario" --argjson a "$agg" '. + {($s): $a}')
    done
    all=$(echo "$all" | jq --arg fw "$fw" --argjson r "$fw_results" '. + {($fw): $r}')
  done

  local final
  final=$(jq -n --argjson prov "$prov" --argjson results "$all" \
    '{provenance: $prov, frameworks: $results}')

  echo "$final" > "$RESULTS_FILE"
  echo
  echo "==> Wrote $RESULTS_FILE"
}

main
