#!/usr/bin/env bash
#
# Sequential N-request latency on a fresh boot. Used to distinguish
# warm-up cost from persistent per-request overhead.
#
# Usage: scripts/perf-bench-requests.sh [<bench-root>]
#
# For each framework:
#  - cold boot the server (BOOTS times)
#  - fire requests 1..N sequentially to /
#  - record per-request wall time via curl -w "%{time_total}"
#  - kill server, repeat
# Aggregates: median per-request-index across boots.
#
# Output: scripts/perf-bench-requests-results.json

set -euo pipefail

BENCH_ROOT="${1:-$HOME/perf-bench}"
PORT_BASE=7878   # incremented per boot to avoid TIME_WAIT collisions
N_REQUESTS=10
BOOTS=5

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_FILE="$SCRIPT_DIR/perf-bench-requests-results.json"
HELPERS_FILE="$SCRIPT_DIR/perf-bench-helpers.sh"

for tool in curl jq node nc; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not on PATH" >&2; exit 1; }
done

# shellcheck disable=SC1090
source "$HELPERS_FILE"

FRAMEWORKS="rudderjs next nuxt svelte"

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

# One fresh boot on a unique port, fire N requests, output one "i,t" line per request.
# Per-boot unique port avoids TIME_WAIT / port-recycling false-positives where
# nc -z would see a zombie listener from the previous boot.
one_boot_measure() {
  local cmd="$1"
  local port="$2"
  local pidfile
  pidfile=$(mktemp)
  # shellcheck disable=SC2086
  ( PORT="$port" $cmd >/dev/null 2>&1 & echo $! > "$pidfile"; wait ) >/dev/null 2>&1 &
  local sh_pid=$!
  # Wait for the listener — fresh port, no zombies, so nc -z is reliable.
  local j
  for j in $(seq 1 1500); do
    if nc -z localhost "$port" 2>/dev/null; then break; fi
    sleep 0.02
  done
  # Fire N requests. Request 1 is the cold first-render after listener-up.
  local i
  for i in $(seq 1 $N_REQUESTS); do
    local t
    t=$(curl -s -o /dev/null --max-time 30 -w "%{time_total}" "http://localhost:$port/" 2>/dev/null || echo "0")
    echo "$i,$t"
  done
  if [ -f "$pidfile" ]; then
    kill -9 "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  fi
  kill -9 "$sh_pid" 2>/dev/null || true
}

median_seconds() {
  # arg = list of seconds (decimal); print median (still in seconds).
  echo "$*" | tr ' ' '\n' | grep -v '^$' | sort -n \
    | awk '{a[NR]=$1} END{if (NR>0) print a[int((NR+1)/2)]; else print "null"}'
}

# ─── Main ───────────────────────────────────────────────────────────────

main() {
  local results="{}"
  local global_port_offset=0
  for fw in $FRAMEWORKS; do
    echo "==> $fw"
    cd "$(fw_dir "$fw")"
    local cmd
    cmd=$(fw_start_cmd "$fw")

    # samples[i] is a space-separated list of times for request-index i
    local samples_1="" samples_2="" samples_3="" samples_5="" samples_10=""
    local b
    for b in $(seq 1 $BOOTS); do
      local port=$((PORT_BASE + global_port_offset))
      global_port_offset=$((global_port_offset + 1))
      echo "  boot $b/$BOOTS (port $port)..."
      local line idx t
      while IFS=, read -r idx t; do
        case "$idx" in
          1)  samples_1="$samples_1 $t" ;;
          2)  samples_2="$samples_2 $t" ;;
          3)  samples_3="$samples_3 $t" ;;
          5)  samples_5="$samples_5 $t" ;;
          10) samples_10="$samples_10 $t" ;;
        esac
      done < <(one_boot_measure "$cmd" "$port")
    done

    local m1 m2 m3 m5 m10
    m1=$(median_seconds "$samples_1")
    m2=$(median_seconds "$samples_2")
    m3=$(median_seconds "$samples_3")
    m5=$(median_seconds "$samples_5")
    m10=$(median_seconds "$samples_10")
    echo "  medians: req_1=${m1}s req_2=${m2}s req_3=${m3}s req_5=${m5}s req_10=${m10}s"

    results=$(echo "$results" | jq \
      --arg fw "$fw" \
      --argjson r1 "$m1" --argjson r2 "$m2" --argjson r3 "$m3" \
      --argjson r5 "$m5" --argjson r10 "$m10" \
      '. + {($fw): {req_1_s: $r1, req_2_s: $r2, req_3_s: $r3, req_5_s: $r5, req_10_s: $r10}}')
  done

  jq -n \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg node "$(node -v)" \
    --arg n "$N_REQUESTS" --arg b "$BOOTS" \
    --argjson results "$results" \
    '{date: $date, node: $node, n_requests: ($n|tonumber), boots: ($b|tonumber), frameworks: $results}' \
    > "$RESULTS_FILE"

  echo
  echo "==> Wrote $RESULTS_FILE"
  jq '.frameworks' "$RESULTS_FILE"
}

main
