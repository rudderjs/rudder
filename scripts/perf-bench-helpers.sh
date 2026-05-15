#!/usr/bin/env bash
# Sourced by scripts/perf-bench.sh AND by every hyperfine inner invocation.
# Defines cold_start_then_kill / first_request_then_kill so they're visible
# inside the bash that hyperfine spawns.

cold_start_then_kill() {
  local cmd="$1"
  local pidfile
  pidfile=$(mktemp)
  # shellcheck disable=SC2086
  ( $cmd >/dev/null 2>&1 & echo $! > "$pidfile"; wait ) &
  local sh_pid=$!
  for _ in $(seq 1 1500); do
    if nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done
  if [[ -f "$pidfile" ]]; then
    local app_pid
    app_pid=$(cat "$pidfile")
    kill -9 "$app_pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
  kill -9 "$sh_pid" 2>/dev/null || true
  for _ in $(seq 1 500); do
    if ! nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done
}

first_request_then_kill() {
  local cmd="$1"
  local path="$2"
  local pidfile
  pidfile=$(mktemp)
  # shellcheck disable=SC2086
  ( $cmd >/dev/null 2>&1 & echo $! > "$pidfile"; wait ) &
  local sh_pid=$!
  for _ in $(seq 1 1500); do
    if nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done
  curl -s -o /dev/null --max-time 10 "http://localhost:$PORT$path" || true
  if [[ -f "$pidfile" ]]; then
    local app_pid
    app_pid=$(cat "$pidfile")
    kill -9 "$app_pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
  kill -9 "$sh_pid" 2>/dev/null || true
  for _ in $(seq 1 500); do
    if ! nc -z localhost "$PORT" 2>/dev/null; then break; fi
    sleep 0.02
  done
}
