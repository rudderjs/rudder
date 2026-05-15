#!/usr/bin/env bash
#
# Performance comparison runner — RudderJS vs Next.js / Nuxt / SvelteKit.
#
# Usage: scripts/perf-bench.sh [<bench-root>]
#   <bench-root> defaults to ~/perf-bench
#
# Required tools: hyperfine, curl, jq, node, pnpm, nc
# Each app must already be scaffolded + built under <bench-root>/<name>/.
# See docs/plans/2026-05-15-perf-baseline.md for setup.

set -euo pipefail

BENCH_ROOT="${1:-$HOME/perf-bench}"
PORT=7878
COLD_BOOT_RUNS=10
FIRST_REQ_RUNS=5
BUILD_RUNS=3   # builds are expensive — fewer runs
INTERNALS_RUNS=5

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_FILE="$SCRIPT_DIR/perf-bench-results.json"
HELPERS_FILE="$SCRIPT_DIR/perf-bench-helpers.sh"

for tool in hyperfine curl jq node pnpm nc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool not on PATH" >&2
    exit 1
  fi
done

# shellcheck disable=SC1090
source "$HELPERS_FILE"

export PORT
export HELPERS_FILE

FRAMEWORKS="rudderjs next nuxt svelte"

# ─── Per-framework config ────────────────────────────────────────────────

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

fw_build_cmd() {
  case "$1" in
    rudderjs|next|nuxt|svelte) echo "pnpm build" ;;
  esac
}

fw_clean_cmd() {
  case "$1" in
    rudderjs) echo "rm -rf dist" ;;
    next)     echo "rm -rf .next" ;;
    nuxt)     echo "rm -rf .output .nuxt" ;;
    svelte)   echo "rm -rf build .svelte-kit/output" ;;
  esac
}

fw_version() {
  local fw="$1"
  local pkg="$(fw_dir "$fw")/package.json"
  case "$fw" in
    rudderjs) node -e "console.log(require('$(fw_dir rudderjs)/node_modules/@rudderjs/core/package.json').version)" 2>/dev/null || echo "unknown" ;;
    next)     jq -r '.dependencies.next' "$pkg" ;;
    nuxt)     jq -r '.dependencies.nuxt' "$pkg" ;;
    svelte)   jq -r '.devDependencies["@sveltejs/kit"]' "$pkg" ;;
  esac
}

# ─── Provenance ──────────────────────────────────────────────────────────

provenance() {
  local node_ver
  node_ver=$(node -v)
  local hf_ver
  hf_ver=$(hyperfine --version | head -1 | awk '{print $2}')
  local versions_json="{}"
  for fw in $FRAMEWORKS; do
    local ver
    ver=$(fw_version "$fw")
    versions_json=$(echo "$versions_json" | jq --arg fw "$fw" --arg ver "$ver" '. + {($fw): $ver}')
  done
  jq -n \
    --arg node "$node_ver" \
    --arg hf "$hf_ver" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson versions "$versions_json" \
    '{node: $node, hyperfine: $hf, date: $date, versions: $versions}'
}

# ─── Measurements ────────────────────────────────────────────────────────

measure_cold_boot() {
  local fw="$1"
  local dir cmd
  dir=$(fw_dir "$fw")
  cmd=$(fw_start_cmd "$fw")
  cd "$dir"
  hyperfine --warmup 1 --runs "$COLD_BOOT_RUNS" \
    --shell bash --export-json /tmp/hf-cold-$fw.json \
    "bash -c 'source \"$HELPERS_FILE\"; cold_start_then_kill \"$cmd\"'" >/dev/null 2>&1
  jq -r '.results[0].median' /tmp/hf-cold-$fw.json
}

measure_first_request() {
  local fw="$1"
  local path="$2"
  local dir cmd safe
  dir=$(fw_dir "$fw")
  cmd=$(fw_start_cmd "$fw")
  safe=$(echo "$path" | tr / _)
  cd "$dir"
  hyperfine --warmup 1 --runs "$FIRST_REQ_RUNS" \
    --shell bash --export-json /tmp/hf-firstreq-$fw$safe.json \
    "bash -c 'source \"$HELPERS_FILE\"; first_request_then_kill \"$cmd\" \"$path\"'" >/dev/null 2>&1
  jq -r '.results[0].median' /tmp/hf-firstreq-$fw$safe.json
}

measure_build() {
  local fw="$1"
  local dir build clean
  dir=$(fw_dir "$fw")
  build=$(fw_build_cmd "$fw")
  clean=$(fw_clean_cmd "$fw")
  cd "$dir"
  hyperfine --warmup 1 --runs "$BUILD_RUNS" --prepare "$clean" \
    --export-json /tmp/hf-build-$fw.json \
    "$build" >/dev/null 2>&1
  jq -r '.results[0].median' /tmp/hf-build-$fw.json
}

measure_node_modules_size() {
  local fw="$1"
  local dir="$(fw_dir "$fw")/node_modules"
  if [ ! -d "$dir" ]; then echo 0; return; fi
  local kb
  kb=$(du -sk "$dir" 2>/dev/null | awk '{print $1}')
  echo $((kb * 1024))
}

measure_client_js_payload() {
  local fw="$1"
  local dir cmd
  dir=$(fw_dir "$fw")
  cmd=$(fw_start_cmd "$fw")
  cd "$dir"
  local pidfile
  pidfile=$(mktemp)
  # shellcheck disable=SC2086
  ( $cmd >/dev/null 2>&1 & echo $! > "$pidfile"; wait ) >/dev/null 2>&1 &
  local sh_pid=$!
  local i
  for i in $(seq 1 1500); do
    if nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done
  local html
  html=$(curl -s --max-time 10 "http://localhost:$PORT/" || echo "")
  local total=0
  local src
  while IFS= read -r src; do
    [ -z "$src" ] && continue
    case "$src" in http*) continue ;; esac
    local size
    size=$(curl -s -o /dev/null -w "%{size_download}" --max-time 5 "http://localhost:$PORT$src" 2>/dev/null || echo 0)
    total=$((total + size))
  done < <(echo "$html" | grep -oE '<script[^>]+src="[^"]+\.js[^"]*"' | grep -oE 'src="[^"]+"' | sed 's/src="//; s/"$//')
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
  echo "$total"
}

# RudderJS internals — boots with RUDDER_PERF_TRACE=1, parses [perf] lines.
measure_rudderjs_internals() {
  local dir cmd
  dir=$(fw_dir rudderjs)
  cmd=$(fw_start_cmd rudderjs)
  cd "$dir"
  local view_scans="" registers="" boots="" bootstraps=""
  local i
  for i in $(seq 1 $INTERNALS_RUNS); do
    rm -f /tmp/rudder-perf.log
    # shellcheck disable=SC2086
    RUDDER_PERF_TRACE=1 $cmd > /tmp/rudder-perf.log 2>&1 &
    local pid=$!
    local j
    for j in $(seq 1 1500); do
      if nc -z localhost "$PORT" 2>/dev/null; then break; fi
      sleep 0.02
    done
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.3
    local vs reg btm tot
    vs=$(grep -oE 'view-scan [0-9.]+ms' /tmp/rudder-perf.log | head -1 | awk '{print $2}' | sed 's/ms//')
    reg=$(grep -oE 'providers:register [0-9.]+ms' /tmp/rudder-perf.log | head -1 | awk '{print $2}' | sed 's/ms//')
    btm=$(grep -oE 'providers:boot [0-9.]+ms' /tmp/rudder-perf.log | head -1 | awk '{print $2}' | sed 's/ms//')
    tot=$(grep -oE 'application.bootstrap total [0-9.]+ms' /tmp/rudder-perf.log | head -1 | awk '{print $3}' | sed 's/ms//')
    [ -n "$vs" ]  && view_scans="$view_scans $vs"
    [ -n "$reg" ] && registers="$registers $reg"
    [ -n "$btm" ] && boots="$boots $btm"
    [ -n "$tot" ] && bootstraps="$bootstraps $tot"
  done
  # Median = middle element after numeric sort
  local m_vs m_reg m_btm m_tot
  m_vs=$(echo "$view_scans" | tr ' ' '\n' | grep -v '^$' | sort -n | awk '{a[NR]=$1} END{if(NR>0) print a[int((NR+1)/2)]; else print "null"}')
  m_reg=$(echo "$registers" | tr ' ' '\n' | grep -v '^$' | sort -n | awk '{a[NR]=$1} END{if(NR>0) print a[int((NR+1)/2)]; else print "null"}')
  m_btm=$(echo "$boots" | tr ' ' '\n' | grep -v '^$' | sort -n | awk '{a[NR]=$1} END{if(NR>0) print a[int((NR+1)/2)]; else print "null"}')
  m_tot=$(echo "$bootstraps" | tr ' ' '\n' | grep -v '^$' | sort -n | awk '{a[NR]=$1} END{if(NR>0) print a[int((NR+1)/2)]; else print "null"}')
  jq -n \
    --arg vs "$m_vs" --arg reg "$m_reg" --arg btm "$m_btm" --arg tot "$m_tot" \
    '{view_scan_ms: ($vs|tonumber? // null),
      providers_register_ms: ($reg|tonumber? // null),
      providers_boot_ms: ($btm|tonumber? // null),
      application_bootstrap_ms: ($tot|tonumber? // null)}'
}

measure_providers_discover() {
  local dir
  dir=$(fw_dir rudderjs)
  cd "$dir"
  hyperfine --warmup 1 --runs "$INTERNALS_RUNS" \
    --export-json /tmp/hf-providers-discover.json \
    "pnpm rudder providers:discover" >/dev/null 2>&1
  jq -r '.results[0].median' /tmp/hf-providers-discover.json
}

# ─── Main ───────────────────────────────────────────────────────────────

main() {
  echo "==> Provenance"
  local prov
  prov=$(provenance)
  echo "$prov" | jq

  local results="{}"
  for fw in $FRAMEWORKS; do
    echo
    echo "==> $fw"
    echo "  build..."
    local build_med
    build_med=$(measure_build "$fw")
    echo "    median: ${build_med}s"

    echo "  cold boot..."
    local cold_med
    cold_med=$(measure_cold_boot "$fw")
    echo "    median: ${cold_med}s"

    echo "  first request / ..."
    local req_root
    req_root=$(measure_first_request "$fw" "/")
    echo "    median: ${req_root}s"

    echo "  first request /health ..."
    local req_health
    req_health=$(measure_first_request "$fw" "/health")
    echo "    median: ${req_health}s"

    echo "  node_modules size..."
    local nm_size
    nm_size=$(measure_node_modules_size "$fw")
    echo "    ${nm_size} bytes"

    echo "  client JS payload..."
    local js_payload
    js_payload=$(measure_client_js_payload "$fw")
    echo "    ${js_payload} bytes"

    results=$(echo "$results" | jq \
      --arg fw "$fw" \
      --argjson build "$build_med" \
      --argjson cold "$cold_med" \
      --argjson req_root "$req_root" \
      --argjson req_health "$req_health" \
      --argjson nm "$nm_size" \
      --argjson js "$js_payload" \
      '. + {($fw): {build_s: $build, cold_boot_s: $cold, first_request_root_s: $req_root, first_request_health_s: $req_health, node_modules_bytes: $nm, client_js_bytes: $js}}')
  done

  echo
  echo "==> RudderJS internals"
  local pd_med
  pd_med=$(measure_providers_discover)
  echo "  providers:discover median: ${pd_med}s"

  local internals
  internals=$(measure_rudderjs_internals)
  echo "  internals:"
  echo "$internals" | jq

  local final
  final=$(jq -n \
    --argjson prov "$prov" \
    --argjson results "$results" \
    --argjson internals "$internals" \
    --argjson pd "$pd_med" \
    '{provenance: $prov, frameworks: $results, rudderjs_internals: ($internals + {providers_discover_s: $pd})}')

  echo "$final" > "$RESULTS_FILE"
  echo
  echo "==> Wrote $RESULTS_FILE"
}

main
